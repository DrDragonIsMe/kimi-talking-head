const express = require('express');
const multer = require('multer');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const {
  createJob,
  getJob,
  updateJob,
  listJobs,
  deleteJob,
  sanitizeOutputName,
  PROJECT_ROOT,
} = require('./job-store');

const app = express();
app.use(express.json({ limit: '10mb' }));

const PORT = process.env.PORT || 3456;
const MAX_CONCURRENT = parseInt(process.env.MAX_CONCURRENT || '1', 10);
const UPLOAD_DIR = path.join(PROJECT_ROOT, 'api', 'uploads');
const PUBLIC_DIR = path.join(__dirname, 'public');
const TEMP_DIR = path.join(PROJECT_ROOT, 'temp');
const OUTPUT_DIR = path.join(PROJECT_ROOT, 'output');

// 测试可用环境变量替换真实 pipeline 脚本（默认指向现有脚本）
const PIPELINE_SCRIPT =
  process.env.PIPELINE_SCRIPT || path.join(PROJECT_ROOT, 'scripts', 'pipeline.sh');
const REBUILD_SCRIPT =
  process.env.REBUILD_SCRIPT || path.join(PROJECT_ROOT, 'scripts', 'render_with_reused_media.sh');

// pipeline 的 9 个阶段（与 scripts/lib/state.sh 的 PHASES 保持一致）
const PHASES = ['script', 'tts', 'whisper', 'subtitles', 'storyboard', 'visuals', 'lipsync', 'postprocess', 'render'];

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// 口播文章为纯文本，5MB 足够；限制单文件且只接受 .md/.txt，防磁盘 DoS
const upload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const name = (file.originalname || '').toLowerCase();
    if (name.endsWith('.md') || name.endsWith('.markdown') || name.endsWith('.txt')) {
      cb(null, true);
    } else {
      cb(new Error('只接受 .md / .txt 文章文件'));
    }
  },
});
const DEFAULT_PROFILE_PATH = path.join(PROJECT_ROOT, 'config', 'host_profile.json');

// jobId 由 createJob 用 randomUUID 生成；校验格式，防路径穿越出 api/jobs/
const JOB_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isValidJobId = (id) => JOB_ID_RE.test(id);

// Simple concurrency semaphore for heavy video pipeline.
class Semaphore {
  constructor(max) {
    this.max = max;
    this.count = 0;
    this.queue = [];
  }

  async acquire() {
    if (this.count < this.max) {
      this.count += 1;
      return;
    }
    await new Promise((resolve) => this.queue.push(resolve));
    this.count += 1;
  }

  release() {
    this.count -= 1;
    if (this.queue.length > 0) {
      const next = this.queue.shift();
      next();
    }
  }
}

const pipelineSemaphore = new Semaphore(MAX_CONCURRENT);
// 按 jobId 跟踪所有子进程，stop/shutdown 时按进程组 SIGTERM
const children = new Map();

function deepMerge(target, source) {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (
      source[key] &&
      typeof source[key] === 'object' &&
      !Array.isArray(source[key])
    ) {
      result[key] = deepMerge(result[key] || {}, source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

function writeProfileWithOverrides(job) {
  if (!job.configOverrides) return DEFAULT_PROFILE_PATH;

  const baseProfile = JSON.parse(fs.readFileSync(DEFAULT_PROFILE_PATH, 'utf8'));
  const merged = deepMerge(baseProfile, job.configOverrides);
  fs.writeFileSync(job.profilePath, JSON.stringify(merged, null, 2));
  return job.profilePath;
}

// 路径 containment 校验：resolved 必须落在 baseDir 之内
function isInside(baseDir, resolved) {
  return resolved.startsWith(path.resolve(baseDir) + path.sep);
}

// 读取 temp/<outputName>/.pipeline_state.json 作为阶段进度数据源
function readPipelineState(outputName) {
  const statePath = path.resolve(TEMP_DIR, outputName, '.pipeline_state.json');
  if (!isInside(TEMP_DIR, statePath)) return null;
  if (!fs.existsSync(statePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(statePath, 'utf8'));
  } catch (_err) {
    return null;
  }
}

// 规范化 9 阶段详情（state 文件缺失时全部 pending）
function phaseDetails(state) {
  const result = {};
  for (const phase of PHASES) {
    const s = (state && state[phase]) || {};
    result[phase] = {
      status: s.status || 'pending',
      started_at: s.started_at || null,
      completed_at: s.completed_at || null,
      error: s.error || null,
    };
  }
  return result;
}

// 阶段摘要：x/9 + 当前阶段（running/failed 优先，否则取第一个未完成）
function summarizePhases(state) {
  const details = phaseDetails(state);
  let completed = 0;
  let currentPhase = null;
  for (const phase of PHASES) {
    const status = details[phase].status;
    if (status === 'completed') completed += 1;
    else if (!currentPhase && (status === 'running' || status === 'failed')) currentPhase = phase;
  }
  if (!currentPhase) {
    for (const phase of PHASES) {
      if (details[phase].status !== 'completed') {
        currentPhase = phase;
        break;
      }
    }
  }
  return { completed, total: PHASES.length, currentPhase };
}

function mediaPaths(job) {
  const dir = path.resolve(TEMP_DIR, job.outputName);
  return {
    audio: path.join(dir, 'audio.wav'),
    lip: path.join(dir, 'lip_synced_raw.mp4'),
  };
}

// Rebuild 可用性：TTS 音频 + 唇形同步视频都已存在
function getMediaInfo(job) {
  const paths = mediaPaths(job);
  const audio = isInside(TEMP_DIR, paths.audio) && fs.existsSync(paths.audio);
  const lip = isInside(TEMP_DIR, paths.lip) && fs.existsSync(paths.lip);
  return { audio, lip, ready: audio && lip };
}

function runPipeline(job) {
  return new Promise((resolve) => {
    const profilePath = writeProfileWithOverrides(job);
    const stdoutStream = fs.createWriteStream(job.logs.stdout, { flags: 'a' });
    const stderrStream = fs.createWriteStream(job.logs.stderr, { flags: 'a' });

    const now = new Date().toISOString();
    updateJob(job.jobId, { status: 'running', error: null, exitCode: null, startedAt: now });

    const media = mediaPaths(job);
    const script = job.kind === 'rebuild' ? REBUILD_SCRIPT : PIPELINE_SCRIPT;
    const args =
      job.kind === 'rebuild'
        ? [script, job.articlePath, job.outputName, media.audio, media.lip, profilePath]
        : [script, job.articlePath, job.outputName, profilePath];

    const child = spawn('bash', args, {
      cwd: PROJECT_ROOT,
      env: {
        ...process.env,
        PIPELINE_RUN_ID: job.jobId,
      },
      detached: true,
    });
    children.set(job.jobId, child);

    child.stdout.pipe(stdoutStream);
    child.stderr.pipe(stderrStream);

    child.on('error', (err) => {
      children.delete(job.jobId);
      stdoutStream.end();
      stderrStream.end();
      updateJob(job.jobId, {
        status: 'failed',
        error: `Failed to start pipeline: ${err.message}`,
        finishedAt: new Date().toISOString(),
      });
      resolve();
    });

    child.on('close', (code) => {
      children.delete(job.jobId);
      stdoutStream.end();
      stderrStream.end();

      // stop 已将状态置为 cancelled，保留不再覆盖
      const latest = getJob(job.jobId);
      if (latest && latest.status === 'cancelled') {
        updateJob(job.jobId, { exitCode: code, finishedAt: new Date().toISOString() });
        resolve();
        return;
      }

      const videoExists = fs.existsSync(job.outputs.video) && fs.statSync(job.outputs.video).size > 10000;
      const coverExists = fs.existsSync(job.outputs.cover) && fs.statSync(job.outputs.cover).size > 5000;
      const success = code === 0 && videoExists && coverExists;

      const error = success
        ? null
        : `Pipeline exited with code ${code}; videoExists=${videoExists}, coverExists=${coverExists}`;

      updateJob(job.jobId, {
        status: success ? 'completed' : 'failed',
        exitCode: code,
        error,
        finishedAt: new Date().toISOString(),
      });

      resolve();
    });
  });
}

async function enqueuePipeline(job) {
  await pipelineSemaphore.acquire();
  try {
    // 排队期间可能已被 stop 取消，拿到信号量后复核状态
    const latest = getJob(job.jobId);
    if (!latest || latest.status !== 'queued') return;
    await runPipeline(latest);
  } finally {
    pipelineSemaphore.release();
  }
}

// 排队任务：清 error 后置 queued 并进入信号量队列
function queueJob(jobId, kind) {
  const job = updateJob(jobId, {
    status: 'queued',
    kind,
    error: null,
    exitCode: null,
    queuedAt: new Date().toISOString(),
    startedAt: null,
    finishedAt: null,
  });
  enqueuePipeline(job).catch((err) => {
    console.error(`Pipeline error for job ${jobId}:`, err);
    updateJob(jobId, {
      status: 'failed',
      error: err.message,
      finishedAt: new Date().toISOString(),
    });
  });
  return job;
}

// 停止任务：queued 直接取消；running SIGTERM 整个进程组
function stopJob(job) {
  const now = new Date().toISOString();
  if (job.status === 'queued') {
    return updateJob(job.jobId, { status: 'cancelled', finishedAt: now });
  }
  if (job.status === 'running') {
    updateJob(job.jobId, { status: 'cancelled', finishedAt: now });
    const child = children.get(job.jobId);
    if (child) {
      try {
        // 杀整个进程组（负 PID），确保 ffmpeg/python 等子进程也被终止
        process.kill(-child.pid, 'SIGTERM');
      } catch (_err) {
        try { child.kill('SIGTERM'); } catch (_e) {}
      }
    }
    return getJob(job.jobId);
  }
  return null;
}

function sanitizeField(value, fallback) {
  if (typeof value !== 'string' || !value.trim()) return fallback;
  return value.trim();
}

function serializeJob(job) {
  return {
    jobId: job.jobId,
    status: job.status,
    kind: job.kind || 'full',
    outputName: job.outputName,
    originalName: job.originalName,
    error: job.error,
    exitCode: job.exitCode,
    queuedAt: job.queuedAt || null,
    startedAt: job.startedAt || null,
    finishedAt: job.finishedAt || null,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    outputs: {
      video: `/api/v1/jobs/${job.jobId}/download/video`,
      cover: `/api/v1/jobs/${job.jobId}/download/cover`,
    },
    logs: {
      stdout: `/api/v1/jobs/${job.jobId}/logs/stdout`,
      stderr: `/api/v1/jobs/${job.jobId}/logs/stderr`,
    },
    preview: {
      video: `/api/v1/jobs/${job.jobId}/preview/video`,
      cover: `/api/v1/jobs/${job.jobId}/preview/cover`,
    },
  };
}

// 列表项：附阶段摘要 / hasMedia / hasOutput / queuePosition
function serializeJobListItem(job, queueOrder) {
  const base = serializeJob(job);
  const state = readPipelineState(job.outputName);
  base.phases = summarizePhases(state);
  base.hasMedia = getMediaInfo(job).ready;
  base.hasOutput = fs.existsSync(job.outputs.video);
  base.queuePosition = job.status === 'queued' ? queueOrder.indexOf(job.jobId) + 1 : null;
  return base;
}

// 详情：附完整阶段 / configOverrides / articleText / media
function serializeJobDetail(job) {
  const base = serializeJob(job);
  const state = readPipelineState(job.outputName);
  base.phases = phaseDetails(state);
  base.phasesSummary = summarizePhases(state);
  base.configOverrides = job.configOverrides || null;
  base.media = getMediaInfo(job);
  base.hasOutput = fs.existsSync(job.outputs.video);
  try {
    base.articleText = fs.readFileSync(job.articlePath, 'utf8');
  } catch (_err) {
    base.articleText = null;
  }
  return base;
}

function isActiveStatus(status) {
  return status === 'queued' || status === 'running';
}

// Health check
app.get('/health', (_req, res) => {
  res.json({ ok: true, maxConcurrent: MAX_CONCURRENT, running: pipelineSemaphore.count });
});

// Create a video generation job（multipart 上传或 JSON articleText 均可）
app.post('/api/v1/jobs', upload.single('article'), async (req, res) => {
  try {
    // multipart：上传文章文件，保持既有行为——创建后立即排队
    if (req.file) {
      const outputName = sanitizeField(req.body.outputName, null);
      let configOverrides = null;
      if (req.body.config) {
        try {
          configOverrides = JSON.parse(req.body.config);
        } catch (err) {
          return res.status(400).json({ error: 'Invalid JSON in config field', detail: err.message });
        }
      }

      const job = createJob({
        outputName,
        originalName: req.file.originalname,
        configOverrides,
      });

      // Move uploaded file to job directory as article.md
      fs.renameSync(req.file.path, job.articlePath);

      queueJob(job.jobId, 'full');
      return res.status(202).json(serializeJobDetail(getJob(job.jobId)));
    }

    // JSON body：{outputName, articleText, config, run}
    const { outputName, articleText, config, run } = req.body || {};
    if (typeof articleText !== 'string' || !articleText.trim()) {
      return res.status(400).json({ error: 'Missing articleText (or upload multipart field "article").' });
    }
    if (config !== undefined && config !== null && (typeof config !== 'object' || Array.isArray(config))) {
      return res.status(400).json({ error: 'config must be an object' });
    }

    const job = createJob({
      outputName: sanitizeField(outputName, null),
      originalName: 'article.md',
      configOverrides: config || null,
    });
    fs.writeFileSync(job.articlePath, articleText, 'utf8');

    const shouldRun = run !== false; // run:false 建草稿，默认立即排队
    if (shouldRun) {
      queueJob(job.jobId, 'full');
      return res.status(202).json(serializeJobDetail(getJob(job.jobId)));
    }
    return res.status(201).json(serializeJobDetail(getJob(job.jobId)));
  } catch (err) {
    console.error('Error creating job:', err);
    res.status(500).json({ error: err.message });
  }
});

// List jobs
app.get('/api/v1/jobs', (req, res) => {
  const limit = parseInt(req.query.limit || '50', 10);
  const offset = parseInt(req.query.offset || '0', 10);
  // 队列位置需要在全量 queued 任务里按 queuedAt 排序计算，先取全量再分页
  const all = listJobs({ limit: Number.MAX_SAFE_INTEGER, offset: 0 });
  const queueOrder = all.jobs
    .filter((j) => j.status === 'queued')
    .sort((a, b) => new Date(a.queuedAt || a.createdAt) - new Date(b.queuedAt || b.createdAt))
    .map((j) => j.jobId);
  const page = all.jobs.slice(offset, offset + limit);
  res.json({
    total: all.total,
    limit,
    offset,
    jobs: page.map((j) => serializeJobListItem(j, queueOrder)),
  });
});

// Get job status
app.get('/api/v1/jobs/:id', (req, res) => {
  if (!isValidJobId(req.params.id)) return res.status(400).json({ error: 'Invalid job id' });
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(serializeJobDetail(job));
});

// 修改任务：outputName / configOverrides / articleText；running/queued 拒绝
app.patch('/api/v1/jobs/:id', (req, res) => {
  if (!isValidJobId(req.params.id)) return res.status(400).json({ error: 'Invalid job id' });
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (isActiveStatus(job.status)) {
    return res.status(409).json({ error: `Job is ${job.status}; stop it before editing.` });
  }

  const updates = {};
  const { outputName, configOverrides, articleText } = req.body || {};

  if (outputName !== undefined) {
    if (typeof outputName !== 'string' || !outputName.trim()) {
      return res.status(400).json({ error: 'outputName must be a non-empty string' });
    }
    const safe = sanitizeOutputName(outputName);
    if (!safe) return res.status(400).json({ error: 'outputName is empty after sanitizing' });
    updates.outputName = safe;
    // outputs 路径跟随新名字
    updates.outputs = {
      video: path.join(OUTPUT_DIR, `${safe}.mp4`),
      cover: path.join(OUTPUT_DIR, `${safe}_cover.png`),
    };
  }

  if (configOverrides !== undefined) {
    if (configOverrides !== null && (typeof configOverrides !== 'object' || Array.isArray(configOverrides))) {
      return res.status(400).json({ error: 'configOverrides must be an object or null' });
    }
    // 整体替换 overrides 层（前端负责合并/删 key 后回传完整对象）
    updates.configOverrides = configOverrides;
    updates.profilePath = configOverrides ? job.profilePath || path.join(PROJECT_ROOT, 'api', 'jobs', job.jobId, 'profile.json') : null;
  }

  if (articleText !== undefined) {
    if (typeof articleText !== 'string' || !articleText.trim()) {
      return res.status(400).json({ error: 'articleText must be a non-empty string' });
    }
    fs.writeFileSync(job.articlePath, articleText, 'utf8');
  }

  const next = updateJob(job.jobId, updates);
  res.json(serializeJobDetail(next));
});

// 删除任务：running/queued 先停；?purge=1 同时清理 temp/ 与 output/ 产物
app.delete('/api/v1/jobs/:id', (req, res) => {
  if (!isValidJobId(req.params.id)) return res.status(400).json({ error: 'Invalid job id' });
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  if (isActiveStatus(job.status)) {
    stopJob(job);
  }

  const purged = [];
  if (req.query.purge === '1') {
    // 产物清理严格限制在 temp/ 与 output/ 之内
    const tempDir = path.resolve(TEMP_DIR, job.outputName);
    if (isInside(TEMP_DIR, tempDir) && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
      purged.push(path.relative(PROJECT_ROOT, tempDir));
    }
    for (const p of [job.outputs.video, job.outputs.cover]) {
      const resolved = path.resolve(p);
      if (isInside(OUTPUT_DIR, resolved) && fs.existsSync(resolved)) {
        fs.rmSync(resolved, { force: true });
        purged.push(path.relative(PROJECT_ROOT, resolved));
      }
    }
  }

  deleteJob(job.jobId);
  res.json({ deleted: true, jobId: job.jobId, purged });
});

// 全量重跑：scripts/pipeline.sh
app.post('/api/v1/jobs/:id/run', (req, res) => {
  if (!isValidJobId(req.params.id)) return res.status(400).json({ error: 'Invalid job id' });
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (isActiveStatus(job.status)) {
    return res.status(409).json({ error: `Job is already ${job.status}` });
  }
  if (!fs.existsSync(job.articlePath)) {
    return res.status(400).json({ error: 'Article file missing; edit the job to re-add article text.' });
  }
  queueJob(job.jobId, 'full');
  res.status(202).json(serializeJobDetail(getJob(job.jobId)));
});

// 复用媒体重渲：scripts/render_with_reused_media.sh
app.post('/api/v1/jobs/:id/rebuild', (req, res) => {
  if (!isValidJobId(req.params.id)) return res.status(400).json({ error: 'Invalid job id' });
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (isActiveStatus(job.status)) {
    return res.status(409).json({ error: `Job is already ${job.status}` });
  }
  const media = getMediaInfo(job);
  if (!media.ready) {
    return res.status(400).json({
      error: 'Rebuild requires existing media (temp/<outputName>/audio.wav + lip_synced_raw.mp4). Run the full pipeline first.',
      media,
    });
  }
  queueJob(job.jobId, 'rebuild');
  res.status(202).json(serializeJobDetail(getJob(job.jobId)));
});

// 停止：queued → cancelled；running → SIGTERM 进程组 → cancelled
app.post('/api/v1/jobs/:id/stop', (req, res) => {
  if (!isValidJobId(req.params.id)) return res.status(400).json({ error: 'Invalid job id' });
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  const stopped = stopJob(job);
  if (!stopped) {
    return res.status(409).json({ error: `Job is ${job.status}; only queued/running jobs can be stopped.` });
  }
  res.json(serializeJobDetail(stopped));
});

// 克隆：复制文章 + configOverrides 建新任务（body 可覆盖 outputName/config/run）
app.post('/api/v1/jobs/:id/clone', (req, res) => {
  if (!isValidJobId(req.params.id)) return res.status(400).json({ error: 'Invalid job id' });
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (!fs.existsSync(job.articlePath)) {
    return res.status(400).json({ error: 'Article file missing on source job.' });
  }

  const { outputName, config, run } = req.body || {};
  if (config !== undefined && config !== null && (typeof config !== 'object' || Array.isArray(config))) {
    return res.status(400).json({ error: 'config must be an object' });
  }

  const clone = createJob({
    outputName: sanitizeField(outputName, null) || `${job.outputName}_copy`,
    originalName: job.originalName,
    configOverrides: config !== undefined ? config : job.configOverrides,
  });
  fs.copyFileSync(job.articlePath, clone.articlePath);

  if (run === true) {
    queueJob(clone.jobId, 'full');
    return res.status(202).json(serializeJobDetail(getJob(clone.jobId)));
  }
  res.status(201).json(serializeJobDetail(clone));
});

// 在线预览：res.sendFile 自带 Range 支持，<video> 可拖动
app.get('/api/v1/jobs/:id/preview/:file', (req, res) => {
  if (!isValidJobId(req.params.id)) return res.status(400).json({ error: 'Invalid job id' });
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  const fileType = req.params.file;
  if (fileType !== 'video' && fileType !== 'cover') {
    return res.status(400).json({ error: 'Preview type must be video or cover' });
  }

  const filePath = job.outputs[fileType];
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: `${fileType} not ready` });
  }
  res.sendFile(filePath);
});

// Stream logs
app.get('/api/v1/jobs/:id/logs/:type', (req, res) => {
  if (!isValidJobId(req.params.id)) return res.status(400).json({ error: 'Invalid job id' });
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  const logType = req.params.type;
  if (logType !== 'stdout' && logType !== 'stderr') {
    return res.status(400).json({ error: 'Log type must be stdout or stderr' });
  }

  const logPath = job.logs[logType];
  if (!fs.existsSync(logPath)) {
    return res.status(404).json({ error: 'Log file not found' });
  }

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  fs.createReadStream(logPath).pipe(res);
});

// Download outputs
app.get('/api/v1/jobs/:id/download/:file', (req, res) => {
  if (!isValidJobId(req.params.id)) return res.status(400).json({ error: 'Invalid job id' });
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  const fileType = req.params.file;
  if (fileType !== 'video' && fileType !== 'cover') {
    return res.status(400).json({ error: 'Download type must be video or cover' });
  }

  const filePath = job.outputs[fileType];
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: `${fileType} not ready` });
  }

  const filename = fileType === 'video'
    ? `${job.outputName}.mp4`
    : `${job.outputName}_cover.png`;

  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.sendFile(filePath);
});

// 基础配置 + 表单枚举（供前端渲染分组参数表单）
app.get('/api/v1/config', (_req, res) => {
  let profile = {};
  try {
    profile = JSON.parse(fs.readFileSync(DEFAULT_PROFILE_PATH, 'utf8'));
  } catch (_err) {
    // profile 缺失时返回空默认
  }
  res.json({
    profile: sanitizeSecrets(profile),
    enums: {
      // 字幕 DNA 六套，镜像 src/themes/captions/index.ts 的 CAPTION_DNAS 注册表，改动时需同步
      captionDnas: [
        { id: 'classic', label: '经典' },
        { id: 'loud', label: '醒目大字' },
        { id: 'keynote', label: '发布会' },
        { id: 'cream', label: '奶油风' },
        { id: 'editorial', label: '杂志风' },
        { id: 'documentary', label: '纪录片' },
      ],
      // 镜像 src/components/PortraitHybridLayout.tsx 的 preset 类型
      hybridPresets: [
        { id: 'default', label: '默认' },
        { id: 'host-focus', label: '主播优先' },
        { id: 'visual-focus', label: '画面优先' },
        { id: 'minimal', label: '极简' },
        { id: 'balanced', label: '均衡' },
      ],
      mediaTypes: [
        { id: 'image', label: '图片' },
        { id: 'video', label: '视频' },
        { id: 'mixed', label: '混合' },
      ],
    },
  });
});

// 脱敏：递归剔除 key/secret/token 类字段，避免把 API 密钥吐给前端
function sanitizeSecrets(value) {
  if (Array.isArray(value)) return value.map(sanitizeSecrets);
  if (value && typeof value === 'object') {
    const result = {};
    for (const [k, v] of Object.entries(value)) {
      if (/api_?key|access_?key|secret|token|password/i.test(k)) {
        result[k] = '';
      } else {
        result[k] = sanitizeSecrets(v);
      }
    }
    return result;
  }
  return value;
}

// 静态托管前端 SPA
app.use(express.static(PUBLIC_DIR));

// SPA 回退：非 /api 路径一律返回 index.html（hash 路由由前端接管）
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/') || req.path === '/health') return next();
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'), (err) => {
    if (err) next();
  });
});

// multer 错误（文件超限/类型不符）统一返回 4xx 而不是 500
app.use((err, _req, res, _next) => {
  if (!err) return res.status(500).json({ error: 'Internal error' });
  const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
  res.status(status).json({ error: err.message });
});

const server = app.listen(PORT, () => {
  console.log(`🎬 Talking-head API server listening on http://localhost:${PORT}`);
  console.log(`   Project root: ${PROJECT_ROOT}`);
  console.log(`   Max concurrent pipelines: ${MAX_CONCURRENT}`);
});

function shutdown(signal) {
  console.log(`\nReceived ${signal}, shutting down gracefully...`);
  for (const child of children.values()) {
    try {
      // Kill the entire process group (negative PID) to ensure
      // subprocesses like ffmpeg/python are also terminated.
      process.kill(-child.pid, 'SIGTERM');
    } catch (_err) {
      // Process group may already be gone; fall back to individual kill.
      try { child.kill('SIGTERM'); } catch (_e) {}
    }
  }
  server.close(() => {
    process.exit(0);
  });
  setTimeout(() => {
    console.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

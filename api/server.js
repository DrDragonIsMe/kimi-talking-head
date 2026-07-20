const express = require('express');
const multer = require('multer');
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const cron = require('node-cron');

const {
  createJob,
  getJob,
  updateJob,
  listJobs,
  deleteJob,
  sanitizeOutputName,
  PROJECT_ROOT,
} = require('./job-store');

const {
  PHASES,
  hashText,
  stableStringify,
  computeInvalidationPhase,
  prepareReuseWorkdir,
  aggregateEstimates,
  // 由 api/versioning.js 提供（可能尚未实现，调用侧做容错）
  estimateCost,
} = require('./versioning');

const sseEvents = require('./events');

const app = express();
app.use(express.json({ limit: '10mb' }));

// 外部触发端点（P3-17）：token 即凭证，必须在鉴权中间件之前注册（外部系统无 Bearer token）。
// 具体 handler 在下方定义（依赖 job-store 与 queueJob），这里只挂路径。
app.post('/api/v1/trigger/:token', (req, res, next) => triggerHandler(req, res, next));

// ---------- 鉴权（P2-10） ----------
// WEB_TOKENS="alice:tokenA,bob:tokenB" 启用多用户鉴权；未设置时本机模式全开放（默认）。
// Bearer token 之外还接受 ?access_token=（<video>/<audio>/EventSource 无法带 header）。
const AUTH_USERS = (() => {
  const map = new Map(); // token -> username
  for (const pair of (process.env.WEB_TOKENS || '').split(',')) {
    const idx = pair.indexOf(':');
    if (idx > 0) {
      const user = pair.slice(0, idx).trim();
      const token = pair.slice(idx + 1).trim();
      if (user && token) map.set(token, user);
    }
  }
  return map;
})();
const AUTH_ENABLED = AUTH_USERS.size > 0;

function authMiddleware(req, res, next) {
  if (!AUTH_ENABLED) return next();
  const header = req.headers.authorization || '';
  let token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token && typeof req.query.access_token === 'string') {
    token = req.query.access_token;
  }
  const user = AUTH_USERS.get(token);
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized: a valid Bearer token is required (WEB_TOKENS enabled)' });
  }
  req.user = user;
  next();
}

// /health 与静态 SPA 保持公开；仅 /api 与 /assets 受保护
app.use('/api', authMiddleware);
app.use('/assets', authMiddleware);

// job 归属校验：鉴权开启时只能访问 owner === req.user 的任务（他人任务一律 404）
function requireOwner(job, req, res) {
  if (AUTH_ENABLED && job.owner !== req.user) {
    res.status(404).json({ error: 'Job not found' });
    return false;
  }
  return true;
}

const PORT = process.env.PORT || 3456;
const MAX_CONCURRENT = parseInt(process.env.MAX_CONCURRENT || '1', 10);
const UPLOAD_DIR = path.join(PROJECT_ROOT, 'api', 'uploads');
const PUBLIC_DIR = path.join(__dirname, 'public');
const TEMP_DIR = path.join(PROJECT_ROOT, 'temp');
const OUTPUT_DIR = path.join(PROJECT_ROOT, 'output');

// 测试可用环境变量替换真实 pipeline 脚本（默认指向现有脚本）
const PIPELINE_SCRIPT =
  process.env.PIPELINE_SCRIPT || path.join(PROJECT_ROOT, 'scripts', 'pipeline.sh');

// pipeline 的 9 个阶段由 api/versioning.js 导出（与 scripts/lib/state.sh 的 PHASES 保持一致）

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
const HOSTS_DIR = path.join(PROJECT_ROOT, 'config', 'hosts');
const DEFAULT_HOST_PROFILE = 'host_profile.json';

// 主播配置绝对路径：hostProfile 为 config/hosts/ 下的文件名；null/默认名回退 host_profile.json
function hostProfilePathFor(job) {
  const name = job && job.hostProfile;
  if (name && name !== DEFAULT_HOST_PROFILE) {
    return path.join(HOSTS_DIR, name);
  }
  return DEFAULT_PROFILE_PATH;
}

// 校验 hostProfile 参数：纯 .json 文件名，必须存在于 config/hosts/（默认名等价于不传）
function validateHostProfile(value) {
  if (value === undefined || value === null || value === DEFAULT_HOST_PROFILE) return { value: null };
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_\-]+\.json$/.test(value)) {
    return { error: 'hostProfile must be a plain .json file name under config/hosts/' };
  }
  const resolved = path.resolve(HOSTS_DIR, value);
  if (!isInside(HOSTS_DIR, resolved) || !fs.existsSync(resolved)) {
    return { error: `hostProfile "${value}" not found under config/hosts/` };
  }
  return { value };
}

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
  const basePath = hostProfilePathFor(job);
  if (!job.configOverrides) return basePath;

  const baseProfile = JSON.parse(fs.readFileSync(basePath, 'utf8'));
  const merged = deepMerge(baseProfile, job.configOverrides);
  fs.writeFileSync(job.profilePath, JSON.stringify(merged, null, 2));
  return job.profilePath;
}

// 路径 containment 校验：resolved 必须落在 baseDir 之内
function isInside(baseDir, resolved) {
  return resolved.startsWith(path.resolve(baseDir) + path.sep);
}

// 读取 temp/<outputName>/.pipeline_state.json 作为阶段进度数据源。
// 按 (mtimeMs, size) 指纹缓存解析结果：SSE 进度轮询（默认 3s）与详情接口都走这里，
// 指纹不变不重读盘，避免活跃任务多时每轮重复 read+parse。
const pipelineStateCache = new Map(); // statePath -> { fingerprint, state }
function readPipelineState(outputName) {
  const statePath = path.resolve(TEMP_DIR, outputName, '.pipeline_state.json');
  if (!isInside(TEMP_DIR, statePath)) return null;
  let stat = null;
  try {
    stat = fs.statSync(statePath);
  } catch (_err) {
    stat = null;
  }
  const fingerprint = stat ? `${stat.mtimeMs}:${stat.size}` : 'missing';
  const cached = pipelineStateCache.get(statePath);
  if (cached && cached.fingerprint === fingerprint) return cached.state;
  let state = null;
  if (stat) {
    try {
      state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    } catch (_err) {
      state = null;
    }
  }
  pipelineStateCache.set(statePath, { fingerprint, state });
  // 缓存条目数与 temp/ 下的 run 数同量级；超限时整体清空重建，防无界增长
  if (pipelineStateCache.size > 1000) pipelineStateCache.clear();
  return state;
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

// 最新版本记录（无版本时返回 null，兼容未版本化的旧任务）
function latestVersionRecord(job) {
  const lv = job.latestVersion || 0;
  if (lv >= 1 && Array.isArray(job.versions) && job.versions[lv - 1]) {
    return job.versions[lv - 1];
  }
  return null;
}

// 当前工作目录名：最新版本的 runName；未跑过的任务退回 outputName
function currentRunName(job) {
  const record = latestVersionRecord(job);
  return record ? record.runName : job.outputName;
}

// SSE 广播：job 状态变更时推送 {type:'job', jobId, status, latestVersion, owner}
function publishJobEvent(job) {
  if (!job || !job.jobId) return;
  sseEvents.publish({
    type: 'job',
    jobId: job.jobId,
    status: job.status,
    latestVersion: job.latestVersion || 0,
    owner: job.owner || null,
  });
}

// ---------- SSE 进度 watcher ----------
// 任务处于 running/queued 期间，阶段进度与日志持续变化但 status 不变，
// publishJobEvent 不会触发——只靠前端的轮询又会被 SSE 抑制（页面"冻住"）。
// 这里服务端轮询活跃任务的 state/日志指纹，有变化就广播，驱动前端刷新。
const PROGRESS_WATCH_MS = parseInt(process.env.PROGRESS_WATCH_MS || '3000', 10);
const progressFingerprints = new Map(); // jobId -> fingerprint string
const previewNotified = new Set(); // `${jobId}:${runName}` —— preview_ready 每个 run 只推一次

// 渐进式预览（P2-16）：pipeline 在 video_layout.preview.enabled 时于 render 早期产出
// temp/<run>/preview.mp4；服务端只认文件存在性（未开启时 pipeline 不产出，无需重复判配置）
function previewPathFor(job) {
  const p = path.resolve(TEMP_DIR, currentRunName(job), 'preview.mp4');
  return isInside(TEMP_DIR, p) ? p : null;
}

function logSize(file) {
  try {
    return fs.existsSync(file) ? fs.statSync(file).size : 0;
  } catch (_err) {
    return 0;
  }
}

function progressFingerprint(job) {
  const summary = summarizePhases(readPipelineState(currentRunName(job)));
  const outSize = job.logs ? logSize(job.logs.stdout) : 0;
  const errSize = job.logs ? logSize(job.logs.stderr) : 0;
  return `${job.status}|${summary.completed}/${summary.currentPhase}|${outSize}|${errSize}`;
}

function watchProgress() {
  let jobs;
  try {
    jobs = listJobs({ limit: 200, offset: 0 }).jobs;
  } catch (_err) {
    return;
  }
  const activeIds = new Set();
  for (const job of jobs) {
    if (job.status !== 'running' && job.status !== 'queued') continue;
    activeIds.add(job.jobId);
    // 低清预览已产出：推 preview_ready（每个 run 一次；与进度指纹无关，文件出现即推）
    const previewKey = `${job.jobId}:${currentRunName(job)}`;
    if (!previewNotified.has(previewKey)) {
      const previewPath = previewPathFor(job);
      if (previewPath && fs.existsSync(previewPath)) {
        previewNotified.add(previewKey);
        sseEvents.publish({
          type: 'preview_ready',
          jobId: job.jobId,
          runName: currentRunName(job),
          preview: `/api/v1/jobs/${job.jobId}/preview`,
          owner: job.owner || null,
        });
      }
    }
    const fp = progressFingerprint(job);
    if (progressFingerprints.get(job.jobId) === fp) continue;
    progressFingerprints.set(job.jobId, fp);
    publishJobEvent(job);
  }
  // 任务终态后清掉指纹，避免内存随任务数增长
  for (const id of [...progressFingerprints.keys()]) {
    if (activeIds.has(id)) continue;
    progressFingerprints.delete(id);
    for (const key of [...previewNotified]) {
      if (key.startsWith(`${id}:`)) previewNotified.delete(key);
    }
  }
}

const progressWatcher = setInterval(watchProgress, PROGRESS_WATCH_MS);
progressWatcher.unref();

// ---------- Webhook（P2-11 / P3-11） ----------
// 版本到达终态（completed/failed/cancelled）时 POST JSON，最多 3 次尝试（1s/3s backoff，5s 超时）。
// fire-and-forget：绝不阻塞任务生命周期；最终失败写进 job 的 stderr 日志。
// 投递状态持久化在版本记录的 webhookDelivery 字段（{status, attempts, lastAttemptAt, lastError}），
// 进程重启后扫描 pending 恢复投递，并用持久化的 delivered 状态替代纯内存去重（防重启重复投递）。
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);
const webhookSent = new Set(); // 同一 (jobId, version, status) 只投递一次（进程内第一道防线）

function isValidWebhookUrl(value) {
  if (typeof value !== 'string' || !value || value.length > 2048) return false;
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch (_err) {
    return false;
  }
}

function logWebhookFailure(job, message) {
  try {
    fs.appendFileSync(job.logs.stderr, `[webhook] ${new Date().toISOString()} ${message}\n`);
  } catch (_err) { /* 日志写不进去只能放弃 */ }
}

// 持久化投递状态到指定版本记录（读-改-写 state.json）
function persistWebhookDelivery(jobId, version, patch) {
  const job = getJob(jobId);
  if (!job || !Array.isArray(job.versions)) return;
  const idx = job.versions.findIndex((v) => v.version === version);
  if (idx < 0) return;
  const versions = job.versions.slice();
  const current = versions[idx].webhookDelivery || { status: 'pending', attempts: 0, lastAttemptAt: null, lastError: null };
  versions[idx] = { ...versions[idx], webhookDelivery: { ...current, ...patch } };
  updateJob(jobId, { versions });
}

function retryOrFailWebhook(job, payload, attempt, reason) {
  if (attempt < 3) {
    const timer = setTimeout(() => deliverWebhook(job, payload, attempt + 1), attempt === 1 ? 1000 : 3000);
    timer.unref();
    return;
  }
  persistWebhookDelivery(job.jobId, payload.version, { status: 'failed', lastError: reason });
  logWebhookFailure(job, `webhook delivery failed after 3 attempts: ${reason} (${job.webhookUrl})`);
}

function deliverWebhook(job, payload, attempt = 1) {
  const body = JSON.stringify(payload);
  let url;
  try {
    url = new URL(job.webhookUrl);
  } catch (_err) {
    persistWebhookDelivery(job.jobId, payload.version, { status: 'failed', lastError: 'invalid webhookUrl' });
    return logWebhookFailure(job, `invalid webhookUrl: ${job.webhookUrl}`);
  }
  // 每次尝试先落盘（attempts/lastAttemptAt），进程在投递间隙被杀也能从未完成状态恢复
  persistWebhookDelivery(job.jobId, payload.version, {
    status: 'pending',
    attempts: attempt,
    lastAttemptAt: new Date().toISOString(),
  });
  const mod = url.protocol === 'https:' ? https : http;
  const req = mod.request(
    {
      method: 'POST',
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: 5000,
    },
    (res) => {
      res.resume();
      if (res.statusCode >= 200 && res.statusCode < 300) {
        persistWebhookDelivery(job.jobId, payload.version, { status: 'delivered', lastError: null });
        return;
      }
      retryOrFailWebhook(job, payload, attempt, `HTTP ${res.statusCode}`);
    }
  );
  req.on('timeout', () => req.destroy(new Error('timeout after 5s')));
  req.on('error', (err) => retryOrFailWebhook(job, payload, attempt, err.message));
  req.write(body);
  req.end();
}

function maybeDeliverWebhook(job) {
  if (!job || !job.webhookUrl) return;
  const record = latestVersionRecord(job);
  if (!record) return;
  // 持久化的 delivered 状态跨重启有效（内存 webhookSent 重启即丢，不能单独依赖）
  if (record.webhookDelivery && record.webhookDelivery.status === 'delivered') return;
  const key = `${job.jobId}:${record.version}:${record.status}`;
  if (webhookSent.has(key)) return;
  webhookSent.add(key);
  deliverWebhook(job, {
    jobId: job.jobId,
    outputName: job.outputName,
    version: record.version,
    status: record.status,
    error: record.error || null,
    finishedAt: record.finishedAt || new Date().toISOString(),
  });
}

// 启动恢复：扫描所有版本记录里 webhookDelivery.status === 'pending' 且版本已到终态的投递，
// 从已尝试次数继续（attempts 已达到 3 的直接落 failed，不再投递）。
function resumePendingWebhooks() {
  let jobs;
  try {
    jobs = listJobs({ limit: Number.MAX_SAFE_INTEGER, offset: 0 }).jobs;
  } catch (_err) {
    return;
  }
  for (const job of jobs) {
    if (!job.webhookUrl || !Array.isArray(job.versions)) continue;
    for (const record of job.versions) {
      const delivery = record.webhookDelivery;
      if (!delivery || delivery.status !== 'pending') continue;
      if (!TERMINAL_STATUSES.has(record.status)) continue;
      if ((delivery.attempts || 0) >= 3) {
        persistWebhookDelivery(job.jobId, record.version, { status: 'failed', lastError: 'process exited before retries finished' });
        continue;
      }
      const key = `${job.jobId}:${record.version}:${record.status}`;
      webhookSent.add(key);
      console.log(`🔁 恢复 webhook 投递：job ${job.jobId} v${record.version}（第 ${(delivery.attempts || 0) + 1} 次尝试）`);
      deliverWebhook(job, {
        jobId: job.jobId,
        outputName: job.outputName,
        version: record.version,
        status: record.status,
        error: record.error || null,
        finishedAt: record.finishedAt || new Date().toISOString(),
      }, (delivery.attempts || 0) + 1);
    }
  }
}

// 顶层字段更新的同时镜像到最新版本记录（列表/详情兼容性）
function updateJobAndLatestVersion(jobId, updates) {
  const job = getJob(jobId);
  if (!job) return null;
  const next = { ...job, ...updates };
  const lv = job.latestVersion || 0;
  if (lv >= 1 && Array.isArray(job.versions) && job.versions[lv - 1]) {
    const versions = job.versions.slice();
    const record = { ...versions[lv - 1] };
    for (const key of ['status', 'error', 'exitCode', 'queuedAt', 'startedAt', 'finishedAt']) {
      if (key in updates) record[key] = updates[key];
    }
    versions[lv - 1] = record;
    next.versions = versions;
  }
  const result = updateJob(jobId, next);
  if (updates && 'status' in updates) {
    publishJobEvent(result);
    if (TERMINAL_STATUSES.has(updates.status)) {
      maybeDeliverWebhook(result);
    }
  }
  return result;
}

function mediaPaths(job) {
  const dir = path.resolve(TEMP_DIR, currentRunName(job));
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
    updateJobAndLatestVersion(job.jobId, { status: 'running', error: null, exitCode: null, startedAt: now });

    // 版本化运行：runName 来自版本记录（v1=outputName，vN=<outputName>_vN）。
    // full/rebuild/retry 统一走 PIPELINE_SCRIPT，复用与瘦身由排队时的 workdir prep 决定；
    // retry 指定阶段时在版本记录上带 forcePhase，注入 FORCE_<PHASE>=1 定点重跑。
    const record = latestVersionRecord(job);
    const runName = record ? record.runName : job.outputName;
    const args = [PIPELINE_SCRIPT, job.articlePath, runName, profilePath];

    const env = { ...process.env, PIPELINE_RUN_ID: job.jobId };
    // 多主播：pipeline 经 HOST_PROFILE 读取选中的主播配置（绝对路径硬约定）
    env.HOST_PROFILE = hostProfilePathFor(job);
    const forcePhase = record && record.forcePhase;
    if (forcePhase && PHASES.includes(forcePhase)) {
      env[`FORCE_${forcePhase.toUpperCase()}`] = '1';
    }

    const child = spawn('bash', args, {
      cwd: PROJECT_ROOT,
      env,
      detached: true,
    });
    children.set(job.jobId, child);

    child.stdout.pipe(stdoutStream);
    child.stderr.pipe(stderrStream);

    child.on('error', (err) => {
      children.delete(job.jobId);
      stdoutStream.end();
      stderrStream.end();
      updateJobAndLatestVersion(job.jobId, {
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
        updateJobAndLatestVersion(job.jobId, { exitCode: code, finishedAt: new Date().toISOString() });
        resolve();
        return;
      }

      const videoExists = fs.existsSync(job.outputs.video) && fs.statSync(job.outputs.video).size > 10000;
      const coverExists = fs.existsSync(job.outputs.cover) && fs.statSync(job.outputs.cover).size > 5000;
      const success = code === 0 && videoExists && coverExists;

      const error = success
        ? null
        : `Pipeline exited with code ${code}; videoExists=${videoExists}, coverExists=${coverExists}`;

      updateJobAndLatestVersion(job.jobId, {
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

// 排队任务：创建新版本（快照 config + 文章 hash），重跑时按失效阶段复用上版工作目录。
// 失效起点：rebuild 固定 render（瘦身：零 GPU 零 LLM）；fromPhase 手动指定；否则按 diff 推导。
function queueJob(jobId, kind, options = {}) {
  const fromPhase = options.fromPhase || null;
  const current = getJob(jobId);
  if (!current) return null;

  let articleText = null;
  try {
    articleText = fs.readFileSync(current.articlePath, 'utf8');
  } catch (_err) {
    // /run 已在路由层校验文章存在；rebuild 缺失文章时由脚本自身报错
  }
  const articleHash = articleText == null ? null : hashText(articleText);
  const versions = Array.isArray(current.versions) ? current.versions : [];
  const version = (current.latestVersion || 0) + 1;
  const runName = version === 1 ? current.outputName : `${current.outputName}_v${version}`;
  const prevRecord = version > 1 ? versions[version - 2] || null : null;

  // 没改的不重跑：克隆上版 workdir，并把失效阶段起全部置回 pending
  if (prevRecord) {
    let invalidationPhase;
    if (kind === 'rebuild') {
      invalidationPhase = 'render';
    } else if (fromPhase) {
      invalidationPhase = fromPhase;
    } else {
      invalidationPhase = computeInvalidationPhase(
        { articleHash: prevRecord.articleHash, config: prevRecord.configSnapshot },
        { articleHash, config: current.configOverrides }
      );
    }
    const prepared = prepareReuseWorkdir({
      tempDir: TEMP_DIR,
      prevRunName: prevRecord.runName,
      newRunName: runName,
      invalidationPhase,
    });
    if (prepared.copied) {
      console.log(`♻️  job ${jobId} v${version} (${kind}): 复用 ${prevRecord.runName}，从 ${invalidationPhase} 起重跑`);
    }
  }

  const now = new Date().toISOString();
  let configSnapshot = current.configOverrides ? JSON.parse(JSON.stringify(current.configOverrides)) : null;
  if (fromPhase) {
    // 手动指定重跑起点（如口播稿微调）：在快照里记录来源，便于追溯
    configSnapshot = { ...(configSnapshot || {}), scriptEdited: true, fromPhase };
  }
  const record = {
    version,
    runName,
    kind,
    status: 'queued',
    configSnapshot,
    articleHash,
    error: null,
    exitCode: null,
    queuedAt: now,
    startedAt: null,
    finishedAt: null,
    outputs: {
      video: path.join(OUTPUT_DIR, `${runName}.mp4`),
      cover: path.join(OUTPUT_DIR, `${runName}_cover.png`),
    },
  };
  // webhook 投递状态随版本持久化（重启后恢复/去重，见 resumePendingWebhooks）
  if (current.webhookUrl) {
    record.webhookDelivery = { status: 'pending', attempts: 0, lastAttemptAt: null, lastError: null };
  }

  const job = updateJob(jobId, {
    status: 'queued',
    kind,
    error: null,
    exitCode: null,
    queuedAt: now,
    startedAt: null,
    finishedAt: null,
    versions: [...versions, record],
    latestVersion: version,
    // 顶层 outputs 镜像最新版本
    outputs: record.outputs,
  });
  publishJobEvent(job);
  enqueuePipeline(job).catch((err) => {
    console.error(`Pipeline error for job ${jobId}:`, err);
    updateJobAndLatestVersion(jobId, {
      status: 'failed',
      error: err.message,
      finishedAt: new Date().toISOString(),
    });
  });
  return job;
}

// 失败重试：同一版本续跑（不产生新版本，state 机自动跳过 completed 阶段）；
// 指定 phase 时在版本记录上打 forcePhase，runPipeline 注入 FORCE_<PHASE>=1 定点重跑。
function retryJob(jobId, phase) {
  const current = getJob(jobId);
  if (!current) return null;
  const now = new Date().toISOString();
  const reset = {
    status: 'queued',
    error: null,
    exitCode: null,
    queuedAt: now,
    startedAt: null,
    finishedAt: null,
  };
  const updates = { ...reset };
  const lv = current.latestVersion || 0;
  if (lv >= 1 && Array.isArray(current.versions) && current.versions[lv - 1]) {
    const versions = current.versions.slice();
    const record = { ...versions[lv - 1], ...reset, forcePhase: phase || null };
    // 同版本重跑会再次到达终态：重置投递状态并清掉进程内去重键，让 webhook 重新投递
    if (current.webhookUrl) {
      record.webhookDelivery = { status: 'pending', attempts: 0, lastAttemptAt: null, lastError: null };
      for (const s of TERMINAL_STATUSES) webhookSent.delete(`${jobId}:${lv}:${s}`);
    }
    versions[lv - 1] = record;
    updates.versions = versions;
  }
  const job = updateJob(jobId, updates);
  publishJobEvent(job);
  enqueuePipeline(job).catch((err) => {
    console.error(`Pipeline error for job ${jobId}:`, err);
    updateJobAndLatestVersion(jobId, {
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
    return updateJobAndLatestVersion(job.jobId, { status: 'cancelled', finishedAt: now });
  }
  if (job.status === 'running') {
    updateJobAndLatestVersion(job.jobId, { status: 'cancelled', finishedAt: now });
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
    hostProfile: job.hostProfile || null,
    schedule: job.schedule || null,
    triggerToken: job.triggerToken || null,
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
  const state = readPipelineState(currentRunName(job));
  base.phases = summarizePhases(state);
  base.hasMedia = getMediaInfo(job).ready;
  base.hasOutput = fs.existsSync(job.outputs.video);
  base.queuePosition = job.status === 'queued' ? queueOrder.indexOf(job.jobId) + 1 : null;
  base.latestVersion = job.latestVersion || 0;
  return base;
}

// 版本记录序列化：产物链接带 ?version=N，可单独预览/下载
function serializeVersion(job, record) {
  return {
    version: record.version,
    runName: record.runName,
    kind: record.kind,
    status: record.status,
    error: record.error || null,
    exitCode: record.exitCode === undefined ? null : record.exitCode,
    queuedAt: record.queuedAt || null,
    startedAt: record.startedAt || null,
    finishedAt: record.finishedAt || null,
    configSnapshot: record.configSnapshot === undefined ? null : record.configSnapshot,
    hasOutput: !!(record.outputs && fs.existsSync(record.outputs.video)),
    outputs: {
      video: `/api/v1/jobs/${job.jobId}/download/video?version=${record.version}`,
      cover: `/api/v1/jobs/${job.jobId}/download/cover?version=${record.version}`,
    },
    preview: {
      video: `/api/v1/jobs/${job.jobId}/preview/video?version=${record.version}`,
      cover: `/api/v1/jobs/${job.jobId}/preview/cover?version=${record.version}`,
    },
  };
}

// 快照对比前剔除手动重跑写入的元信息键（scriptEdited/fromPhase），避免 configDirty 永远为 true
function normalizeConfigForCompare(cfg) {
  const clone = cfg && typeof cfg === 'object' ? { ...cfg } : {};
  delete clone.scriptEdited;
  delete clone.fromPhase;
  return clone;
}

// 当前 {configOverrides, articleText} 与最新版本快照是否不一致
function computeConfigDirty(job, articleText) {
  const record = latestVersionRecord(job);
  if (!record) return false;
  const articleHash = articleText == null ? null : hashText(articleText);
  if (articleHash && record.articleHash && articleHash !== record.articleHash) return true;
  return stableStringify(normalizeConfigForCompare(job.configOverrides)) !== stableStringify(normalizeConfigForCompare(record.configSnapshot));
}

// 详情：附完整阶段 / configOverrides / articleText / media / versions / configDirty
function serializeJobDetail(job) {
  const base = serializeJob(job);
  const state = readPipelineState(currentRunName(job));
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
  const versions = Array.isArray(job.versions) ? job.versions : [];
  base.versions = versions.map((record) => serializeVersion(job, record));
  base.latestVersion = job.latestVersion || 0;
  base.configDirty = computeConfigDirty(job, base.articleText);
  // 成本预估（P2-15）：estimateCost 由 api/versioning.js 提供，未实现/异常时容错为 null
  base.costEstimate = null;
  if (typeof estimateCost === 'function' && base.articleText) {
    try {
      base.costEstimate = estimateCost(base.articleText, job.configOverrides || null);
    } catch (_err) {
      base.costEstimate = null;
    }
  }
  return base;
}

function isActiveStatus(status) {
  return status === 'queued' || status === 'running';
}

// ---------- 口播稿质量预检（P1-14） ----------
// 硬约定：node scripts/validate_article.js <articlePath>，退出码 0=通过 / 1=不通过，
// stdout 输出 JSON {ok, checks:[{name,ok,detail}]}。脚本缺失/超时/输出非法时容错放行（预检不阻塞主流程）。
// ARTICLE_VALIDATE_MODE=warn 降级为警告（照常建任务，响应带 articleWarnings）；
// ARTICLE_VALIDATE_SCRIPT 可覆盖脚本路径（测试注入 stub 用）。
const ARTICLE_VALIDATE_SCRIPT =
  process.env.ARTICLE_VALIDATE_SCRIPT || path.join(PROJECT_ROOT, 'scripts', 'validate_article.js');
const ARTICLE_VALIDATE_MODE = process.env.ARTICLE_VALIDATE_MODE || 'block';

// 返回 {ok, checks?}；null = 预检不可用/结果不可解析（放行）
function validateArticle(articlePath) {
  if (!fs.existsSync(ARTICLE_VALIDATE_SCRIPT)) return null;
  try {
    const out = execFileSync('node', [ARTICLE_VALIDATE_SCRIPT, articlePath], {
      timeout: 30000,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return JSON.parse(out);
  } catch (err) {
    // 校验脚本报"不通过"时以非 0 退出：stdout 里带 JSON 详情
    if (err && typeof err.status === 'number' && err.stdout) {
      try {
        return JSON.parse(err.stdout);
      } catch (_e) { /* 输出不可解析，按放行处理 */ }
    }
    return null;
  }
}

// ---------- 定时任务（P3-17，node-cron） ----------
// job.schedule 为 cron 表达式；任务触发 = 对该 job 发起一次全量 run（活跃中则跳过本轮）。
const scheduledTasks = new Map(); // jobId -> node-cron task

function registerScheduledJob(job) {
  unregisterScheduledJob(job.jobId);
  if (!job.schedule || !cron.validate(job.schedule)) return;
  const task = cron.schedule(job.schedule, () => {
    const latest = getJob(job.jobId);
    if (!latest || isActiveStatus(latest.status)) return; // 运行/排队中跳过本轮
    if (!fs.existsSync(latest.articlePath)) return;
    console.log(`⏰ 定时触发 job ${job.jobId}（${job.schedule}）`);
    queueJob(job.jobId, 'full');
  });
  task.unref(); // 不阻塞进程退出
  scheduledTasks.set(job.jobId, task);
}

function unregisterScheduledJob(jobId) {
  const task = scheduledTasks.get(jobId);
  if (task) {
    try { task.stop(); } catch (_e) {}
    try { task.destroy(); } catch (_e) {}
    scheduledTasks.delete(jobId);
  }
}

// 服务启动时加载所有带 schedule 的任务
function loadScheduledJobs() {
  let jobs;
  try {
    jobs = listJobs({ limit: Number.MAX_SAFE_INTEGER, offset: 0 }).jobs;
  } catch (_err) {
    return;
  }
  for (const job of jobs) {
    if (job.schedule) registerScheduledJob(job);
  }
}

// 外部触发：POST /api/v1/trigger/<token>（token 即凭证，路由在鉴权中间件之前注册）
function triggerHandler(req, res) {
  const token = req.params.token;
  if (typeof token !== 'string' || token.length < 16 || token.length > 128) {
    return res.status(404).json({ error: 'Unknown trigger token' });
  }
  const jobs = listJobs({ limit: Number.MAX_SAFE_INTEGER, offset: 0 }).jobs;
  const job = jobs.find((j) => j.triggerToken === token);
  if (!job) return res.status(404).json({ error: 'Unknown trigger token' });
  if (isActiveStatus(job.status)) {
    return res.status(409).json({ error: `Job is already ${job.status}` });
  }
  if (!fs.existsSync(job.articlePath)) {
    return res.status(400).json({ error: 'Article file missing; edit the job to re-add article text.' });
  }
  queueJob(job.jobId, 'full');
  res.status(202).json(serializeJobDetail(getJob(job.jobId)));
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
      const webhookUrl = sanitizeField(req.body.webhookUrl, null);
      if (webhookUrl && !isValidWebhookUrl(webhookUrl)) {
        return res.status(400).json({ error: 'webhookUrl must be a valid http(s) URL of at most 2048 characters' });
      }
      const hostCheck = validateHostProfile(sanitizeField(req.body.hostProfile, null));
      if (hostCheck.error) {
        return res.status(400).json({ error: hostCheck.error });
      }

      // 口播稿质量预检（不通过 400；warn 模式仅告警；脚本缺失放行）
      const check = validateArticle(req.file.path);
      if (check && check.ok === false && ARTICLE_VALIDATE_MODE !== 'warn') {
        fs.rmSync(req.file.path, { force: true });
        return res.status(400).json({ error: 'Article failed quality pre-check', checks: check.checks || [] });
      }

      const job = createJob({
        outputName,
        originalName: req.file.originalname,
        configOverrides,
        owner: AUTH_ENABLED ? req.user : null,
        webhookUrl,
        hostProfile: hostCheck.value,
      });

      // Move uploaded file to job directory as article.md
      fs.renameSync(req.file.path, job.articlePath);

      queueJob(job.jobId, 'full');
      const detail = serializeJobDetail(getJob(job.jobId));
      if (check && check.ok === false) detail.articleWarnings = check.checks || [];
      return res.status(202).json(detail);
    }

    // JSON body：{outputName, articleText, config, run, webhookUrl, hostProfile, schedule}
    const { outputName, articleText, config, run, webhookUrl, hostProfile, schedule } = req.body || {};
    if (typeof articleText !== 'string' || !articleText.trim()) {
      return res.status(400).json({ error: 'Missing articleText (or upload multipart field "article").' });
    }
    if (config !== undefined && config !== null && (typeof config !== 'object' || Array.isArray(config))) {
      return res.status(400).json({ error: 'config must be an object' });
    }
    if (webhookUrl !== undefined && webhookUrl !== null && !isValidWebhookUrl(webhookUrl)) {
      return res.status(400).json({ error: 'webhookUrl must be a valid http(s) URL of at most 2048 characters' });
    }
    const hostCheck = validateHostProfile(hostProfile);
    if (hostCheck.error) {
      return res.status(400).json({ error: hostCheck.error });
    }
    if (schedule !== undefined && schedule !== null) {
      if (typeof schedule !== 'string' || !cron.validate(schedule)) {
        return res.status(400).json({ error: 'schedule must be a valid cron expression' });
      }
    }

    const job = createJob({
      outputName: sanitizeField(outputName, null),
      originalName: 'article.md',
      configOverrides: config || null,
      owner: AUTH_ENABLED ? req.user : null,
      webhookUrl: webhookUrl || null,
      hostProfile: hostCheck.value,
      schedule: schedule || null,
    });
    fs.writeFileSync(job.articlePath, articleText, 'utf8');
    if (job.schedule) registerScheduledJob(job);

    // 口播稿质量预检（不通过时删除已建任务并 400；warn 模式仅告警；脚本缺失放行）
    const check = validateArticle(job.articlePath);
    if (check && check.ok === false && ARTICLE_VALIDATE_MODE !== 'warn') {
      deleteJob(job.jobId);
      unregisterScheduledJob(job.jobId);
      return res.status(400).json({ error: 'Article failed quality pre-check', checks: check.checks || [] });
    }
    const withWarnings = (detail) => {
      if (check && check.ok === false) detail.articleWarnings = check.checks || [];
      return detail;
    };

    const shouldRun = run !== false; // run:false 建草稿，默认立即排队
    if (shouldRun) {
      queueJob(job.jobId, 'full');
      return res.status(202).json(withWarnings(serializeJobDetail(getJob(job.jobId))));
    }
    publishJobEvent(job); // 草稿创建也是一次状态变更
    return res.status(201).json(withWarnings(serializeJobDetail(getJob(job.jobId))));
  } catch (err) {
    console.error('Error creating job:', err);
    res.status(500).json({ error: err.message });
  }
});

// 批量创建：{items: [{outputName?, articleText, config?}], run} —— 逐条校验，单条失败不中断整批
app.post('/api/v1/jobs/batch', (req, res) => {
  const { items, run } = req.body || {};
  if (!Array.isArray(items) || !items.length) {
    return res.status(400).json({ error: 'items must be a non-empty array' });
  }
  if (items.length > 100) {
    return res.status(400).json({ error: 'items limited to 100 per batch' });
  }
  const results = [];
  items.forEach((item, i) => {
    try {
      const { outputName, articleText, config, webhookUrl } = item || {};
      if (typeof articleText !== 'string' || !articleText.trim()) {
        results.push({ ok: false, error: `items[${i}]: Missing articleText` });
        return;
      }
      if (config !== undefined && config !== null && (typeof config !== 'object' || Array.isArray(config))) {
        results.push({ ok: false, error: `items[${i}]: config must be an object` });
        return;
      }
      if (webhookUrl !== undefined && webhookUrl !== null && !isValidWebhookUrl(webhookUrl)) {
        results.push({ ok: false, error: `items[${i}]: webhookUrl must be a valid http(s) URL` });
        return;
      }
      const job = createJob({
        outputName: sanitizeField(outputName, null),
        originalName: 'article.md',
        configOverrides: config || null,
        owner: AUTH_ENABLED ? req.user : null,
        webhookUrl: webhookUrl || null,
      });
      fs.writeFileSync(job.articlePath, articleText, 'utf8');
      if (run === true) {
        queueJob(job.jobId, 'full'); // 信号量串行执行
      } else {
        publishJobEvent(job);
      }
      results.push({ ok: true, job: serializeJobDetail(getJob(job.jobId)) });
    } catch (err) {
      results.push({ ok: false, error: `items[${i}]: ${err.message}` });
    }
  });
  res.json({ jobs: results });
});

// List jobs
app.get('/api/v1/jobs', (req, res) => {
  const limit = parseInt(req.query.limit || '50', 10);
  const offset = parseInt(req.query.offset || '0', 10);
  // 队列位置需要在全量 queued 任务里按 queuedAt 排序计算，先取全量再分页
  let all = listJobs({ limit: Number.MAX_SAFE_INTEGER, offset: 0 });
  if (AUTH_ENABLED) {
    // 鉴权开启时列表只含自己的任务
    const mine = all.jobs.filter((j) => j.owner === req.user);
    all = { total: mine.length, jobs: mine };
  }
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
  if (!requireOwner(job, req, res)) return;
  res.json(serializeJobDetail(job));
});

// 修改任务：outputName / configOverrides / articleText；running/queued 拒绝
app.patch('/api/v1/jobs/:id', (req, res) => {
  if (!isValidJobId(req.params.id)) return res.status(400).json({ error: 'Invalid job id' });
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (!requireOwner(job, req, res)) return;
  if (isActiveStatus(job.status)) {
    return res.status(409).json({ error: `Job is ${job.status}; stop it before editing.` });
  }

  const updates = {};
  const { outputName, configOverrides, articleText, webhookUrl } = req.body || {};

  if (webhookUrl !== undefined) {
    if (webhookUrl !== null && !isValidWebhookUrl(webhookUrl)) {
      return res.status(400).json({ error: 'webhookUrl must be a valid http(s) URL of at most 2048 characters' });
    }
    // null 清除回调
    updates.webhookUrl = webhookUrl || null;
  }

  if (outputName !== undefined) {
    if (typeof outputName !== 'string' || !outputName.trim()) {
      return res.status(400).json({ error: 'outputName must be a non-empty string' });
    }
    const safe = sanitizeOutputName(outputName);
    if (!safe) return res.status(400).json({ error: 'outputName is empty after sanitizing' });
    updates.outputName = safe;
    // 未版本化的任务 outputs 路径跟随新名字；已有版本的任务顶层 outputs 镜像最新版本，不动
    if (!(job.latestVersion >= 1)) {
      updates.outputs = {
        video: path.join(OUTPUT_DIR, `${safe}.mp4`),
        cover: path.join(OUTPUT_DIR, `${safe}_cover.png`),
      };
    }
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
  if (!requireOwner(job, req, res)) return;

  if (isActiveStatus(job.status)) {
    stopJob(job);
  }

  const purged = [];
  if (req.query.purge === '1') {
    // 产物清理严格限制在 temp/ 与 output/ 之内；版本化任务清掉每个版本的 workdir 与产物
    const versions = Array.isArray(job.versions) ? job.versions : [];
    const runNames = new Set(versions.map((v) => v.runName));
    runNames.add(job.outputName); // 草稿/旧版任务的兼容路径
    for (const runName of runNames) {
      const tempDir = path.resolve(TEMP_DIR, runName);
      if (isInside(TEMP_DIR, tempDir) && fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
        purged.push(path.relative(PROJECT_ROOT, tempDir));
      }
    }
    const outputPaths = new Set([job.outputs.video, job.outputs.cover]);
    for (const v of versions) {
      if (v.outputs) {
        outputPaths.add(v.outputs.video);
        outputPaths.add(v.outputs.cover);
      }
    }
    for (const p of outputPaths) {
      const resolved = path.resolve(p);
      if (isInside(OUTPUT_DIR, resolved) && fs.existsSync(resolved)) {
        fs.rmSync(resolved, { force: true });
        purged.push(path.relative(PROJECT_ROOT, resolved));
      }
    }
  }

  unregisterScheduledJob(job.jobId);
  deleteJob(job.jobId);
  res.json({ deleted: true, jobId: job.jobId, purged });
});

// 全量重跑：scripts/pipeline.sh；body 可选 {fromPhase} 手动指定失效起点（如口播稿微调）
app.post('/api/v1/jobs/:id/run', (req, res) => {
  if (!isValidJobId(req.params.id)) return res.status(400).json({ error: 'Invalid job id' });
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (!requireOwner(job, req, res)) return;
  if (isActiveStatus(job.status)) {
    return res.status(409).json({ error: `Job is already ${job.status}` });
  }
  if (!fs.existsSync(job.articlePath)) {
    return res.status(400).json({ error: 'Article file missing; edit the job to re-add article text.' });
  }
  const { fromPhase } = req.body || {};
  if (fromPhase !== undefined && fromPhase !== null && !PHASES.includes(fromPhase)) {
    return res.status(400).json({ error: `fromPhase must be one of: ${PHASES.join(', ')}` });
  }
  queueJob(job.jobId, 'full', { fromPhase: fromPhase || null });
  res.status(202).json(serializeJobDetail(getJob(job.jobId)));
});

// Rebuild 瘦身：与 /run 同路径新建版本（kind=rebuild），失效阶段固定 render，
// 复用上版工作目录后只重渲 render 阶段——零 GPU 零 LLM（统一走 pipeline.sh）
app.post('/api/v1/jobs/:id/rebuild', (req, res) => {
  if (!isValidJobId(req.params.id)) return res.status(400).json({ error: 'Invalid job id' });
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (!requireOwner(job, req, res)) return;
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

// 失败重试：同一版本续跑；body 可选 {phase} 注入 FORCE_<PHASE>=1 定点重跑
app.post('/api/v1/jobs/:id/retry', (req, res) => {
  if (!isValidJobId(req.params.id)) return res.status(400).json({ error: 'Invalid job id' });
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (!requireOwner(job, req, res)) return;
  if (isActiveStatus(job.status)) {
    return res.status(409).json({ error: `Job is already ${job.status}` });
  }
  if (!latestVersionRecord(job)) {
    return res.status(400).json({ error: 'Job has never run; use /run instead.' });
  }
  if (!fs.existsSync(job.articlePath)) {
    return res.status(400).json({ error: 'Article file missing; edit the job to re-add article text.' });
  }
  const { phase } = req.body || {};
  if (phase !== undefined && phase !== null && !PHASES.includes(phase)) {
    return res.status(400).json({ error: `phase must be one of: ${PHASES.join(', ')}` });
  }
  retryJob(job.jobId, phase || null);
  res.status(202).json(serializeJobDetail(getJob(job.jobId)));
});

// 停止：queued → cancelled；running → SIGTERM 进程组 → cancelled
app.post('/api/v1/jobs/:id/stop', (req, res) => {
  if (!isValidJobId(req.params.id)) return res.status(400).json({ error: 'Invalid job id' });
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (!requireOwner(job, req, res)) return;
  const stopped = stopJob(job);
  if (!stopped) {
    return res.status(409).json({ error: `Job is ${job.status}; only queued/running jobs can be stopped.` });
  }
  res.json(serializeJobDetail(stopped));
});

// 定时任务（P3-17）：设置/更新 cron 表达式，立即生效
app.post('/api/v1/jobs/:id/schedule', (req, res) => {
  if (!isValidJobId(req.params.id)) return res.status(400).json({ error: 'Invalid job id' });
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (!requireOwner(job, req, res)) return;
  const cronExpr = (req.body || {}).cron;
  if (typeof cronExpr !== 'string' || !cron.validate(cronExpr)) {
    return res.status(400).json({ error: 'cron must be a valid cron expression (5 or 6 fields)' });
  }
  const next = updateJob(job.jobId, { schedule: cronExpr });
  registerScheduledJob(next);
  res.json(serializeJobDetail(next));
});

// 取消定时任务
app.delete('/api/v1/jobs/:id/schedule', (req, res) => {
  if (!isValidJobId(req.params.id)) return res.status(400).json({ error: 'Invalid job id' });
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (!requireOwner(job, req, res)) return;
  unregisterScheduledJob(job.jobId);
  const next = updateJob(job.jobId, { schedule: null });
  res.json(serializeJobDetail(next));
});

// 克隆：复制文章 + configOverrides 建新任务（body 可覆盖 outputName/config/run）
app.post('/api/v1/jobs/:id/clone', (req, res) => {
  if (!isValidJobId(req.params.id)) return res.status(400).json({ error: 'Invalid job id' });
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (!requireOwner(job, req, res)) return;
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
    owner: AUTH_ENABLED ? req.user : null,
  });
  fs.copyFileSync(job.articlePath, clone.articlePath);

  if (run === true) {
    queueJob(clone.jobId, 'full');
    return res.status(202).json(serializeJobDetail(getJob(clone.jobId)));
  }
  publishJobEvent(clone);
  res.status(201).json(serializeJobDetail(clone));
});

// 口播稿路径：最新版本工作目录的 script.txt
function scriptPathForJob(job) {
  const record = latestVersionRecord(job);
  if (!record) return null;
  const p = path.resolve(TEMP_DIR, record.runName, 'script.txt');
  if (!isInside(TEMP_DIR, p)) return null;
  return p;
}

// 口播稿历史版本（P3-19）：每次 PUT 前把旧 script.txt 备份为 script.v{N}.txt（N 从 1 递增）
const SCRIPT_VERSION_RE = /^script\.v(\d+)\.txt$/;

function scriptDirForJob(job) {
  const scriptPath = scriptPathForJob(job);
  return scriptPath ? path.dirname(scriptPath) : null;
}

function listScriptVersions(job) {
  const dir = scriptDirForJob(job);
  if (!dir || !fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .map((f) => {
      const m = SCRIPT_VERSION_RE.exec(f);
      if (!m) return null;
      const fp = path.join(dir, f);
      let st = null;
      try { st = fs.statSync(fp); } catch (_e) { /* 文件可能刚被清理 */ }
      if (!st || !st.isFile()) return null;
      return { version: parseInt(m[1], 10), bytes: st.size, modifiedAt: st.mtime.toISOString() };
    })
    .filter(Boolean)
    .sort((a, b) => a.version - b.version);
}

// 读取口播稿：最新版本的 temp/<runName>/script.txt；?version=N 读历史备份 script.v{N}.txt
app.get('/api/v1/jobs/:id/script', (req, res) => {
  if (!isValidJobId(req.params.id)) return res.status(400).json({ error: 'Invalid job id' });
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (!requireOwner(job, req, res)) return;
  if (req.query.version !== undefined) {
    const n = parseInt(req.query.version, 10);
    const dir = scriptDirForJob(job);
    const versionPath = dir && Number.isInteger(n) && n >= 1
      ? path.resolve(dir, `script.v${n}.txt`)
      : null;
    if (!versionPath || !isInside(TEMP_DIR, versionPath) || !fs.existsSync(versionPath)) {
      return res.status(404).json({ error: `script version ${req.query.version} not found` });
    }
    return res.json({ script: fs.readFileSync(versionPath, 'utf8'), version: n });
  }
  const scriptPath = scriptPathForJob(job);
  if (!scriptPath || !fs.existsSync(scriptPath)) {
    return res.status(404).json({ error: 'script.txt not found (the latest version has not produced a script yet)' });
  }
  res.json({ script: fs.readFileSync(scriptPath, 'utf8') });
});

// 口播稿历史版本列表
app.get('/api/v1/jobs/:id/script/versions', (req, res) => {
  if (!isValidJobId(req.params.id)) return res.status(400).json({ error: 'Invalid job id' });
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (!requireOwner(job, req, res)) return;
  res.json({ versions: listScriptVersions(job) });
});

// 写回口播稿：纯文本不做 sanitize；仅非运行态可写。文件不存在时创建（目录缺失时补齐）。
// 已存在的 script.txt 先备份为 script.v{N}.txt（历史版本可经 GET ?version=N 读取）。
app.put('/api/v1/jobs/:id/script', (req, res) => {
  if (!isValidJobId(req.params.id)) return res.status(400).json({ error: 'Invalid job id' });
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (!requireOwner(job, req, res)) return;
  if (isActiveStatus(job.status)) {
    return res.status(409).json({ error: `Job is ${job.status}; stop it before editing the script.` });
  }
  const { script } = req.body || {};
  if (typeof script !== 'string') {
    return res.status(400).json({ error: 'script must be a string' });
  }
  const scriptPath = scriptPathForJob(job);
  if (!scriptPath) {
    return res.status(404).json({ error: 'Job has never run; no script to edit. Run the pipeline first.' });
  }
  fs.mkdirSync(path.dirname(scriptPath), { recursive: true });
  let backedUp = null;
  if (fs.existsSync(scriptPath)) {
    const existing = listScriptVersions(job); // 升序；取最大版本号 +1，容忍中间版本被删
    backedUp = existing.length ? existing[existing.length - 1].version + 1 : 1;
    fs.copyFileSync(scriptPath, path.join(path.dirname(scriptPath), `script.v${backedUp}.txt`));
  }
  fs.writeFileSync(scriptPath, script, 'utf8');
  res.json({ ok: true, bytes: Buffer.byteLength(script, 'utf8'), backedUpVersion: backedUp });
});

// 解析预览/下载的版本：?version=N 指定；默认取最新 completed 版本，都没有则退回最新版本
function resolveVersionForOutputs(job, query) {
  const versions = Array.isArray(job.versions) ? job.versions : [];
  if (!versions.length) return { record: null };
  if (query && query.version !== undefined) {
    const n = parseInt(query.version, 10);
    const record = versions.find((v) => v.version === n);
    if (!record) return { error: `version ${query.version} not found` };
    return { record };
  }
  for (let i = versions.length - 1; i >= 0; i--) {
    if (versions[i].status === 'completed') return { record: versions[i] };
  }
  return { record: versions[versions.length - 1] };
}

// 渐进式预览（P2-16）：pipeline 在 render 早期产出的低清 temp/<run>/preview.mp4。
// 配置 video_layout.preview.enabled（默认 false）开启后由 pipeline 生成；出现后经 SSE 推 preview_ready。
app.get('/api/v1/jobs/:id/preview', (req, res) => {
  if (!isValidJobId(req.params.id)) return res.status(400).json({ error: 'Invalid job id' });
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (!requireOwner(job, req, res)) return;
  const previewPath = previewPathFor(job);
  if (!previewPath || !fs.existsSync(previewPath)) {
    return res.status(404).json({ error: 'preview not ready (requires video_layout.preview.enabled and a running render)' });
  }
  res.sendFile(previewPath);
});

// 在线预览：res.sendFile 自带 Range 支持，<video> 可拖动
app.get('/api/v1/jobs/:id/preview/:file', (req, res) => {
  if (!isValidJobId(req.params.id)) return res.status(400).json({ error: 'Invalid job id' });
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (!requireOwner(job, req, res)) return;

  const fileType = req.params.file;
  if (fileType !== 'video' && fileType !== 'cover') {
    return res.status(400).json({ error: 'Preview type must be video or cover' });
  }

  const { record, error } = resolveVersionForOutputs(job, req.query);
  if (error) return res.status(404).json({ error });
  const filePath = record ? record.outputs[fileType] : job.outputs[fileType];
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
  if (!requireOwner(job, req, res)) return;

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
  if (!requireOwner(job, req, res)) return;

  const fileType = req.params.file;
  if (fileType !== 'video' && fileType !== 'cover') {
    return res.status(400).json({ error: 'Download type must be video or cover' });
  }

  const { record, error } = resolveVersionForOutputs(job, req.query);
  if (error) return res.status(404).json({ error });
  const filePath = record ? record.outputs[fileType] : job.outputs[fileType];
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: `${fileType} not ready` });
  }

  const baseName = record ? record.runName : job.outputName;
  const filename = fileType === 'video'
    ? `${baseName}.mp4`
    : `${baseName}_cover.png`;

  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.sendFile(filePath);
});

// SSE 实时推送：job 状态变更事件流（鉴权开启时按用户过滤他人任务事件）
app.get('/api/v1/events', (req, res) => {
  sseEvents.subscribe(res, AUTH_ENABLED ? req.user : null);
});

// 配置模板：api/templates.json（用户数据，gitignore），首次读取时写入内置模板。
// 鉴权开启时按用户分文件：api/templates.<user>.json。
const TEMPLATES_PATH = path.join(__dirname, 'templates.json');
const BUILTIN_TEMPLATES = {
  知识科普: {
    content_overlay: { subtitles: { dna: 'loud' } },
    video_layout: { hybrid: { chapterCardScale: 1.5 } },
  },
  发布会风: {
    content_overlay: { subtitles: { dna: 'keynote' } },
  },
};

function templatesPathFor(req) {
  if (!AUTH_ENABLED) return TEMPLATES_PATH;
  // 用户名来自 WEB_TOKENS 环境变量（受信配置），仍做一次文件名安全清洗
  const safe = String(req.user).replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(__dirname, `templates.${safe}.json`);
}

function loadTemplates(filePath) {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(BUILTIN_TEMPLATES, null, 2));
    return { ...BUILTIN_TEMPLATES };
  }
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch (_err) {
    return {};
  }
}

function saveTemplates(filePath, map) {
  fs.writeFileSync(filePath, JSON.stringify(map, null, 2));
}

app.get('/api/v1/templates', (req, res) => {
  const map = loadTemplates(templatesPathFor(req));
  res.json({ templates: Object.keys(map).map((name) => ({ name, overrides: map[name] })) });
});

// 新建/覆盖模板：{name, overrides}，按 name upsert
app.post('/api/v1/templates', (req, res) => {
  const { name, overrides } = req.body || {};
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 40) {
    return res.status(400).json({ error: 'name must be a non-empty string of at most 40 characters' });
  }
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) {
    return res.status(400).json({ error: 'overrides must be an object' });
  }
  const filePath = templatesPathFor(req);
  const map = loadTemplates(filePath);
  const key = name.trim();
  map[key] = overrides;
  saveTemplates(filePath, map);
  res.json({ ok: true, name: key, overrides });
});

app.delete('/api/v1/templates/:name', (req, res) => {
  const filePath = templatesPathFor(req);
  const map = loadTemplates(filePath);
  if (!(req.params.name in map)) {
    return res.status(404).json({ error: `template "${req.params.name}" not found` });
  }
  delete map[req.params.name];
  saveTemplates(filePath, map);
  res.json({ ok: true, deleted: req.params.name });
});

// ---------- 素材库（只读浏览） ----------

const SCENE_VISUALS_DIR = path.join(PROJECT_ROOT, 'public', 'scene_visuals');
const BGM_DIR = path.join(PROJECT_ROOT, 'assets', 'bgm');
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
const VIDEO_EXTS = new Set(['.mp4', '.webm', '.mov']);
const MEDIA_EXTS = new Set([...IMAGE_EXTS, ...VIDEO_EXTS]);
const AUDIO_EXTS = new Set(['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac']);

// 严格 containment 的静态文件服务：resolved 必须落在 baseDir 内且扩展名在白名单
function serveMediaFile(baseDir, allowedExts) {
  return (req, res) => {
    const rel = req.params[0] || '';
    const resolved = path.resolve(baseDir, rel);
    if (!isInside(baseDir, resolved)) {
      return res.status(400).json({ error: 'Invalid path' });
    }
    const ext = path.extname(resolved).toLowerCase();
    if (!allowedExts.has(ext)) {
      return res.status(404).json({ error: 'Not found' });
    }
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
      return res.status(404).json({ error: 'Not found' });
    }
    res.sendFile(resolved);
  };
}

app.get('/assets/scene/*', serveMediaFile(SCENE_VISUALS_DIR, MEDIA_EXTS));
app.get('/assets/bgm/*', serveMediaFile(BGM_DIR, AUDIO_EXTS));

// 素材库清单：场景画面按 run 分组（每个最多 12 个，新 run 在前）+ BGM + 主播 profile
app.get('/api/v1/assets', (_req, res) => {
  const sceneVisuals = [];
  if (fs.existsSync(SCENE_VISUALS_DIR)) {
    const runs = fs
      .readdirSync(SCENE_VISUALS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => {
        const dirPath = path.join(SCENE_VISUALS_DIR, d.name);
        let mtime = 0;
        try {
          mtime = fs.statSync(dirPath).mtimeMs;
        } catch (_e) { /* 目录可能刚被清理 */ }
        return { name: d.name, dirPath, mtime };
      })
      .sort((a, b) => b.mtime - a.mtime);
    for (const run of runs) {
      const files = fs
        .readdirSync(run.dirPath)
        .filter((f) => MEDIA_EXTS.has(path.extname(f).toLowerCase()))
        .slice(0, 12)
        .map((f) => {
          const fp = path.join(run.dirPath, f);
          let size = 0;
          try {
            size = fs.statSync(fp).size;
          } catch (_e) { /* 文件可能刚被清理 */ }
          const ext = path.extname(f).toLowerCase();
          return {
            name: f,
            size,
            type: VIDEO_EXTS.has(ext) ? 'video' : 'image',
            url: `/assets/scene/${encodeURIComponent(run.name)}/${encodeURIComponent(f)}`,
          };
        });
      if (files.length) sceneVisuals.push({ run: run.name, files });
    }
  }

  const bgm = [];
  if (fs.existsSync(BGM_DIR)) {
    for (const f of fs.readdirSync(BGM_DIR)) {
      if (!AUDIO_EXTS.has(path.extname(f).toLowerCase())) continue;
      const fp = path.join(BGM_DIR, f);
      if (!fs.statSync(fp).isFile()) continue;
      bgm.push({ name: f, size: fs.statSync(fp).size, url: `/assets/bgm/${encodeURIComponent(f)}` });
    }
  }

  // 主播 profile：config/hosts/*.json 存在则列出，否则回退默认主播（仅展示，多主播切换在 P2）
  const hostsDir = path.join(PROJECT_ROOT, 'config', 'hosts');
  let hosts = [];
  if (fs.existsSync(hostsDir)) {
    hosts = fs
      .readdirSync(hostsDir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => ({ name: path.basename(f, '.json'), path: `config/hosts/${f}` }));
  }
  if (!hosts.length) {
    hosts = [{ name: '默认主播', path: 'config/host_profile.json' }];
  }

  res.json({ sceneVisuals, bgm, hosts });
});

// 执行预估：最近 20 个已完成版本按 kind（full/rebuild）分组的平均耗时
app.get('/api/v1/estimates', (req, res) => {
  let all = listJobs({ limit: Number.MAX_SAFE_INTEGER, offset: 0 }).jobs;
  if (AUTH_ENABLED) all = all.filter((j) => j.owner === req.user);
  res.json(aggregateEstimates(all, 20));
});

// 数据看板（P2-13）：跨任务版本聚合，鉴权开启时只统计自己的任务
app.get('/api/v1/stats', (req, res) => {
  let jobs = listJobs({ limit: Number.MAX_SAFE_INTEGER, offset: 0 }).jobs;
  if (AUTH_ENABLED) jobs = jobs.filter((j) => j.owner === req.user);

  const totals = { jobs: jobs.length, versions: 0, completed: 0, failed: 0, cancelled: 0, successRate: 0 };
  const perDayMap = new Map(); // YYYY-MM-DD -> {completed, failed}
  const durationSum = { full: 0, rebuild: 0 };
  const durationCount = { full: 0, rebuild: 0 };
  const failureByPhaseMap = new Map();

  for (const job of jobs) {
    const versions = Array.isArray(job.versions) ? job.versions : [];
    totals.versions += versions.length;
    for (const v of versions) {
      if (v.status === 'completed') totals.completed += 1;
      else if (v.status === 'failed') totals.failed += 1;
      else if (v.status === 'cancelled') totals.cancelled += 1;

      if ((v.status === 'completed' || v.status === 'failed') && v.finishedAt) {
        const day = v.finishedAt.slice(0, 10);
        const entry = perDayMap.get(day) || { completed: 0, failed: 0 };
        entry[v.status] += 1;
        perDayMap.set(day, entry);
      }
      if (v.status === 'completed' && v.startedAt && v.finishedAt) {
        const kind = v.kind === 'rebuild' ? 'rebuild' : 'full';
        const seconds = (new Date(v.finishedAt) - new Date(v.startedAt)) / 1000;
        if (Number.isFinite(seconds) && seconds >= 0) {
          durationSum[kind] += seconds;
          durationCount[kind] += 1;
        }
      }
    }
    // failureByPhase：最新版本 failed 时读其工作目录 state 文件里的 failed 阶段（best-effort）
    const latest = latestVersionRecord(job);
    if (latest && latest.status === 'failed') {
      const state = readPipelineState(latest.runName);
      if (state) {
        for (const phase of PHASES) {
          if (state[phase] && state[phase].status === 'failed') {
            failureByPhaseMap.set(phase, (failureByPhaseMap.get(phase) || 0) + 1);
          }
        }
      }
    }
  }

  const terminal = totals.completed + totals.failed;
  totals.successRate = terminal > 0 ? Math.round((totals.completed / terminal) * 1000) / 1000 : 0;

  // perDay：最近 14 天（含今天），无数据补 0
  const perDay = [];
  for (let i = 13; i >= 0; i--) {
    const day = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    const entry = perDayMap.get(day) || { completed: 0, failed: 0 };
    perDay.push({ date: day, completed: entry.completed, failed: entry.failed });
  }

  const avgDurationByKind = {
    full: durationCount.full ? Math.round((durationSum.full / durationCount.full) * 10) / 10 : null,
    rebuild: durationCount.rebuild ? Math.round((durationSum.rebuild / durationCount.rebuild) * 10) / 10 : null,
  };
  const failureByPhase = PHASES.filter((p) => failureByPhaseMap.has(p))
    .map((p) => ({ phase: p, count: failureByPhaseMap.get(p) }))
    .sort((a, b) => b.count - a.count);

  res.json({ totals, perDay, avgDurationByKind, failureByPhase });
});

// 基础配置 + 表单枚举（供前端渲染分组参数表单）
app.get('/api/v1/config', (req, res) => {
  let profile = {};
  try {
    profile = JSON.parse(fs.readFileSync(DEFAULT_PROFILE_PATH, 'utf8'));
  } catch (_err) {
    // profile 缺失时返回空默认
  }
  // 最近创建任务的 configOverrides，供新建任务预填（鉴权开启时只看自己的任务；无任务或无 overrides 时为 null）
  let latestJobs = listJobs({ limit: AUTH_ENABLED ? Number.MAX_SAFE_INTEGER : 1, offset: 0 }).jobs;
  if (AUTH_ENABLED) latestJobs = latestJobs.filter((j) => j.owner === req.user);
  const latest = latestJobs[0] || null;
  res.json({
    profile: sanitizeSecrets(profile),
    lastJobOverrides: latest && latest.configOverrides ? latest.configOverrides : null,
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
      // 镜像 src/index.tsx 注册的 composition（TalkingHeadVideo / TalkingHeadVideoLandscape / 正方形）
      aspects: [
        { id: '9:16', label: '竖屏 9:16' },
        { id: '16:9', label: '横屏 16:9' },
        { id: '1:1', label: '正方形 1:1' },
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

// 启动恢复：未完成 webhook 投递（P3-11）+ 定时任务注册（P3-17）
resumePendingWebhooks();
loadScheduledJobs();

function shutdown(signal) {
  console.log(`\nReceived ${signal}, shutting down gracefully...`);
  sseEvents.closeAll(); // 断开 SSE 连接，让 server.close 立即完成
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

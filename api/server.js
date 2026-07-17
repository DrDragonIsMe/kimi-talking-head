const express = require('express');
const multer = require('multer');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const { createJob, getJob, updateJob, listJobs, PROJECT_ROOT } = require('./job-store');

const app = express();
app.use(express.json({ limit: '10mb' }));

const PORT = process.env.PORT || 3456;
const MAX_CONCURRENT = parseInt(process.env.MAX_CONCURRENT || '1', 10);
const UPLOAD_DIR = path.join(PROJECT_ROOT, 'api', 'uploads');

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
let activeChild = null;

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

function runPipeline(job) {
  return new Promise((resolve) => {
    const profilePath = writeProfileWithOverrides(job);
    const stdoutStream = fs.createWriteStream(job.logs.stdout, { flags: 'a' });
    const stderrStream = fs.createWriteStream(job.logs.stderr, { flags: 'a' });

    updateJob(job.jobId, { status: 'running', error: null, exitCode: null });

    const child = spawn(
      'bash',
      [
        path.join(PROJECT_ROOT, 'scripts', 'pipeline.sh'),
        job.articlePath,
        job.outputName,
        profilePath,
      ],
      {
        cwd: PROJECT_ROOT,
        env: {
          ...process.env,
          PIPELINE_RUN_ID: job.jobId,
        },
        detached: true,
      }
    );
    activeChild = child;

    child.stdout.pipe(stdoutStream);
    child.stderr.pipe(stderrStream);

    child.on('error', (err) => {
      activeChild = null;
      stdoutStream.end();
      stderrStream.end();
      updateJob(job.jobId, {
        status: 'failed',
        error: `Failed to start pipeline: ${err.message}`,
      });
      resolve();
    });

    child.on('close', (code) => {
      activeChild = null;
      stdoutStream.end();
      stderrStream.end();

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
      });

      resolve();
    });
  });
}

async function enqueuePipeline(job) {
  await pipelineSemaphore.acquire();
  try {
    await runPipeline(job);
  } finally {
    pipelineSemaphore.release();
  }
}

function sanitizeField(value, fallback) {
  if (typeof value !== 'string' || !value.trim()) return fallback;
  return value.trim();
}

function serializeJob(job, includeLogs = false) {
  const base = {
    jobId: job.jobId,
    status: job.status,
    outputName: job.outputName,
    originalName: job.originalName,
    error: job.error,
    exitCode: job.exitCode,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    outputs: {
      video: `/api/v1/jobs/${job.jobId}/download/video`,
      cover: `/api/v1/jobs/${job.jobId}/download/cover`,
    },
  };
  if (includeLogs) {
    base.logs = {
      stdout: `/api/v1/jobs/${job.jobId}/logs/stdout`,
      stderr: `/api/v1/jobs/${job.jobId}/logs/stderr`,
    };
  }
  return base;
}

// Health check
app.get('/health', (_req, res) => {
  res.json({ ok: true, maxConcurrent: MAX_CONCURRENT, running: pipelineSemaphore.count });
});

// Create a video generation job
app.post('/api/v1/jobs', upload.single('article'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Missing article file. Use multipart/form-data with field "article".' });
    }

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

    // Start pipeline in background
    enqueuePipeline(job).catch((err) => {
      console.error(`Pipeline error for job ${job.jobId}:`, err);
      updateJob(job.jobId, { status: 'failed', error: err.message });
    });

    res.status(202).json(serializeJob(job, true));
  } catch (err) {
    console.error('Error creating job:', err);
    res.status(500).json({ error: err.message });
  }
});

// List jobs
app.get('/api/v1/jobs', (req, res) => {
  const limit = parseInt(req.query.limit || '50', 10);
  const offset = parseInt(req.query.offset || '0', 10);
  const result = listJobs({ limit, offset });
  res.json({
    total: result.total,
    limit,
    offset,
    jobs: result.jobs.map((j) => serializeJob(j, true)),
  });
});

// Get job status
app.get('/api/v1/jobs/:id', (req, res) => {
  if (!isValidJobId(req.params.id)) return res.status(400).json({ error: 'Invalid job id' });
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(serializeJob(job, true));
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
  if (activeChild) {
    try {
      // Kill the entire process group (negative PID) to ensure
      // subprocesses like ffmpeg/python are also terminated.
      process.kill(-activeChild.pid, 'SIGTERM');
    } catch (_err) {
      // Process group may already be gone; fall back to individual kill.
      try { activeChild.kill('SIGTERM'); } catch (_e) {}
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

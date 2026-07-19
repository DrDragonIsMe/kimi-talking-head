const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const JOBS_DIR = path.join(PROJECT_ROOT, 'api', 'jobs');

function ensureJobsDir() {
  if (!fs.existsSync(JOBS_DIR)) {
    fs.mkdirSync(JOBS_DIR, { recursive: true });
  }
}

function getJobDir(jobId) {
  return path.join(JOBS_DIR, jobId);
}

function getStatePath(jobId) {
  return path.join(getJobDir(jobId), 'state.json');
}

function createJob({ outputName, originalName = 'article.md', configOverrides = null, kind = 'full' }) {
  ensureJobsDir();
  const jobId = randomUUID();
  const jobDir = getJobDir(jobId);
  fs.mkdirSync(jobDir, { recursive: true });

  const now = new Date().toISOString();
  const safeOutputName = sanitizeOutputName(outputName || `job_${jobId.slice(0, 8)}_${Date.now()}`);

  const state = {
    jobId,
    // 状态机：draft → queued → running → completed / failed / cancelled
    status: 'draft',
    kind, // full=全量 pipeline，rebuild=复用媒体重渲
    outputName: safeOutputName,
    originalName,
    configOverrides,
    articlePath: path.join(jobDir, 'article.md'),
    profilePath: configOverrides ? path.join(jobDir, 'profile.json') : null,
    outputs: {
      video: path.join(PROJECT_ROOT, 'output', `${safeOutputName}.mp4`),
      cover: path.join(PROJECT_ROOT, 'output', `${safeOutputName}_cover.png`),
    },
    logs: {
      stdout: path.join(jobDir, 'stdout.log'),
      stderr: path.join(jobDir, 'stderr.log'),
    },
    error: null,
    exitCode: null,
    queuedAt: null,
    startedAt: null,
    finishedAt: null,
    createdAt: now,
    updatedAt: now,
  };

  writeState(jobId, state);
  return state;
}

function getJob(jobId) {
  const statePath = getStatePath(jobId);
  if (!fs.existsSync(statePath)) return null;
  return JSON.parse(fs.readFileSync(statePath, 'utf8'));
}

function updateJob(jobId, updates) {
  const state = getJob(jobId);
  if (!state) return null;
  const next = { ...state, ...updates, updatedAt: new Date().toISOString() };
  writeState(jobId, next);
  return next;
}

function writeState(jobId, state) {
  const statePath = getStatePath(jobId);
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
}

function listJobs({ limit = 50, offset = 0 } = {}) {
  ensureJobsDir();
  const entries = fs.readdirSync(JOBS_DIR, { withFileTypes: true });
  const jobs = entries
    .filter((d) => d.isDirectory())
    .map((d) => getJob(d.name))
    .filter(Boolean)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  return {
    total: jobs.length,
    jobs: jobs.slice(offset, offset + limit),
  };
}

function sanitizeOutputName(name) {
  return name
    .replace(/[^a-zA-Z0-9\u4e00-\u9fa5_\-]/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 80);
}

// 删除整个 job 目录（api/jobs/<id>/）；jobId 只允许 UUID 形态，防路径穿越
function deleteJob(jobId) {
  const jobDir = getJobDir(jobId);
  const resolved = path.resolve(jobDir);
  if (!resolved.startsWith(path.resolve(JOBS_DIR) + path.sep)) {
    throw new Error(`Invalid job id: ${jobId}`);
  }
  if (fs.existsSync(resolved)) {
    fs.rmSync(resolved, { recursive: true, force: true });
  }
  return true;
}

module.exports = {
  PROJECT_ROOT,
  JOBS_DIR,
  createJob,
  getJob,
  updateJob,
  listJobs,
  getJobDir,
  deleteJob,
  sanitizeOutputName,
};

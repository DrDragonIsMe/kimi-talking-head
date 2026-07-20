const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const JOBS_DIR = path.join(PROJECT_ROOT, 'api', 'jobs');

// 内存缓存：jobId -> { job, mtime }。state.json 的唯一写入方是本进程（writeState），
// 缓存随写同步维护；getJob/listJobs 用 mtime 兜底校验，兼容测试/外部直写文件的场景。
const jobCache = new Map();

function statMtime(statePath) {
  try {
    return fs.statSync(statePath).mtimeMs;
  } catch (_err) {
    return -1;
  }
}

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

function createJob({ outputName, originalName = 'article.md', configOverrides = null, kind = 'full', owner = null, webhookUrl = null, hostProfile = null, schedule = null }) {
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
    // WEB_TOKENS 鉴权开启时的归属用户（未启用鉴权为 null）
    owner,
    // 版本终态回调（POST JSON，最多 3 次尝试）
    webhookUrl,
    // 主播配置文件名（null = 默认 config/host_profile.json；否则 config/hosts/<hostProfile>）
    hostProfile,
    // cron 表达式定时运行（null = 不定时）；由 POST/DELETE /api/v1/jobs/:id/schedule 维护
    schedule,
    // 外部触发 token：POST /api/v1/trigger/<token> 命中即运行本任务
    triggerToken: randomUUID(),
    articlePath: path.join(jobDir, 'article.md'),
    profilePath: configOverrides ? path.join(jobDir, 'profile.json') : null,
    outputs: {
      video: path.join(PROJECT_ROOT, 'output', `${safeOutputName}.mp4`),
      cover: path.join(PROJECT_ROOT, 'output', `${safeOutputName}_cover.png`),
    },
    // 版本化运行：每次 run/rebuild 追加一个版本（见 api/versioning.js），latestVersion 指向最新
    versions: [],
    latestVersion: 0,
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
  const mtime = statMtime(statePath);
  const cached = jobCache.get(jobId);
  if (cached && cached.mtime === mtime) return cached.job;
  const job = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  jobCache.set(jobId, { job, mtime });
  return job;
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
  jobCache.set(jobId, { job: state, mtime: statMtime(statePath) });
}

function listJobs({ limit = 50, offset = 0 } = {}) {
  ensureJobsDir();
  const entries = fs.readdirSync(JOBS_DIR, { withFileTypes: true });
  const jobs = entries
    .filter((d) => d.isDirectory())
    .map((d) => getJob(d.name)) // getJob 命中缓存（mtime 未变）时不重读磁盘
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
  jobCache.delete(jobId);
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

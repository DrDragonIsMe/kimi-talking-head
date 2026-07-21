#!/usr/bin/env node
/**
 * Tests for api/server.js —— 用 PIPELINE_SCRIPT 钩子注入假脚本，
 * spawn 真实 server 于随机端口，覆盖任务 CRUD / run / rebuild / retry / script /
 * estimates / stop / clone / preview / purge 以及既有 multipart/logs/download 兼容行为。
 *
 * Usage: node scripts/test_api_server.js
 */

const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const STUB_FAST = path.join(__dirname, 'fixtures', 'stub_pipeline.sh');
const STUB_SLOW = path.join(__dirname, 'fixtures', 'stub_pipeline_slow.sh');
const STUB_FAIL = path.join(__dirname, 'fixtures', 'stub_pipeline_fail.sh');
const STUB_ENV = path.join(__dirname, 'fixtures', 'stub_pipeline_env.sh');
const STUB_VALIDATE_PASS = path.join(__dirname, 'fixtures', 'stub_validate_article_pass.js');
const STUB_VALIDATE_FAIL = path.join(__dirname, 'fixtures', 'stub_validate_article_fail.js');
const VALIDATE_MISSING = path.join(__dirname, 'fixtures', 'no_such_validate_article.js');

let failures = 0;

function assert(cond, message) {
  if (cond) {
    console.log(`  ✅ ${message}`);
  } else {
    failures += 1;
    console.error(`  ❌ ${message}`);
  }
}

function assertEqual(actual, expected, message) {
  assert(
    actual === expected,
    `${message} (expected: ${JSON.stringify(expected)}, got: ${JSON.stringify(actual)})`
  );
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 本次测试创建的任务与产物名（统一前缀，便于清理且不与存量任务混淆）
const RUN_TAG = `test_api_${process.pid}_${Date.now().toString(36)}`;
const createdJobIds = [];
const createdOutputNames = [];
let hostsTestFile = null; // hostProfile 测试写入的 config/hosts/<file>，finally 里清理

function api(base, pathname, options = {}) {
  if (options.json !== undefined) {
    options.body = JSON.stringify(options.json);
    options.headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    delete options.json;
  }
  return fetch(`${base}${pathname}`, options).then(async (res) => {
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch (_e) { /* 非 JSON 响应 */ }
    if (!res.ok) {
      const err = new Error((data && data.error) || `HTTP ${res.status}`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return { res, data, text };
  });
}

async function waitHealth(base, timeoutMs = 10000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const { data } = await api(base, '/health');
      if (data && data.ok) return;
    } catch (_e) { /* server 尚未就绪 */ }
    await sleep(200);
  }
  throw new Error(`server at ${base} did not become healthy`);
}

async function waitStatus(base, jobId, targets, timeoutMs = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const { data } = await api(base, `/api/v1/jobs/${jobId}`);
    if (targets.includes(data.status)) return data;
    await sleep(300);
  }
  throw new Error(`timeout waiting job ${jobId} for status ${targets.join('/')}`);
}

function startServer(port, script, extraEnv = {}) {
  const child = spawn('node', [path.join(PROJECT_ROOT, 'api', 'server.js')], {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      PIPELINE_SCRIPT: script,
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', () => {});
  child.stderr.on('data', (d) => process.stderr.write(`[server:${port}] ${d}`));
  return child;
}

function stopServer(child) {
  return new Promise((resolve) => {
    if (!child || child.exitCode !== null) return resolve();
    child.once('exit', () => resolve());
    child.kill('SIGTERM');
    setTimeout(() => {
      try { child.kill('SIGKILL'); } catch (_e) {}
      resolve();
    }, 5000);
  });
}

// 取一个当前空闲的随机端口（供追加的测试 server 使用，避免与推导端口相撞）
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = http.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function cleanup(baseList) {
  // 删除测试任务（purge 连带 temp/ 与 output/ 产物）
  for (const base of baseList) {
    for (const jobId of createdJobIds) {
      try { await api(base, `/api/v1/jobs/${jobId}?purge=1`, { method: 'DELETE' }); } catch (_e) {}
    }
  }
  // 兜底：按名字清理可能残留的产物
  for (const name of createdOutputNames) {
    try { fs.rmSync(path.join(PROJECT_ROOT, 'temp', name), { recursive: true, force: true }); } catch (_e) {}
    for (const f of [`${name}.mp4`, `${name}_cover.png`]) {
      try { fs.rmSync(path.join(PROJECT_ROOT, 'output', f), { force: true }); } catch (_e) {}
    }
  }
}

async function main() {
  // ---------- job-store 单测 ----------
  console.log('=== job-store deleteJob ===');
  {
    const store = require('../api/job-store');
    const job = store.createJob({ outputName: `${RUN_TAG}_store` });
    createdOutputNames.push(job.outputName);
    const dir = store.getJobDir(job.jobId);
    assert(fs.existsSync(dir), 'createJob creates job dir');
    store.deleteJob(job.jobId);
    assert(!fs.existsSync(dir), 'deleteJob removes job dir recursively');
    assert(store.getJob(job.jobId) === null, 'getJob returns null after delete');
    assertEqual(job.status, 'draft', 'new job starts as draft');
    assertEqual(job.kind, 'full', 'new job defaults kind=full');
  }

  // ---------- job-store 缓存（建议7）+ 新字段（建议13/17） ----------
  console.log('=== job-store 缓存与新字段 ===');
  {
    const store = require('../api/job-store');
    const job = store.createJob({ outputName: `${RUN_TAG}_store2`, hostProfile: null, schedule: null });
    createdOutputNames.push(job.outputName);
    assert(typeof job.triggerToken === 'string' && job.triggerToken.length === 36, 'createJob generates triggerToken');
    assertEqual(job.hostProfile, null, 'hostProfile defaults to null');
    assertEqual(job.schedule, null, 'schedule defaults to null');

    assert(store.listJobs({ limit: 500 }).jobs.some((j) => j.jobId === job.jobId), 'listJobs contains new job');

    // 外部直写 state.json：mtime 变化使缓存失效，getJob/listJobs 都能读到新值
    await sleep(10);
    const statePath = path.join(store.getJobDir(job.jobId), 'state.json');
    const raw = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    raw.status = 'queued';
    fs.writeFileSync(statePath, JSON.stringify(raw, null, 2));
    assertEqual(store.getJob(job.jobId).status, 'queued', 'getJob invalidates cache on external mtime change');
    assertEqual(
      store.listJobs({ limit: 500 }).jobs.find((j) => j.jobId === job.jobId).status,
      'queued',
      'listJobs invalidates cache on external mtime change'
    );

    // 经 updateJob 的写路径同步维护缓存
    store.updateJob(job.jobId, { status: 'draft' });
    assertEqual(store.getJob(job.jobId).status, 'draft', 'updateJob keeps cache coherent');

    store.deleteJob(job.jobId);
    assert(!store.listJobs({ limit: 500 }).jobs.some((j) => j.jobId === job.jobId), 'deleteJob evicts cache entry');
  }

  // ---------- versioning 单测（纯函数，无需 server） ----------
  console.log('=== versioning computeInvalidationPhase ===');
  {
    const { computeInvalidationPhase } = require('../api/versioning');
    const base = { articleHash: 'h1', config: { voice: { speed: 1 }, scene_visuals: { media_type: 'image' } } };
    assertEqual(
      computeInvalidationPhase(base, { articleHash: 'h1', config: { voice: { speed: 1 }, scene_visuals: { media_type: 'image' } } }),
      'render', 'no diff falls back to render'
    );
    assertEqual(
      computeInvalidationPhase(base, { articleHash: 'h2', config: base.config }),
      'script', 'articleHash change invalidates from script'
    );
    assertEqual(
      computeInvalidationPhase({ articleText: '原文' }, { articleText: '改后' }),
      'script', 'articleText change invalidates from script'
    );
    assertEqual(
      computeInvalidationPhase(base, { articleHash: 'h1', config: { voice: { speed: 2 }, scene_visuals: { media_type: 'image' } } }),
      'tts', 'voice key change invalidates from tts'
    );
    assertEqual(
      computeInvalidationPhase(
        { articleHash: 'h1', config: { content_overlay: { subtitles: { segmentation: { max: 3 } } } } },
        { articleHash: 'h1', config: { content_overlay: { subtitles: { segmentation: { max: 4 } } } } }
      ),
      'subtitles', 'segmentation change invalidates from subtitles'
    );
    assertEqual(
      computeInvalidationPhase(base, { articleHash: 'h1', config: { voice: { speed: 1 }, scene_visuals: { media_type: 'video' } } }),
      'visuals', 'scene_visuals change invalidates from visuals'
    );
    assertEqual(
      computeInvalidationPhase(
        { articleHash: 'h1', config: { content_overlay: { subtitles: { dna: 'loud' } } } },
        { articleHash: 'h1', config: { content_overlay: { subtitles: { dna: 'cream' } } } }
      ),
      'render', 'dna change only re-renders'
    );
    assertEqual(
      computeInvalidationPhase(
        { articleHash: 'h1', config: { voice: { speed: 2 }, scene_visuals: { media_type: 'video' } } },
        { articleHash: 'h1', config: { voice: { speed: 3 }, scene_visuals: { media_type: 'image' } } }
      ),
      'tts', 'multiple diffs pick the earliest phase'
    );
  }

  // ---------- estimates 单测（纯函数，无需 server） ----------
  console.log('=== versioning aggregateEstimates ===');
  {
    const { aggregateEstimates } = require('../api/versioning');
    const empty = aggregateEstimates([], 20);
    assert(empty.full === null && empty.rebuild === null, 'no completed versions -> both groups null');

    const mkJob = (kind, startedAt, finishedAt) => ({ versions: [{ kind, status: 'completed', startedAt, finishedAt }] });
    const est = aggregateEstimates([
      mkJob('full', '2026-01-01T00:00:00Z', '2026-01-01T00:01:40Z'), // 100s
      mkJob('rebuild', '2026-01-01T00:00:00Z', '2026-01-01T00:00:40Z'), // 40s
      mkJob('full', '2026-01-01T00:10:00Z', '2026-01-01T00:13:20Z'), // 200s
      { versions: [{ kind: 'full', status: 'failed', startedAt: '2026-01-01T00:00:00Z', finishedAt: '2026-01-01T00:05:00Z' }] },
    ], 20);
    assertEqual(est.full.samples, 2, 'full group counts only completed full versions');
    assertEqual(est.full.avgSeconds, 150, 'full avgSeconds averaged over samples');
    assertEqual(est.rebuild.samples, 1, 'rebuild group separated from full');
    assertEqual(est.rebuild.avgSeconds, 40, 'rebuild avgSeconds');

    const many = [];
    for (let i = 0; i < 25; i++) {
      many.push(mkJob('full', '2026-01-01T00:00:00Z', `2026-01-02T00:${String(i).padStart(2, '0')}:00Z`));
    }
    assertEqual(aggregateEstimates(many, 20).full.samples, 20, 'caps at the most recent 20 samples');
  }

  // ---------- 快速 server ----------
  // 注：所有 legacy server 统一注入「预检通过」stub（ARTICLE_VALIDATE_SCRIPT），
  // 使套件行为不依赖 scripts/validate_article.js 是否存在（该脚本由其他任务线实现）；
  // 预检的 block/warn/缺失分支由下方专用 server 覆盖。
  const FAST_PORT = 20000 + Math.floor(Math.random() * 15000);
  const FAST = `http://127.0.0.1:${FAST_PORT}`;
  const fastServer = startServer(FAST_PORT, STUB_FAST, { ARTICLE_VALIDATE_SCRIPT: STUB_VALIDATE_PASS });

  // ---------- 慢速 server（stop 测试） ----------
  const SLOW_PORT = FAST_PORT + 15000;
  const SLOW = `http://127.0.0.1:${SLOW_PORT}`;
  const slowServer = startServer(SLOW_PORT, STUB_SLOW, { PROGRESS_WATCH_MS: '400', ARTICLE_VALIDATE_SCRIPT: STUB_VALIDATE_PASS });

  // ---------- 失败 server（retry 测试：无 FORCE_RENDER=1 即失败） ----------
  const FAIL_PORT = FAST_PORT + 30000;
  const FAIL = `http://127.0.0.1:${FAIL_PORT}`;
  const failServer = startServer(FAIL_PORT, STUB_FAIL, { ARTICLE_VALIDATE_SCRIPT: STUB_VALIDATE_PASS });

  // ---------- 鉴权 server（WEB_TOKENS 多用户隔离测试） ----------
  const AUTH_PORT = FAST_PORT - 15000;
  const AUTH = `http://127.0.0.1:${AUTH_PORT}`;
  const authServer = startServer(AUTH_PORT, STUB_FAST, { WEB_TOKENS: 'alice:tokenA,bob:tokenB', ARTICLE_VALIDATE_SCRIPT: STUB_VALIDATE_PASS });

  // ---------- 预检专用 server（建议14） ----------
  const VALB_PORT = await freePort();
  const VALB = `http://127.0.0.1:${VALB_PORT}`;
  const valbServer = startServer(VALB_PORT, STUB_FAST, { ARTICLE_VALIDATE_SCRIPT: STUB_VALIDATE_FAIL });

  const VALW_PORT = await freePort();
  const VALW = `http://127.0.0.1:${VALW_PORT}`;
  const valwServer = startServer(VALW_PORT, STUB_FAST, {
    ARTICLE_VALIDATE_SCRIPT: STUB_VALIDATE_FAIL,
    ARTICLE_VALIDATE_MODE: 'warn',
  });

  // ---------- HOST_PROFILE env server（建议13，预检通过 stub） ----------
  const ENVV_PORT = await freePort();
  const ENVV = `http://127.0.0.1:${ENVV_PORT}`;
  const envvServer = startServer(ENVV_PORT, STUB_ENV, { ARTICLE_VALIDATE_SCRIPT: STUB_VALIDATE_PASS });

  // ---------- SSE 保活 server（建议5：短保活间隔；预检脚本缺失→放行分支） ----------
  const KA_PORT = await freePort();
  const KA = `http://127.0.0.1:${KA_PORT}`;
  const kaServer = startServer(KA_PORT, STUB_FAST, {
    SSE_KEEPALIVE_MS: '200',
    ARTICLE_VALIDATE_SCRIPT: VALIDATE_MISSING,
  });

  try {
    await waitHealth(FAST);
    await waitHealth(SLOW);
    await waitHealth(FAIL);
    await waitHealth(AUTH);
    await waitHealth(VALB);
    await waitHealth(VALW);
    await waitHealth(ENVV);
    await waitHealth(KA);
    console.log('=== server startup / health ===');
    assert(true, `fast :${FAST_PORT}, slow :${SLOW_PORT}, fail :${FAIL_PORT}, auth :${AUTH_PORT}, valb :${VALB_PORT}, valw :${VALW_PORT}, envv :${ENVV_PORT}, ka :${KA_PORT} healthy`);

    // ---------- JSON 创建 ----------
    console.log('=== JSON 创建（draft / run）===');
    const draftName = `${RUN_TAG}_draft`;
    const fullName = `${RUN_TAG}_full`;
    createdOutputNames.push(draftName, fullName);

    const { res: draftRes, data: draft } = await api(FAST, '/api/v1/jobs', {
      method: 'POST',
      json: { outputName: draftName, articleText: '# 草稿文章\n\n正文内容。', run: false },
    });
    createdJobIds.push(draft.jobId);
    assertEqual(draftRes.status, 201, 'run:false returns 201');
    assertEqual(draft.status, 'draft', 'run:false creates draft');
    assertEqual(draft.kind, 'full', 'draft kind is full');

    const { res: runRes, data: running } = await api(FAST, '/api/v1/jobs', {
      method: 'POST',
      json: {
        outputName: fullName,
        articleText: '# 正式文章\n\n这是正文。',
        config: { content_overlay: { subtitles: { dna: 'loud' } } },
      },
    });
    createdJobIds.push(running.jobId);
    assertEqual(runRes.status, 202, 'default run returns 202');
    assert(['queued', 'running'].includes(running.status), 'default run queues immediately');

    const done = await waitStatus(FAST, running.jobId, ['completed', 'failed']);
    assertEqual(done.status, 'completed', 'stub pipeline completes');
    assertEqual(done.finishedAt !== null, true, 'finishedAt set after completion');
    assert(fs.existsSync(path.join(PROJECT_ROOT, 'output', `${fullName}.mp4`)), 'output video created');

    // ---------- 列表 / 详情字段 ----------
    console.log('=== 列表与详情字段 ===');
    {
      const { data: list } = await api(FAST, '/api/v1/jobs?limit=100');
      const item = list.jobs.find((j) => j.jobId === running.jobId);
      assert(item, 'list contains created job');
      assertEqual(item.phases.total, 9, 'list item has 9-phase summary');
      assertEqual(item.phases.completed, 9, 'completed job shows 9/9 phases');
      assertEqual(item.hasMedia, true, 'hasMedia true after stub run');
      assertEqual(item.hasOutput, true, 'hasOutput true after stub run');
      assert('queuePosition' in item, 'queuePosition field present');

      const { data: detail } = await api(FAST, `/api/v1/jobs/${running.jobId}`);
      assertEqual(Object.keys(detail.phases).length, 9, 'detail has full 9 phases');
      assertEqual(detail.phases.render.status, 'completed', 'render phase completed');
      assertEqual(detail.articleText, '# 正式文章\n\n这是正文。', 'detail returns articleText');
      assertEqual(detail.configOverrides.content_overlay.subtitles.dna, 'loud', 'detail returns configOverrides');
      assertEqual(detail.media.ready, true, 'detail media.ready true');
      assert(detail.logs.stdout.includes(`/api/v1/jobs/${running.jobId}/logs/stdout`), 'detail has logs links');

      let badId = null;
      try { await api(FAST, '/api/v1/jobs/not-a-uuid'); } catch (err) { badId = err.status; }
      assertEqual(badId, 400, 'invalid job id rejected with 400');
    }

    // ---------- PATCH ----------
    console.log('=== PATCH 参数与文章 ===');
    {
      const renamed = `${RUN_TAG}_改名`;
      createdOutputNames.push(renamed);
      const { data: patched } = await api(FAST, `/api/v1/jobs/${draft.jobId}`, {
        method: 'PATCH',
        json: {
          outputName: `${renamed}!!`, // 非法字符应被 sanitize
          articleText: '# 改后的文章',
          configOverrides: { style: { bgm_volume: 0.3 } },
        },
      });
      assertEqual(patched.outputName, `${renamed}_`, 'outputName sanitized on PATCH');
      // serializeJob 的 outputs 是下载链接，直接读 state.json 校验磁盘路径同步
      const state = JSON.parse(
        fs.readFileSync(path.join(PROJECT_ROOT, 'api', 'jobs', draft.jobId, 'state.json'), 'utf8')
      );
      assert(state.outputs.video.endsWith(`${renamed}_.mp4`), 'outputs video path follows new outputName');
      assert(state.outputs.cover.endsWith(`${renamed}__cover.png`), 'outputs cover path follows new outputName');
      assertEqual(patched.articleText, '# 改后的文章', 'articleText updated');
      assertEqual(patched.configOverrides.style.bgm_volume, 0.3, 'configOverrides replaced');
    }

    // PATCH 409：running 与 queued 都拒绝（用慢速 server）
    console.log('=== PATCH 409（running/queued）===');
    const slowNameA = `${RUN_TAG}_slow_a`;
    const slowNameB = `${RUN_TAG}_slow_b`;
    createdOutputNames.push(slowNameA, slowNameB);
    const { data: slowA } = await api(SLOW, '/api/v1/jobs', {
      method: 'POST',
      json: { outputName: slowNameA, articleText: '# 慢任务A' },
    });
    createdJobIds.push(slowA.jobId);
    await waitStatus(SLOW, slowA.jobId, ['running']);

    let patchRunning = null;
    try {
      await api(SLOW, `/api/v1/jobs/${slowA.jobId}`, { method: 'PATCH', json: { outputName: 'x' } });
    } catch (err) { patchRunning = err.status; }
    assertEqual(patchRunning, 409, 'PATCH rejected with 409 while running');

    const { data: slowB } = await api(SLOW, '/api/v1/jobs', {
      method: 'POST',
      json: { outputName: slowNameB, articleText: '# 慢任务B' },
    });
    createdJobIds.push(slowB.jobId);
    await waitStatus(SLOW, slowB.jobId, ['queued']);

    let patchQueued = null;
    try {
      await api(SLOW, `/api/v1/jobs/${slowB.jobId}`, { method: 'PATCH', json: { outputName: 'x' } });
    } catch (err) { patchQueued = err.status; }
    assertEqual(patchQueued, 409, 'PATCH rejected with 409 while queued');

    // 队列位置
    {
      const { data: list } = await api(SLOW, '/api/v1/jobs?limit=100');
      const itemB = list.jobs.find((j) => j.jobId === slowB.jobId);
      const itemA = list.jobs.find((j) => j.jobId === slowA.jobId);
      assertEqual(itemB && itemB.queuePosition, 1, 'queued job shows queuePosition=1');
      assertEqual(itemA && itemA.queuePosition, null, 'running job has queuePosition=null');
    }

    // ---------- stop 流转 ----------
    console.log('=== stop 状态流转（queued cancel + running kill）===');
    {
      const { data: stoppedB } = await api(SLOW, `/api/v1/jobs/${slowB.jobId}/stop`, { method: 'POST' });
      assertEqual(stoppedB.status, 'cancelled', 'queued job cancelled via stop');

      const { data: stoppedA } = await api(SLOW, `/api/v1/jobs/${slowA.jobId}/stop`, { method: 'POST' });
      assertEqual(stoppedA.status, 'cancelled', 'running job cancelled via stop');

      // 信号量释放后，已取消的排队任务不应被拉起，状态保持 cancelled
      await sleep(1200);
      const { data: checkB } = await api(SLOW, `/api/v1/jobs/${slowB.jobId}`);
      assertEqual(checkB.status, 'cancelled', 'cancelled queued job stays cancelled after semaphore frees');

      let stopAgain = null;
      try { await api(SLOW, `/api/v1/jobs/${slowA.jobId}/stop`, { method: 'POST' }); } catch (err) { stopAgain = err.status; }
      assertEqual(stopAgain, 409, 'stop on terminal job returns 409');

      let runActive = null;
      const { data: slowC } = await api(SLOW, '/api/v1/jobs', {
        method: 'POST',
        json: { outputName: `${RUN_TAG}_slow_c`, articleText: '# 慢任务C' },
      });
      createdJobIds.push(slowC.jobId);
      createdOutputNames.push(`${RUN_TAG}_slow_c`);
      await waitStatus(SLOW, slowC.jobId, ['running']);
      try { await api(SLOW, `/api/v1/jobs/${slowC.jobId}/run`, { method: 'POST' }); } catch (err) { runActive = err.status; }
      assertEqual(runActive, 409, 'run on running job returns 409');
      await api(SLOW, `/api/v1/jobs/${slowC.jobId}/stop`, { method: 'POST' });
    }

    // ---------- rebuild / run ----------
    console.log('=== rebuild / run 状态流转 ===');
    {
      // 草稿没有媒体，rebuild 400
      let noMedia = null;
      try { await api(FAST, `/api/v1/jobs/${draft.jobId}/rebuild`, { method: 'POST' }); } catch (err) { noMedia = err.status; }
      assertEqual(noMedia, 400, 'rebuild without media returns 400');

      const { res: rbRes, data: rb } = await api(FAST, `/api/v1/jobs/${running.jobId}/rebuild`, { method: 'POST' });
      assertEqual(rbRes.status, 202, 'rebuild accepted with media');
      assertEqual(rb.kind, 'rebuild', 'rebuild sets kind=rebuild');
      const rbDone = await waitStatus(FAST, running.jobId, ['completed', 'failed']);
      assertEqual(rbDone.status, 'completed', 'rebuild completes');

      const { data: rerun } = await api(FAST, `/api/v1/jobs/${running.jobId}/run`, { method: 'POST' });
      assertEqual(rerun.kind, 'full', 'run sets kind=full');
      const rerunDone = await waitStatus(FAST, running.jobId, ['completed', 'failed']);
      assertEqual(rerunDone.status, 'completed', 're-run completes');
    }

    // ---------- clone ----------
    console.log('=== clone 一致性 ===');
    {
      const cloneName = `${RUN_TAG}_clone`;
      createdOutputNames.push(cloneName);
      const { res: cRes, data: clone } = await api(FAST, `/api/v1/jobs/${running.jobId}/clone`, {
        method: 'POST',
        json: { outputName: cloneName, run: false },
      });
      createdJobIds.push(clone.jobId);
      assertEqual(cRes.status, 201, 'clone returns 201 (run:false)');
      assertEqual(clone.status, 'draft', 'clone starts as draft');
      assertEqual(clone.articleText, '# 正式文章\n\n这是正文。', 'clone copies article text');
      assertEqual(clone.configOverrides.content_overlay.subtitles.dna, 'loud', 'clone copies configOverrides');
      assert(clone.jobId !== running.jobId, 'clone has new jobId');
    }

    // ---------- preview Range / inline ----------
    console.log('=== preview Range / inline ===');
    {
      const videoRes = await fetch(`${FAST}/api/v1/jobs/${running.jobId}/preview/video`);
      assertEqual(videoRes.status, 200, 'preview video 200');
      assert((videoRes.headers.get('content-type') || '').includes('video/mp4'), 'preview video content-type');
      const dispo = videoRes.headers.get('content-disposition') || '';
      assert(!dispo.includes('attachment'), 'preview is inline (no attachment disposition)');
      await videoRes.arrayBuffer();

      const rangeRes = await fetch(`${FAST}/api/v1/jobs/${running.jobId}/preview/video`, {
        headers: { Range: 'bytes=0-99' },
      });
      assertEqual(rangeRes.status, 206, 'preview honors Range with 206');
      const buf = await rangeRes.arrayBuffer();
      assertEqual(buf.byteLength, 100, 'range body has exactly 100 bytes');

      const coverRes = await fetch(`${FAST}/api/v1/jobs/${running.jobId}/preview/cover`);
      assertEqual(coverRes.status, 200, 'preview cover 200');
      assert((coverRes.headers.get('content-type') || '').includes('image/png'), 'preview cover content-type');
      await coverRes.arrayBuffer();
    }

    // ---------- logs / download 兼容 ----------
    console.log('=== logs / download 兼容 ===');
    {
      const { text: stdout } = await api(FAST, `/api/v1/jobs/${running.jobId}/logs/stdout`);
      assert(stdout.includes('stub pipeline done'), 'stdout log streams stub output');

      const dl = await fetch(`${FAST}/api/v1/jobs/${running.jobId}/download/video`);
      assertEqual(dl.status, 200, 'download video 200');
      assert((dl.headers.get('content-disposition') || '').includes('attachment'), 'download uses attachment disposition');
      await dl.arrayBuffer();
    }

    // ---------- multipart 创建兼容 ----------
    console.log('=== multipart 创建兼容 ===');
    {
      const mpName = `${RUN_TAG}_mp`;
      createdOutputNames.push(mpName);
      const form = new FormData();
      form.append('article', new Blob(['# 多部分文章\n\n正文。'], { type: 'text/markdown' }), 'article.md');
      form.append('outputName', mpName);
      form.append('config', JSON.stringify({ style: { bgm_volume: 0.2 } }));
      const res = await fetch(`${FAST}/api/v1/jobs`, { method: 'POST', body: form });
      assertEqual(res.status, 202, 'multipart creation returns 202');
      const mp = await res.json();
      createdJobIds.push(mp.jobId);
      const mpDone = await waitStatus(FAST, mp.jobId, ['completed', 'failed']);
      assertEqual(mpDone.status, 'completed', 'multipart job runs automatically');

      // 非文本文件被 fileFilter 拒绝
      const badForm = new FormData();
      badForm.append('article', new Blob(['x'], { type: 'application/octet-stream' }), 'evil.exe');
      const badRes = await fetch(`${FAST}/api/v1/jobs`, { method: 'POST', body: badForm });
      assertEqual(badRes.status, 400, 'non-md/txt upload rejected with 400');
    }

    // ---------- DELETE purge ----------
    console.log('=== DELETE（含 purge 清理 temp/output）===');
    {
      const purgeName = `${RUN_TAG}_purge`;
      createdOutputNames.push(purgeName);
      const { data: pj } = await api(FAST, '/api/v1/jobs', {
        method: 'POST',
        json: { outputName: purgeName, articleText: '# 待清理' },
      });
      createdJobIds.push(pj.jobId);
      await waitStatus(FAST, pj.jobId, ['completed', 'failed']);
      assert(fs.existsSync(path.join(PROJECT_ROOT, 'temp', purgeName)), 'temp dir exists before purge');
      assert(fs.existsSync(path.join(PROJECT_ROOT, 'output', `${purgeName}.mp4`)), 'output exists before purge');

      const { data: del } = await api(FAST, `/api/v1/jobs/${pj.jobId}?purge=1`, { method: 'DELETE' });
      assertEqual(del.deleted, true, 'delete returns deleted=true');
      assert(!fs.existsSync(path.join(PROJECT_ROOT, 'temp', purgeName)), 'purge removes temp dir');
      assert(!fs.existsSync(path.join(PROJECT_ROOT, 'output', `${purgeName}.mp4`)), 'purge removes output video');
      assert(!fs.existsSync(path.join(PROJECT_ROOT, 'output', `${purgeName}_cover.png`)), 'purge removes output cover');
      assert(!fs.existsSync(path.join(PROJECT_ROOT, 'api', 'jobs', pj.jobId)), 'delete removes job dir');

      let gone = null;
      try { await api(FAST, `/api/v1/jobs/${pj.jobId}`); } catch (err) { gone = err.status; }
      assertEqual(gone, 404, 'deleted job returns 404');
    }

    // ---------- config 枚举与脱敏 ----------
    console.log('=== config 枚举与脱敏 ===');
    {
      const { data: cfg } = await api(FAST, '/api/v1/config');
      const dnaIds = cfg.enums.captionDnas.map((d) => d.id);
      assertEqual(dnaIds.join(','), 'classic,loud,keynote,cream,editorial,documentary', 'caption DNA enums mirror registry');
      assert(cfg.enums.captionDnas.every((d) => d.label), 'caption DNAs have Chinese labels');
      assertEqual(cfg.enums.hybridPresets.length, 5, 'hybrid presets enum has 5 entries');
      assertEqual(cfg.enums.mediaTypes.map((m) => m.id).join(','), 'image,video,mixed', 'media_type enums');
      assertEqual(cfg.enums.aspects.map((a) => a.id).join(','), '9:16,16:9,1:1', 'aspect enums mirror compositions (含 1:1)');
      assert(cfg.profile && cfg.profile.content_overlay, 'config returns base profile');
      assertEqual(cfg.profile.scene_visuals.pexels.api_key, '', 'api keys stripped from profile');
    }

    // ---------- SPA 静态托管 ----------
    console.log('=== SPA 静态托管 ===');
    {
      const index = await fetch(`${FAST}/`);
      assertEqual(index.status, 200, 'GET / serves index.html');
      const html = await index.text();
      assert(html.includes('/app.js'), 'index.html references app.js');

      const spa = await fetch(`${FAST}/some/spa/route`);
      assertEqual(spa.status, 200, 'SPA fallback serves index.html for non-/api paths');
      const spaHtml = await spa.text();
      assert(spaHtml.includes('/app.js'), 'SPA fallback returns index.html content');

      const js = await fetch(`${FAST}/app.js`);
      assertEqual(js.status, 200, 'static app.js served');
      await js.text();
    }

    // ---------- config lastJobOverrides ----------
    console.log('=== config lastJobOverrides ===');
    {
      const { data: jobA } = await api(FAST, '/api/v1/jobs', {
        method: 'POST',
        json: {
          outputName: `${RUN_TAG}_cfg_a`,
          articleText: '# 配置A',
          run: false,
          config: { content_overlay: { subtitles: { dna: 'keynote' } } },
        },
      });
      createdJobIds.push(jobA.jobId);
      const { data: cfgA } = await api(FAST, '/api/v1/config');
      assertEqual(
        cfgA.lastJobOverrides && cfgA.lastJobOverrides.content_overlay.subtitles.dna,
        'keynote',
        'lastJobOverrides returns latest job configOverrides'
      );

      await sleep(50); // createdAt 毫秒精度，确保 B 是最新任务
      const { data: jobB } = await api(FAST, '/api/v1/jobs', {
        method: 'POST',
        json: { outputName: `${RUN_TAG}_cfg_b`, articleText: '# 配置B', run: false },
      });
      createdJobIds.push(jobB.jobId);
      const { data: cfgB } = await api(FAST, '/api/v1/config');
      assertEqual(cfgB.lastJobOverrides, null, 'lastJobOverrides null when latest job has no overrides');
    }

    // ---------- 版本化运行：run/rebuild 追加版本 + 阶段复用 + purge ----------
    console.log('=== 版本化运行（versioned runs + 阶段复用）===');
    {
      const verName = `${RUN_TAG}_ver`;
      createdOutputNames.push(verName, `${verName}_v2`, `${verName}_v3`);
      const { data: vj } = await api(FAST, '/api/v1/jobs', {
        method: 'POST',
        json: {
          outputName: verName,
          articleText: '# 版本测试\n\n正文。',
          config: { content_overlay: { subtitles: { dna: 'loud' } } },
        },
      });
      createdJobIds.push(vj.jobId);
      const v1Done = await waitStatus(FAST, vj.jobId, ['completed', 'failed']);
      assertEqual(v1Done.status, 'completed', 'v1 run completes');
      assertEqual(v1Done.versions.length, 1, 'v1 creates exactly one version');
      assertEqual(v1Done.versions[0].runName, verName, 'v1 runName is outputName');
      assertEqual(v1Done.versions[0].kind, 'full', 'v1 kind is full');
      assertEqual(v1Done.versions[0].status, 'completed', 'v1 version status completed');
      assertEqual(v1Done.latestVersion, 1, 'latestVersion=1 after first run');
      assertEqual(v1Done.configDirty, false, 'configDirty false right after run');

      // v1 工作目录放个哨兵文件，验证 v2 复用是真实目录拷贝
      fs.writeFileSync(path.join(PROJECT_ROOT, 'temp', verName, 'reuse_marker.txt'), 'marker');

      const { data: patched } = await api(FAST, `/api/v1/jobs/${vj.jobId}`, {
        method: 'PATCH',
        json: { configOverrides: { content_overlay: { subtitles: { dna: 'cream' } } } },
      });
      assertEqual(patched.configDirty, true, 'configDirty true after dna PATCH');

      const { res: run2Res, data: run2 } = await api(FAST, `/api/v1/jobs/${vj.jobId}/run`, { method: 'POST' });
      assertEqual(run2Res.status, 202, 'second run accepted with 202');
      assertEqual(run2.versions.length, 2, 'second run appends version 2');
      assertEqual(run2.versions[1].runName, `${verName}_v2`, 'v2 runName is <outputName>_v2');
      assertEqual(run2.versions[1].kind, 'full', 'v2 kind is full');
      assertEqual(run2.configDirty, false, 'configDirty false after queue (snapshot == current)');
      assert(fs.existsSync(path.join(PROJECT_ROOT, 'output', `${verName}.mp4`)), 'v1 output file still on disk after v2 queued');

      const v2Done = await waitStatus(FAST, vj.jobId, ['completed', 'failed']);
      assertEqual(v2Done.status, 'completed', 'v2 run completes');
      assertEqual(v2Done.latestVersion, 2, 'latestVersion=2 after second run');
      assertEqual(v2Done.versions[1].status, 'completed', 'v2 version status completed');
      assert(fs.existsSync(path.join(PROJECT_ROOT, 'output', `${verName}.mp4`)), 'v1 output file still on disk after v2 completes');
      assert(fs.existsSync(path.join(PROJECT_ROOT, 'output', `${verName}_v2.mp4`)), 'v2 output video created');

      // 复用 prep：dna 变更 → 只 render 失效；render pending & tts completed；路径指向 v2 目录
      const v2Work = path.join(PROJECT_ROOT, 'temp', `${verName}_v2`);
      assert(fs.existsSync(path.join(v2Work, 'reuse_marker.txt')), 'reuse prep copied previous workdir (marker file)');
      assert(fs.existsSync(path.join(v2Work, 'audio.wav')), 'v2 workdir has audio.wav');
      assert(fs.existsSync(path.join(v2Work, 'lip_synced_raw.mp4')), 'v2 workdir has lip_synced_raw.mp4');
      const v2State = JSON.parse(fs.readFileSync(path.join(v2Work, '.pipeline_state.json'), 'utf8'));
      assertEqual(v2State.render.status, 'pending', 'render-only change leaves render pending');
      assertEqual(v2State.tts.status, 'completed', 'render-only change keeps tts completed');
      assert(
        v2State.tts.output.includes(path.join('temp', `${verName}_v2`)),
        'state output paths rewritten to v2 dir'
      );
      assert(
        !v2State.tts.output.includes(path.join('temp', verName) + path.sep),
        'state output paths no longer point at v1 dir'
      );

      // rebuild → v3：媒体来自 v2 工作目录，runName 用新版本名
      const { data: rb3 } = await api(FAST, `/api/v1/jobs/${vj.jobId}/rebuild`, { method: 'POST' });
      assertEqual(rb3.versions.length, 3, 'rebuild appends version 3');
      assertEqual(rb3.versions[2].kind, 'rebuild', 'v3 kind is rebuild');
      assertEqual(rb3.versions[2].runName, `${verName}_v3`, 'v3 runName is <outputName>_v3');
      const v3Done = await waitStatus(FAST, vj.jobId, ['completed', 'failed']);
      assertEqual(v3Done.status, 'completed', 'v3 rebuild completes');
      assert(fs.existsSync(path.join(PROJECT_ROOT, 'output', `${verName}_v3.mp4`)), 'v3 output video created');

      const { data: patched2 } = await api(FAST, `/api/v1/jobs/${vj.jobId}`, {
        method: 'PATCH',
        json: { configOverrides: { content_overlay: { subtitles: { dna: 'classic' } } } },
      });
      assertEqual(patched2.configDirty, true, 'configDirty true again after later PATCH');

      // 版本预览/下载：?version=1 仍可取 v1 产物
      const v1Range = await fetch(`${FAST}/api/v1/jobs/${vj.jobId}/preview/video?version=1`, {
        headers: { Range: 'bytes=0-99' },
      });
      assertEqual(v1Range.status, 206, 'preview?version=1 honors Range with 206');
      assertEqual((await v1Range.arrayBuffer()).byteLength, 100, 'preview?version=1 range body has 100 bytes');

      const latestPreview = await fetch(`${FAST}/api/v1/jobs/${vj.jobId}/preview/video`);
      assertEqual(latestPreview.status, 200, 'preview without version serves latest completed (v3)');
      await latestPreview.arrayBuffer();

      const v2Cover = await fetch(`${FAST}/api/v1/jobs/${vj.jobId}/preview/cover?version=2`);
      assertEqual(v2Cover.status, 200, 'preview?version=2 cover 200');
      await v2Cover.arrayBuffer();

      const badVersion = await fetch(`${FAST}/api/v1/jobs/${vj.jobId}/preview/video?version=99`);
      assertEqual(badVersion.status, 404, 'unknown version returns 404');
      await badVersion.arrayBuffer();

      const v1Dl = await fetch(`${FAST}/api/v1/jobs/${vj.jobId}/download/video?version=1`);
      assertEqual(v1Dl.status, 200, 'download?version=1 200');
      assert(
        (v1Dl.headers.get('content-disposition') || '').includes(`${verName}.mp4`),
        'download?version=1 uses v1 runName as filename'
      );
      await v1Dl.arrayBuffer();

      // purge：清掉所有版本的 workdir 与产物
      const { data: del } = await api(FAST, `/api/v1/jobs/${vj.jobId}?purge=1`, { method: 'DELETE' });
      assertEqual(del.deleted, true, 'purge delete returns deleted=true');
      assert(!fs.existsSync(path.join(PROJECT_ROOT, 'temp', verName)), 'purge removes v1 workdir');
      assert(!fs.existsSync(path.join(PROJECT_ROOT, 'temp', `${verName}_v2`)), 'purge removes v2 workdir');
      assert(!fs.existsSync(path.join(PROJECT_ROOT, 'temp', `${verName}_v3`)), 'purge removes v3 workdir');
      assert(!fs.existsSync(path.join(PROJECT_ROOT, 'output', `${verName}.mp4`)), 'purge removes v1 video');
      assert(!fs.existsSync(path.join(PROJECT_ROOT, 'output', `${verName}_cover.png`)), 'purge removes v1 cover');
      assert(!fs.existsSync(path.join(PROJECT_ROOT, 'output', `${verName}_v2.mp4`)), 'purge removes v2 video');
      assert(!fs.existsSync(path.join(PROJECT_ROOT, 'output', `${verName}_v2_cover.png`)), 'purge removes v2 cover');
      assert(!fs.existsSync(path.join(PROJECT_ROOT, 'output', `${verName}_v3.mp4`)), 'purge removes v3 video');
      assert(!fs.existsSync(path.join(PROJECT_ROOT, 'output', `${verName}_v3_cover.png`)), 'purge removes v3 cover');
    }

    // ---------- 文章变更 → script 阶段失效 ----------
    console.log('=== 文章变更（invalidation=script）===');
    {
      const artName = `${RUN_TAG}_art`;
      createdOutputNames.push(artName, `${artName}_v2`);
      const { data: aj } = await api(FAST, '/api/v1/jobs', {
        method: 'POST',
        json: { outputName: artName, articleText: '# 原文章\n\n正文。' },
      });
      createdJobIds.push(aj.jobId);
      const a1Done = await waitStatus(FAST, aj.jobId, ['completed', 'failed']);
      assertEqual(a1Done.status, 'completed', 'article job v1 completes');

      await api(FAST, `/api/v1/jobs/${aj.jobId}`, {
        method: 'PATCH',
        json: { articleText: '# 完全不同的文章\n\n新正文。' },
      });
      const { data: run2 } = await api(FAST, `/api/v1/jobs/${aj.jobId}/run`, { method: 'POST' });
      assertEqual(run2.versions.length, 2, 'article change run appends v2');
      // 复用 prep 在排队时同步完成；stub 不覆盖已有 state，断言不受时序影响
      const v2State = JSON.parse(
        fs.readFileSync(path.join(PROJECT_ROOT, 'temp', `${artName}_v2`, '.pipeline_state.json'), 'utf8')
      );
      assertEqual(v2State.script.status, 'pending', 'article change invalidates script');
      assertEqual(v2State.tts.status, 'pending', 'article change cascades to tts');
      const a2Done = await waitStatus(FAST, aj.jobId, ['completed', 'failed']);
      assertEqual(a2Done.status, 'completed', 'article-change v2 completes');
    }

    // ---------- P0-3 Rebuild 瘦身（invalidation 固定 render，零 LLM） ----------
    console.log('=== P0-3 Rebuild 瘦身（slim rebuild）===');
    {
      const slimName = `${RUN_TAG}_slim`;
      createdOutputNames.push(slimName, `${slimName}_v2`);
      const { data: sj } = await api(FAST, '/api/v1/jobs', {
        method: 'POST',
        json: {
          outputName: slimName,
          articleText: '# 瘦身 rebuild\n\n正文。',
          config: { content_overlay: { subtitles: { dna: 'loud' } } },
        },
      });
      createdJobIds.push(sj.jobId);
      const s1 = await waitStatus(FAST, sj.jobId, ['completed', 'failed']);
      assertEqual(s1.status, 'completed', 'slim job v1 completes');

      // v1 工作目录写入带标识的 storyboard.json：rebuild 后字节不变 = 没有 LLM 重生成
      const storyboardContent = JSON.stringify({ scenes: [1, 2, 3], marker: RUN_TAG }, null, 2);
      fs.writeFileSync(path.join(PROJECT_ROOT, 'temp', slimName, 'storyboard.json'), storyboardContent);

      await api(FAST, `/api/v1/jobs/${sj.jobId}`, {
        method: 'PATCH',
        json: { configOverrides: { content_overlay: { subtitles: { dna: 'cream' } } } },
      });
      const { res: slimRes, data: slim } = await api(FAST, `/api/v1/jobs/${sj.jobId}/rebuild`, { method: 'POST' });
      assertEqual(slimRes.status, 202, 'slim rebuild accepted with 202');
      assertEqual(slim.versions.length, 2, 'slim rebuild appends v2');
      assertEqual(slim.versions[1].kind, 'rebuild', 'v2 kind is rebuild');
      assertEqual(slim.versions[1].runName, `${slimName}_v2`, 'v2 runName is <outputName>_v2');
      const s2 = await waitStatus(FAST, sj.jobId, ['completed', 'failed']);
      assertEqual(s2.status, 'completed', 'slim rebuild completes');

      // 失效固定 render：storyboard 保持 completed，render 被重置（stub 不覆盖已有 state）
      const slimState = JSON.parse(
        fs.readFileSync(path.join(PROJECT_ROOT, 'temp', `${slimName}_v2`, '.pipeline_state.json'), 'utf8')
      );
      assertEqual(slimState.storyboard.status, 'completed', 'slim rebuild keeps storyboard completed');
      assert(slimState.render.status !== 'completed', 'slim rebuild leaves render not-completed (reset)');
      const copiedStoryboard = fs.readFileSync(
        path.join(PROJECT_ROOT, 'temp', `${slimName}_v2`, 'storyboard.json'), 'utf8'
      );
      assertEqual(copiedStoryboard, storyboardContent, 'storyboard.json byte-identical to v1 (no LLM regen)');
    }

    // ---------- P0-4 口播稿读写 + fromPhase ----------
    console.log('=== P0-4 口播稿微调（script GET/PUT + fromPhase）===');
    {
      const scName = `${RUN_TAG}_sc`;
      createdOutputNames.push(scName, `${scName}_v2`);
      const { data: sc } = await api(FAST, '/api/v1/jobs', {
        method: 'POST',
        json: { outputName: scName, articleText: '# 口播稿测试\n\n正文。' },
      });
      createdJobIds.push(sc.jobId);
      await waitStatus(FAST, sc.jobId, ['completed', 'failed']);

      // stub 不生成 script.txt → GET 404；PUT 后可读写
      let getMissing = null;
      try { await api(FAST, `/api/v1/jobs/${sc.jobId}/script`); } catch (err) { getMissing = err.status; }
      assertEqual(getMissing, 404, 'GET script 404 when script.txt absent');

      const scriptText = '测试口播稿\n第二行内容。';
      const { data: putRes } = await api(FAST, `/api/v1/jobs/${sc.jobId}/script`, {
        method: 'PUT',
        json: { script: scriptText },
      });
      assertEqual(putRes.ok, true, 'PUT script writes back');
      const { data: getRes } = await api(FAST, `/api/v1/jobs/${sc.jobId}/script`);
      assertEqual(getRes.script, scriptText, 'GET script round-trips');

      let badFrom = null;
      try {
        await api(FAST, `/api/v1/jobs/${sc.jobId}/run`, { method: 'POST', json: { fromPhase: 'bogus' } });
      } catch (err) { badFrom = err.status; }
      assertEqual(badFrom, 400, 'run with unknown fromPhase returns 400');

      const { data: runSub } = await api(FAST, `/api/v1/jobs/${sc.jobId}/run`, {
        method: 'POST',
        json: { fromPhase: 'subtitles' },
      });
      assertEqual(runSub.versions.length, 2, 'fromPhase run appends v2');
      assertEqual(runSub.versions[1].configSnapshot.scriptEdited, true, 'snapshot records scriptEdited');
      assertEqual(runSub.versions[1].configSnapshot.fromPhase, 'subtitles', 'snapshot records fromPhase');
      assertEqual(runSub.configDirty, false, 'configDirty false with snapshot meta keys');

      // 准备态：subtitles 起全部 pending，script/tts/whisper 保持 completed
      const scState = JSON.parse(
        fs.readFileSync(path.join(PROJECT_ROOT, 'temp', `${scName}_v2`, '.pipeline_state.json'), 'utf8')
      );
      assertEqual(scState.script.status, 'completed', 'fromPhase=subtitles keeps script completed');
      assertEqual(scState.tts.status, 'completed', 'fromPhase=subtitles keeps tts completed');
      assertEqual(scState.whisper.status, 'completed', 'fromPhase=subtitles keeps whisper completed');
      ['subtitles', 'storyboard', 'visuals', 'lipsync', 'postprocess', 'render'].forEach((ph) => {
        assertEqual(scState[ph].status, 'pending', `fromPhase=subtitles resets ${ph}`);
      });
      const sc2 = await waitStatus(FAST, sc.jobId, ['completed', 'failed']);
      assertEqual(sc2.status, 'completed', 'fromPhase run completes');
    }

    // ---------- 活跃状态 409（script PUT / retry） ----------
    console.log('=== 活跃状态 409（script PUT / retry）===');
    {
      const slowDName = `${RUN_TAG}_slow_d`;
      createdOutputNames.push(slowDName);
      const { data: slowD } = await api(SLOW, '/api/v1/jobs', {
        method: 'POST',
        json: { outputName: slowDName, articleText: '# 慢任务D' },
      });
      createdJobIds.push(slowD.jobId);
      await waitStatus(SLOW, slowD.jobId, ['running']);

      let putActive = null;
      try {
        await api(SLOW, `/api/v1/jobs/${slowD.jobId}/script`, { method: 'PUT', json: { script: 'x' } });
      } catch (err) { putActive = err.status; }
      assertEqual(putActive, 409, 'PUT script rejected with 409 while running');

      let retryActive = null;
      try {
        await api(SLOW, `/api/v1/jobs/${slowD.jobId}/retry`, { method: 'POST', json: {} });
      } catch (err) { retryActive = err.status; }
      assertEqual(retryActive, 409, 'retry rejected with 409 while running');

      await api(SLOW, `/api/v1/jobs/${slowD.jobId}/stop`, { method: 'POST' });
    }

    // ---------- P0-1 失败阶段重试 ----------
    console.log('=== P0-1 失败阶段重试（retry）===');
    {
      const failName = `${RUN_TAG}_fail`;
      createdOutputNames.push(failName);
      const { data: fj } = await api(FAIL, '/api/v1/jobs', {
        method: 'POST',
        json: { outputName: failName, articleText: '# 失败重试\n\n正文。' },
      });
      createdJobIds.push(fj.jobId);
      const f1 = await waitStatus(FAIL, fj.jobId, ['completed', 'failed']);
      assertEqual(f1.status, 'failed', 'fail stub exits 1 on first run');
      assertEqual(f1.versions.length, 1, 'failed run has one version');
      assertEqual(f1.versions[0].status, 'failed', 'v1 version status failed');

      // 无 phase 续跑：没有 FORCE_RENDER=1 仍失败，且不产生新版本
      const { res: retryRes } = await api(FAIL, `/api/v1/jobs/${fj.jobId}/retry`, { method: 'POST', json: {} });
      assertEqual(retryRes.status, 202, 'plain retry accepted with 202');
      const f2 = await waitStatus(FAIL, fj.jobId, ['completed', 'failed']);
      assertEqual(f2.status, 'failed', 'plain retry fails again without FORCE_RENDER');
      assertEqual(f2.versions.length, 1, 'retry does not create a new version');
      assertEqual(f2.versions[0].status, 'failed', 'version status failed again');

      // 指定 phase=render：注入 FORCE_RENDER=1 → 成功，版本状态翻回 completed
      const { data: retry2 } = await api(FAIL, `/api/v1/jobs/${fj.jobId}/retry`, {
        method: 'POST',
        json: { phase: 'render' },
      });
      assertEqual(retry2.versions.length, 1, 'phase retry still same version');
      const f3 = await waitStatus(FAIL, fj.jobId, ['completed', 'failed']);
      assertEqual(f3.status, 'completed', 'retry {phase:render} completes via FORCE_RENDER=1');
      assertEqual(f3.versions[0].status, 'completed', 'version status flips back to completed');
      assertEqual(f3.latestVersion, 1, 'latestVersion stays 1 after retries');

      let badPhase = null;
      try {
        await api(FAIL, `/api/v1/jobs/${fj.jobId}/retry`, { method: 'POST', json: { phase: 'bogus' } });
      } catch (err) { badPhase = err.status; }
      assertEqual(badPhase, 400, 'retry with unknown phase returns 400');

      let retryDraft = null;
      try {
        await api(FAST, `/api/v1/jobs/${draft.jobId}/retry`, { method: 'POST', json: {} });
      } catch (err) { retryDraft = err.status; }
      assertEqual(retryDraft, 400, 'retry on never-run job returns 400');
    }

    // ---------- P0-2 estimates API ----------
    console.log('=== P0-2 estimates API ===');
    {
      const { data: est } = await api(FAST, '/api/v1/estimates');
      assert(
        est.full && typeof est.full.avgSeconds === 'number' && est.full.samples >= 1,
        'estimates full group has samples after completed full runs'
      );
      assert(
        est.rebuild && typeof est.rebuild.avgSeconds === 'number' && est.rebuild.samples >= 1,
        'estimates rebuild group has samples after slim rebuild'
      );
      assert(est.full.avgSeconds >= 0 && est.rebuild.avgSeconds >= 0, 'avgSeconds non-negative');
    }

    // ---------- P1-5 批量导入 ----------
    console.log('=== P1-5 批量导入（batch）===');
    {
      const batchBase = `${RUN_TAG}_batch`;
      const { res: bRes, data: bData } = await api(FAST, '/api/v1/jobs/batch', {
        method: 'POST',
        json: {
          run: false,
          items: [
            { outputName: `${batchBase}_a`, articleText: '# 批量A' },
            { outputName: `${batchBase}_b`, articleText: '' }, // 坏条目：空文章
            { outputName: `${batchBase}_c`, articleText: '# 批量C', config: { content_overlay: { subtitles: { dna: 'cream' } } } },
          ],
        },
      });
      assertEqual(bRes.status, 200, 'batch returns 200 with per-item status');
      assertEqual(bData.jobs.length, 3, 'batch returns one result per item');
      assertEqual(bData.jobs[0].ok, true, 'batch item 0 ok');
      assertEqual(bData.jobs[1].ok, false, 'batch item 1 fails with empty article');
      assert(bData.jobs[1].error.includes('articleText'), 'batch item 1 error mentions articleText');
      assertEqual(bData.jobs[2].ok, true, 'batch item 2 ok (bad item does not abort batch)');
      const jobA = bData.jobs[0].job;
      const jobC = bData.jobs[2].job;
      createdJobIds.push(jobA.jobId, jobC.jobId);
      createdOutputNames.push(`${batchBase}_a`, `${batchBase}_c`);
      assertEqual(jobA.status, 'draft', 'batch run:false creates drafts');
      assertEqual(jobC.configOverrides.content_overlay.subtitles.dna, 'cream', 'batch item config applied');

      let badBatch = null;
      try { await api(FAST, '/api/v1/jobs/batch', { method: 'POST', json: { items: [] } }); } catch (err) { badBatch = err.status; }
      assertEqual(badBatch, 400, 'batch with empty items returns 400');

      // run:true → 立即排队，信号量串行执行
      const { data: bRun } = await api(FAST, '/api/v1/jobs/batch', {
        method: 'POST',
        json: {
          run: true,
          items: [
            { outputName: `${batchBase}_r1`, articleText: '# 批量跑1' },
            { outputName: `${batchBase}_r2`, articleText: '# 批量跑2' },
          ],
        },
      });
      const r1 = bRun.jobs[0].job;
      const r2 = bRun.jobs[1].job;
      createdJobIds.push(r1.jobId, r2.jobId);
      createdOutputNames.push(`${batchBase}_r1`, `${batchBase}_r2`);
      assert(['queued', 'running'].includes(r1.status), 'batch run:true queues immediately');
      const r1Done = await waitStatus(FAST, r1.jobId, ['completed', 'failed']);
      const r2Done = await waitStatus(FAST, r2.jobId, ['completed', 'failed']);
      assertEqual(r1Done.status, 'completed', 'batch run item 1 completes');
      assertEqual(r2Done.status, 'completed', 'batch run item 2 completes');
    }

    // ---------- P1-5 配置模板 ----------
    console.log('=== P1-5 配置模板（templates）===');
    {
      const tplPath = path.join(PROJECT_ROOT, 'api', 'templates.json');
      try { fs.rmSync(tplPath, { force: true }); } catch (_e) {}

      const { data: seeded } = await api(FAST, '/api/v1/templates');
      const names = seeded.templates.map((t) => t.name).sort();
      assertEqual(names.join(','), '发布会风,知识科普', 'built-in templates seeded on first GET');
      assert(fs.existsSync(tplPath), 'templates.json written on seed');
      const kp = seeded.templates.find((t) => t.name === '知识科普');
      assertEqual(kp.overrides.content_overlay.subtitles.dna, 'loud', '知识科普 dna loud');
      assertEqual(kp.overrides.video_layout.hybrid.chapterCardScale, 1.5, '知识科普 chapterCardScale 1.5');

      const { data: upserted } = await api(FAST, '/api/v1/templates', {
        method: 'POST',
        json: { name: '测试模板', overrides: { style: { bgm_volume: 0.08 } } },
      });
      assertEqual(upserted.ok, true, 'POST template upserts');
      const { data: afterPost } = await api(FAST, '/api/v1/templates');
      assert(
        afterPost.templates.some((t) => t.name === '测试模板' && t.overrides.style.bgm_volume === 0.08),
        'upserted template persisted'
      );
      assertEqual(afterPost.templates.length, 3, 'template count 3 after upsert');

      let noName = null;
      try { await api(FAST, '/api/v1/templates', { method: 'POST', json: { name: '', overrides: {} } }); } catch (err) { noName = err.status; }
      assertEqual(noName, 400, 'template with empty name returns 400');
      let longName = null;
      try { await api(FAST, '/api/v1/templates', { method: 'POST', json: { name: 'x'.repeat(41), overrides: {} } }); } catch (err) { longName = err.status; }
      assertEqual(longName, 400, 'template with >40 char name returns 400');
      let badOv = null;
      try { await api(FAST, '/api/v1/templates', { method: 'POST', json: { name: 'ok', overrides: [1] } }); } catch (err) { badOv = err.status; }
      assertEqual(badOv, 400, 'template with array overrides returns 400');

      // 同名 upsert 覆盖
      await api(FAST, '/api/v1/templates', {
        method: 'POST',
        json: { name: '测试模板', overrides: { style: { bgm_volume: 0.5 } } },
      });
      const { data: afterUpsert } = await api(FAST, '/api/v1/templates');
      assertEqual(
        afterUpsert.templates.find((t) => t.name === '测试模板').overrides.style.bgm_volume,
        0.5,
        'upsert overwrites by name'
      );
      assertEqual(afterUpsert.templates.length, 3, 'upsert by name keeps count');

      const del = await fetch(`${FAST}/api/v1/templates/${encodeURIComponent('测试模板')}`, { method: 'DELETE' });
      assertEqual(del.status, 200, 'DELETE template 200');
      await del.json();
      const { data: afterDel } = await api(FAST, '/api/v1/templates');
      assertEqual(afterDel.templates.length, 2, 'template removed');
      let delAgain = null;
      try {
        await api(FAST, `/api/v1/templates/${encodeURIComponent('测试模板')}`, { method: 'DELETE' });
      } catch (err) { delAgain = err.status; }
      assertEqual(delAgain, 404, 'DELETE missing template returns 404');

      const onDisk = JSON.parse(fs.readFileSync(tplPath, 'utf8'));
      assert('知识科普' in onDisk && '发布会风' in onDisk, 'templates.json on disk contains built-ins');
      try { fs.rmSync(tplPath, { force: true }); } catch (_e) {}
    }

    // ---------- P1-7 SSE 实时推送 ----------
    console.log('=== P1-7 SSE 实时推送 ===');
    {
      const sseName = `${RUN_TAG}_sse`;
      createdOutputNames.push(sseName);
      // 先建草稿（draft 事件不监听），再连 SSE，再触发 /run 的 queued/running 事件
      const { data: sj } = await api(FAST, '/api/v1/jobs', {
        method: 'POST',
        json: { outputName: sseName, articleText: '# SSE 测试', run: false },
      });
      createdJobIds.push(sj.jobId);

      const frames = [];
      await new Promise((resolve, reject) => {
        const req = http.get(`${FAST}/api/v1/events`, (res) => {
          assertEqual(res.statusCode, 200, 'SSE endpoint returns 200');
          assert(
            (res.headers['content-type'] || '').includes('text/event-stream'),
            'SSE content-type is text/event-stream'
          );
          let buf = '';
          res.on('data', (chunk) => {
            buf += chunk.toString();
            let idx;
            while ((idx = buf.indexOf('\n\n')) !== -1) {
              const frame = buf.slice(0, idx);
              buf = buf.slice(idx + 2);
              if (frame.startsWith('data: ')) frames.push(frame);
            }
            if (frames.some((f) => f.includes(sj.jobId))) {
              req.destroy();
              resolve();
            }
          });
          res.on('error', () => { /* destroy 触发，忽略 */ });
          // 连接建立后触发一次状态变更
          api(FAST, `/api/v1/jobs/${sj.jobId}/run`, { method: 'POST' }).catch(reject);
        });
        req.on('error', () => { /* destroy 触发，忽略 */ });
        req.setTimeout(15000, () => {
          req.destroy();
          reject(new Error('SSE timeout waiting job event'));
        });
      });

      const jobFrame = frames.find((f) => f.includes(sj.jobId));
      assert(jobFrame, 'SSE delivers a data frame for the job transition');
      const parsed = JSON.parse(jobFrame.slice('data: '.length));
      assertEqual(parsed.type, 'job', 'SSE frame type is job');
      assertEqual(parsed.jobId, sj.jobId, 'SSE frame carries jobId');
      assert('status' in parsed && 'latestVersion' in parsed, 'SSE frame carries status + latestVersion');
      await waitStatus(FAST, sj.jobId, ['completed', 'failed']);
    }

    // ---------- SSE 进度 watcher：status 不变时也能收到阶段/日志进度事件 ----------
    console.log('=== SSE 进度 watcher ===');
    {
      const watchName = `${RUN_TAG}_ssewatch`;
      createdOutputNames.push(watchName);
      // slow server：任务一直处于 running（status 不变），靠 watcher 推阶段进度
      const { data: wj } = await api(SLOW, '/api/v1/jobs', {
        method: 'POST',
        json: { outputName: watchName, articleText: '# watcher 测试', run: true },
      });
      createdJobIds.push(wj.jobId);
      await waitStatus(SLOW, wj.jobId, ['running']);

      await new Promise((resolve, reject) => {
        const req = http.get(`${SLOW}/api/v1/events`, (res) => {
          let buf = '';
          res.on('data', (chunk) => {
            buf += chunk.toString();
            if (buf.includes(`"jobId":"${wj.jobId}"`)) {
              req.destroy();
              resolve();
            }
          });
          res.on('error', () => {});
          // 连接建立后模拟阶段推进：写入 state 文件改变 watcher 指纹
          const dir = path.join(PROJECT_ROOT, 'temp', watchName);
          fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(
            path.join(dir, '.pipeline_state.json'),
            JSON.stringify({
              script: { status: 'completed', started_at: '2026-01-01T00:00:00Z', completed_at: '2026-01-01T00:00:05Z', output: null, attempt: 1, error: null },
            })
          );
        });
        req.on('error', () => {});
        req.setTimeout(10000, () => {
          req.destroy();
          reject(new Error('SSE watcher timeout: no progress event while status unchanged'));
        });
      });
      assert(true, 'SSE watcher publishes progress events while status stays running');
      await api(SLOW, `/api/v1/jobs/${wj.jobId}/stop`, { method: 'POST' }).catch(() => {});
    }

    // ---------- P1-8 素材库 API ----------
    console.log('=== P1-8 素材库（assets）===');
    {
      const { data: assets } = await api(FAST, '/api/v1/assets');
      assert(
        Array.isArray(assets.sceneVisuals) && Array.isArray(assets.bgm) && Array.isArray(assets.hosts),
        'assets returns sceneVisuals/bgm/hosts arrays'
      );
      assert(assets.bgm.length >= 1, 'bgm lists real files from assets/bgm/');
      const bgm0 = assets.bgm[0];
      assert(bgm0.name && bgm0.size > 0 && bgm0.url.startsWith('/assets/bgm/'), 'bgm entry has name/size/url');
      // hosts 断言需按真实环境计算预期：本地可能已有 config/hosts/*.json（如 customer_female.json），
      // 只有目录不存在或无 .json 时才回退单个默认主播。
      const hostsDirOnDisk = path.join(PROJECT_ROOT, 'config', 'hosts');
      const hasHostProfiles =
        fs.existsSync(hostsDirOnDisk) && fs.readdirSync(hostsDirOnDisk).some((f) => f.endsWith('.json'));
      if (!hasHostProfiles) {
        assertEqual(assets.hosts.length, 1, 'no config/hosts dir -> single default host entry');
        assertEqual(assets.hosts[0].path, 'config/host_profile.json', 'default host profile path');
      } else {
        assert(assets.hosts.length >= 1, 'config/hosts/*.json -> hosts listed');
        assert(
          assets.hosts.every((h) => /^config\/hosts\/[a-zA-Z0-9_\-]+\.json$/.test(h.path) && h.name),
          'host entries carry config/hosts/<file>.json path and name'
        );
      }

      const bgmRes = await fetch(`${FAST}${bgm0.url}`);
      assertEqual(bgmRes.status, 200, 'bgm file fetch 200');
      assert(
        (bgmRes.headers.get('content-type') || '').includes('audio'),
        'bgm file served with audio content-type'
      );
      await bgmRes.arrayBuffer();

      // 路径穿越防护：resolved 必须落在挂载目录内
      const traversal = await fetch(`${FAST}/assets/bgm/..%2f..%2f.env`);
      assert([400, 404].includes(traversal.status), `bgm traversal rejected (got ${traversal.status})`);
      await traversal.arrayBuffer();
      const traversal2 = await fetch(`${FAST}/assets/scene/..%2f..%2f..%2fconfig%2fservers.json`);
      assert([400, 404].includes(traversal2.status), `scene traversal rejected (got ${traversal2.status})`);
      await traversal2.arrayBuffer();
    }

    // ---------- P2-10 鉴权与多用户隔离 ----------
    console.log('=== P2-10 鉴权（WEB_TOKENS）===');
    {
      const asAlice = { headers: { Authorization: 'Bearer tokenA' } };
      const asBob = { headers: { Authorization: 'Bearer tokenB' } };
      const asBad = { headers: { Authorization: 'Bearer nope' } };

      // /health 保持公开
      const health = await fetch(`${AUTH}/health`);
      assertEqual(health.status, 200, 'health stays public without token');
      await health.json();

      let noToken = null;
      try { await api(AUTH, '/api/v1/jobs'); } catch (err) { noToken = err.status; }
      assertEqual(noToken, 401, 'no token -> 401');
      let badToken = null;
      try { await api(AUTH, '/api/v1/jobs', asBad); } catch (err) { badToken = err.status; }
      assertEqual(badToken, 401, 'bad token -> 401');
      const { data: aliceJobs } = await api(AUTH, '/api/v1/jobs', asAlice);
      assertEqual(aliceJobs.total, 0, 'valid token -> 200 (scoped list empty at first)');

      // alice 建任务；bob 不可见（404 + 列表隔离 + 不能改）
      const { data: aj } = await api(AUTH, '/api/v1/jobs', {
        method: 'POST',
        json: { outputName: `${RUN_TAG}_auth_a`, articleText: '# Alice 的任务', run: false },
        headers: asAlice.headers,
      });
      createdJobIds.push(aj.jobId);
      createdOutputNames.push(`${RUN_TAG}_auth_a`);
      let bobSee = null;
      try { await api(AUTH, `/api/v1/jobs/${aj.jobId}`, asBob); } catch (err) { bobSee = err.status; }
      assertEqual(bobSee, 404, 'bob gets 404 for alice job');
      const { data: bobList } = await api(AUTH, '/api/v1/jobs', asBob);
      assert(!bobList.jobs.some((j) => j.jobId === aj.jobId), 'bob list excludes alice job');
      const { data: aliceList } = await api(AUTH, '/api/v1/jobs', asAlice);
      assert(aliceList.jobs.some((j) => j.jobId === aj.jobId), 'alice list includes her job');
      let bobPatch = null;
      try {
        await api(AUTH, `/api/v1/jobs/${aj.jobId}`, {
          method: 'PATCH',
          json: { outputName: 'x' },
          headers: asBob.headers,
        });
      } catch (err) { bobPatch = err.status; }
      assertEqual(bobPatch, 404, 'bob cannot PATCH alice job (404)');
      let aliceSee = null;
      try { await api(AUTH, `/api/v1/jobs/${aj.jobId}`, asAlice); } catch (err) { aliceSee = err.status; }
      assertEqual(aliceSee === null, true, 'alice can GET her own job');

      // bob 自助：自建自删
      const { data: bj } = await api(AUTH, '/api/v1/jobs', {
        method: 'POST',
        json: { outputName: `${RUN_TAG}_auth_b`, articleText: '# Bob 的任务', run: false },
        headers: asBob.headers,
      });
      createdJobIds.push(bj.jobId);
      createdOutputNames.push(`${RUN_TAG}_auth_b`);
      const { data: bobDel } = await api(AUTH, `/api/v1/jobs/${bj.jobId}`, {
        method: 'DELETE',
        headers: asBob.headers,
      });
      assertEqual(bobDel.deleted, true, 'bob can delete his own job');

      // 模板按用户分文件
      const tplAlicePath = path.join(PROJECT_ROOT, 'api', 'templates.alice.json');
      const tplBobPath = path.join(PROJECT_ROOT, 'api', 'templates.bob.json');
      try { fs.rmSync(tplAlicePath, { force: true }); fs.rmSync(tplBobPath, { force: true }); } catch (_e) {}
      const { data: aliceTpls } = await api(AUTH, '/api/v1/templates', asAlice);
      assert(aliceTpls.templates.some((t) => t.name === '知识科普'), 'alice templates seeded with built-ins');
      assert(fs.existsSync(tplAlicePath), 'per-user template file written (alice)');
      await api(AUTH, '/api/v1/templates', {
        method: 'POST',
        json: { name: '爱丽丝专属', overrides: { style: { bgm_volume: 0.1 } } },
        headers: asAlice.headers,
      });
      const { data: bobTpls } = await api(AUTH, '/api/v1/templates', asBob);
      assert(!bobTpls.templates.some((t) => t.name === '爱丽丝专属'), 'bob does not see alice template');
      assert(fs.existsSync(tplBobPath), 'per-user template file written (bob)');
      try { fs.rmSync(tplAlicePath, { force: true }); fs.rmSync(tplBobPath, { force: true }); } catch (_e) {}

      // /assets 静态挂载同样受保护；?access_token= 供媒体标签回退
      const bgmNoAuth = await fetch(`${AUTH}/assets/bgm/piano-reflections.mp3`);
      assertEqual(bgmNoAuth.status, 401, 'assets mount requires token when auth on');
      await bgmNoAuth.arrayBuffer();
      const bgmAlice = await fetch(`${AUTH}/assets/bgm/piano-reflections.mp3`, { headers: asAlice.headers });
      assertEqual(bgmAlice.status, 200, 'assets mount serves with valid token');
      await bgmAlice.arrayBuffer();
      const bgmQuery = await fetch(`${AUTH}/assets/bgm/piano-reflections.mp3?access_token=tokenA`);
      assertEqual(bgmQuery.status, 200, 'assets mount accepts ?access_token=');
      await bgmQuery.arrayBuffer();
    }

    // ---------- P2-11 Webhook ----------
    console.log('=== P2-11 Webhook ===');
    {
      const received = [];
      const receiver = http.createServer((req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 404;
          return res.end();
        }
        let body = '';
        req.on('data', (c) => { body += c; });
        req.on('end', () => {
          try { received.push(JSON.parse(body)); } catch (_e) { /* 非 JSON 忽略 */ }
          res.statusCode = 200;
          res.end('ok');
        });
      });
      await new Promise((resolve) => receiver.listen(0, '127.0.0.1', resolve));
      const receiverUrl = `http://127.0.0.1:${receiver.address().port}/hook`;

      const whName = `${RUN_TAG}_wh`;
      createdOutputNames.push(whName);
      const { data: wj } = await api(FAST, '/api/v1/jobs', {
        method: 'POST',
        json: { outputName: whName, articleText: '# Webhook 测试', webhookUrl: receiverUrl },
      });
      createdJobIds.push(wj.jobId);
      const whDone = await waitStatus(FAST, wj.jobId, ['completed', 'failed']);
      assertEqual(whDone.status, 'completed', 'webhook job completes');

      // fire-and-forget 投递，轮询等待到达
      const t0 = Date.now();
      while (received.length === 0 && Date.now() - t0 < 10000) await sleep(200);
      assertEqual(received.length, 1, 'exactly one webhook delivery on terminal status');
      const payload = received[0] || {};
      assertEqual(payload.jobId, wj.jobId, 'webhook payload jobId');
      assertEqual(payload.outputName, whName, 'webhook payload outputName');
      assertEqual(payload.version, 1, 'webhook payload version');
      assertEqual(payload.status, 'completed', 'webhook payload status completed');
      assert('finishedAt' in payload && 'error' in payload, 'webhook payload has finishedAt + error fields');
      await sleep(400);
      assertEqual(received.length, 1, 'no duplicate webhook delivery');
      receiver.close();

      // 投递状态持久化（建议11）：成功 → delivered / attempts=1
      {
        const whState = JSON.parse(
          fs.readFileSync(path.join(PROJECT_ROOT, 'api', 'jobs', wj.jobId, 'state.json'), 'utf8')
        );
        const delivery = whState.versions[0].webhookDelivery;
        assert(delivery, 'version record carries webhookDelivery');
        assertEqual(delivery.status, 'delivered', 'webhookDelivery status delivered after success');
        assertEqual(delivery.attempts, 1, 'webhookDelivery attempts=1 on first-try success');
        assert(delivery.lastAttemptAt, 'webhookDelivery lastAttemptAt set');
      }

      let badUrl = null;
      try {
        await api(FAST, '/api/v1/jobs', {
          method: 'POST',
          json: { outputName: 'x', articleText: '# x', webhookUrl: 'ftp://nope' },
        });
      } catch (err) { badUrl = err.status; }
      assertEqual(badUrl, 400, 'invalid webhookUrl rejected with 400');

      // 接收端已关闭（连接拒绝）：任务照常完成，3 次尝试后失败写进 stderr 日志
      const deadName = `${RUN_TAG}_wh_dead`;
      createdOutputNames.push(deadName);
      const { data: dj } = await api(FAST, '/api/v1/jobs', {
        method: 'POST',
        json: { outputName: deadName, articleText: '# Webhook 死端测试', webhookUrl: receiverUrl },
      });
      createdJobIds.push(dj.jobId);
      const deadDone = await waitStatus(FAST, dj.jobId, ['completed', 'failed']);
      assertEqual(deadDone.status, 'completed', 'job completes even when webhook receiver is down');
      const stderrPath = path.join(PROJECT_ROOT, 'api', 'jobs', dj.jobId, 'stderr.log');
      const t1 = Date.now();
      let logged = false;
      while (Date.now() - t1 < 15000) {
        if (fs.existsSync(stderrPath) && fs.readFileSync(stderrPath, 'utf8').includes('[webhook]')) {
          logged = true;
          break;
        }
        await sleep(300);
      }
      assert(logged, 'webhook failure logged to job stderr after retries');

      // 投递状态持久化（建议11）：3 次失败 → failed / attempts=3 / lastError
      {
        const deadState = JSON.parse(
          fs.readFileSync(path.join(PROJECT_ROOT, 'api', 'jobs', dj.jobId, 'state.json'), 'utf8')
        );
        const delivery = deadState.versions[0].webhookDelivery;
        assert(delivery, 'dead-receiver version record carries webhookDelivery');
        assertEqual(delivery.status, 'failed', 'webhookDelivery status failed after 3 attempts');
        assertEqual(delivery.attempts, 3, 'webhookDelivery attempts=3 after retries');
        assert(delivery.lastError, 'webhookDelivery lastError recorded');
      }
    }

    // ---------- Webhook 启动恢复（建议11：pending 版本重启后继续投递） ----------
    console.log('=== Webhook 启动恢复（resume pending）===');
    {
      const received = [];
      const receiver = http.createServer((req, res) => {
        let body = '';
        req.on('data', (c) => { body += c; });
        req.on('end', () => {
          try { received.push(JSON.parse(body)); } catch (_e) { /* 非 JSON 忽略 */ }
          res.statusCode = 200;
          res.end('ok');
        });
      });
      await new Promise((resolve) => receiver.listen(0, '127.0.0.1', resolve));
      const receiverUrl = `http://127.0.0.1:${receiver.address().port}/hook`;

      // 造一个"崩溃前来不及投递完"的任务：终态 completed + webhookDelivery pending(attempts=1)
      const resumeName = `${RUN_TAG}_wh_resume`;
      createdOutputNames.push(resumeName);
      const { data: rj } = await api(FAST, '/api/v1/jobs', {
        method: 'POST',
        json: { outputName: resumeName, articleText: '# 恢复投递', run: false, webhookUrl: receiverUrl },
      });
      createdJobIds.push(rj.jobId);
      const statePath = path.join(PROJECT_ROOT, 'api', 'jobs', rj.jobId, 'state.json');
      const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      state.status = 'completed';
      state.latestVersion = 1;
      state.versions = [
        {
          version: 1,
          runName: resumeName,
          kind: 'full',
          status: 'completed',
          error: null,
          finishedAt: new Date().toISOString(),
          webhookDelivery: { status: 'pending', attempts: 1, lastAttemptAt: new Date().toISOString(), lastError: 'simulated crash' },
        },
      ];
      fs.writeFileSync(statePath, JSON.stringify(state, null, 2));

      // 新 server 启动 → resumePendingWebhooks 扫描到 pending 并恢复投递
      const RCV_PORT = await freePort();
      const rcvServer = startServer(RCV_PORT, STUB_FAST, { ARTICLE_VALIDATE_SCRIPT: STUB_VALIDATE_PASS });
      try {
        const t0 = Date.now();
        while (received.length === 0 && Date.now() - t0 < 10000) await sleep(200);
        assertEqual(received.length, 1, 'pending webhook delivered on server startup');
        assertEqual(received[0] && received[0].jobId, rj.jobId, 'resumed webhook payload jobId');
        assertEqual(received[0] && received[0].status, 'completed', 'resumed webhook payload status');
        await sleep(600);
        assertEqual(received.length, 1, 'resumed webhook not duplicated');

        const after = JSON.parse(fs.readFileSync(statePath, 'utf8'));
        assertEqual(
          after.versions[0].webhookDelivery.status,
          'delivered',
          'resumed webhookDelivery flips to delivered'
        );
        assertEqual(after.versions[0].webhookDelivery.attempts, 2, 'resume continues from attempts+1');
      } finally {
        await stopServer(rcvServer);
        receiver.close();
      }
    }

    // ---------- P2-11 OpenAPI ----------
    console.log('=== P2-11 OpenAPI ===');
    {
      const openapi = fs.readFileSync(path.join(PROJECT_ROOT, 'openapi.yaml'), 'utf8');
      assert(openapi.startsWith('openapi: 3.'), 'openapi.yaml starts with "openapi: 3."');
      [
        '/api/v1/jobs',
        '/api/v1/jobs/batch',
        '/api/v1/jobs/{id}/run',
        '/api/v1/jobs/{id}/retry',
        '/api/v1/jobs/{id}/schedule',
        '/api/v1/jobs/{id}/script/versions',
        '/api/v1/jobs/{id}/preview',
        '/api/v1/trigger/{token}',
        '/api/v1/templates',
        '/api/v1/events',
        '/api/v1/stats',
        '/api/v1/assets',
        '/assets/bgm/{file}',
      ].forEach((p) => assert(openapi.includes(p), `openapi documents ${p}`));
      assert(openapi.includes('bearerAuth'), 'openapi documents bearer auth scheme');
      assert(openapi.includes('webhookDelivery'), 'openapi documents webhookDelivery field');
      assert(openapi.includes('costEstimate'), 'openapi documents costEstimate field');
      assert(openapi.includes('hostProfile'), 'openapi documents hostProfile param');
    }

    // ---------- P2-13 数据看板 ----------
    console.log('=== P2-13 数据看板（stats）===');
    {
      // 造一个终态 failed 的版本，供 stats 失败计数（retry 测试的失败版本已被重试翻回 completed）
      const { data: fj2 } = await api(FAIL, '/api/v1/jobs', {
        method: 'POST',
        json: { outputName: `${RUN_TAG}_fail2`, articleText: '# 失败样本' },
      });
      createdJobIds.push(fj2.jobId);
      createdOutputNames.push(`${RUN_TAG}_fail2`);
      const f2Done = await waitStatus(FAIL, fj2.jobId, ['completed', 'failed']);
      assertEqual(f2Done.status, 'failed', 'dedicated failed sample job ends failed');

      const { data: stats } = await api(FAST, '/api/v1/stats');
      assert(stats.totals.jobs >= 5, 'stats totals counts suite jobs');
      assert(stats.totals.versions >= 10, 'versions counted across suite runs');
      assert(
        stats.totals.successRate >= 0 && stats.totals.successRate <= 1,
        'successRate within [0,1]'
      );
      assert(stats.totals.completed >= 1 && stats.totals.failed >= 1, 'completed and failed both counted');
      assert(Array.isArray(stats.perDay) && stats.perDay.length === 14, 'perDay has 14 entries');
      const today = new Date().toISOString().slice(0, 10);
      assertEqual(stats.perDay[13].date, today, 'perDay ends today');
      assert(
        stats.perDay[13].completed >= 1 && stats.perDay[13].failed >= 1,
        'today has completions and failures'
      );
      assert(
        'full' in stats.avgDurationByKind && 'rebuild' in stats.avgDurationByKind,
        'avgDurationByKind has both kinds'
      );
      assert(Array.isArray(stats.failureByPhase), 'failureByPhase is an array');
    }

    // ---------- SSE 保活帧（建议5：SSE_KEEPALIVE_MS=200 缩短等待） ----------
    console.log('=== SSE 保活帧（keepalive）===');
    {
      const { commentFrames } = await new Promise((resolve, reject) => {
        const comments = [];
        const req = http.get(`${KA}/api/v1/events`, (res) => {
          assertEqual(res.statusCode, 200, 'keepalive SSE endpoint 200');
          let buf = '';
          res.on('data', (chunk) => {
            buf += chunk.toString();
            let idx;
            while ((idx = buf.indexOf('\n\n')) !== -1) {
              const frame = buf.slice(0, idx);
              buf = buf.slice(idx + 2);
              // 只收集注释帧；data 帧（进度/状态事件）不是保活帧
              if (frame.startsWith(':')) comments.push(frame);
            }
          });
          res.on('error', () => {});
          setTimeout(() => {
            req.destroy();
            resolve({ commentFrames: comments });
          }, 850);
        });
        req.on('error', () => {});
        req.setTimeout(5000, () => {
          req.destroy();
          reject(new Error('keepalive SSE timeout'));
        });
      });
      const kaFrames = commentFrames.filter((f) => f.trim() === ': ka');
      assert(kaFrames.length >= 2, `keepalive ': ka' comment frames received (got ${kaFrames.length} in 850ms @200ms interval)`);
      assert(
        commentFrames.every((f) => f.trim() === ': ka' || f.trim() === ': connected'),
        'comment frames are only ka/connected (progress data frames not counted)'
      );
    }

    // ---------- 口播稿质量预检（建议14） ----------
    console.log('=== 口播稿质量预检（validate_article）===');
    {
      // block（默认）：预检不通过 → 400 + checks，任务不留存
      let blocked = null;
      try {
        await api(VALB, '/api/v1/jobs', {
          method: 'POST',
          json: { outputName: `${RUN_TAG}_valb`, articleText: '# 低质量' },
        });
      } catch (err) {
        blocked = err;
      }
      assertEqual(blocked && blocked.status, 400, 'failing article rejected with 400 (block mode)');
      assert(
        blocked && blocked.data && Array.isArray(blocked.data.checks) && blocked.data.checks.length === 1,
        '400 response carries checks detail'
      );
      assertEqual(blocked.data.checks[0].name, 'length', 'checks entry mirrors validator output');
      const { data: valbList } = await api(VALB, '/api/v1/jobs?limit=200');
      assert(
        !valbList.jobs.some((j) => j.outputName === `${RUN_TAG}_valb`),
        'rejected job is not persisted'
      );

      // warn：降级为警告 → 创建成功 + articleWarnings
      const { res: warnRes, data: warnJob } = await api(VALW, '/api/v1/jobs', {
        method: 'POST',
        json: { outputName: `${RUN_TAG}_valw`, articleText: '# 低质量但放行', run: false },
      });
      createdJobIds.push(warnJob.jobId);
      createdOutputNames.push(`${RUN_TAG}_valw`);
      assertEqual(warnRes.status, 201, 'warn mode creates job despite failing pre-check');
      assert(
        Array.isArray(warnJob.articleWarnings) && warnJob.articleWarnings.length === 1,
        'warn mode response carries articleWarnings'
      );

      // pass：无 articleWarnings
      const { data: passJob } = await api(ENVV, '/api/v1/jobs', {
        method: 'POST',
        json: { outputName: `${RUN_TAG}_valp`, articleText: '# 合格文章', run: false },
      });
      createdJobIds.push(passJob.jobId);
      createdOutputNames.push(`${RUN_TAG}_valp`);
      assert(!('articleWarnings' in passJob), 'passing article has no articleWarnings');

      // 脚本缺失：容错放行
      const { res: missRes, data: missJob } = await api(KA, '/api/v1/jobs', {
        method: 'POST',
        json: { outputName: `${RUN_TAG}_valm`, articleText: '# 脚本缺失放行', run: false },
      });
      createdJobIds.push(missJob.jobId);
      createdOutputNames.push(`${RUN_TAG}_valm`);
      assertEqual(missRes.status, 201, 'missing validator script tolerated (job created)');
    }

    // ---------- 多主播 hostProfile（建议13） ----------
    console.log('=== 多主播 hostProfile ===');
    {
      const hostsDir = path.join(PROJECT_ROOT, 'config', 'hosts');
      const hostFile = `test_host_${RUN_TAG}.json`;
      fs.mkdirSync(hostsDir, { recursive: true });
      hostsTestFile = path.join(hostsDir, hostFile);
      fs.writeFileSync(hostsTestFile, JSON.stringify({ host: { name: '测试主播' } }));

      let badName = null;
      try {
        await api(FAST, '/api/v1/jobs', {
          method: 'POST',
          json: { articleText: '# x', hostProfile: '../evil.json' },
        });
      } catch (err) { badName = err.status; }
      assertEqual(badName, 400, 'hostProfile with path separator rejected');

      let missingHost = null;
      try {
        await api(FAST, '/api/v1/jobs', {
          method: 'POST',
          json: { articleText: '# x', hostProfile: 'no_such_host.json' },
        });
      } catch (err) { missingHost = err.status; }
      assertEqual(missingHost, 400, 'nonexistent hostProfile rejected');

      // 指定主播：env stub 把 HOST_PROFILE 写入 workdir
      const hpName = `${RUN_TAG}_hp`;
      createdOutputNames.push(hpName);
      const { data: hj } = await api(ENVV, '/api/v1/jobs', {
        method: 'POST',
        json: { outputName: hpName, articleText: '# 主播测试', hostProfile: hostFile },
      });
      createdJobIds.push(hj.jobId);
      assertEqual(hj.hostProfile, hostFile, 'detail returns hostProfile');
      const hpDone = await waitStatus(ENVV, hj.jobId, ['completed', 'failed']);
      assertEqual(hpDone.status, 'completed', 'hostProfile job completes');
      const envTxt = fs.readFileSync(path.join(PROJECT_ROOT, 'temp', hpName, 'host_profile_env.txt'), 'utf8');
      assertEqual(envTxt, path.join(hostsDir, hostFile), 'HOST_PROFILE env points at config/hosts/<file>');

      // 默认主播：回退 config/host_profile.json
      const defName = `${RUN_TAG}_hp_def`;
      createdOutputNames.push(defName);
      const { data: dj2 } = await api(ENVV, '/api/v1/jobs', {
        method: 'POST',
        json: { outputName: defName, articleText: '# 默认主播' },
      });
      createdJobIds.push(dj2.jobId);
      assertEqual(dj2.hostProfile, null, 'default hostProfile is null');
      const defDone = await waitStatus(ENVV, dj2.jobId, ['completed', 'failed']);
      assertEqual(defDone.status, 'completed', 'default host job completes');
      const defEnv = fs.readFileSync(path.join(PROJECT_ROOT, 'temp', defName, 'host_profile_env.txt'), 'utf8');
      assertEqual(
        defEnv,
        path.join(PROJECT_ROOT, 'config', 'host_profile.json'),
        'HOST_PROFILE defaults to config/host_profile.json'
      );

      // 显式默认名等价于不传
      const { data: dj3 } = await api(ENVV, '/api/v1/jobs', {
        method: 'POST',
        json: { outputName: `${RUN_TAG}_hp_def2`, articleText: '# 显式默认', hostProfile: 'host_profile.json', run: false },
      });
      createdJobIds.push(dj3.jobId);
      createdOutputNames.push(`${RUN_TAG}_hp_def2`);
      assertEqual(dj3.hostProfile, null, 'explicit host_profile.json normalized to null');
    }

    // ---------- 成本预估（建议15） ----------
    console.log('=== 成本预估 costEstimate ===');
    {
      const { data: detail } = await api(FAST, `/api/v1/jobs/${running.jobId}`);
      assert('costEstimate' in detail, 'detail carries costEstimate field');
      const { estimateCost } = require('../api/versioning');
      if (typeof estimateCost === 'function') {
        assert(
          detail.costEstimate && detail.costEstimate.tokens && detail.costEstimate.seconds,
          'costEstimate has {tokens, seconds} when estimateCost is available'
        );
      } else {
        assertEqual(detail.costEstimate, null, 'costEstimate falls back to null while estimateCost is not implemented');
      }
    }

    // ---------- 渐进式预览（建议16） ----------
    console.log('=== 渐进式预览 preview.mp4 ===');
    {
      const pvName = `${RUN_TAG}_pv`;
      createdOutputNames.push(pvName);
      const { data: pj } = await api(SLOW, '/api/v1/jobs', {
        method: 'POST',
        json: { outputName: pvName, articleText: '# 预览测试' },
      });
      createdJobIds.push(pj.jobId);
      await waitStatus(SLOW, pj.jobId, ['running']);

      const notYet = await fetch(`${SLOW}/api/v1/jobs/${pj.jobId}/preview`);
      assertEqual(notYet.status, 404, 'preview endpoint 404 before preview.mp4 exists');
      await notYet.arrayBuffer();

      // 连 SSE 后模拟 pipeline 产出 preview.mp4 → 收到 preview_ready
      await new Promise((resolve, reject) => {
        const req = http.get(`${SLOW}/api/v1/events`, (res) => {
          let buf = '';
          res.on('data', (chunk) => {
            buf += chunk.toString();
            if (buf.includes('"type":"preview_ready"') && buf.includes(pj.jobId)) {
              req.destroy();
              resolve();
            }
          });
          res.on('error', () => {});
          const dir = path.join(PROJECT_ROOT, 'temp', pvName);
          fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(path.join(dir, 'preview.mp4'), Buffer.alloc(20000));
        });
        req.on('error', () => {});
        req.setTimeout(8000, () => {
          req.destroy();
          reject(new Error('preview_ready SSE timeout'));
        });
      });
      assert(true, 'SSE pushes preview_ready when preview.mp4 appears');

      const okRes = await fetch(`${SLOW}/api/v1/jobs/${pj.jobId}/preview`);
      assertEqual(okRes.status, 200, 'preview endpoint 200 after preview.mp4 exists');
      assert(
        (okRes.headers.get('content-type') || '').includes('video/mp4'),
        'preview served as video/mp4'
      );
      await okRes.arrayBuffer();

      await api(SLOW, `/api/v1/jobs/${pj.jobId}/stop`, { method: 'POST' }).catch(() => {});
    }

    // ---------- 定时任务与外部触发（建议17） ----------
    console.log('=== 定时任务与外部触发（cron / trigger）===');
    {
      let badCron = null;
      try {
        await api(FAST, `/api/v1/jobs/${draft.jobId}/schedule`, { method: 'POST', json: { cron: 'not a cron' } });
      } catch (err) { badCron = err.status; }
      assertEqual(badCron, 400, 'invalid cron rejected with 400');

      let badCronCreate = null;
      try {
        await api(FAST, '/api/v1/jobs', { method: 'POST', json: { articleText: '# x', schedule: 'nope' } });
      } catch (err) { badCronCreate = err.status; }
      assertEqual(badCronCreate, 400, 'create with invalid schedule rejected');

      // 每秒触发：注册后自动开跑；删除后不再产生新版本
      const schName = `${RUN_TAG}_sch`;
      createdOutputNames.push(schName);
      const { data: schJob } = await api(FAST, '/api/v1/jobs', {
        method: 'POST',
        json: { outputName: schName, articleText: '# 定时任务', run: false },
      });
      createdJobIds.push(schJob.jobId);
      const { data: schSet } = await api(FAST, `/api/v1/jobs/${schJob.jobId}/schedule`, {
        method: 'POST',
        json: { cron: '*/1 * * * * *' },
      });
      assertEqual(schSet.schedule, '*/1 * * * * *', 'schedule set via POST');

      const t0 = Date.now();
      let fired = null;
      while (Date.now() - t0 < 8000) {
        const { data } = await api(FAST, `/api/v1/jobs/${schJob.jobId}`);
        if ((data.latestVersion || 0) >= 1) { fired = data; break; }
        await sleep(300);
      }
      assert(fired, 'cron schedule triggers a run automatically');

      const { data: schDel } = await api(FAST, `/api/v1/jobs/${schJob.jobId}/schedule`, { method: 'DELETE' });
      assertEqual(schDel.schedule, null, 'schedule cleared via DELETE');
      await waitStatus(FAST, schJob.jobId, ['completed', 'failed', 'cancelled']).catch(() => {});
      const { data: atDelete } = await api(FAST, `/api/v1/jobs/${schJob.jobId}`);
      await sleep(2500);
      const { data: schAfter } = await api(FAST, `/api/v1/jobs/${schJob.jobId}`);
      assertEqual(schAfter.latestVersion, atDelete.latestVersion, 'no new versions after schedule removed');

      // trigger token：错误 token 404；正确 token 触发运行
      const { data: tgJob } = await api(FAST, '/api/v1/jobs', {
        method: 'POST',
        json: { outputName: `${RUN_TAG}_tg`, articleText: '# 触发测试', run: false },
      });
      createdJobIds.push(tgJob.jobId);
      createdOutputNames.push(`${RUN_TAG}_tg`);
      assert(tgJob.triggerToken, 'job exposes triggerToken');

      let badToken = null;
      try {
        await api(FAST, `/api/v1/trigger/${'x'.repeat(40)}`, { method: 'POST' });
      } catch (err) { badToken = err.status; }
      assertEqual(badToken, 404, 'unknown trigger token returns 404');

      const { res: tgRes, data: tgRun } = await api(FAST, `/api/v1/trigger/${tgJob.triggerToken}`, { method: 'POST' });
      assertEqual(tgRes.status, 202, 'trigger token queues the job');
      assert(['queued', 'running'].includes(tgRun.status), 'triggered job is active');
      const tgDone = await waitStatus(FAST, tgJob.jobId, ['completed', 'failed']);
      assertEqual(tgDone.status, 'completed', 'triggered run completes');

      // 触发端点绕开 Bearer 鉴权（triggerToken 即凭证）
      const { data: tgAuth } = await api(AUTH, '/api/v1/jobs', {
        method: 'POST',
        json: { outputName: `${RUN_TAG}_tg_auth`, articleText: '# 鉴权触发', run: false },
        headers: { Authorization: 'Bearer tokenA' },
      });
      createdJobIds.push(tgAuth.jobId);
      createdOutputNames.push(`${RUN_TAG}_tg_auth`);
      const noAuthRes = await fetch(`${AUTH}/api/v1/trigger/${tgAuth.triggerToken}`, { method: 'POST' });
      assertEqual(noAuthRes.status, 202, 'trigger works without Bearer (token is the credential)');
      await noAuthRes.json();
      const ta0 = Date.now();
      while (Date.now() - ta0 < 8000) {
        const st = await fetch(`${AUTH}/api/v1/jobs/${tgAuth.jobId}`, {
          headers: { Authorization: 'Bearer tokenA' },
        });
        const body = await st.json();
        if (body.status === 'completed' || body.status === 'failed') break;
        await sleep(300);
      }
    }

    // ---------- 口播稿版本管理（建议19） ----------
    console.log('=== 口播稿版本管理（script versions）===');
    {
      const svName = `${RUN_TAG}_sv`;
      createdOutputNames.push(svName);
      const { data: sj } = await api(FAST, '/api/v1/jobs', {
        method: 'POST',
        json: { outputName: svName, articleText: '# 口播稿版本' },
      });
      createdJobIds.push(sj.jobId);
      await waitStatus(FAST, sj.jobId, ['completed', 'failed']);

      const { data: put1 } = await api(FAST, `/api/v1/jobs/${sj.jobId}/script`, {
        method: 'PUT',
        json: { script: '第一版口播稿' },
      });
      assertEqual(put1.backedUpVersion, null, 'first PUT has nothing to back up');
      const { data: put2 } = await api(FAST, `/api/v1/jobs/${sj.jobId}/script`, {
        method: 'PUT',
        json: { script: '第二版口播稿' },
      });
      assertEqual(put2.backedUpVersion, 1, 'second PUT backs up v1');
      const { data: put3 } = await api(FAST, `/api/v1/jobs/${sj.jobId}/script`, {
        method: 'PUT',
        json: { script: '第三版口播稿' },
      });
      assertEqual(put3.backedUpVersion, 2, 'third PUT backs up v2');

      const { data: cur } = await api(FAST, `/api/v1/jobs/${sj.jobId}/script`);
      assertEqual(cur.script, '第三版口播稿', 'GET script returns latest');
      const { data: v1 } = await api(FAST, `/api/v1/jobs/${sj.jobId}/script?version=1`);
      assertEqual(v1.script, '第一版口播稿', 'GET ?version=1 returns first version');
      const { data: v2 } = await api(FAST, `/api/v1/jobs/${sj.jobId}/script?version=2`);
      assertEqual(v2.script, '第二版口播稿', 'GET ?version=2 returns second version');

      const { data: versions } = await api(FAST, `/api/v1/jobs/${sj.jobId}/script/versions`);
      assertEqual(
        versions.versions.map((v) => v.version).join(','),
        '1,2',
        'versions endpoint lists history'
      );
      assert(
        versions.versions.every((v) => v.bytes > 0 && v.modifiedAt),
        'version entries carry bytes + modifiedAt'
      );

      let noVer = null;
      try { await api(FAST, `/api/v1/jobs/${sj.jobId}/script?version=99`); } catch (err) { noVer = err.status; }
      assertEqual(noVer, 404, 'unknown script version returns 404');

      const { data: draftVers } = await api(FAST, `/api/v1/jobs/${draft.jobId}/script/versions`);
      assertEqual(draftVers.versions.length, 0, 'draft job has empty script version list');
    }
  } finally {
    // 先走 API purge（server 还活着），再停 server，最后按 jobId 兜底删目录
    await cleanup([FAST, SLOW, FAIL, VALB, VALW, ENVV, KA]);
    await stopServer(fastServer);
    await stopServer(slowServer);
    await stopServer(failServer);
    await stopServer(authServer);
    await stopServer(valbServer);
    await stopServer(valwServer);
    await stopServer(envvServer);
    await stopServer(kaServer);
    // hostProfile 测试写入的 config/hosts/<file>（目录为空则一并移除，恢复测试前状态）
    if (hostsTestFile) {
      try { fs.rmSync(hostsTestFile, { force: true }); } catch (_e) {}
      try { fs.rmdirSync(path.dirname(hostsTestFile)); } catch (_e) { /* 目录非空则保留 */ }
    }
    for (const jobId of createdJobIds) {
      try {
        fs.rmSync(path.join(PROJECT_ROOT, 'api', 'jobs', jobId), { recursive: true, force: true });
      } catch (_e) {}
    }
  }

  console.log('');
  if (failures > 0) {
    console.error(`❌ ${failures} test(s) failed`);
    process.exit(1);
  }
  console.log('✅ all api server tests passed');
}

main().catch((err) => {
  console.error('❌ test run crashed:', err);
  process.exit(1);
});

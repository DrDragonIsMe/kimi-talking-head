#!/usr/bin/env node
/**
 * Tests for api/server.js —— 用 PIPELINE_SCRIPT/REBUILD_SCRIPT 钩子注入假脚本，
 * spawn 真实 server 于随机端口，覆盖任务 CRUD / run / rebuild / stop / clone /
 * preview / purge 以及既有 multipart/logs/download 兼容行为。
 *
 * Usage: node scripts/test_api_server.js
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const STUB_FAST = path.join(__dirname, 'fixtures', 'stub_pipeline.sh');
const STUB_SLOW = path.join(__dirname, 'fixtures', 'stub_pipeline_slow.sh');

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

function startServer(port, script) {
  const child = spawn('node', [path.join(PROJECT_ROOT, 'api', 'server.js')], {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      PIPELINE_SCRIPT: script,
      REBUILD_SCRIPT: script,
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

  // ---------- 快速 server ----------
  const FAST_PORT = 20000 + Math.floor(Math.random() * 15000);
  const FAST = `http://127.0.0.1:${FAST_PORT}`;
  const fastServer = startServer(FAST_PORT, STUB_FAST);

  // ---------- 慢速 server（stop 测试） ----------
  const SLOW_PORT = FAST_PORT + 15000;
  const SLOW = `http://127.0.0.1:${SLOW_PORT}`;
  const slowServer = startServer(SLOW_PORT, STUB_SLOW);

  try {
    await waitHealth(FAST);
    await waitHealth(SLOW);
    console.log('=== server startup / health ===');
    assert(true, `fast server healthy on :${FAST_PORT}, slow server on :${SLOW_PORT}`);

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
  } finally {
    // 先走 API purge（server 还活着），再停 server，最后按 jobId 兜底删目录
    await cleanup([FAST, SLOW]);
    await stopServer(fastServer);
    await stopServer(slowServer);
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

#!/usr/bin/env node

/**
 * 版本化与阶段复用测试。
 *
 * 覆盖：
 * 1. hashText — SHA-256 确定性
 * 2. stableStringify — 键序无关序列化
 * 3. computeInvalidationPhase — 配置 diff 推导失效阶段
 * 4. prepareReuseWorkdir — 工作目录复制与状态重置
 * 5. aggregateEstimates — 耗时聚合
 * 6. estimateCost — 成本预估公式与边界
 *
 * 运行：node scripts/test_versioning.js
 */

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

// 内联副本（来自 api/versioning.js）
const PHASES = ['script', 'tts', 'whisper', 'subtitles', 'storyboard', 'visuals', 'lipsync', 'postprocess', 'render'];

function hashText(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}

function diffConfigPaths(prev, next, prefix, out) {
  const prevIsObj = prev && typeof prev === 'object' && !Array.isArray(prev);
  const nextIsObj = next && typeof next === 'object' && !Array.isArray(next);
  if (!prevIsObj || !nextIsObj) {
    if (stableStringify(prev) !== stableStringify(next)) out.push(prefix);
    return;
  }
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
  for (const key of keys) {
    const p = prefix ? `${prefix}.${key}` : key;
    if (!(key in prev) || !(key in next)) {
      out.push(p);
    } else {
      diffConfigPaths(prev[key], next[key], p, out);
    }
  }
}

function computeInvalidationPhase(prev, next) {
  const p = prev || {};
  const n = next || {};

  if (p.articleHash && n.articleHash) {
    if (p.articleHash !== n.articleHash) return 'script';
  } else if (p.articleText !== undefined || n.articleText !== undefined) {
    if ((p.articleText || '') !== (n.articleText || '')) return 'script';
  }

  const changed = [];
  diffConfigPaths(p.config || {}, n.config || {}, '', changed);
  if (!changed.length) return 'render';

  let best = 'render';
  for (const changedPath of changed) {
    const top = changedPath.split('.')[0];
    let phase = 'render';
    if (top === 'voice') {
      phase = 'tts';
    } else if (
      changedPath === 'content_overlay.subtitles.segmentation' ||
      changedPath.startsWith('content_overlay.subtitles.segmentation.')
    ) {
      phase = 'subtitles';
    } else if (top === 'scene_visuals') {
      phase = 'visuals';
    }
    if (PHASES.indexOf(phase) < PHASES.indexOf(best)) best = phase;
  }
  return best;
}

function aggregateEstimates(jobs, limit = 20) {
  const records = [];
  for (const job of jobs || []) {
    const versions = Array.isArray(job.versions) ? job.versions : [];
    for (const v of versions) {
      if (v.status !== 'completed' || !v.startedAt || !v.finishedAt) continue;
      const seconds = (new Date(v.finishedAt) - new Date(v.startedAt)) / 1000;
      if (Number.isFinite(seconds) && seconds >= 0) {
        records.push({ kind: v.kind === 'rebuild' ? 'rebuild' : 'full', seconds, finishedAt: v.finishedAt });
      }
    }
  }
  records.sort((a, b) => new Date(b.finishedAt) - new Date(a.finishedAt));
  const recent = records.slice(0, limit);
  const agg = (kind) => {
    const arr = recent.filter((r) => r.kind === kind);
    if (!arr.length) return null;
    const avgSeconds = Math.round((arr.reduce((s, r) => s + r.seconds, 0) / arr.length) * 10) / 10;
    return { avgSeconds, samples: arr.length };
  };
  return { full: agg('full'), rebuild: agg('rebuild') };
}

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

const test = (name, fn) => {
  try {
    fn();
    passed += 1;
    console.log(`✅ ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`❌ ${name}: ${error.message}`);
  }
};

// ---------------------------------------------------------------------------
// 1. hashText
// ---------------------------------------------------------------------------

test('hashText: 相同输入相同输出', () => {
  const h1 = hashText('hello');
  const h2 = hashText('hello');
  assert.strictEqual(h1, h2);
});

test('hashText: 不同输入不同输出', () => {
  const h1 = hashText('hello');
  const h2 = hashText('world');
  assert.notStrictEqual(h1, h2);
});

test('hashText: 空字符串有合法 hash', () => {
  const h = hashText('');
  assert.strictEqual(typeof h, 'string');
  assert.strictEqual(h.length, 64);
});

test('hashText: 中文字符串正常', () => {
  const h = hashText('你好世界');
  assert.strictEqual(h.length, 64);
});

// ---------------------------------------------------------------------------
// 2. stableStringify
// ---------------------------------------------------------------------------

test('stableStringify: 键序无关', () => {
  const a = stableStringify({ b: 1, a: 2 });
  const b = stableStringify({ a: 2, b: 1 });
  assert.strictEqual(a, b);
});

test('stableStringify: 嵌套对象也排序', () => {
  const a = stableStringify({ b: { d: 2, c: 1 }, a: 1 });
  const b = stableStringify({ a: 1, b: { c: 1, d: 2 } });
  assert.strictEqual(a, b);
});

test('stableStringify: 数组保持顺序', () => {
  const a = stableStringify([3, 2, 1]);
  const b = stableStringify([1, 2, 3]);
  assert.notStrictEqual(a, b);
});

test('stableStringify: null/undefined 处理', () => {
  assert.strictEqual(stableStringify(null), 'null');
  assert.strictEqual(stableStringify(undefined), 'null');
});

test('stableStringify: 基本类型', () => {
  assert.strictEqual(stableStringify(42), '42');
  assert.strictEqual(stableStringify('hello'), '"hello"');
  assert.strictEqual(stableStringify(true), 'true');
});

// ---------------------------------------------------------------------------
// 3. computeInvalidationPhase
// ---------------------------------------------------------------------------

test('articleHash 变化 → script', () => {
  const phase = computeInvalidationPhase(
    { articleHash: 'aaa' },
    { articleHash: 'bbb' }
  );
  assert.strictEqual(phase, 'script');
});

test('articleText 变化 → script', () => {
  const phase = computeInvalidationPhase(
    { articleText: 'old' },
    { articleText: 'new' }
  );
  assert.strictEqual(phase, 'script');
});

test('voice 变化 → tts', () => {
  const phase = computeInvalidationPhase(
    { config: { voice: { reference_audio: 'old.wav' } } },
    { config: { voice: { reference_audio: 'new.wav' } } }
  );
  assert.strictEqual(phase, 'tts');
});

test('subtitle segmentation 变化 → subtitles', () => {
  const phase = computeInvalidationPhase(
    { config: { content_overlay: { subtitles: { segmentation: { maxSegmentSeconds: 3.0 } } } } },
    { config: { content_overlay: { subtitles: { segmentation: { maxSegmentSeconds: 4.0 } } } } }
  );
  assert.strictEqual(phase, 'subtitles');
});

test('scene_visuals 变化 → visuals', () => {
  const phase = computeInvalidationPhase(
    { config: { scene_visuals: { media_type: 'image' } } },
    { config: { scene_visuals: { media_type: 'video' } } }
  );
  assert.strictEqual(phase, 'visuals');
});

test('冗余字段变化（title_card）→ render', () => {
  const phase = computeInvalidationPhase(
    { config: { title_card: { title: 'old' } } },
    { config: { title_card: { title: 'new' } } }
  );
  assert.strictEqual(phase, 'render');
});

test('无配置变化 → render', () => {
  const phase = computeInvalidationPhase(
    { config: { a: 1 } },
    { config: { a: 1 } }
  );
  assert.strictEqual(phase, 'render');
});

test('多字段变化取最早阶段', () => {
  const phase = computeInvalidationPhase(
    { config: { voice: { ref: 'old' }, title_card: { title: 'old' } } },
    { config: { voice: { ref: 'new' }, title_card: { title: 'new' } } }
  );
  // voice → tts，title_card → render，tts 更早
  assert.strictEqual(phase, 'tts');
});

test('新增字段 → 检测到变化', () => {
  const phase = computeInvalidationPhase(
    { config: { a: 1 } },
    { config: { a: 1, voice: { ref: 'new' } } }
  );
  assert.strictEqual(phase, 'tts');
});

test('删除字段 → 检测到变化', () => {
  const phase = computeInvalidationPhase(
    { config: { a: 1, voice: { ref: 'old' } } },
    { config: { a: 1 } }
  );
  assert.strictEqual(phase, 'tts');
});

// ---------------------------------------------------------------------------
// 4. prepareReuseWorkdir
// ---------------------------------------------------------------------------

test('prepareReuseWorkdir: 源目录不存在时返回 copied=false', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'versioning-test-'));
  try {
    const { prepareReuseWorkdir } = require(path.join(__dirname, '..', 'api', 'versioning'));
    const result = prepareReuseWorkdir({
      tempDir: tmpDir,
      prevRunName: 'nonexistent_run',
      newRunName: 'new_run',
      invalidationPhase: 'render',
    });
    assert.strictEqual(result.copied, false);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('prepareReuseWorkdir: 源目录存在时复制并重置状态', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'versioning-test-'));
  try {
    const { prepareReuseWorkdir } = require(path.join(__dirname, '..', 'api', 'versioning'));

    // 创建源工作目录
    const srcDir = path.join(tmpDir, 'old_run');
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(path.join(srcDir, 'script.txt'), 'hello');

    // 创建状态文件：所有阶段 completed
    const state = {};
    for (const phase of PHASES) {
      state[phase] = {
        status: 'completed',
        started_at: '2026-01-01T00:00:00Z',
        completed_at: '2026-01-01T00:01:00Z',
        output: `/tmp/old_run/${phase}.out`,
        attempt: 1,
        error: null,
      };
    }
    fs.writeFileSync(path.join(srcDir, '.pipeline_state.json'), JSON.stringify(state, null, 2));

    const result = prepareReuseWorkdir({
      tempDir: tmpDir,
      prevRunName: 'old_run',
      newRunName: 'new_run',
      invalidationPhase: 'subtitles',
    });

    assert.strictEqual(result.copied, true);
    assert.strictEqual(result.stateReset, true);

    // 新目录存在
    const dstDir = path.join(tmpDir, 'new_run');
    assert.ok(fs.existsSync(dstDir));

    // script.txt 复制过来了
    assert.ok(fs.existsSync(path.join(dstDir, 'script.txt')));

    // 状态文件：旧路径被替换
    const newState = JSON.parse(fs.readFileSync(path.join(dstDir, '.pipeline_state.json'), 'utf8'));
    // script 和 tts 仍为 completed
    assert.strictEqual(newState.script.status, 'completed');
    assert.strictEqual(newState.tts.status, 'completed');
    // subtitles 及之后重置为 pending
    assert.strictEqual(newState.subtitles.status, 'pending');
    assert.strictEqual(newState.render.status, 'pending');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('prepareReuseWorkdir: 无状态文件时 reset=false', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'versioning-test-'));
  try {
    const { prepareReuseWorkdir } = require(path.join(__dirname, '..', 'api', 'versioning'));

    const srcDir = path.join(tmpDir, 'old_run');
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(path.join(srcDir, 'script.txt'), 'hello');

    const result = prepareReuseWorkdir({
      tempDir: tmpDir,
      prevRunName: 'old_run',
      newRunName: 'new_run',
      invalidationPhase: 'render',
    });

    assert.strictEqual(result.copied, true);
    assert.strictEqual(result.stateReset, false);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('prepareReuseWorkdir: fs.cpSync 复制目录内容（嵌套结构）而非目录本身', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'versioning-test-'));
  try {
    const { prepareReuseWorkdir } = require(path.join(__dirname, '..', 'api', 'versioning'));

    // 嵌套目录 + 多文件
    const srcDir = path.join(tmpDir, 'old_run');
    fs.mkdirSync(path.join(srcDir, 'audio', 'segments'), { recursive: true });
    fs.writeFileSync(path.join(srcDir, 'script.txt'), 'hello');
    fs.writeFileSync(path.join(srcDir, 'audio', 'full.wav'), 'wav-bytes');
    fs.writeFileSync(path.join(srcDir, 'audio', 'segments', 'seg0.wav'), 'seg0');

    const result = prepareReuseWorkdir({
      tempDir: tmpDir,
      prevRunName: 'old_run',
      newRunName: 'new_run',
      invalidationPhase: 'render',
    });

    assert.strictEqual(result.copied, true);
    const dstDir = path.join(tmpDir, 'new_run');
    // 内容复制到新目录根部（不是 new_run/old_run/...）
    assert.ok(fs.existsSync(path.join(dstDir, 'script.txt')));
    assert.strictEqual(fs.readFileSync(path.join(dstDir, 'script.txt'), 'utf8'), 'hello');
    assert.strictEqual(fs.readFileSync(path.join(dstDir, 'audio', 'full.wav'), 'utf8'), 'wav-bytes');
    assert.strictEqual(fs.readFileSync(path.join(dstDir, 'audio', 'segments', 'seg0.wav'), 'utf8'), 'seg0');
    assert.ok(!fs.existsSync(path.join(dstDir, 'old_run')));
    // 源目录不受影响
    assert.ok(fs.existsSync(path.join(srcDir, 'script.txt')));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('prepareReuseWorkdir: 符号链接被解引用（dereference）复制为实体文件', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'versioning-test-'));
  try {
    const { prepareReuseWorkdir } = require(path.join(__dirname, '..', 'api', 'versioning'));

    const srcDir = path.join(tmpDir, 'old_run');
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(path.join(srcDir, 'real.txt'), 'real-content');
    fs.symlinkSync(path.join(srcDir, 'real.txt'), path.join(srcDir, 'link.txt'));

    const result = prepareReuseWorkdir({
      tempDir: tmpDir,
      prevRunName: 'old_run',
      newRunName: 'new_run',
      invalidationPhase: 'render',
    });

    assert.strictEqual(result.copied, true);
    const dstLink = path.join(tmpDir, 'new_run', 'link.txt');
    assert.ok(fs.existsSync(dstLink));
    assert.strictEqual(fs.readFileSync(dstLink, 'utf8'), 'real-content');
    // dereference: true → 复制后不再是符号链接
    assert.strictEqual(fs.lstatSync(dstLink).isSymbolicLink(), false);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 5. aggregateEstimates
// ---------------------------------------------------------------------------

test('aggregateEstimates: 空任务列表返回 null', () => {
  const result = aggregateEstimates([]);
  assert.strictEqual(result.full, null);
  assert.strictEqual(result.rebuild, null);
});

test('aggregateEstimates: 单个完成版本统计正确', () => {
  const jobs = [{
    versions: [{
      kind: 'full',
      status: 'completed',
      startedAt: '2026-01-01T00:00:00Z',
      finishedAt: '2026-01-01T00:01:30Z',
    }],
  }];
  const result = aggregateEstimates(jobs);
  assert.ok(result.full);
  assert.strictEqual(result.full.avgSeconds, 90);
  assert.strictEqual(result.full.samples, 1);
});

test('aggregateEstimates: 区分 full 和 rebuild', () => {
  const jobs = [{
    versions: [
      { kind: 'full', status: 'completed', startedAt: '2026-01-01T00:00:00Z', finishedAt: '2026-01-01T00:01:00Z' },
      { kind: 'rebuild', status: 'completed', startedAt: '2026-01-01T00:00:00Z', finishedAt: '2026-01-01T00:00:30Z' },
    ],
  }];
  const result = aggregateEstimates(jobs);
  assert.strictEqual(result.full.avgSeconds, 60);
  assert.strictEqual(result.rebuild.avgSeconds, 30);
});

test('aggregateEstimates: 未完成/失败版本不计入', () => {
  const jobs = [{
    versions: [
      { kind: 'full', status: 'failed', startedAt: '2026-01-01T00:00:00Z', finishedAt: '2026-01-01T00:01:00Z' },
      { kind: 'full', status: 'completed', startedAt: '2026-01-01T00:00:00Z', finishedAt: '2026-01-01T00:02:00Z' },
    ],
  }];
  const result = aggregateEstimates(jobs);
  assert.strictEqual(result.full.samples, 1);
  assert.strictEqual(result.full.avgSeconds, 120);
});

test('aggregateEstimates: 缺少 startedAt/finishedAt 不计入', () => {
  const jobs = [{
    versions: [
      { kind: 'full', status: 'completed', startedAt: null, finishedAt: '2026-01-01T00:01:00Z' },
      { kind: 'full', status: 'completed', startedAt: '2026-01-01T00:00:00Z', finishedAt: null },
    ],
  }];
  const result = aggregateEstimates(jobs);
  assert.strictEqual(result.full, null);
});

test('aggregateEstimates: 负耗时不计入', () => {
  const jobs = [{
    versions: [{
      kind: 'full',
      status: 'completed',
      startedAt: '2026-01-01T00:01:00Z',
      finishedAt: '2026-01-01T00:00:00Z', // 负耗时
    }],
  }];
  const result = aggregateEstimates(jobs);
  assert.strictEqual(result.full, null);
});

// ---------------------------------------------------------------------------
// 6. estimateCost
// ---------------------------------------------------------------------------

const { estimateCost } = require(path.join(__dirname, '..', 'api', 'versioning'));

test('estimateCost: 返回结构 {tokens:{script,storyboard,total}, seconds:{tts,lipSync,render,total}}', () => {
  const result = estimateCost('x'.repeat(100));
  assert.deepStrictEqual(Object.keys(result).sort(), ['seconds', 'tokens']);
  assert.deepStrictEqual(Object.keys(result.tokens).sort(), ['script', 'storyboard', 'total']);
  assert.deepStrictEqual(Object.keys(result.seconds).sort(), ['lipSync', 'render', 'total', 'tts']);
});

test('estimateCost: token 公式 — script=3×字符数，storyboard=8×字符数', () => {
  const result = estimateCost('x'.repeat(1000));
  assert.strictEqual(result.tokens.script, 3000);
  assert.strictEqual(result.tokens.storyboard, 8000);
  assert.strictEqual(result.tokens.total, 11000);
});

test('estimateCost: 时长公式 — TTS=字符数/4 秒，lipSync=2×，render=1×', () => {
  const result = estimateCost('x'.repeat(400));
  assert.strictEqual(result.seconds.tts, 100);
  assert.strictEqual(result.seconds.lipSync, 200);
  assert.strictEqual(result.seconds.render, 100);
  assert.strictEqual(result.seconds.total, 400);
});

test('estimateCost: storyboard LLM 关闭时 storyboard token 为 0', () => {
  const result = estimateCost('x'.repeat(1000), {
    scene_visuals: { storyboard: { llm: { enabled: false } } },
  });
  assert.strictEqual(result.tokens.storyboard, 0);
  assert.strictEqual(result.tokens.script, 3000);
  assert.strictEqual(result.tokens.total, 3000);
  // 时长不受 storyboard 开关影响
  assert.strictEqual(result.seconds.tts, 250);
});

test('estimateCost: storyboard.llm.enabled 缺省时默认启用', () => {
  assert.strictEqual(estimateCost('x'.repeat(100), {}).tokens.storyboard, 800);
  assert.strictEqual(
    estimateCost('x'.repeat(100), { scene_visuals: { storyboard: {} } }).tokens.storyboard,
    800
  );
  assert.strictEqual(
    estimateCost('x'.repeat(100), { scene_visuals: { storyboard: { llm: { enabled: true } } } }).tokens.storyboard,
    800
  );
});

test('estimateCost: 空文章 / 无参数 → 全部为 0', () => {
  for (const result of [estimateCost(''), estimateCost(), estimateCost(null)]) {
    assert.deepStrictEqual(result.tokens, { script: 0, storyboard: 0, total: 0 });
    assert.deepStrictEqual(result.seconds, { tts: 0, lipSync: 0, render: 0, total: 0 });
  }
});

test('estimateCost: 中文字符按长度计数', () => {
  const result = estimateCost('你好世界你好世界'); // 8 字
  assert.strictEqual(result.tokens.script, 24);
  assert.strictEqual(result.seconds.tts, 2);
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${passed} 通过, ${failed} 失败`);
if (failed > 0) process.exit(1);
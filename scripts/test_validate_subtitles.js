#!/usr/bin/env node

/**
 * scripts/validate_subtitles.js CLI 行为测试。
 *
 * 通过子进程调用真实 CLI，验证退出码与 stderr：
 * 1. 合法字幕 JSON → 退出码 0
 * 2. 非法字幕（空数组、非数组、end<=start）→ 退出码 1
 * 3. 词级时间戳非法（回退、越界）→ 退出码 1
 * 4. 文件不存在 → 退出码 1
 *
 * 运行：node scripts/test_validate_subtitles.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const CLI = path.join(__dirname, 'validate_subtitles.js');
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'test_validate_subtitles_'));

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

let tmpSeq = 0;
const writeJson = (data) => {
  tmpSeq += 1;
  const file = path.join(TMP_DIR, `subtitles_${tmpSeq}.json`);
  fs.writeFileSync(file, JSON.stringify(data));
  return file;
};

const runCli = (args) => {
  const result = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
};

const validCues = () => [
  { start: 0, end: 1.5, text: '第一句字幕' },
  { start: 1.5, end: 3, text: '第二句字幕' },
  { start: 3, end: 4.5, text: '第三句字幕' },
];

// ---------------------------------------------------------------------------
// 1. 合法字幕 → 退出码 0
// ---------------------------------------------------------------------------

test('合法字幕 JSON 退出码为 0', () => {
  const { status, stdout } = runCli([writeJson(validCues())]);
  assert.strictEqual(status, 0);
  assert.ok(stdout.includes('字幕校验通过'), `stdout 缺少通过提示: ${stdout}`);
});

test('带合法词级时间戳的字幕退出码为 0', () => {
  const cues = validCues();
  cues[0].words = [
    { start: 0, end: 0.5, text: '第一' },
    { start: 0.5, end: 1.5, text: '句字幕' },
  ];
  const { status } = runCli([writeJson(cues)]);
  assert.strictEqual(status, 0);
});

// ---------------------------------------------------------------------------
// 2. 非法字幕 → 退出码 1
// ---------------------------------------------------------------------------

test('空数组退出码为 1', () => {
  const { status, stderr } = runCli([writeJson([])]);
  assert.strictEqual(status, 1);
  assert.ok(stderr.includes('cue 数量不足'), `stderr 缺少数量提示: ${stderr}`);
});

test('非数组（对象）退出码为 1', () => {
  const { status, stderr } = runCli([writeJson({ start: 0, end: 1, text: 'x' })]);
  assert.strictEqual(status, 1);
  assert.ok(stderr.includes('必须是数组'), `stderr 缺少数组提示: ${stderr}`);
});

test('end<=start 退出码为 1', () => {
  const cues = validCues();
  cues[1].end = cues[1].start;
  const { status, stderr } = runCli([writeJson(cues)]);
  assert.strictEqual(status, 1);
  assert.ok(stderr.includes('end 必须大于 start'), `stderr 缺少 end/start 提示: ${stderr}`);
});

// ---------------------------------------------------------------------------
// 3. 词级时间戳非法 → 退出码 1
// ---------------------------------------------------------------------------

test('词级时间戳回退退出码为 1', () => {
  const cues = validCues();
  cues[0].words = [
    { start: 0.5, end: 1, text: '甲' },
    { start: 0.2, end: 1.5, text: '乙' },
  ];
  const { status, stderr } = runCli([writeJson(cues)]);
  assert.strictEqual(status, 1);
  assert.ok(stderr.includes('单调递增'), `stderr 缺少回退提示: ${stderr}`);
});

test('词级时间戳越出 cue 范围退出码为 1', () => {
  const cues = validCues();
  cues[0].words = [{ start: 0, end: 3, text: '超长词' }];
  const { status, stderr } = runCli([writeJson(cues)]);
  assert.strictEqual(status, 1);
  assert.ok(stderr.includes('超出 cue 时间范围'), `stderr 缺少越界提示: ${stderr}`);
});

// ---------------------------------------------------------------------------
// 4. 文件不存在 → 退出码 1
// ---------------------------------------------------------------------------

test('字幕文件不存在退出码为 1', () => {
  const missing = path.join(TMP_DIR, 'does_not_exist.json');
  const { status, stderr } = runCli([missing]);
  assert.strictEqual(status, 1);
  assert.ok(stderr.includes('Subtitles file not found'), `stderr 缺少文件缺失提示: ${stderr}`);
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

fs.rmSync(TMP_DIR, { recursive: true, force: true });

console.log(`\nPASSED: ${passed}, FAILED: ${failed}, TOTAL: ${passed + failed}`);
if (failed > 0) {
  process.exit(1);
}

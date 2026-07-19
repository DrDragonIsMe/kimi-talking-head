#!/usr/bin/env node
/**
 * Tests for scripts/extract_title.js — 标题必须在分句边界拆分，不能硬切词中间。
 *
 * Usage: node scripts/test_extract_title.js
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SCRIPT = path.join(__dirname, 'extract_title.js');

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

function extract(content, ext = '.md') {
  const file = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'extract-title-')),
    `article${ext}`
  );
  fs.writeFileSync(file, content, 'utf-8');
  const out = execFileSync('node', [SCRIPT, file, '本期分享'], { encoding: 'utf-8' });
  return JSON.parse(out);
}

console.log('=== extract_title ===');

// 1. 生产案例：长首行在最后一个 ≤24 字的分句边界拆分，标题是完整分句
{
  const { title, subtitle } = extract(
    '如果你觉得AI员工还只是个概念，那2026年上半年的国外职场，可能会让你有点坐不住。\n\n正文段落。'
  );
  assertEqual(title, '如果你觉得AI员工还只是个概念', 'long first line splits at clause boundary');
  assertEqual(
    subtitle,
    '那2026年上半年的国外职场，可能会让你有点坐不住。',
    'remainder becomes subtitle'
  );
}

// 2. MAX 内无边界时，允许延伸到 SOFT_MAX(36) 内的第一个边界
{
  const { title } = extract(
    '这是一个长度超过二十四字但中间完全没有标点符号的超长句子，后面才出现逗号。\n\n正文。'
  );
  assertEqual(title, '这是一个长度超过二十四字但中间完全没有标点符号的超长句子', 'extends to first boundary within SOFT_MAX');
}

// 3. H1 优先且短标题不拆
{
  const { title, subtitle } = extract('# AI员工来了\n\n正文段落。');
  assertEqual(title, 'AI员工来了', 'H1 preferred');
  assertEqual(subtitle, '', 'short title has empty subtitle');
}

// 4. 完全没有标点时的兜底：硬切（last resort）
{
  const { title } = extract('这是一个没有任何标点符号但长度超过二十四个字的标题用来验证硬切回退逻辑是否正常工作');
  assertEqual(title.length, 24, 'no-punct title falls back to hard cut at MAX_TITLE_LEN');
}

// 5. 英文长标题在空格处拆分，且副标题保留单词间空格
{
  const { title, subtitle } = extract('Short English Title That Is Way Too Long For The Card Layout');
  assertEqual(title, 'Short English Title', 'english title splits at last space');
  assert(subtitle.startsWith('That Is'), `subtitle keeps space between words (got: ${subtitle})`);
}

// 6. 表演指令行会被跳过
{
  const { title } = extract('（开场钩子，语速偏快）\n真正的标题句子。\n\n正文。');
  assertEqual(title, '真正的标题句子。', 'performance direction lines are skipped');
}

// 7. 拆分后的标题不带尾随逗号/句号
{
  const { title } = extract('前半句说完之后，后半句继续补充更多内容直到超过长度限制需要拆分。\n\n正文。');
  assert(!/[，、；：,;:。]+$/.test(title), `title has no trailing clause punctuation (got: ${title})`);
}

console.log(failures === 0 ? '\n所有 extract_title 测试通过' : `\n${failures} 个测试失败`);
process.exit(failures === 0 ? 0 : 1);

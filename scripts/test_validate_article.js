#!/usr/bin/env node
/**
 * Tests for scripts/validate_article.js — 口播文章质量预检 CLI 约定。
 *
 * 硬约定：退出码 0=通过 / 1=不通过，stdout 输出 JSON { ok, checks: [{ name, ok, detail }] }。
 *
 * Usage: node scripts/test_validate_article.js
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SCRIPT = path.join(__dirname, 'validate_article.js');

let failures = 0;

function assert(cond, message) {
  if (cond) {
    console.log(`  ✅ ${message}`);
  } else {
    failures += 1;
    console.error(`  ❌ ${message}`);
  }
}

function run(content) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'validate-article-')), 'article.md');
  fs.writeFileSync(file, content, 'utf-8');
  const res = spawnSync('node', [SCRIPT, file], { encoding: 'utf-8' });
  let json = null;
  try {
    json = JSON.parse(res.stdout.trim());
  } catch {
    // json stays null
  }
  return { status: res.status, json };
}

const checkByName = (json, name) => (json.checks || []).find((c) => c.name === name);

console.log('=== validate_article ===');

// 1. 正常中文文章 → 退出码 0，ok=true，4 项检查全部通过
{
  const { status, json } = run('人工智能正在深刻改变人力资源行业。'.repeat(20));
  assert(status === 0, 'valid Chinese article exits 0');
  assert(json && json.ok === true, 'valid Chinese article returns ok=true');
  assert(Array.isArray(json.checks) && json.checks.length === 4, 'returns 4 checks');
  assert(
    json.checks.every((c) => typeof c.name === 'string' && typeof c.ok === 'boolean' && typeof c.detail === 'string'),
    'every check has name/ok/detail'
  );
}

// 2. 文章过短（<100 有效字符）→ char_count 不通过，退出码 1
{
  const { status, json } = run('太短的文章。');
  assert(status === 1, 'too-short article exits 1');
  assert(json && json.ok === false, 'too-short article ok=false');
  assert(checkByName(json, 'char_count').ok === false, 'char_count check fails');
}

// 3. 文章过长（>10000 有效字符）→ char_count 不通过
{
  const { status, json } = run('长'.repeat(11000));
  assert(status === 1, 'too-long article exits 1');
  assert(checkByName(json, 'char_count').ok === false, 'char_count check fails for long article');
}

// 4. 代码块占比 ≥30% → code_ratio 不通过
{
  const code = '```\n' + 'const x = 1;\n'.repeat(60) + '```\n';
  const { status, json } = run('前言：这篇文章主要是代码。'.repeat(5) + '\n' + code);
  assert(status === 1, 'code-heavy article exits 1');
  assert(checkByName(json, 'code_ratio').ok === false, 'code_ratio check fails');
}

// 5. 表格行数 ≥10 → table_rows 不通过
{
  const table = Array.from({ length: 12 }, (_, i) => `| 列A${i} | 列B${i} |`).join('\n');
  const { status, json } = run('这是一篇带大表格的文章。'.repeat(15) + '\n' + table);
  assert(status === 1, 'table-heavy article exits 1');
  assert(checkByName(json, 'table_rows').ok === false, 'table_rows check fails');
}

// 6. 纯英文文章（中文占比 <50%）→ chinese_ratio 不通过
{
  const { status, json } = run(
    'This is a purely English article about business and technology trends. '.repeat(10)
  );
  assert(status === 1, 'english-only article exits 1');
  assert(checkByName(json, 'chinese_ratio').ok === false, 'chinese_ratio check fails');
}

// 7. 文件不存在 → 退出码 1，stdout 仍是合法 JSON 且 ok=false
{
  const res = spawnSync('node', [SCRIPT, '/tmp/validate_article_nonexistent_xyz.md'], {
    encoding: 'utf-8',
  });
  let json = null;
  try {
    json = JSON.parse(res.stdout.trim());
  } catch {
    // json stays null
  }
  assert(res.status === 1, 'missing file exits 1');
  assert(json && json.ok === false, 'missing file returns ok=false JSON');
}

// 8. 有效字符数剔除代码块：正文 120 字 + 大代码块仍应通过 char_count 与 code 占比按总字符计
{
  const body = '人力资源数字化转型的核心是数据驱动决策。'.repeat(6); // ~120 有效字符
  const code = '```\n' + 'x\n'.repeat(30) + '```\n'; // 小代码块，占比 <30%
  const { status, json } = run(body + '\n' + code);
  assert(status === 0, 'article with small code block passes');
  assert(checkByName(json, 'char_count').ok === true, 'effective chars exclude code block content');
}

console.log('');
if (failures > 0) {
  console.error(`FAILED: ${failures} assertion(s)`);
  process.exit(1);
}
console.log('PASSED: all assertions');

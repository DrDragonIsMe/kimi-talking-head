#!/usr/bin/env node
/**
 * 口播文章质量预检（pipeline script 阶段前调用，后端 POST /jobs 也按此约定调用）。
 *
 * 硬约定：
 *   node scripts/validate_article.js <articlePath>
 *   退出码 0 = 通过，1 = 不通过
 *   stdout 输出 JSON: { ok, checks: [{ name, ok, detail }] }
 *
 * 检查项：
 *   char_count    有效字符数（剔除代码块与空白）在 100~10000 之间
 *   code_ratio    代码块字符占比 < 30%（代码不适合朗读）
 *   table_rows    Markdown 表格行数 < 10（表格朗读效果差）
 *   chinese_ratio 中文字符占比 ≥ 50%（当前 TTS 主要支持中文）
 */

const fs = require('fs');

const MIN_CHARS = 100;
const MAX_CHARS = 10000;
const MAX_CODE_RATIO = 0.3;
const MAX_TABLE_ROWS = 10;
const MIN_CHINESE_RATIO = 0.5;

const fail = (checks) => {
  console.log(JSON.stringify({ ok: false, checks }));
  process.exit(1);
};

const articlePath = process.argv[2];
if (!articlePath) {
  console.error('Usage: node scripts/validate_article.js <articlePath>');
  process.exit(1);
}

let content;
try {
  content = fs.readFileSync(articlePath, 'utf8');
} catch (err) {
  fail([{ name: 'readable', ok: false, detail: `无法读取文章文件: ${articlePath} (${err.message})` }]);
}

// 提取 ``` 围栏代码块（含未闭合的尾部围栏块）
const codeBlocks = content.match(/```[\s\S]*?(```|$)/g) || [];
const codeChars = codeBlocks.join('').replace(/\s+/g, '').length;
const textWithoutCode = content.replace(/```[\s\S]*?(```|$)/g, '');

const totalChars = content.replace(/\s+/g, '').length;
const effectiveChars = textWithoutCode.replace(/\s+/g, '').length;
const codeRatio = totalChars > 0 ? codeChars / totalChars : 0;

const tableRows = content
  .split('\n')
  .filter((line) => /^\s*\|.+\|\s*$/.test(line)).length;

const hanCount = (content.match(/[\u4e00-\u9fff]/g) || []).length;
const latinCount = (content.match(/[A-Za-z]/g) || []).length;
const chineseRatio = hanCount + latinCount > 0 ? hanCount / (hanCount + latinCount) : 0;

const pct = (v) => `${(v * 100).toFixed(1)}%`;

const checks = [
  {
    name: 'char_count',
    ok: effectiveChars >= MIN_CHARS && effectiveChars <= MAX_CHARS,
    detail: `有效字符数 ${effectiveChars}（要求 ${MIN_CHARS}~${MAX_CHARS}，已剔除代码块与空白）`,
  },
  {
    name: 'code_ratio',
    ok: codeRatio < MAX_CODE_RATIO,
    detail: `代码块占比 ${pct(codeRatio)}（要求 < ${pct(MAX_CODE_RATIO)}）`,
  },
  {
    name: 'table_rows',
    ok: tableRows < MAX_TABLE_ROWS,
    detail: `表格行数 ${tableRows}（要求 < ${MAX_TABLE_ROWS}）`,
  },
  {
    name: 'chinese_ratio',
    ok: chineseRatio >= MIN_CHINESE_RATIO,
    detail: `中文字符占比 ${pct(chineseRatio)}（要求 ≥ ${pct(MIN_CHINESE_RATIO)}）`,
  },
];

const ok = checks.every((c) => c.ok);
console.log(JSON.stringify({ ok, checks }));
process.exit(ok ? 0 : 1);

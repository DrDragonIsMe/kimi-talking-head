#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const inputPath = process.argv[2];

if (!inputPath) {
  console.error('Usage: node extract_cover_copy.js <article-file>');
  process.exit(1);
}

const raw = fs.readFileSync(inputPath, 'utf8');

const cleanLine = (line) =>
  line
    .replace(/^#+\s*/g, '')
    .replace(/\*\*|__|\*|_/g, '')
    .replace(/`/g, '')
    .replace(/[ \t]+/g, ' ')
    .trim();

const cleanText = raw
  .split('\n')
  .map(cleanLine)
  .filter(Boolean)
  .join(' ')
  .replace(/https?:\/\/\S+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const stripMarkdown = (text) =>
  text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, ' ')
    .replace(/\[[^\]]+\]\([^)]+\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const text = stripMarkdown(cleanText);

// 提取标题
const titleMatch = text.match(/^(.{4,40})/);
const title = titleMatch ? titleMatch[1].trim() : '';

// 摘要：第一句完整话
const firstSentenceMatch = text.match(/^([^。！？!?]{10,80})[。！？!?]/);
const summary = firstSentenceMatch ? firstSentenceMatch[1].trim() : text.slice(0, 60).trim();

// 核心判断：找一句包含数据或结论的话
const clauses = text
  .split(/[。！？!?]/)
  .map((s) => s.trim())
  .filter((s) => s.length >= 10 && s.length <= 80);

let insight = summary;
const priorityWords = /表明|说明|意味着|显示|证明|结论|信号|趋势|关键|核心/;
const dataPattern = /\d+(?:\.\d+)?%?|\d+(?:\.\d+)?(?:亿|万|千|百)/;

for (const clause of clauses) {
  if (priorityWords.test(clause) || (dataPattern.test(clause) && clause.length <= 60)) {
    insight = clause;
    break;
  }
}

// 提取关键数字作为 stats
const stats = [];
const seen = new Set();

// 融资/金额模式
const fundingPattern = /([\u4e00-\u9fa5A-Za-z][\u4e00-\u9fa5A-Za-z\s]*?)[,，、\s]+(\d+(?:\.\d+)?)\s*(亿美元|万美元|百万美元|千万美元|亿元|万元|百万|千万|%)|(\d+(?:\.\d+)?)\s*(亿美元|万美元|百万美元|千万美元|亿元|万元|百万|千万|%)/gu;
let match;
while ((match = fundingPattern.exec(text)) !== null) {
  const label = (match[1] || '关键数据').replace(/[，、：:；;。！？!?\s]/g, '').trim();
  const value = match[2] || match[4];
  const unit = match[3] || match[5];
  const key = `${label}:${value}${unit}`;
  if (!seen.has(key) && label.length >= 2 && label.length <= 12) {
    seen.add(key);
    stats.push({ label, value: `${value}${unit}` });
  }
}

// 如果 stats 不足，补充数量类数字
if (stats.length < 2) {
  const countPattern = /(\d+)\s*(家|个|笔|项|人)/gu;
  while ((match = countPattern.exec(text)) !== null) {
    const value = match[1];
    const unit = match[2];
    const key = `${value}${unit}`;
    if (!seen.has(key)) {
      seen.add(key);
      stats.push({ label: '数量', value: `${value}${unit}` });
    }
  }
}

const result = {
  summary: summary.length > 80 ? `${summary.slice(0, 80).trim()}…` : summary,
  insight: insight.length > 60 ? `${insight.slice(0, 60).trim()}…` : insight,
  stats: stats.slice(0, 3),
};

console.log(JSON.stringify(result, null, 2));

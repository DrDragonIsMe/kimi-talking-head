#!/usr/bin/env node

const fs = require('fs');

const inputPath = process.argv[2];

if (!inputPath) {
  console.error('Usage: node extract_quote.js <article-file>');
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

const normalizeQuote = (quote) =>
  quote
    .replace(/^[""'']/g, '')
    .replace(/[""'']$/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const normalizeAuthor = (author) =>
  author
    .replace(/[,，、：:;；。]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const extractByPatterns = () => {
  const candidates = [];

  // 模式 1: 中文引号 "..."，前面主体 + 说/表示/认为/指出 + 任意衔接语 + 引号
  const pattern1 = /([\u4e00-\u9fa5A-Za-z][\u4e00-\u9fa5A-Za-z\s\d]*?)(?:说|表示|认为|指出|提到|强调)(?:过|，|：|:|\s|[^""']{0,20})?[""']([^""']{12,120})[""']/gu;
  let match;
  while ((match = pattern1.exec(text)) !== null) {
    candidates.push({
      quote: normalizeQuote(match[2]),
      author: normalizeAuthor(match[1]),
      context: '',
      score: 10 + match[2].length * 0.1,
    });
  }

  // 模式 2: 主体 + "..."（英文引号），常用于 CEO 发言
  const pattern2 = /([\u4e00-\u9fa5A-Za-z][\u4e00-\u9fa5A-Za-z\s\d]*?)(?:说|表示|认为|指出|提到|强调)(?:过|，|：|:|\s|[^"]{0,20})?"([^"]{12,120})"/gu;
  while ((match = pattern2.exec(text)) !== null) {
    candidates.push({
      quote: normalizeQuote(match[2]),
      author: normalizeAuthor(match[1]),
      context: '',
      score: 10 + match[2].length * 0.1,
    });
  }

  // 模式 3: XXX CEO/创始人 Name 说..."..."
  const pattern3 = /([\u4e00-\u9fa5A-Za-z][\u4e00-\u9fa5A-Za-z\s\d]*?(?:CEO|创始人|CTO|COO|总裁|负责人|高管|主管))\s*([\u4e00-\u9fa5A-Za-z][\u4e00-\u9fa5A-Za-z\s\d]*?)(?:说|表示|认为|指出|提到|强调)(?:过|，|：|:|\s|[^""""']{0,20})?[""""']([^""""']{12,120})[""""']/gu;
  while ((match = pattern3.exec(text)) !== null) {
    candidates.push({
      quote: normalizeQuote(match[3]),
      author: normalizeAuthor(`${match[1]} ${match[2]}`),
      context: '',
      score: 12 + match[3].length * 0.1,
    });
  }

  // 模式 4: 纯引号内容（无主语），从上下文推断作者
  const pattern4 = /[""""']([^""""']{16,120})[""""']/gu;
  while ((match = pattern4.exec(text)) !== null) {
    const before = text.slice(Math.max(0, match.index - 80), match.index);
    const authorMatch = before.match(/([\u4e00-\u9fa5A-Za-z][\u4e00-\u9fa5A-Za-z\s\d]*?)(?:说|表示|认为|指出|提到|强调)$/);
    const author = authorMatch ? normalizeAuthor(authorMatch[1]) : '';
    candidates.push({
      quote: normalizeQuote(match[1]),
      author,
      context: '',
      score: author ? 9 : 5,
    });
  }

  // 模式 5: 书名号/尖括号中的论断「...」
  const pattern5 = /[《〈]([^《〈》〉]{12,80})[》〉]/gu;
  while ((match = pattern5.exec(text)) !== null) {
    candidates.push({
      quote: normalizeQuote(match[1]),
      author: '',
      context: '',
      score: 4,
    });
  }

  return candidates;
};

const candidates = extractByPatterns();

// 去重：相同 quote 只保留 score 最高的一条
const quoteMap = new Map();
for (const candidate of candidates) {
  const key = candidate.quote.slice(0, 40);
  if (!quoteMap.has(key) || quoteMap.get(key).score < candidate.score) {
    quoteMap.set(key, candidate);
  }
}

const deduped = Array.from(quoteMap.values()).sort((a, b) => b.score - a.score);

const best = deduped[0] || null;

if (!best) {
  console.log(JSON.stringify(null));
  process.exit(0);
}

// 限制引用长度，避免卡片溢出
const maxQuoteLength = 72;
const trimmedQuote = best.quote.length > maxQuoteLength
  ? `${best.quote.slice(0, maxQuoteLength)}...`
  : best.quote;

const result = {
  quote: trimmedQuote,
  author: best.author,
  context: best.context,
};

console.log(JSON.stringify(result));

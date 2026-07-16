const fs = require('fs');

const inputPath = process.argv[2];
const fallbackTitle = process.argv[3] || '本期分享';

if (!inputPath) {
  console.error('Usage: node extract_title.js <article-file> [fallback-title]');
  process.exit(1);
}

const content = fs.readFileSync(inputPath, 'utf-8').trim();
const ext = inputPath.split('.').pop().toLowerCase();

const MAX_TITLE_LEN = 24;

function isPerformanceDirection(line) {
  // Skip lines that are only performance directions like
  // （开场钩子，语速偏快，制造反差） or 【节奏：开场】
  const trimmed = line.trim();
  if (!trimmed) return true;
  if (/^[（(［\[].*?[）)］\]]$/.test(trimmed)) return true;
  if (/^(节奏|语速|语气|情绪|停顿|动作|表情|镜头|BGM|音乐|音效|字幕|风格|模板|布局|主题|提示|prompt|style|tempo|tone|pause|action|camera|music|sfx|subtitle)\s*[:：].*$/i.test(trimmed)) return true;
  return false;
}

function stripMarkdown(line) {
  return line
    .replace(/^#+\s*/g, '')
    .replace(/\*\*|__|\*|_/g, '')
    .replace(/[`#>\-+]/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .trim();
}

function pickBestTitle(candidates) {
  for (const candidate of candidates) {
    const text = stripMarkdown(candidate);
    if (!text || isPerformanceDirection(text)) continue;
    // Need at least some substance (e.g., not just punctuation or numbers)
    if (/[\u4e00-\u9fa5A-Za-z]/.test(text) && text.length >= 4) {
      return text;
    }
  }
  return '';
}

let title = '';
let subtitle = '';

if (ext === 'md' || ext === 'markdown') {
  const h1Match = content.match(/^#\s+(.+)$/m);
  if (h1Match) {
    title = stripMarkdown(h1Match[1]);
  }
}

if (!title) {
  const lines = content.split('\n').map(line => line.trim()).filter(Boolean);
  title = pickBestTitle(lines);
}

// Last resort: build a title from the first meaningful sentence by taking
// the first chunk before a natural break (comma/colon/dash/period).
if (!title) {
  const firstMeaningful = content
    .split(/[。！？!?,，；;：:\n]/)[0]
    .replace(/^[（(［\[].*?[）)］\]]\s*/g, '')
    .trim();
  if (firstMeaningful.length >= 4) {
    title = firstMeaningful;
  }
}

if (!title) {
  title = fallbackTitle;
}

// Truncate overly long titles and move the remainder to subtitle.
if (title.length > MAX_TITLE_LEN) {
  subtitle = title.slice(MAX_TITLE_LEN).trim();
  title = title.slice(0, MAX_TITLE_LEN).trim();
  const lastSpace = title.lastIndexOf(' ');
  if (lastSpace > MAX_TITLE_LEN / 2) {
    subtitle = title.slice(lastSpace + 1) + subtitle;
    title = title.slice(0, lastSpace);
  }
}

console.log(JSON.stringify({ title, subtitle }));

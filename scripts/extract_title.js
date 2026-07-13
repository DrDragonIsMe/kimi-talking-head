const fs = require('fs');

const inputPath = process.argv[2];
const fallbackTitle = process.argv[3] || '本期分享';

if (!inputPath) {
  console.error('Usage: node extract_title.js <input-file> [fallback-title]');
  process.exit(1);
}

const content = fs.readFileSync(inputPath, 'utf-8').trim();
const ext = inputPath.split('.').pop().toLowerCase();

let title = '';
let subtitle = '';

if (ext === 'md' || ext === 'markdown') {
  // Try to find H1
  const h1Match = content.match(/^#\s+(.+)$/m);
  if (h1Match) {
    title = h1Match[1].trim();
  }
}

if (!title) {
  // Use first non-empty line, stripped of markdown markers
  const firstLine = content.split('\n').find(line => line.trim().length > 0);
  if (firstLine) {
    title = firstLine
      .replace(/^#+\s*/g, '')
      .replace(/\*\*|__|\*|_/g, '')
      .replace(/[\*\`#\>\-\+]/g, '')
      .trim();
  }
}

if (!title) {
  title = fallbackTitle;
}

// Truncate overly long titles
if (title.length > 24) {
  subtitle = title.slice(24).trim();
  title = title.slice(0, 24).trim();
  // Avoid cutting in the middle of a word if possible
  const lastSpace = title.lastIndexOf(' ');
  if (lastSpace > 12) {
    subtitle = title.slice(lastSpace + 1) + subtitle;
    title = title.slice(0, lastSpace);
  }
}

console.log(JSON.stringify({ title, subtitle }));

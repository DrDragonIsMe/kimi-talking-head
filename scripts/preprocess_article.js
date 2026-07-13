const fs = require('fs');
const path = require('path');

const inputPath = process.argv[2];
const outputPath = process.argv[3];

if (!inputPath || !outputPath) {
  console.error('Usage: node preprocess_article.js <input-file> <output-file>');
  process.exit(1);
}

const ext = path.extname(inputPath).toLowerCase();
let content = fs.readFileSync(inputPath, 'utf-8');

function stripMarkdown(md) {
  return md
    // Remove code blocks first
    .replace(/```[\s\S]*?```/g, ' ')
    // Remove inline code
    .replace(/`([^`]+)`/g, '$1')
    // Remove images, keep alt text
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    // Remove links, keep text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // Remove bare URLs
    .replace(/https?:\/\/\S+/g, ' ')
    // Remove HTML tags
    .replace(/<[^>]+>/g, ' ')
    // Remove headers
    .replace(/^#{1,6}\s+/gm, '')
    // Remove blockquotes
    .replace(/^\s*>\s?/gm, '')
    // Remove horizontal rules
    .replace(/^\s*[-=*]{3,}\s*$/gm, ' ')
    // Remove bold/italic markers
    .replace(/(\*\*\*|___)([^\1]*?)\1/g, '$2')
    .replace(/(\*\*|__)([^\1]*?)\1/g, '$2')
    .replace(/(\*|_)([^\1]*?)\1/g, '$2')
    // Remove list markers
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '');
}

function normalizeWhitespace(text) {
  return text
    .replace(/\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

let scriptText;
if (ext === '.md' || ext === '.markdown') {
  scriptText = normalizeWhitespace(stripMarkdown(content));
  console.log(`预处理 Markdown: ${path.basename(inputPath)}`);
} else if (ext === '.txt') {
  scriptText = normalizeWhitespace(content);
  console.log(`预处理纯文本: ${path.basename(inputPath)}`);
} else {
  // Fallback: treat unknown extensions as plain text
  scriptText = normalizeWhitespace(content);
  console.log(`未知格式，按纯文本处理: ${path.basename(inputPath)}`);
}

fs.writeFileSync(outputPath, scriptText, 'utf-8');
console.log(`口播稿已生成: ${outputPath} (${scriptText.length} 字符)`);

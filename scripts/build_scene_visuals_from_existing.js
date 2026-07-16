#!/usr/bin/env node
/**
 * Build scene_visuals.json from already-downloaded scene images.
 * Used when we want to reuse existing visuals instead of re-searching/generating.
 */

const fs = require('fs');
const path = require('path');

const srtPath = process.argv[2];
const imageDir = process.argv[3];
const outputPath = process.argv[4];
const audioDuration = parseFloat(process.argv[5]);

if (!srtPath || !imageDir || !outputPath || Number.isNaN(audioDuration)) {
  console.error(
    'Usage: node build_scene_visuals_from_existing.js <subtitles.srt> <image-dir> <output.json> <audio-duration>'
  );
  process.exit(1);
}

const cleanText = (text) =>
  text
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const parseSRT = (content) => {
  const cues = [];
  const blocks = content.trim().split(/\n\n+/);
  for (const block of blocks) {
    const lines = block.split('\n');
    if (lines.length < 3) continue;
    const timeLine = lines[1];
    const text = lines.slice(2).join(' ');
    const match = timeLine.match(/(\d{2}:\d{2}:\d{2},\d{3})\s+-->\s+(\d{2}:\d{2}:\d{2},\d{3})/);
    if (!match) continue;
    const parseTime = (t) => {
      const [h, m, s, ms] = t.replace(',', ':').split(':').map(Number);
      return h * 3600 + m * 60 + s + ms / 1000;
    };
    cues.push({
      start: parseTime(match[1]),
      end: parseTime(match[2]),
      text: cleanText(text),
    });
  }
  return cues;
};

const cues = parseSRT(fs.readFileSync(srtPath, 'utf8'));

const imageFiles = fs
  .readdirSync(imageDir)
  .filter((f) => /\.(png|jpg|jpeg|webp)$/i.test(f))
  .sort();

if (imageFiles.length === 0) {
  console.error(`No images found in ${imageDir}`);
  process.exit(1);
}

const segmentDuration = audioDuration / imageFiles.length;

const filenameToSummary = (name) => {
  const base = name.replace(/\.[^.]+$/, '').replace(/^\d+-/, '');
  const map = {
    'ai-startup-seed-funding-modern-tech-studio': '建筑AI获400万美元种子轮',
    'glass-installation-contractor-bidding-documents': '玻璃安装投标细分AI服务',
    'ai-business-workflow-diagram-modern-tech': 'AI赋能建筑行业流程闭环',
    'modern-corporate-office-hr-ai': '薪灵AI智能HR场景',
    'ai-technology-construction-business-workflow': 'AI助力建筑行业流程优化',
    'bright-modern-ai-startup-studio': 'AI落地黄金公式分享',
  };
  return map[base] || base.replace(/-/g, ' ');
};

const publicDir = path.resolve(__dirname, '..', 'public');
const relativeImageDir = path.relative(publicDir, imageDir);

const sceneVisuals = imageFiles.map((file, index) => {
  const start = index * segmentDuration;
  const end = index === imageFiles.length - 1 ? audioDuration : (index + 1) * segmentDuration;
  const segmentCues = cues.filter((c) => c.start >= start && c.start < end);
  const text = segmentCues.map((c) => c.text).join(' ');
  const summary = filenameToSummary(file);
  const query = summary;

  return {
    start,
    end,
    prompt: `Vertical editorial visual for a Chinese business news explainer. ${summary}. Clean modern business aesthetic, no text or watermarks.`,
    query,
    text,
    summary,
    aiPrompt: summary,
    provider: 'local',
    path: path.join(relativeImageDir, file).replace(/\\/g, '/'),
    sourceUrl: '',
    license: 'local',
    author: '',
    attributionRequired: false,
  };
});

fs.writeFileSync(outputPath, JSON.stringify(sceneVisuals, null, 2), 'utf8');
console.log(`Wrote ${sceneVisuals.length} scene visuals to ${outputPath}`);

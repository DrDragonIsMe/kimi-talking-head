#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const inputPath = process.argv[2];
const outputPath = process.argv[3];
const offsetSeconds = parseFloat(process.argv[4] || '0');

const DEFAULT_SEGMENTATION = {
  maxSegmentSeconds: 3.2,
  minSegmentSeconds: 0.9,
  maxVisualLength: 26,
};

const readSegmentationConfig = () => {
  try {
    const env = process.env.SUBTITLE_SEGMENTATION_JSON;
    if (env) {
      return { ...DEFAULT_SEGMENTATION, ...JSON.parse(env) };
    }
  } catch (_error) {
    // ignore
  }
  return DEFAULT_SEGMENTATION;
};

const config = readSegmentationConfig();

// 分段/断行逻辑的唯一数据源：scripts/lib/subtitle_segmentation.js
// （与 src/hooks/useSubtitles.ts、src/utils/keywordMatcher.ts 共用，禁止内联副本）
const { segmentCue } = require('./lib/subtitle_segmentation');

const parseSRT = (content) => {
  const cues = [];
  const blocks = content.trim().split(/\n\n+/);
  for (const block of blocks) {
    const lines = block.split('\n');
    if (lines.length < 3) continue;
    const timeLine = lines[1];
    const text = lines.slice(2).join(' ').replace(/<[^>]+>/g, '');
    const timeMatch = timeLine.match(/(\d{2}:\d{2}:\d{2},\d{3})\s+-->\s+(\d{2}:\d{2}:\d{2},\d{3})/);
    if (!timeMatch) continue;

    const parseTime = (t) => {
      const [h, m, s, ms] = t.replace(',', ':').split(':').map(Number);
      return h * 3600 + m * 60 + s + ms / 1000;
    };

    cues.push(...segmentCue({
      start: parseTime(timeMatch[1]) + offsetSeconds,
      end: parseTime(timeMatch[2]) + offsetSeconds,
      text: text.trim(),
    }, config));
  }
  return cues;
};

// 归一化用于「cue 文本 vs 词序列拼接」的一致性校验：忽略空白与标点。
const normalizeForMatch = (text) =>
  String(text || '').replace(/[\s\p{P}\p{S}]/gu, '');

// 把 align_subtitles.py 产出的词级时间戳（subtitles_words.json）挂到输出 cue 上。
// 词按中点归属到 cue；拼接文本与 cue 文本（归一化后）一致才挂载，否则该 cue 降级为无词。
const attachWords = (cues, wordCues, offset = 0) => {
  const allWords = [];
  for (const wc of wordCues || []) {
    for (const w of wc.words || []) {
      if (typeof w.start !== 'number' || typeof w.end !== 'number' || !w.text) continue;
      allWords.push({ text: w.text, start: w.start + offset, end: w.end + offset });
    }
  }
  if (allWords.length === 0) return { attached: 0, dropped: 0 };

  let attached = 0;
  let dropped = 0;
  for (const cue of cues) {
    const words = allWords.filter((w) => {
      const mid = (w.start + w.end) / 2;
      return mid >= cue.start && mid < cue.end;
    });
    if (words.length === 0) {
      dropped += 1;
      continue;
    }
    if (normalizeForMatch(words.map((w) => w.text).join('')) === normalizeForMatch(cue.text)) {
      cue.words = words;
      attached += 1;
    } else {
      dropped += 1;
    }
  }
  return { attached, dropped };
};

const loadWordCues = (wordsPath) => {
  try {
    if (wordsPath && fs.existsSync(wordsPath)) {
      const parsed = JSON.parse(fs.readFileSync(wordsPath, 'utf8'));
      return Array.isArray(parsed) ? parsed : [];
    }
  } catch (error) {
    console.warn(`⚠️  词级字幕文件读取失败，按无词级数据继续: ${error.message}`);
  }
  return [];
};

const main = () => {
  if (!inputPath || !outputPath) {
    console.error('Usage: node parse_srt.js <input-srt> <output-json> [offset-seconds] [words-json]');
    process.exit(1);
  }

  const content = fs.readFileSync(inputPath, 'utf8');
  const cues = parseSRT(content);

  const wordsPath = process.argv[5] || '';
  if (wordsPath) {
    const wordCues = loadWordCues(wordsPath);
    if (wordCues.length > 0) {
      const { attached, dropped } = attachWords(cues, wordCues, offsetSeconds);
      console.log(`词级字幕挂载: ${attached} 条 cue 成功，${dropped} 条降级为整句`);
    }
  }

  fs.writeFileSync(outputPath, JSON.stringify(cues, null, 2));
  console.log(`Parsed ${cues.length} subtitle cues to ${outputPath} (offset: ${offsetSeconds}s)`);
};

if (require.main === module) {
  main();
}

module.exports = { parseSRT, attachWords, normalizeForMatch };

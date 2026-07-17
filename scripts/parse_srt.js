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

const normalizeSubtitleText = (text) =>
  text
    .replace(/\s+/g, ' ')
    .trim();

const isMeaningfulUnit = (text) => /[\u4e00-\u9fa5A-Za-z0-9]/.test(text);

const getCharVisualWidth = (char) => {
  if (char === ' ') return 0.35;
  if (/[A-Za-z0-9]/.test(char)) return 0.62;
  if (/[.,:;!?'"`-]/.test(char)) return 0.38;
  return 1;
};

const getVisualLength = (text) =>
  Array.from(text).reduce((sum, char) => sum + getCharVisualWidth(char), 0);

const splitByDelimiters = (text, delimiters) => {
  const result = [];
  let current = '';
  for (const char of text) {
    current += char;
    if (delimiters.test(char)) {
      const trimmed = current.trim();
      if (trimmed) result.push(trimmed);
      current = '';
    }
  }
  const tail = current.trim();
  if (tail) result.push(tail);
  return result;
};

const findSplitIndex = (text, maxWidth) => {
  let width = 0;
  let lastPreferredBreak = -1;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    width += getCharVisualWidth(char);
    if (/[，、：,:；;。！？!? ]/.test(char)) {
      lastPreferredBreak = i + 1;
    }
    if (width > maxWidth) {
      return lastPreferredBreak > 0 ? lastPreferredBreak : Math.max(1, i);
    }
  }
  return text.length;
};

const splitLongUnit = (text, maxWidth) => {
  const result = [];
  let remaining = normalizeSubtitleText(text);
  while (remaining && getVisualLength(remaining) > maxWidth) {
    const splitIndex = findSplitIndex(remaining, maxWidth);
    const head = normalizeSubtitleText(remaining.slice(0, splitIndex));
    const tail = normalizeSubtitleText(remaining.slice(splitIndex));
    if (!head || head === remaining) {
      result.push(normalizeSubtitleText(remaining.slice(0, Math.max(1, splitIndex))));
      remaining = normalizeSubtitleText(remaining.slice(Math.max(1, splitIndex)));
      continue;
    }
    result.push(head);
    remaining = tail;
  }
  if (remaining) result.push(remaining);
  return result.filter(Boolean);
};

const tokenizeCueText = (text) => {
  const normalized = normalizeSubtitleText(text);
  if (!normalized) return [];
  const sentenceUnits = splitByDelimiters(normalized, /[。！？!?；;—]/);
  const clauseUnits = sentenceUnits.flatMap((unit) => splitByDelimiters(unit, /[，、：,:]/));
  const baseUnits = clauseUnits.length > 0 ? clauseUnits : sentenceUnits;
  return (baseUnits.length > 0 ? baseUnits : [normalized])
    .map((unit) => normalizeSubtitleText(unit))
    .filter((unit) => unit && isMeaningfulUnit(unit))
    .flatMap((unit) => (getVisualLength(unit) > config.maxVisualLength ? splitLongUnit(unit, config.maxVisualLength) : [unit]))
    .filter(Boolean);
};

const groupUnits = (units, desiredCount) => {
  if (units.length <= desiredCount) {
    return units.map((unit) => [unit]);
  }
  const groups = [];
  const totalVisualLength = units.reduce((sum, unit) => sum + getVisualLength(unit), 0);
  const targetVisualLength = totalVisualLength / desiredCount;
  let currentGroup = [];
  let currentVisualLength = 0;

  for (let index = 0; index < units.length; index++) {
    const unit = units[index];
    const unitVisualLength = getVisualLength(unit);
    const remainingUnits = units.length - index;
    const remainingSlots = desiredCount - groups.length;

    if (
      currentGroup.length > 0 &&
      remainingSlots > 1 &&
      (currentVisualLength + unitVisualLength > targetVisualLength * 1.18 || remainingUnits === remainingSlots)
    ) {
      groups.push(currentGroup);
      currentGroup = [unit];
      currentVisualLength = unitVisualLength;
    } else {
      currentGroup.push(unit);
      currentVisualLength += unitVisualLength;
    }
  }
  if (currentGroup.length > 0) groups.push(currentGroup);

  while (groups.length > desiredCount) {
    const tail = groups.pop();
    if (!tail) break;
    groups[groups.length - 1] = groups[groups.length - 1].concat(tail);
  }
  return groups;
};

const segmentCue = (cue) => {
  const duration = cue.end - cue.start;
  const normalizedText = normalizeSubtitleText(cue.text);
  const visualLength = getVisualLength(normalizedText);
  if (!normalizedText) return [];

  if (duration <= 2.4 && visualLength <= config.maxVisualLength * 1.2) {
    return [{ ...cue, text: normalizedText }];
  }

  const units = tokenizeCueText(normalizedText);
  if (units.length <= 1) {
    return [{ ...cue, text: normalizedText }];
  }

  const desiredByDuration = Math.ceil(duration / config.maxSegmentSeconds);
  const desiredByLength = Math.ceil(visualLength / (config.maxVisualLength * 1.2));
  const maxSegmentsByDuration = Math.max(1, Math.floor(duration / config.minSegmentSeconds));
  const desiredCount = Math.max(1, Math.min(Math.max(desiredByDuration, desiredByLength), maxSegmentsByDuration, units.length));

  const groupedUnits = groupUnits(units, desiredCount);
  if (groupedUnits.length <= 1) {
    return [{ ...cue, text: normalizedText }];
  }

  const weights = groupedUnits.map((group) => Math.max(1, group.reduce((sum, unit) => sum + getVisualLength(unit), 0)));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);

  let cursor = cue.start;
  let consumedWeight = 0;

  return groupedUnits.map((group, index) => {
    const text = normalizeSubtitleText(group.join(''));
    consumedWeight += weights[index];
    const end = index === groupedUnits.length - 1 ? cue.end : cue.start + (duration * consumedWeight) / totalWeight;
    const segmentedCue = { start: cursor, end, text };
    cursor = end;
    return segmentedCue;
  });
};

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
    }));
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

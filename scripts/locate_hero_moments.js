#!/usr/bin/env node

/**
 * 把 storyboard.json 里 LLM 挑选的 hero_phrase 定位到词级时间戳，
 * 输出 Remotion 渲染用的 hero 时刻清单（含标题卡偏移）。
 *
 * Usage:
 *   node locate_hero_moments.js <storyboard.json> <words.json> <output.json> [offset-seconds]
 *
 * 规则：
 * - 只在所属 shot 的时间窗内定位（容忍 ±0.5s），窗外命中丢弃；
 * - 密度控制：最小间距 MIN_SPACING_SECONDS，每 60s 滑窗至多 MAX_PER_MINUTE 个；
 * - 定位失败不报错，只记日志——hero 是增强，缺失时退化为普通 karaoke。
 */

const fs = require('fs');

const MIN_SPACING_SECONDS = 10;
const MAX_PER_MINUTE = 3;
const WINDOW_TOLERANCE_SECONDS = 0.5;

const normalizeForMatch = (text) => String(text || '').replace(/[\s\p{P}\p{S}]/gu, '');

const flattenWords = (wordCues) => {
  const words = [];
  for (const cue of wordCues || []) {
    for (const w of cue.words || []) {
      if (typeof w.start === 'number' && typeof w.end === 'number' && w.text) {
        words.push({ text: w.text, start: w.start, end: w.end });
      }
    }
  }
  return words.sort((a, b) => a.start - b.start);
};

// 归一化拼接文本 + 归一化字符位置 → 词下标的映射
const buildIndex = (words) => {
  let joined = '';
  const charToWord = [];
  words.forEach((word, wordIndex) => {
    for (const ch of normalizeForMatch(word.text)) {
      joined += ch;
      charToWord.push(wordIndex);
    }
  });
  return { joined, charToWord };
};

const stripDisplayPunct = (text) =>
  String(text || '')
    .replace(/^[\s\p{P}\p{S}]+/gu, '')
    .replace(/[\s\p{P}\p{S}]+$/gu, '');

const findPhraseInWindow = (words, index, phrase, shot) => {
  const needle = normalizeForMatch(phrase);
  if (!needle) return null;

  let from = 0;
  while (from <= index.joined.length - needle.length) {
    const at = index.joined.indexOf(needle, from);
    if (at === -1) return null;
    const firstWord = index.charToWord[at];
    const lastWord = index.charToWord[at + needle.length - 1];
    const start = words[firstWord].start;
    const end = words[lastWord].end;
    if (
      start >= shot.start - WINDOW_TOLERANCE_SECONDS &&
      end <= shot.end + WINDOW_TOLERANCE_SECONDS
    ) {
      // 展示用 LLM 原短语（词边界可能横跨 token，拼接词文本会带入相邻字）
      const display = stripDisplayPunct(phrase);
      return { start, end, text: display || phrase };
    }
    from = at + 1;
  }
  return null;
};

const applyDensityRules = (moments) => {
  const kept = [];
  for (const moment of moments.slice().sort((a, b) => a.start - b.start)) {
    const last = kept[kept.length - 1];
    if (last && moment.start - last.start < MIN_SPACING_SECONDS) continue;
    const withinMinute = kept.filter((m) => moment.start - m.start < 60).length;
    if (withinMinute >= MAX_PER_MINUTE) continue;
    kept.push(moment);
  }
  return kept;
};

const clampMoment = (moment, maxDuration) => {
  if (typeof maxDuration !== 'number' || !Number.isFinite(maxDuration)) return moment;
  const start = Math.min(moment.start, maxDuration);
  const end = Math.min(Math.max(moment.end, start), maxDuration);
  return { ...moment, start, end };
};

const locateMoments = (storyboard, wordCues, options = {}) => {
  const offset = options.offsetSeconds || 0;
  const maxDuration = options.maxDurationSeconds;
  const words = flattenWords(wordCues);
  if (words.length === 0) return { moments: [], dropped: 0 };

  const index = buildIndex(words);
  const located = [];
  let dropped = 0;

  for (const shot of storyboard || []) {
    if (!shot || !shot.hero_phrase) continue;
    const found = findPhraseInWindow(words, index, shot.hero_phrase, shot);
    if (found) {
      const moment = clampMoment(
        {
          start: Number((found.start + offset).toFixed(3)),
          end: Number((found.end + offset).toFixed(3)),
          text: found.text,
        },
        maxDuration
      );
      // 完全超出时长范围则丢弃
      if (moment.start < (maxDuration ?? Infinity)) {
        located.push(moment);
      } else {
        dropped += 1;
      }
    } else {
      dropped += 1;
    }
  }

  return { moments: applyDensityRules(located), dropped };
};

const main = () => {
  const [, , storyboardPath, wordsPath, outputPath, offsetArg, maxDurationArg] = process.argv;
  if (!storyboardPath || !wordsPath || !outputPath) {
    console.error('Usage: node locate_hero_moments.js <storyboard.json> <words.json> <output.json> [offset-seconds] [max-duration-seconds]');
    process.exit(1);
  }

  const storyboard = JSON.parse(fs.readFileSync(storyboardPath, 'utf8'));
  const wordCues = JSON.parse(fs.readFileSync(wordsPath, 'utf8'));
  const offsetSeconds = parseFloat(offsetArg || '0');
  const maxDurationSeconds = maxDurationArg ? parseFloat(maxDurationArg) : undefined;

  const requested = (Array.isArray(storyboard) ? storyboard : []).filter((s) => s && s.hero_phrase).length;
  const { moments, dropped } = locateMoments(storyboard, wordCues, { offsetSeconds, maxDurationSeconds });

  fs.writeFileSync(outputPath, JSON.stringify(moments, null, 2));
  console.log(
    `🦸 hero 时刻: LLM 提出 ${requested} 个，定位成功 ${requested - dropped} 个，密度过滤后保留 ${moments.length} 个 -> ${outputPath}`
  );
};

if (require.main === module) {
  main();
}

module.exports = { locateMoments, normalizeForMatch, MIN_SPACING_SECONDS, MAX_PER_MINUTE };

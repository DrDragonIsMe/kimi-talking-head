/**
 * subtitle_segmentation.js — 字幕分段/断行逻辑的单一数据源。
 *
 * 以原 src/utils/keywordMatcher.ts 的增强版实现为基准（断点预算检查 +
 * 悬挂标点容差），供三处共用，禁止再各自内联：
 *   - scripts/parse_srt.js（Node 直接 require 本文件）
 *   - src/hooks/useSubtitles.ts（Remotion 打包，经同级 .d.ts 获得类型）
 *   - src/utils/keywordMatcher.ts（同上）
 *
 * 纯函数、无副作用；分段/断行行为只允许在这里修改。
 */

const normalizeSubtitleText = (text) =>
  text
    .replace(/\s+/g, ' ')
    .trim();

const isMeaningfulUnit = (text) => /[\u4e00-\u9fa5A-Za-z0-9]/.test(text);

const getCharVisualWidth = (char) => {
  if (char === ' ') return 0.35;
  if (/[A-Za-z0-9]/.test(char)) return 0.62;
  if (/[.,:;!?"'`\-]/.test(char)) return 0.38;
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
  let lastPreferredBreakWidth = 0;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    width += getCharVisualWidth(char);

    if (/[，、：,:；;。！？!? ]/.test(char)) {
      lastPreferredBreak = i + 1;
      lastPreferredBreakWidth = width;
    }

    if (width > maxWidth) {
      // 只有不超预算的断点才可取：预算之外的标点（如行尾逗号）不能作为断点，
      // 否则整行会超过 maxWidth
      if (lastPreferredBreak > 0 && lastPreferredBreakWidth <= maxWidth) {
        return lastPreferredBreak;
      }
      // 硬切：把紧跟的句读标点并入本行（悬挂标点），避免下一行以标点开头
      let cut = Math.max(1, i);
      let merged = 0;
      while (cut < text.length && merged < 2 && /[，、：,:；;。！？!?）)》」』]/.test(text[cut])) {
        cut++;
        merged++;
      }
      return cut;
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

const tokenizeCueText = (text, config) => {
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

const segmentCue = (cue, config) => {
  const duration = cue.end - cue.start;
  const normalizedText = normalizeSubtitleText(cue.text);
  const visualLength = getVisualLength(normalizedText);
  if (!normalizedText) return [];

  if (duration <= 2.4 && visualLength <= config.maxVisualLength * 1.2) {
    return [{ ...cue, text: normalizedText }];
  }

  const units = tokenizeCueText(normalizedText, config);
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

const trimLineForDisplay = (text) =>
  text.replace(/\s+/g, ' ').trim();

const clampLineByWidth = (text, maxWidth) => {
  let current = '';
  let width = 0;

  for (const char of text) {
    const nextWidth = width + getCharVisualWidth(char);
    if (nextWidth > maxWidth) {
      break;
    }
    current += char;
    width = nextWidth;
  }

  return trimLineForDisplay(current);
};

const forceWrapLines = (text, maxLines, maxWidth) => {
  const remainingLines = Math.max(1, maxLines);
  let remaining = trimLineForDisplay(text);
  const lines = [];

  for (let lineIndex = 0; lineIndex < remainingLines; lineIndex++) {
    const isLastLine = lineIndex === remainingLines - 1;
    if (!remaining) {
      break;
    }

    if (isLastLine) {
      if (getVisualLength(remaining) <= maxWidth) {
        lines.push(trimLineForDisplay(remaining));
      } else {
        lines.push(clampLineByWidth(remaining, maxWidth));
      }
      break;
    }

    if (getVisualLength(remaining) <= maxWidth) {
      lines.push(trimLineForDisplay(remaining));
      break;
    }

    const splitIndex = findSplitIndex(remaining, maxWidth);
    const head = trimLineForDisplay(remaining.slice(0, splitIndex));
    const tail = trimLineForDisplay(remaining.slice(splitIndex));

    if (!head) {
      lines.push(clampLineByWidth(remaining, maxWidth));
      remaining = trimLineForDisplay(remaining.slice(1));
      continue;
    }

    lines.push(head);
    remaining = tail;
  }

  return lines.filter(Boolean);
};

module.exports = {
  normalizeSubtitleText,
  isMeaningfulUnit,
  getCharVisualWidth,
  getVisualLength,
  splitByDelimiters,
  findSplitIndex,
  splitLongUnit,
  tokenizeCueText,
  groupUnits,
  segmentCue,
  trimLineForDisplay,
  clampLineByWidth,
  forceWrapLines,
};

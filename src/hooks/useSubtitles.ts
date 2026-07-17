import { useMemo } from 'react';

export interface SubtitleWord {
  text: string;
  start: number;
  end: number;
}

export interface HeroMoment {
  start: number;
  end: number;
  text: string;
}

export interface SubtitleCue {
  start: number;
  end: number;
  text: string;
  words?: SubtitleWord[];
}

interface SubtitleSegmentationConfig {
  maxSegmentSeconds: number;
  minSegmentSeconds: number;
  maxVisualLength: number;
}

const DEFAULT_SEGMENTATION_CONFIG: SubtitleSegmentationConfig = {
  maxSegmentSeconds: 3.2,
  minSegmentSeconds: 0.9,
  maxVisualLength: 26,
};

const readSegmentationConfigFromProps = (): SubtitleSegmentationConfig => {
  try {
    const fs = require('fs');
    const path = require('path');
    const props = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), 'public', 'props.json'), 'utf-8')
    );

    return {
      ...DEFAULT_SEGMENTATION_CONFIG,
      ...(props?.contentOverlay?.subtitles?.segmentation ?? {}),
    };
  } catch (_error) {
    return DEFAULT_SEGMENTATION_CONFIG;
  }
};

const normalizeSubtitleText = (text: string): string =>
  text
    .replace(/\s+/g, ' ')
    .trim();

const isMeaningfulUnit = (text: string): boolean => /[\u4e00-\u9fa5A-Za-z0-9]/.test(text);

const getCharVisualWidth = (char: string): number => {
  if (char === ' ') return 0.35;
  if (/[A-Za-z0-9]/.test(char)) return 0.62;
  if (/[.,:;!?"'`\-]/.test(char)) return 0.38;
  return 1;
};

const getVisualLength = (text: string): number =>
  Array.from(text).reduce((sum, char) => sum + getCharVisualWidth(char), 0);

const splitByDelimiters = (text: string, delimiters: RegExp): string[] => {
  const result: string[] = [];
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

const findSplitIndex = (text: string, maxWidth: number): number => {
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

const splitLongUnit = (text: string, maxWidth: number): string[] => {
  const result: string[] = [];
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

const tokenizeCueText = (text: string, config: SubtitleSegmentationConfig): string[] => {
  const normalized = normalizeSubtitleText(text);
  if (!normalized) return [];

  const sentenceUnits = splitByDelimiters(normalized, /[。！？!?；;—]/);
  const clauseUnits = sentenceUnits.flatMap((unit) => splitByDelimiters(unit, /[，、：,:]/));
  const baseUnits = clauseUnits.length > 0 ? clauseUnits : sentenceUnits;

  return (baseUnits.length > 0 ? baseUnits : [normalized])
    .map((unit) => normalizeSubtitleText(unit))
    .filter((unit) => unit && isMeaningfulUnit(unit))
    .flatMap((unit) => (
      getVisualLength(unit) > config.maxVisualLength
        ? splitLongUnit(unit, config.maxVisualLength)
        : [unit]
    ))
    .filter(Boolean);
};

const groupUnits = (units: string[], desiredCount: number): string[][] => {
  if (units.length <= desiredCount) {
    return units.map((unit) => [unit]);
  }

  const groups: string[][] = [];
  const totalVisualLength = units.reduce((sum, unit) => sum + getVisualLength(unit), 0);
  const targetVisualLength = totalVisualLength / desiredCount;
  let currentGroup: string[] = [];
  let currentVisualLength = 0;

  for (let index = 0; index < units.length; index++) {
    const unit = units[index];
    const unitVisualLength = getVisualLength(unit);
    const remainingUnits = units.length - index;
    const remainingSlots = desiredCount - groups.length;

    if (
      currentGroup.length > 0 &&
      remainingSlots > 1 &&
      (currentVisualLength + unitVisualLength > targetVisualLength * 1.18 ||
        remainingUnits === remainingSlots)
    ) {
      groups.push(currentGroup);
      currentGroup = [unit];
      currentVisualLength = unitVisualLength;
    } else {
      currentGroup.push(unit);
      currentVisualLength += unitVisualLength;
    }
  }

  if (currentGroup.length > 0) {
    groups.push(currentGroup);
  }

  while (groups.length > desiredCount) {
    const tail = groups.pop();
    if (!tail) break;
    groups[groups.length - 1] = groups[groups.length - 1].concat(tail);
  }

  return groups;
};

const segmentCue = (cue: SubtitleCue, config: SubtitleSegmentationConfig): SubtitleCue[] => {
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
  const desiredCount = Math.max(
    1,
    Math.min(Math.max(desiredByDuration, desiredByLength), maxSegmentsByDuration, units.length)
  );

  const groupedUnits = groupUnits(units, desiredCount);
  if (groupedUnits.length <= 1) {
    return [{ ...cue, text: normalizedText }];
  }

  const weights = groupedUnits.map((group) =>
    Math.max(1, group.reduce((sum, unit) => sum + getVisualLength(unit), 0))
  );
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);

  let cursor = cue.start;
  let consumedWeight = 0;

  return groupedUnits.map((group, index) => {
    const text = normalizeSubtitleText(group.join(''));
    consumedWeight += weights[index];
    const end = index === groupedUnits.length - 1
      ? cue.end
      : cue.start + (duration * consumedWeight) / totalWeight;

    const segmentedCue = {
      start: cursor,
      end,
      text,
    };

    cursor = end;
    return segmentedCue;
  });
};

export const parseSRT = (
  content: string,
  segmentationConfig: SubtitleSegmentationConfig = DEFAULT_SEGMENTATION_CONFIG
): SubtitleCue[] => {
  const cues: SubtitleCue[] = [];
  const blocks = content.trim().split(/\n\n+/);

  for (const block of blocks) {
    const lines = block.split('\n');
    if (lines.length < 3) continue;

    const timeLine = lines[1];
    const text = lines.slice(2).join(' ').replace(/<[^>]+>/g, '');

    const timeMatch = timeLine.match(/(\d{2}:\d{2}:\d{2},\d{3})\s+-->\s+(\d{2}:\d{2}:\d{2},\d{3})/);
    if (!timeMatch) continue;

    const parseTime = (t: string) => {
      const [h, m, s, ms] = t.replace(',', ':').split(':').map(Number);
      return h * 3600 + m * 60 + s + ms / 1000;
    };

    cues.push(...segmentCue({
      start: parseTime(timeMatch[1]),
      end: parseTime(timeMatch[2]),
      text: text.trim(),
    }, segmentationConfig));
  }

  return cues;
};

export const useSubtitles = (srtPath: string): SubtitleCue[] => {
  return useMemo(() => {
    // 浏览器端渲染时，字幕应通过 props 传入；此 fallback 仅用于本地预览/开发
    if (typeof window !== 'undefined') {
      return [];
    }

    try {
      const fs = require('fs');
      const path = require('path');
      const segmentationConfig = readSegmentationConfigFromProps();
      const content = fs.readFileSync(
        path.join(process.cwd(), 'public', srtPath),
        'utf-8'
      );
      return parseSRT(content, segmentationConfig);
    } catch (error) {
      console.warn('Failed to load subtitles from fs:', error);
      return [];
    }
  }, [srtPath]);
};

import { useMemo } from 'react';
// 分段/断行逻辑的唯一数据源：scripts/lib/subtitle_segmentation.js
// （与 scripts/parse_srt.js、src/utils/keywordMatcher.ts 共用，禁止内联副本）
import {
  segmentCue,
  SubtitleSegmentationConfig,
} from '../../scripts/lib/subtitle_segmentation';

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

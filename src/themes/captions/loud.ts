import type { CaptionDna } from './types';

const FONT_FAMILY = '"Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif';

/**
 * loud：短视频口播标杆（Hormozi 式）。
 * 逐词 pop 入场、当前词变色放大、hero 全屏冲击入场 + 呼吸保持。
 * 动效语义移植自 embedded-captions 的 loud DNA（percussion 家族）。
 */
export const LOUD_DNA: CaptionDna = {
  id: 'loud',
  label: '冲击力逐词',
  wordReveal: 'pop',
  fontFamily: FONT_FAMILY,
  fontWeight: 900,
  heroFontWeight: 900,
  colors: {
    text: '#ffffff',
    accent: '#00e6c3',
    heroText: '#ffffff',
    cardBackground: 'rgba(10,10,18,0.88)',
    cardBorder: 'rgba(255,255,255,0.14)',
  },
  motion: {
    wordInSeconds: 0.16,
    fromScale: 1.3,
    fromY: 16,
    fromX: 0,
    currentScale: 1.15,
    currentGlow: 0.6,
  },
  hero: {
    fontSize: 150,
    entrance: 'pop',
    entranceSeconds: 0.35,
    exitSeconds: 0.25,
    holdSeconds: 0.6,
    dimOpacity: 0.12,
    scrimOpacity: 0.5,
    breathe: 0.025,
    glow: 0.5,
    fromScale: 1.6,
    fromY: 0,
  },
};

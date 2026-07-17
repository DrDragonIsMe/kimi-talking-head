import type { CaptionDna } from './types';

const FONT_FAMILY = '"Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif';

/**
 * cream：暖奶油——诗意默认款。
 * 暖白字 + 金色强调，柔和的凝聚入场（轻缩放 + 短位移 + 辉光）。
 * 动效语义移植自 embedded-captions 的 cream DNA（light condenses 家族）。
 */
export const CREAM_DNA: CaptionDna = {
  id: 'cream',
  label: '暖奶油诗意',
  wordReveal: 'pop',
  fontFamily: FONT_FAMILY,
  fontWeight: 700,
  heroFontWeight: 900,
  colors: {
    text: '#fff5df',
    accent: '#e3c06a',
    heroText: '#fff5df',
    cardBackground: 'rgba(24,18,10,0.85)',
    cardBorder: 'rgba(255,245,223,0.16)',
  },
  motion: {
    wordInSeconds: 0.3,
    fromScale: 1.03,
    fromY: 12,
    fromX: 0,
    currentScale: 1.06,
    currentGlow: 0.3,
  },
  hero: {
    fontSize: 140,
    entrance: 'pop',
    entranceSeconds: 0.45,
    exitSeconds: 0.4,
    holdSeconds: 0.7,
    dimOpacity: 0.45,
    scrimOpacity: 0.42,
    breathe: 0.012,
    glow: 0.3,
    fromScale: 1.12,
    fromY: 10,
  },
};

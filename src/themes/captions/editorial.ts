import type { CaptionDna } from './types';

// 源 DNA 用 Bodoni Moda；离线环境用系统宋体系回退，保留衬线语感
const SERIF_FAMILY = '"Songti SC", "STSong", "Noto Serif SC", "SimSun", serif';

/**
 * editorial：杂志衬线——优雅大于呐喊。
 * 衬线体、x 向滑入、hero 斜体呈现。
 * 动效语义移植自 embedded-captions 的 editorial DNA（the pen glides 家族）。
 */
export const EDITORIAL_DNA: CaptionDna = {
  id: 'editorial',
  label: '杂志衬线',
  wordReveal: 'pop',
  fontFamily: SERIF_FAMILY,
  fontWeight: 700,
  heroFontWeight: 700,
  heroFontStyle: 'italic',
  colors: {
    text: '#f2ead8',
    accent: '#c9a36a',
    heroText: '#f2ead8',
    cardBackground: 'rgba(20,16,12,0.85)',
    cardBorder: 'rgba(242,234,216,0.14)',
  },
  motion: {
    wordInSeconds: 0.34,
    fromScale: 1,
    fromY: 0,
    fromX: -10,
    currentScale: 1.04,
    currentGlow: 0.18,
  },
  hero: {
    fontSize: 136,
    entrance: 'pop',
    entranceSeconds: 0.5,
    exitSeconds: 0.4,
    holdSeconds: 0.7,
    dimOpacity: 0.5,
    scrimOpacity: 0.4,
    breathe: 0.01,
    glow: 0.18,
    fromScale: 1.05,
    fromY: 0,
  },
};

import type { CaptionDna } from './types';

const FONT_FAMILY = '"Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif';

/**
 * documentary：纪实庄重——静止即风格。
 * burn 式出现（无动效）、无强调色、无辉光、克制的 hero。
 * 动效语义移植自 embedded-captions 的 documentary DNA（burn and hold 家族）。
 */
export const DOCUMENTARY_DNA: CaptionDna = {
  id: 'documentary',
  label: '纪实庄重',
  wordReveal: 'burn',
  fontFamily: FONT_FAMILY,
  fontWeight: 700,
  heroFontWeight: 700,
  colors: {
    text: '#F5EFE6',
    accent: '#F5EFE6',
    heroText: '#F5EFE6',
    cardBackground: 'rgba(12,12,14,0.88)',
    cardBorder: 'rgba(245,239,230,0.10)',
  },
  motion: {
    wordInSeconds: 0.12,
    fromScale: 1,
    fromY: 0,
    fromX: 0,
    currentScale: 1,
    currentGlow: 0,
  },
  hero: {
    fontSize: 96,
    entrance: 'pop',
    entranceSeconds: 0.25,
    exitSeconds: 0.2,
    holdSeconds: 0.5,
    dimOpacity: 0.3,
    scrimOpacity: 0.5,
    breathe: 0,
    glow: 0,
    fromScale: 1,
    fromY: 24,
  },
};

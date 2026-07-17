import type { CaptionDna } from './types';

const FONT_FAMILY = '"Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif';

/**
 * keynote：发布式自信（Apple keynote 式）。
 * 少字大字、wipe 揭示、hero wipe-up；自信来自静止，不加呼吸/辉光。
 * 动效语义移植自 embedded-captions 的 keynote DNA（surgical reveal 家族）。
 */
export const KEYNOTE_DNA: CaptionDna = {
  id: 'keynote',
  label: '发布式揭示',
  wordReveal: 'wipe',
  fontFamily: FONT_FAMILY,
  fontWeight: 800,
  heroFontWeight: 900,
  colors: {
    text: '#ffffff',
    accent: '#8ab4ff',
    heroText: '#ffffff',
    cardBackground: 'rgba(10,10,18,0.82)',
    cardBorder: 'rgba(255,255,255,0.10)',
  },
  motion: {
    wordInSeconds: 0.3,
    fromScale: 1,
    fromY: 0,
    currentScale: 1.06,
    currentGlow: 0,
  },
  hero: {
    fontSize: 132,
    entrance: 'wipe-up',
    entranceSeconds: 0.4,
    exitSeconds: 0.3,
    holdSeconds: 0.8,
    dimOpacity: 0.2,
    scrimOpacity: 0.55,
    breathe: 0,
    glow: 0,
  },
};

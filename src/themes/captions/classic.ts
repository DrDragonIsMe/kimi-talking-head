import type { CaptionDna } from './types';

const FONT_FAMILY = '"Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif';

/**
 * classic：默认 DNA，保持现有整句卡片渲染（Subtitles.tsx 旧路径）。
 * wordReveal 为 none 时不会进入 karaoke 渲染，这里的数值仅作占位。
 */
export const CLASSIC_DNA: CaptionDna = {
  id: 'classic',
  label: '经典卡片',
  wordReveal: 'none',
  fontFamily: FONT_FAMILY,
  fontWeight: 900,
  heroFontWeight: 900,
  colors: {
    text: '#151A19',
    accent: '#00b498',
    heroText: '#151A19',
    cardBackground: '#FAFAF7',
    cardBorder: 'rgba(21,26,25,0.08)',
  },
  motion: {
    wordInSeconds: 0,
    fromScale: 1,
    fromY: 0,
    currentScale: 1,
    currentGlow: 0,
  },
  hero: {
    fontSize: 120,
    entrance: 'pop',
    entranceSeconds: 0.3,
    exitSeconds: 0.25,
    holdSeconds: 0.5,
    dimOpacity: 0.15,
    scrimOpacity: 0.4,
    breathe: 0,
    glow: 0,
  },
};

export type VideoTemplate = 'editorial' | 'product-launch';

export interface ThemeColors {
  primary: string;
  secondary: string;
  background: string;
  backgroundGradient: [string, string];
  glow: string;
  text: string;
  textMuted: string;
  surface: string;
  surfaceStrong: string;
  border: string;
}

export interface ThemeTypography {
  fontFamily: string;
  title: {
    large: number;
    medium: number;
    small: number;
  };
  subtitle: number;
  body: number;
  label: number;
}

export interface ThemeAnimation {
  titleCardDurationFrames: number;
  fadeInFrames: number;
  slideInFrames: number;
  easing: 'cubic' | 'linear';
}

export interface ThemeLayout {
  titleCard: 'hero-image' | 'centered' | 'split';
  hostPosition: 'bottom-center' | 'bottom-right' | 'left-strip' | 'fullscreen-carousel';
  subtitleVariant: 'bottom-large' | 'dynamic-typing' | 'centered';
  sellingPointVariant: 'pills' | 'numbered-cards' | 'list' | 'hero-words';
  endcardCtaVariant: 'big-button' | 'qr-code' | 'screenshot' | 'text-only';
}

export interface ThemeConfig {
  id: VideoTemplate;
  label: string;
  colors: ThemeColors;
  typography: ThemeTypography;
  animation: ThemeAnimation;
  layout: ThemeLayout;
}

const FONT_FAMILY = '"Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif';

export const EDITORIAL_THEME: ThemeConfig = {
  id: 'editorial',
  label: '财经口播',
  colors: {
    primary: '#00b498',
    secondary: '#00d4c8',
    background: '#FAFAF7',
    backgroundGradient: ['#FAFAF7', '#f4f4f0'],
    glow: '#00b49818',
    text: '#151A19',
    textMuted: 'rgba(21,26,25,0.62)',
    surface: '#EDF1F0',
    surfaceStrong: '#E3E9E7',
    border: 'rgba(21,26,25,0.08)',
  },
  typography: {
    fontFamily: FONT_FAMILY,
    title: { large: 88, medium: 76, small: 64 },
    subtitle: 30,
    body: 24,
    label: 16,
  },
  animation: {
    titleCardDurationFrames: 60,
    fadeInFrames: 16,
    slideInFrames: 22,
    easing: 'cubic',
  },
  layout: {
    titleCard: 'split',
    hostPosition: 'bottom-center',
    subtitleVariant: 'bottom-large',
    sellingPointVariant: 'pills',
    endcardCtaVariant: 'big-button',
  },
};

export const PRODUCT_LAUNCH_THEME: ThemeConfig = {
  id: 'product-launch',
  label: '产品发布',
  colors: {
    primary: '#00b498',
    secondary: '#00d4c8',
    background: '#FAFAF7',
    backgroundGradient: ['#FAFAF7', '#E8F7F4'],
    glow: '#00b49822',
    text: '#151A19',
    textMuted: 'rgba(21,26,25,0.60)',
    surface: 'rgba(255,255,255,0.82)',
    surfaceStrong: '#E3F5F1',
    border: 'rgba(21,26,25,0.08)',
  },
  typography: {
    fontFamily: FONT_FAMILY,
    title: { large: 88, medium: 72, small: 60 },
    subtitle: 32,
    body: 26,
    label: 18,
  },
  animation: {
    titleCardDurationFrames: 60,
    fadeInFrames: 18,
    slideInFrames: 24,
    easing: 'cubic',
  },
  layout: {
    titleCard: 'hero-image',
    hostPosition: 'fullscreen-carousel',
    subtitleVariant: 'dynamic-typing',
    sellingPointVariant: 'numbered-cards',
    endcardCtaVariant: 'big-button',
  },
};

export const THEMES: Record<VideoTemplate, ThemeConfig> = {
  editorial: EDITORIAL_THEME,
  'product-launch': PRODUCT_LAUNCH_THEME,
};

export function getTheme(template: VideoTemplate | undefined, overrides?: Partial<ThemeConfig>): ThemeConfig {
  const base = THEMES[template ?? 'editorial'] ?? EDITORIAL_THEME;
  if (!overrides) return base;
  return {
    ...base,
    ...overrides,
    colors: { ...base.colors, ...overrides.colors },
    typography: { ...base.typography, ...overrides.typography },
    animation: { ...base.animation, ...overrides.animation },
    layout: { ...base.layout, ...overrides.layout },
  };
}

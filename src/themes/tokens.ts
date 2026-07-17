/**
 * 设计 tokens：全组件统一的暗色、层级与网格基准。
 * 规则来源：impeccable 反 AI-slop 清单（不用纯黑、4px 网格、层级有序）。
 */

/** 统一暗色 tint——所有阴影/压暗/深色卡片用它，不用纯黑 rgba(0,0,0,…) */
export const INK_RGB = '10,10,18';
export const inkAlpha = (alpha: number): string => `rgba(${INK_RGB},${alpha})`;

/** 层级尺度：显性定义，避免再次出现字幕被卡片遮挡类事故 */
export const Z = {
  background: 0,
  breadcrumb: 10,
  cards: 12,
  captions: 20,
  hero: 20,
} as const;

/** 4px 间距网格 */
export const space = (n: number): number => n * 4;

/** 圆角尺度（4px 网格对齐） */
export const radius = {
  sm: 12,
  md: 16,
  lg: 24,
  pill: 999,
} as const;

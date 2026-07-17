export type WordRevealMode = 'none' | 'pop' | 'wipe';
export type HeroEntrance = 'pop' | 'wipe-up';

export interface CaptionDnaColors {
  /** 已说出词的颜色 */
  text: string;
  /** 当前词（正在说）强调色 */
  accent: string;
  /** hero 大字颜色 */
  heroText: string;
  cardBackground: string;
  cardBorder: string;
}

export interface CaptionDnaMotion {
  /** 单词入场时长（秒） */
  wordInSeconds: number;
  /** 入场起始缩放（1 = 无缩放） */
  fromScale: number;
  /** 入场起始纵向位移 px */
  fromY: number;
  /** 当前词放大倍数 */
  currentScale: number;
  /** 当前词辉光强度 0-1 */
  currentGlow: number;
}

export interface CaptionDnaHero {
  fontSize: number;
  entrance: HeroEntrance;
  entranceSeconds: number;
  exitSeconds: number;
  /** hero 结束后额外保持秒数 */
  holdSeconds: number;
  /** hero 期间普通字幕的不透明度 */
  dimOpacity: number;
  /** hero 背景压暗 scrim 不透明度 */
  scrimOpacity: number;
  /** 保持期呼吸幅度（scale 振荡比例，0 = 静止） */
  breathe: number;
  /** hero 辉光强度 0-1 */
  glow: number;
}

export interface CaptionDna {
  id: string;
  label: string;
  wordReveal: WordRevealMode;
  fontFamily: string;
  fontWeight: number;
  heroFontWeight: number;
  colors: CaptionDnaColors;
  motion: CaptionDnaMotion;
  hero: CaptionDnaHero;
}

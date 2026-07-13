export interface OverlayLayoutRegion {
  left: number;
  top: number;
  width: number;
  height?: number;
}

export interface OverlayLayoutPreset {
  hostWindow: OverlayLayoutRegion;
  heroVisual: OverlayLayoutRegion;
  detailVisual: OverlayLayoutRegion;
  subtitles: OverlayLayoutRegion;
  talkingPoints: OverlayLayoutRegion;
  dataBars: OverlayLayoutRegion;
  quoteHighlight: OverlayLayoutRegion;
}

export interface OverlayLayoutConfig {
  sequence: string[];
  holdCues: number;
}

export const DEFAULT_OVERLAY_LAYOUT_CONFIG: OverlayLayoutConfig = {
  sequence: ['editorial-left'],
  holdCues: 2,
};

// 字幕已全局关闭，原字幕区域释放给内容卡片（观点拆解 / 数据条 / 引用高亮）使用。
// subtitles 区域保留但尺寸为 0，避免破坏旧组件的接口契约。
const LAYOUT_PRESETS: Record<string, OverlayLayoutPreset> = {
  // 主视觉在左、细节在右；观点拆解占用原字幕区全宽
  'editorial-left': {
    hostWindow: { left: 64, top: 960, width: 952, height: 820 },
    heroVisual: { left: 64, top: 120, width: 560, height: 500 },
    detailVisual: { left: 652, top: 120, width: 364, height: 500 },
    subtitles: { left: 64, top: 640, width: 0, height: 0 },
    talkingPoints: { left: 64, top: 640, width: 952 },
    dataBars: { left: 64, top: 1020, width: 560 },
    quoteHighlight: { left: 652, top: 1020, width: 364 },
  },
  // 主视觉在右、细节在左
  'editorial-right': {
    hostWindow: { left: 64, top: 960, width: 952, height: 820 },
    heroVisual: { left: 456, top: 120, width: 560, height: 500 },
    detailVisual: { left: 64, top: 120, width: 364, height: 500 },
    subtitles: { left: 64, top: 640, width: 0, height: 0 },
    talkingPoints: { left: 64, top: 640, width: 952 },
    dataBars: { left: 456, top: 1020, width: 560 },
    quoteHighlight: { left: 64, top: 1020, width: 364 },
  },
  // 上下分层：主视觉全宽大图 + 细节条带；观点拆解全宽
  'editorial-balanced': {
    hostWindow: { left: 64, top: 980, width: 952, height: 800 },
    heroVisual: { left: 64, top: 120, width: 952, height: 380 },
    detailVisual: { left: 64, top: 520, width: 952, height: 160 },
    subtitles: { left: 64, top: 700, width: 0, height: 0 },
    talkingPoints: { left: 64, top: 700, width: 952 },
    dataBars: { left: 64, top: 1040, width: 560 },
    quoteHighlight: { left: 652, top: 1040, width: 364 },
  },
  // 兼容旧命名（映射到 editorial-left）
  default: {
    hostWindow: { left: 64, top: 960, width: 952, height: 820 },
    heroVisual: { left: 64, top: 120, width: 560, height: 500 },
    detailVisual: { left: 652, top: 120, width: 364, height: 500 },
    subtitles: { left: 64, top: 640, width: 0, height: 0 },
    talkingPoints: { left: 64, top: 640, width: 952 },
    dataBars: { left: 64, top: 1020, width: 560 },
    quoteHighlight: { left: 652, top: 1020, width: 364 },
  },
  rightHeavy: {
    hostWindow: { left: 64, top: 960, width: 952, height: 820 },
    heroVisual: { left: 456, top: 120, width: 560, height: 500 },
    detailVisual: { left: 64, top: 120, width: 364, height: 500 },
    subtitles: { left: 64, top: 640, width: 0, height: 0 },
    talkingPoints: { left: 64, top: 640, width: 952 },
    dataBars: { left: 456, top: 1020, width: 560 },
    quoteHighlight: { left: 64, top: 1020, width: 364 },
  },
  split: {
    hostWindow: { left: 64, top: 980, width: 952, height: 800 },
    heroVisual: { left: 64, top: 120, width: 952, height: 380 },
    detailVisual: { left: 64, top: 520, width: 952, height: 160 },
    subtitles: { left: 64, top: 700, width: 0, height: 0 },
    talkingPoints: { left: 64, top: 700, width: 952 },
    dataBars: { left: 64, top: 1040, width: 560 },
    quoteHighlight: { left: 652, top: 1040, width: 364 },
  },
};

export function getActiveCueIndex(
  cues: Array<{ start: number; end: number }>,
  currentTime: number
): number {
  return cues.findIndex((cue) => currentTime >= cue.start && currentTime <= cue.end);
}

export function getOverlayLayoutPreset(
  cueIndex: number,
  layout: OverlayLayoutConfig = DEFAULT_OVERLAY_LAYOUT_CONFIG
): OverlayLayoutPreset {
  const { sequence, holdCues } = layout;
  if (!sequence.length) {
    return LAYOUT_PRESETS.default;
  }

  const safeHoldCues = Math.max(1, holdCues);
  const step = Math.max(0, Math.floor(cueIndex / safeHoldCues));
  const key = sequence[step % sequence.length];

  return LAYOUT_PRESETS[key] || LAYOUT_PRESETS.default;
}

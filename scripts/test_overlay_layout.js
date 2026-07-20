#!/usr/bin/env node

/**
 * 叠加布局预设测试。
 *
 * 覆盖：
 * 1. getActiveCueIndex — 字幕 cue 定位
 * 2. getOverlayLayoutPreset — 序列轮换、holdCues 步进
 *
 * 运行：node scripts/test_overlay_layout.js
 */

const assert = require('assert');

// 内联副本（来自 src/utils/overlayLayout.ts）
const getActiveCueIndex = (cues, currentTime) => {
  return cues.findIndex((cue) => currentTime >= cue.start && currentTime <= cue.end);
};

const LAYOUT_PRESETS = {
  'editorial-left': {
    hostWindow: { left: 64, top: 960, width: 952, height: 820 },
    heroVisual: { left: 64, top: 120, width: 560, height: 500 },
    detailVisual: { left: 652, top: 120, width: 364, height: 500 },
    subtitles: { left: 64, top: 640, width: 0, height: 0 },
    talkingPoints: { left: 64, top: 640, width: 952 },
    dataBars: { left: 64, top: 1020, width: 560 },
    quoteHighlight: { left: 652, top: 1020, width: 364 },
  },
  'editorial-right': {
    hostWindow: { left: 64, top: 960, width: 952, height: 820 },
    heroVisual: { left: 456, top: 120, width: 560, height: 500 },
    detailVisual: { left: 64, top: 120, width: 364, height: 500 },
    subtitles: { left: 64, top: 640, width: 0, height: 0 },
    talkingPoints: { left: 64, top: 640, width: 952 },
    dataBars: { left: 456, top: 1020, width: 560 },
    quoteHighlight: { left: 64, top: 1020, width: 364 },
  },
  'editorial-balanced': {
    hostWindow: { left: 64, top: 980, width: 952, height: 800 },
    heroVisual: { left: 64, top: 120, width: 952, height: 380 },
    detailVisual: { left: 64, top: 520, width: 952, height: 160 },
    subtitles: { left: 64, top: 700, width: 0, height: 0 },
    talkingPoints: { left: 64, top: 700, width: 952 },
    dataBars: { left: 64, top: 1040, width: 560 },
    quoteHighlight: { left: 652, top: 1040, width: 364 },
  },
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

const DEFAULT_OVERLAY_LAYOUT_CONFIG = {
  sequence: ['editorial-left'],
  holdCues: 2,
};

const getOverlayLayoutPreset = (cueIndex, layout) => {
  const cfg = layout || DEFAULT_OVERLAY_LAYOUT_CONFIG;
  const { sequence, holdCues } = cfg;
  if (!sequence.length) {
    return LAYOUT_PRESETS.default;
  }
  const safeHoldCues = Math.max(1, holdCues);
  const step = Math.max(0, Math.floor(cueIndex / safeHoldCues));
  const key = sequence[step % sequence.length];
  return LAYOUT_PRESETS[key] || LAYOUT_PRESETS.default;
};

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

const test = (name, fn) => {
  try {
    fn();
    passed += 1;
    console.log(`✅ ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`❌ ${name}: ${error.message}`);
  }
};

// ---------------------------------------------------------------------------
// 1. getActiveCueIndex（已在 sync_timing 中覆盖，这里补充边界）
// ---------------------------------------------------------------------------

test('单个 cue 末尾边界命中', () => {
  const cues = [{ start: 0, end: 5, text: 'test' }];
  assert.strictEqual(getActiveCueIndex(cues, 5), 0);
});

test('单个 cue 超出后返回 -1', () => {
  const cues = [{ start: 0, end: 5, text: 'test' }];
  assert.strictEqual(getActiveCueIndex(cues, 5.1), -1);
});

test('两 cue 共享边界：第一个命中', () => {
  const cues = [
    { start: 0, end: 2, text: 'a' },
    { start: 2, end: 4, text: 'b' },
  ];
  assert.strictEqual(getActiveCueIndex(cues, 2), 0);
});

// ---------------------------------------------------------------------------
// 2. getOverlayLayoutPreset — 默认配置
// ---------------------------------------------------------------------------

test('默认配置：cueIndex=0 返回 editorial-left', () => {
  const preset = getOverlayLayoutPreset(0);
  assert.strictEqual(preset.hostWindow.left, 64);
  assert.strictEqual(preset.hostWindow.top, 960);
});

test('默认配置：holdCues=2 时 cueIndex=0,1 返回相同预设', () => {
  const p0 = getOverlayLayoutPreset(0);
  const p1 = getOverlayLayoutPreset(1);
  assert.deepStrictEqual(p0, p1);
});

test('默认配置：holdCues=2 时 cueIndex=2 切换预设', () => {
  const p0 = getOverlayLayoutPreset(0);
  const p2 = getOverlayLayoutPreset(2);
  // 默认只有单个序列元素，切换后还是同一个
  assert.deepStrictEqual(p0, p2);
});

// ---------------------------------------------------------------------------
// 3. getOverlayLayoutPreset — 自定义序列
// ---------------------------------------------------------------------------

test('多序列：holdCues=1 时每个 cue 切换', () => {
  const layout = { sequence: ['editorial-left', 'editorial-right', 'editorial-balanced'], holdCues: 1 };
  const p0 = getOverlayLayoutPreset(0, layout);
  const p1 = getOverlayLayoutPreset(1, layout);
  const p2 = getOverlayLayoutPreset(2, layout);
  const p3 = getOverlayLayoutPreset(3, layout);

  assert.strictEqual(p0.hostWindow.left, 64); // editorial-left
  assert.strictEqual(p1.heroVisual.left, 456); // editorial-right
  assert.strictEqual(p2.heroVisual.width, 952); // editorial-balanced
  // 轮换回 editorial-left
  assert.strictEqual(p3.hostWindow.left, 64);
});

test('多序列：holdCues=3 时每 3 个 cue 切换', () => {
  const layout = { sequence: ['editorial-left', 'editorial-right'], holdCues: 3 };
  const p0 = getOverlayLayoutPreset(0, layout);
  const p1 = getOverlayLayoutPreset(1, layout);
  const p2 = getOverlayLayoutPreset(2, layout);
  const p3 = getOverlayLayoutPreset(3, layout);

  // cueIndex 0,1,2 都应是 editorial-left
  assert.deepStrictEqual(p0, p1);
  assert.deepStrictEqual(p1, p2);
  // cueIndex 3 切换到 editorial-right
  assert.strictEqual(p3.heroVisual.left, 456);
});

test('holdCues=0 时 clamp 到 1', () => {
  const layout = { sequence: ['editorial-left', 'editorial-right'], holdCues: 0 };
  const p0 = getOverlayLayoutPreset(0, layout);
  const p1 = getOverlayLayoutPreset(1, layout);
  // holdCues=0 被 clamp 到 1，每 cue 切换
  assert.notDeepStrictEqual(p0, p1);
});

test('holdCues 负数时 clamp 到 1', () => {
  const layout = { sequence: ['editorial-left', 'editorial-right'], holdCues: -5 };
  const p0 = getOverlayLayoutPreset(0, layout);
  const p1 = getOverlayLayoutPreset(1, layout);
  assert.notDeepStrictEqual(p0, p1);
});

test('空序列回退到默认预设', () => {
  const layout = { sequence: [], holdCues: 2 };
  const preset = getOverlayLayoutPreset(5, layout);
  assert.strictEqual(preset.hostWindow.left, 64);
});

test('未知 key 回退到默认预设', () => {
  const layout = { sequence: ['nonexistent-key'], holdCues: 2 };
  const preset = getOverlayLayoutPreset(0, layout);
  assert.strictEqual(preset.hostWindow.left, 64);
});

test('cueIndex 负数：step=0，取第一个', () => {
  const layout = { sequence: ['editorial-right'], holdCues: 2 };
  const preset = getOverlayLayoutPreset(-1, layout);
  assert.strictEqual(preset.heroVisual.left, 456);
});

test('兼容旧命名：rightHeavy / split', () => {
  const layout = { sequence: ['rightHeavy', 'split'], holdCues: 1 };
  const p0 = getOverlayLayoutPreset(0, layout);
  const p1 = getOverlayLayoutPreset(1, layout);
  assert.strictEqual(p0.heroVisual.left, 456); // rightHeavy
  assert.strictEqual(p1.heroVisual.width, 952); // split
});

test('default 预设名映射到 editorial-left', () => {
  const layout = { sequence: ['default'], holdCues: 2 };
  const preset = getOverlayLayoutPreset(0, layout);
  assert.strictEqual(preset.hostWindow.left, 64);
});

// ---------------------------------------------------------------------------
// 4. 预设结构完整性
// ---------------------------------------------------------------------------

test('所有预设包含必需字段', () => {
  const requiredKeys = ['hostWindow', 'heroVisual', 'detailVisual', 'subtitles', 'talkingPoints', 'dataBars', 'quoteHighlight'];
  const regionKeys = ['left', 'top', 'width'];
  for (const [name, preset] of Object.entries(LAYOUT_PRESETS)) {
    for (const key of requiredKeys) {
      assert.ok(preset[key], `预设 ${name} 缺少 ${key}`);
      for (const rk of regionKeys) {
        assert.ok(typeof preset[key][rk] === 'number', `预设 ${name}.${key}.${rk} 必须是数字，得到 ${preset[key][rk]}`);
      }
    }
  }
});

test('subtitles 区域尺寸为 0（已全局关闭）', () => {
  for (const [name, preset] of Object.entries(LAYOUT_PRESETS)) {
    assert.strictEqual(preset.subtitles.width, 0, `预设 ${name} 的 subtitles width 应为 0`);
    assert.strictEqual(preset.subtitles.height, 0, `预设 ${name} 的 subtitles height 应为 0`);
  }
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${passed} 通过, ${failed} 失败`);
if (failed > 0) process.exit(1);
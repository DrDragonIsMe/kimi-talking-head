#!/usr/bin/env node

/**
 * 场景运动与转场确定性测试。
 *
 * 覆盖：
 * 1. getSceneWindow — 场景定位、交叉淡化窗口、边界处理
 * 2. getKenBurnsTransform — 四种运动模式确定性、边界值
 * 3. getSceneTransition — 三种转场轮换、index=1 固定 fade
 *
 * 运行：node scripts/test_scene_motion.js
 */

const assert = require('assert');
const path = require('path');

// 直接 require 源码（TypeScript → 运行时已无类型，直接读编译或使用内联）
// 这些函数是纯函数，从 src/utils/sceneMotion.ts 内联复制
const CROSSFADE_SECONDS = 0.45;

const clamp01 = (value) => Math.min(1, Math.max(0, value));

const getSceneWindow = (scenes, currentTime) => {
  if (!scenes || scenes.length === 0) {
    return { index: -1, current: null, previous: null, crossfadeProgress: 1, sceneProgress: 0 };
  }

  let index = scenes.findIndex((scene) => currentTime >= scene.start && currentTime < scene.end);
  if (index === -1) {
    index = scenes.length - 1;
  }

  const current = scenes[index];
  const duration = Math.max(0.1, current.end - current.start);
  const sceneProgress = clamp01((currentTime - current.start) / duration);

  const inCrossfade = index > 0 && currentTime - current.start < CROSSFADE_SECONDS;
  if (inCrossfade) {
    const crossfadeProgress = clamp01((currentTime - current.start) / CROSSFADE_SECONDS);
    return { index, current, previous: scenes[index - 1], crossfadeProgress, sceneProgress };
  }

  return { index, current, previous: null, crossfadeProgress: 1, sceneProgress };
};

const getKenBurnsTransform = (sceneIndex, progress) => {
  const p = clamp01(progress);
  const mode = ((sceneIndex % 4) + 4) % 4;

  switch (mode) {
    case 0: return { scale: 1.0 + 0.09 * p, translateX: 0, translateY: 0 };
    case 1: return { scale: 1.09 - 0.09 * p, translateX: 0, translateY: 0 };
    case 2: return { scale: 1.06, translateX: -1.5 + 3 * p, translateY: 0 };
    default: return { scale: 1.06, translateX: 1.5 - 3 * p, translateY: 0 };
  }
};

const TRANSITION_ROTATION = ['fade', 'wipe-left', 'zoom'];

const getSceneTransition = (sceneIndex) => {
  if (sceneIndex <= 0) return 'fade';
  return TRANSITION_ROTATION[(sceneIndex - 1) % TRANSITION_ROTATION.length];
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
// 1. getSceneWindow
// ---------------------------------------------------------------------------

test('空场景数组返回 safe default', () => {
  const w = getSceneWindow([], 5);
  assert.strictEqual(w.index, -1);
  assert.strictEqual(w.current, null);
  assert.strictEqual(w.previous, null);
  assert.strictEqual(w.crossfadeProgress, 1);
  assert.strictEqual(w.sceneProgress, 0);
});

test('null/undefined 场景数组返回 safe default', () => {
  const w = getSceneWindow(null, 5);
  assert.strictEqual(w.index, -1);
  assert.strictEqual(w.current, null);
});

test('单个场景：全程命中', () => {
  const scenes = [{ start: 0, end: 10, path: 'a.png' }];
  const w = getSceneWindow(scenes, 3);
  assert.strictEqual(w.index, 0);
  assert.strictEqual(w.current.path, 'a.png');
  assert.strictEqual(w.previous, null);
  assert.strictEqual(w.crossfadeProgress, 1);
  assert.ok(Math.abs(w.sceneProgress - 0.3) < 0.001);
});

test('单个场景：超出 end 后停留在最后一个场景', () => {
  const scenes = [{ start: 0, end: 10, path: 'a.png' }];
  const w = getSceneWindow(scenes, 15);
  assert.strictEqual(w.index, 0);
  assert.strictEqual(w.current.path, 'a.png');
});

test('两个场景：边界前命中第一个', () => {
  const scenes = [
    { start: 0, end: 5, path: 'a.png' },
    { start: 5, end: 10, path: 'b.png' },
  ];
  const w = getSceneWindow(scenes, 4.5);
  assert.strictEqual(w.index, 0);
  assert.strictEqual(w.current.path, 'a.png');
});

test('两个场景：边界处命中第二个', () => {
  const scenes = [
    { start: 0, end: 5, path: 'a.png' },
    { start: 5, end: 10, path: 'b.png' },
  ];
  const w = getSceneWindow(scenes, 5);
  assert.strictEqual(w.index, 1);
  assert.strictEqual(w.current.path, 'b.png');
});

test('两个场景：交叉淡化窗口内 previous 非空', () => {
  const scenes = [
    { start: 0, end: 5, path: 'a.png' },
    { start: 5, end: 10, path: 'b.png' },
  ];
  // 5.0 + 0.2s = 5.2s，在 0.45s 交叉淡化窗口内
  const w = getSceneWindow(scenes, 5.2);
  assert.strictEqual(w.index, 1);
  assert.strictEqual(w.current.path, 'b.png');
  assert.strictEqual(w.previous.path, 'a.png');
  assert.ok(w.crossfadeProgress > 0 && w.crossfadeProgress < 1);
});

test('两个场景：交叉淡化窗口外 previous 为 null', () => {
  const scenes = [
    { start: 0, end: 5, path: 'a.png' },
    { start: 5, end: 10, path: 'b.png' },
  ];
  // 5.0 + 0.5s = 5.5s，超出 0.45s 交叉淡化窗口
  const w = getSceneWindow(scenes, 5.5);
  assert.strictEqual(w.index, 1);
  assert.strictEqual(w.current.path, 'b.png');
  assert.strictEqual(w.previous, null);
  assert.strictEqual(w.crossfadeProgress, 1);
});

test('交叉淡化进度：0.1s 时 progress ≈ 0.22', () => {
  const scenes = [
    { start: 0, end: 5, path: 'a.png' },
    { start: 5, end: 10, path: 'b.png' },
  ];
  const w = getSceneWindow(scenes, 5.1);
  assert.ok(Math.abs(w.crossfadeProgress - 0.1 / 0.45) < 0.001);
});

test('交叉淡化进度：结束时 progress = 1', () => {
  const scenes = [
    { start: 0, end: 5, path: 'a.png' },
    { start: 5, end: 10, path: 'b.png' },
  ];
  const w = getSceneWindow(scenes, 5.45);
  assert.strictEqual(w.crossfadeProgress, 1);
});

test('场景进度：sceneProgress 在 0-1 之间', () => {
  const scenes = [
    { start: 0, end: 5, path: 'a.png' },
    { start: 5, end: 10, path: 'b.png' },
  ];
  const w = getSceneWindow(scenes, 2.5);
  assert.ok(Math.abs(w.sceneProgress - 0.5) < 0.001);
});

test('场景进度：末尾时接近 1', () => {
  const scenes = [{ start: 0, end: 10, path: 'a.png' }];
  const w = getSceneWindow(scenes, 9.99);
  assert.ok(w.sceneProgress > 0.99);
});

test('场景进度：超出范围时 clamp 到 1', () => {
  const scenes = [{ start: 0, end: 10, path: 'a.png' }];
  const w = getSceneWindow(scenes, 20);
  assert.strictEqual(w.sceneProgress, 1);
});

test('场景进度：开始前 clamp 到 0', () => {
  const scenes = [{ start: 5, end: 10, path: 'a.png' }];
  const w = getSceneWindow(scenes, 2);
  // findIndex 返回 -1，取最后一个场景，sceneProgress 为 (2-5)/5 = -0.6 → clamp 0
  assert.strictEqual(w.sceneProgress, 0);
});

test('多个场景：第三个场景命中', () => {
  const scenes = [
    { start: 0, end: 3, path: 'a.png' },
    { start: 3, end: 6, path: 'b.png' },
    { start: 6, end: 9, path: 'c.png' },
  ];
  const w = getSceneWindow(scenes, 7.5);
  assert.strictEqual(w.index, 2);
  assert.strictEqual(w.current.path, 'c.png');
});

// ---------------------------------------------------------------------------
// 2. getKenBurnsTransform
// ---------------------------------------------------------------------------

test('模式 0：缓推 scale 从 1.0 到 1.09', () => {
  const t = getKenBurnsTransform(0, 0);
  assert.strictEqual(t.scale, 1.0);
  assert.strictEqual(t.translateX, 0);
  assert.strictEqual(t.translateY, 0);

  const t2 = getKenBurnsTransform(0, 1);
  assert.ok(Math.abs(t2.scale - 1.09) < 0.001);
});

test('模式 1：缓拉 scale 从 1.09 到 1.0', () => {
  const t = getKenBurnsTransform(1, 0);
  assert.ok(Math.abs(t.scale - 1.09) < 0.001);

  const t2 = getKenBurnsTransform(1, 1);
  assert.strictEqual(t2.scale, 1.0);
});

test('模式 2：左→右平移，translateX 从 -1.5 到 1.5', () => {
  const t = getKenBurnsTransform(2, 0);
  assert.strictEqual(t.translateX, -1.5);
  assert.strictEqual(t.scale, 1.06);

  const t2 = getKenBurnsTransform(2, 0.5);
  assert.strictEqual(t2.translateX, 0);

  const t3 = getKenBurnsTransform(2, 1);
  assert.strictEqual(t3.translateX, 1.5);
});

test('模式 3：右→左平移，translateX 从 1.5 到 -1.5', () => {
  const t = getKenBurnsTransform(3, 0);
  assert.strictEqual(t.translateX, 1.5);
  assert.strictEqual(t.scale, 1.06);

  const t2 = getKenBurnsTransform(3, 0.5);
  assert.strictEqual(t2.translateX, 0);

  const t3 = getKenBurnsTransform(3, 1);
  assert.strictEqual(t3.translateX, -1.5);
});

test('模式轮换：index 0→0, 1→1, 2→2, 3→3, 4→0', () => {
  // 验证 pattern 循环
  const t0 = getKenBurnsTransform(0, 0.5);
  const t4 = getKenBurnsTransform(4, 0.5);
  assert.deepStrictEqual(t0, t4);

  const t1 = getKenBurnsTransform(1, 0.5);
  const t5 = getKenBurnsTransform(5, 0.5);
  assert.deepStrictEqual(t1, t5);
});

test('progress 超出范围时 clamp', () => {
  const t = getKenBurnsTransform(0, 2);
  assert.ok(Math.abs(t.scale - 1.09) < 0.001); // clamped to 1

  const t2 = getKenBurnsTransform(0, -1);
  assert.strictEqual(t2.scale, 1.0); // clamped to 0
});

test('负 index 等价于正取模', () => {
  const t = getKenBurnsTransform(-1, 0.5);
  const t3 = getKenBurnsTransform(3, 0.5);
  assert.deepStrictEqual(t, t3);
});

test('确定性：相同输入始终相同输出', () => {
  const t1 = getKenBurnsTransform(7, 0.3);
  const t2 = getKenBurnsTransform(7, 0.3);
  assert.deepStrictEqual(t1, t2);
});

// ---------------------------------------------------------------------------
// 3. getSceneTransition
// ---------------------------------------------------------------------------

test('index=0 返回 fade', () => {
  assert.strictEqual(getSceneTransition(0), 'fade');
});

test('index=1 固定为 fade（视觉回归基线依赖）', () => {
  // 这是硬性约束：注释说 "index=1 固定为 fade，勿改"
  assert.strictEqual(getSceneTransition(1), 'fade');
});

test('index=2 返回 wipe-left', () => {
  assert.strictEqual(getSceneTransition(2), 'wipe-left');
});

test('index=3 返回 zoom', () => {
  assert.strictEqual(getSceneTransition(3), 'zoom');
});

test('index=4 轮换回 fade', () => {
  assert.strictEqual(getSceneTransition(4), 'fade');
});

test('轮换序列：fade, fade, wipe-left, zoom, fade, wipe-left, zoom', () => {
  // index=0→fade (≤0), 1→fade ((1-1)%3=0), 2→wipe-left ((2-1)%3=1),
  // 3→zoom ((3-1)%3=2), 4→fade ((4-1)%3=0), 5→wipe-left ((5-1)%3=1), 6→zoom
  const expected = ['fade', 'fade', 'wipe-left', 'zoom', 'fade', 'wipe-left', 'zoom'];
  for (let i = 0; i < expected.length; i++) {
    assert.strictEqual(getSceneTransition(i), expected[i], `index=${i}`);
  }
});

test('负 index 返回 fade', () => {
  assert.strictEqual(getSceneTransition(-1), 'fade');
  assert.strictEqual(getSceneTransition(-5), 'fade');
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${passed} 通过, ${failed} 失败`);
if (failed > 0) process.exit(1);
#!/usr/bin/env node

/**
 * Hero 状态机测试。
 *
 * 覆盖：
 * 1. computeHeroState — 入场/驻留/退场时间轴
 * 2. 边界：无 hero、hero 前后、进度单调性
 *
 * 运行：node scripts/test_hero_state.js
 */

const assert = require('assert');

// 内联副本（来自 src/components/HeroOverlay.tsx）
const HERO_PRE_ROLL_SECONDS = 0.12;

const computeHeroState = (hero, currentTime, heroDna) => {
  if (!hero) {
    return { progress: 0, exit: 0, visible: false };
  }
  const entranceStart = hero.start - HERO_PRE_ROLL_SECONDS;
  const entranceEnd = hero.start + heroDna.entranceSeconds;
  const exitStart = hero.end + heroDna.holdSeconds;
  const exitEnd = exitStart + heroDna.exitSeconds;
  const visible = currentTime >= entranceStart && currentTime <= exitEnd;
  if (!visible) {
    return { progress: 0, exit: 0, visible: false };
  }
  // 简化版 interpolate（去除 easing，仅验证边界逻辑）
  const progress = Math.max(0, Math.min(1, (currentTime - entranceStart) / (entranceEnd - entranceStart)));
  const exit = Math.max(0, Math.min(1, (currentTime - exitStart) / (exitEnd - exitStart)));
  return { visible: true, progress, exit };
};

// 典型 DNA 参数
const heroDna = {
  fontSize: 88,
  entrance: 'pop',
  entranceSeconds: 0.35,
  exitSeconds: 0.25,
  holdSeconds: 0.5,
  dimOpacity: 0.3,
  scrimOpacity: 0.6,
  breathe: 0.02,
  glow: 0.8,
  fromScale: 0.6,
  fromY: 70,
};

const hero = { start: 5.0, end: 7.0, text: '数字员工' };

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
// 1. 无 hero 时返回不可见
// ---------------------------------------------------------------------------

test('null hero 返回不可见', () => {
  const state = computeHeroState(null, 5, heroDna);
  assert.strictEqual(state.visible, false);
  assert.strictEqual(state.progress, 0);
  assert.strictEqual(state.exit, 0);
});

// ---------------------------------------------------------------------------
// 2. hero 之前不可见
// ---------------------------------------------------------------------------

test('hero 开始前 1 秒：不可见', () => {
  const state = computeHeroState(hero, 3.0, heroDna);
  assert.strictEqual(state.visible, false);
});

test('pre-roll 开始前：不可见', () => {
  // entranceStart = 5.0 - 0.12 = 4.88
  const state = computeHeroState(hero, 4.8, heroDna);
  assert.strictEqual(state.visible, false);
});

// ---------------------------------------------------------------------------
// 3. pre-roll 期间可见但 progress=0
// ---------------------------------------------------------------------------

test('pre-roll 开始时：可见, progress=0', () => {
  // entranceStart = 4.88
  const state = computeHeroState(hero, 4.88, heroDna);
  assert.strictEqual(state.visible, true);
  assert.strictEqual(state.progress, 0);
  assert.strictEqual(state.exit, 0);
});

test('hero.start 时刻：progress≈0.255', () => {
  // entranceStart=4.88, entranceEnd=5.35, t=5.0 → (5.0-4.88)/(5.35-4.88) = 0.12/0.47 ≈ 0.255
  const state = computeHeroState(hero, 5.0, heroDna);
  assert.strictEqual(state.visible, true);
  assert.ok(Math.abs(state.progress - 0.12 / 0.47) < 0.01);
});

// ---------------------------------------------------------------------------
// 4. 入场完成（progress=1）
// ---------------------------------------------------------------------------

test('入场完成时：progress=1, exit=0', () => {
  // entranceEnd = 5.35
  const state = computeHeroState(hero, 5.35, heroDna);
  assert.strictEqual(state.visible, true);
  assert.strictEqual(state.progress, 1);
  assert.strictEqual(state.exit, 0);
});

// ---------------------------------------------------------------------------
// 5. 驻留期间 progress=1, exit=0
// ---------------------------------------------------------------------------

test('驻留期间：progress=1, exit=0', () => {
  // 5.35 到 7.0+0.5=7.5 之间的某时刻
  const state = computeHeroState(hero, 6.5, heroDna);
  assert.strictEqual(state.visible, true);
  assert.strictEqual(state.progress, 1);
  assert.strictEqual(state.exit, 0);
});

// ---------------------------------------------------------------------------
// 6. 退场期间
// ---------------------------------------------------------------------------

test('退场开始时：exit=0', () => {
  // exitStart = 7.0 + 0.5 = 7.5
  const state = computeHeroState(hero, 7.5, heroDna);
  assert.strictEqual(state.visible, true);
  assert.strictEqual(state.progress, 1);
  assert.strictEqual(state.exit, 0);
});

test('退场中：exit≈0.5', () => {
  // exitEnd = 7.5 + 0.25 = 7.75
  const state = computeHeroState(hero, 7.625, heroDna);
  assert.strictEqual(state.visible, true);
  assert.strictEqual(state.progress, 1);
  assert.ok(Math.abs(state.exit - 0.5) < 0.01);
});

test('退场完成时：exit=1', () => {
  const state = computeHeroState(hero, 7.75, heroDna);
  assert.strictEqual(state.visible, true);
  assert.strictEqual(state.progress, 1);
  assert.strictEqual(state.exit, 1);
});

// ---------------------------------------------------------------------------
// 7. hero 之后不可见
// ---------------------------------------------------------------------------

test('hero 完全结束后：不可见', () => {
  const state = computeHeroState(hero, 8.0, heroDna);
  assert.strictEqual(state.visible, false);
});

// ---------------------------------------------------------------------------
// 8. 进度单调性
// ---------------------------------------------------------------------------

test('入场期间 progress 单调递增', () => {
  let prev = -1;
  for (let t = 4.8; t <= 5.4; t += 0.01) {
    const state = computeHeroState(hero, t, heroDna);
    if (state.progress < prev) {
      assert.fail(`progress 回退: t=${t.toFixed(2)}, prev=${prev.toFixed(3)}, cur=${state.progress.toFixed(3)}`);
    }
    prev = state.progress;
  }
  assert.ok(true); // 未触发回退断言
});

test('退场期间 exit 单调递增', () => {
  let prev = -1;
  for (let t = 7.5; t <= 7.75; t += 0.01) {
    const state = computeHeroState(hero, t, heroDna);
    if (state.exit < prev) {
      assert.fail(`exit 回退: t=${t.toFixed(2)}, prev=${prev.toFixed(3)}, cur=${state.exit.toFixed(3)}`);
    }
    prev = state.exit;
  }
  assert.ok(true);
});

// ---------------------------------------------------------------------------
// 9. 不同 hero DNA 参数
// ---------------------------------------------------------------------------

test('长入场时间：progress 增长更慢', () => {
  const longEntrance = { ...heroDna, entranceSeconds: 1.0 };
  const fast = computeHeroState(hero, 5.0, heroDna);
  const slow = computeHeroState(hero, 5.0, longEntrance);
  // 同一时刻，长入场时间的 progress 更小
  assert.ok(fast.progress > slow.progress);
});

test('holdSeconds=0：hero 结束立即退场', () => {
  const noHold = { ...heroDna, holdSeconds: 0 };
  // hero.end = 7.0, exitStart = 7.0, exitEnd = 7.25
  const state = computeHeroState(hero, 7.0, noHold);
  assert.strictEqual(state.visible, true);
  assert.strictEqual(state.exit, 0);
});

test('零时长 hero：start=end', () => {
  const zeroHero = { start: 5.0, end: 5.0, text: 'x' };
  const state = computeHeroState(zeroHero, 5.0, heroDna);
  // 仍然可见
  assert.strictEqual(state.visible, true);
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${passed} 通过, ${failed} 失败`);
if (failed > 0) process.exit(1);
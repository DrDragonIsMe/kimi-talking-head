#!/usr/bin/env node
/**
 * 画面窗口（shot-level visual windows）与候选重排测试。
 *
 * 覆盖：
 * 1. buildVisualWindows — 分镜驱动的 6–15s 窗口合并、无分镜 42s 回退、全程覆盖
 * 2. scoreStockCandidate / pickBestCandidate — stock 候选按 query 匹配度重排
 * 3. sceneCacheKey — 全局缓存 key 的确定性与类型区分
 */

const assert = require('assert');
const {
  buildVisualWindows,
  scoreStockCandidate,
  pickBestCandidate,
  sceneCacheKey,
  SCENE_DURATION,
} = require('./prepare_scene_visuals');

const cues = (n, dur = 3) =>
  Array.from({ length: n }, (_, i) => ({ start: i * dur, end: (i + 1) * dur, text: `c${i}` }));

const shot = (start, end, id) => ({ id, start, end, duration: end - start });

console.log('=== buildVisualWindows: 无分镜回退定长切分 ===');
{
  const total = 90;
  const windows = buildVisualWindows(cues(30), null, total);
  const expected = Math.ceil(total / SCENE_DURATION);
  assert.strictEqual(windows.length, expected, `无分镜时应切 ${expected} 段`);
  const seg = total / expected;
  assert.strictEqual(windows[0].start, 0);
  assert.strictEqual(windows[windows.length - 1].end, total);
  assert.ok(Math.abs(windows[1].start - seg) < 1e-9, '回退切分应均分');
}

console.log('=== buildVisualWindows: 短镜头合并，达到 min 后超过 max 才关窗 ===');
{
  // 6 个 3s 短镜头：前 5 个合并成 15s（再加会超过 15s 关窗），最后 1 个 3s 收尾
  const shots = [
    shot(0, 3, 1),
    shot(3, 6, 2),
    shot(6, 9, 3),
    shot(9, 12, 4),
    shot(12, 15, 5),
    shot(15, 18, 6),
  ];
  const windows = buildVisualWindows(cues(6), shots, 18);
  assert.strictEqual(windows.length, 2, `应为 2 窗，实际 ${windows.length}`);
  assert.strictEqual(windows[0].end - windows[0].start, 15, '第一窗合并到 15s');
  assert.deepStrictEqual(windows[0].shots.map((s) => s.id), [1, 2, 3, 4, 5]);
  assert.deepStrictEqual(windows[1].shots.map((s) => s.id), [6]);
  assert.ok(windows.slice(0, -1).every((w) => w.end - w.start >= 6), '非收尾窗口应 ≥6s');
}

console.log('=== buildVisualWindows: 达到 min 后不超过 max ===');
{
  // 4s 镜头连续 5 个：4+4=8（<15 可再加？8+4=12 ≤15 继续；12+4=16 >15 且当前 ≥6 → 关闭）
  const shots = [shot(0, 4, 1), shot(4, 8, 2), shot(8, 12, 3), shot(12, 16, 4), shot(16, 20, 5)];
  const windows = buildVisualWindows(cues(5, 4), shots, 20);
  assert.strictEqual(windows.length, 2, `应为 2 窗，实际 ${windows.length}`);
  assert.strictEqual(windows[0].end - windows[0].start, 12, '第一窗 12s');
  assert.ok(windows.every((w) => w.end - w.start <= 15), '每个窗口应 ≤15s');
}

console.log('=== buildVisualWindows: 单镜头超过 max 独立成窗 ===');
{
  const shots = [shot(0, 3, 1), shot(3, 20, 2), shot(20, 24, 3)];
  const windows = buildVisualWindows(cues(8), shots, 24);
  const longWin = windows.find((w) => w.shots.some((s) => s.id === 2));
  assert.strictEqual(longWin.shots.length, 1, '超长镜头不应被合并');
  assert.strictEqual(longWin.end - longWin.start, 17);
}

console.log('=== buildVisualWindows: 覆盖全程且连续 ===');
{
  const shots = [shot(0, 2, 1), shot(2, 5, 2), shot(5, 11, 3), shot(11, 13, 4)];
  const windows = buildVisualWindows(cues(5, 3), shots, 15);
  assert.strictEqual(windows[0].start, 0, '首窗从 0 开始');
  assert.strictEqual(windows[windows.length - 1].end, 15, '末窗覆盖到正文结束');
  for (let i = 1; i < windows.length; i++) {
    assert.strictEqual(windows[i].start, windows[i - 1].end, `窗口 ${i} 应与前一窗连续`);
  }
}

console.log('=== scoreStockCandidate ===');
{
  assert.ok(
    scoreStockCandidate('salary dashboard chart', 'Business salary dashboard with charts') > 0,
    '命中应得分'
  );
  assert.strictEqual(
    scoreStockCandidate('salary dashboard', 'sunset beach waves'),
    0,
    '不相关应 0 分'
  );
  assert.strictEqual(
    scoreStockCandidate('person man woman', 'person man woman'),
    0,
    '停用词（person/man/woman）不计分'
  );
  assert.ok(
    scoreStockCandidate('AI Recruitment', 'ai-powered recruitment platform') >= 1,
    '大小写不敏感'
  );
}

console.log('=== pickBestCandidate ===');
{
  const items = [
    { id: 'generic', alt: 'person walking on street' },
    { id: 'relevant', alt: 'HR salary dashboard on laptop screen' },
    { id: 'other', alt: 'mountain landscape' },
  ];
  const best = pickBestCandidate('salary dashboard hr', items, (x) => x.alt);
  assert.strictEqual(best.id, 'relevant', '应选匹配度最高的候选');
  const tie = pickBestCandidate('zzz notfound', items, (x) => x.alt);
  assert.strictEqual(tie.id, 'generic', '同分（0）时保持 API 原顺序取第一个');
}

console.log('=== sceneCacheKey ===');
{
  const k1 = sceneCacheKey('salary dashboard', 'video');
  const k2 = sceneCacheKey('salary dashboard', 'video');
  const k3 = sceneCacheKey('salary dashboard', 'image');
  assert.strictEqual(k1, k2, '同输入同 key');
  assert.notStrictEqual(k1, k3, 'image/video 应区分缓存');
  assert.match(k1, /^[0-9a-f]{40}$/, 'sha1 hex');
}

console.log('全部通过 ✅');

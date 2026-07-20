#!/usr/bin/env node

/**
 * 组合守卫：断言 src/index.tsx 注册了竖屏/横屏/正方形三个 composition 且尺寸正确。
 * 比视觉回归轻量（只 bundle + 求 metadata，不渲染帧），挂在 npm test 链上，
 * 防止误删 TalkingHeadVideoLandscape/TalkingHeadVideoSquare 或改坏 TalkingHeadVideo 的尺寸。
 *
 * `remotion compositions` 只输出人类可读表格（无 JSON 模式），按行解析。
 *
 * 运行：node scripts/test_compositions.js
 */

const { execFileSync } = require('child_process');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');

let failures = 0;

function assert(cond, message) {
  if (cond) {
    console.log(`  ✅ ${message}`);
  } else {
    failures += 1;
    console.error(`  ❌ ${message}`);
  }
}

// 表格行形如：TalkingHeadVideo             30      1080x1920      300 (10.00 sec)
function findRow(output, id) {
  const line = output
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.startsWith(`${id} `) || l === id);
  if (!line) return null;
  const m = line.match(/^(?<id>\S+)\s+(?<fps>\d+)\s+(?<width>\d+)x(?<height>\d+)\s+/);
  return m ? { id: m.groups.id, fps: Number(m.groups.fps), width: Number(m.groups.width), height: Number(m.groups.height) } : null;
}

function main() {
  // --props 指向视觉回归 fixture（无 videoLayout.aspect → 默认 9:16 竖屏）
  const out = execFileSync(
    'npx',
    ['remotion', 'compositions', 'src/index.tsx', '--props=scripts/fixtures/visual/props.json'],
    { cwd: PROJECT_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
  );

  console.log('=== compositions 注册守卫 ===');
  const portrait = findRow(out, 'TalkingHeadVideo');
  assert(
    portrait && portrait.width === 1080 && portrait.height === 1920 && portrait.fps === 30,
    `TalkingHeadVideo registered as 1080x1920@30 (got: ${portrait ? `${portrait.width}x${portrait.height}@${portrait.fps}` : 'missing'})`
  );
  const landscape = findRow(out, 'TalkingHeadVideoLandscape');
  assert(
    landscape && landscape.width === 1920 && landscape.height === 1080 && landscape.fps === 30,
    `TalkingHeadVideoLandscape registered as 1920x1080@30 (got: ${landscape ? `${landscape.width}x${landscape.height}@${landscape.fps}` : 'missing'})`
  );
  const square = findRow(out, 'TalkingHeadVideoSquare');
  assert(
    square && square.width === 1080 && square.height === 1080 && square.fps === 30,
    `TalkingHeadVideoSquare registered as 1080x1080@30 (got: ${square ? `${square.width}x${square.height}@${square.fps}` : 'missing'})`
  );

  if (failures > 0) {
    console.error(`❌ ${failures} composition guard check(s) failed`);
    process.exit(1);
  }
  console.log('✅ composition guard passed');
}

main();

#!/usr/bin/env node

/**
 * 视觉回归测试：对固定 fixture props 渲染代表帧，与基线做 SSIM 像素对比。
 *
 * 帧位（fixture：标题卡 1s + 正文 8s，30fps）：
 * - karaoke   frame  90 = 正文 t=2.0s：卡拉 OK 逐词进行中
 * - hero      frame 132 = 正文 t=3.4s：hero 词全屏呈现
 * - crossfade frame 156 = 正文 t=4.2s：场景交叉淡化中点
 *
 * 基线缺失时自动落基线（bless）；UPDATE_BASELINE=1 强制重落。
 * 模板/动效的有意变更后，先人工确认新渲染正确，再 UPDATE_BASELINE=1 重落基线。
 *
 * 运行：node scripts/test_visual_regression.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const PROJECT_ROOT = path.join(__dirname, '..');
const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'visual');
const BASELINE_DIR = path.join(FIXTURE_DIR, 'baseline');
const PUBLIC_FIXTURE_DIR = path.join(PROJECT_ROOT, 'public', 'fixture_visual');
const FIXTURE_PROPS = path.join(FIXTURE_DIR, 'props.json');

const SSIM_THRESHOLD = 0.98;
const UPDATE_BASELINE = process.env.UPDATE_BASELINE === '1';

const FRAMES = [
  { name: 'karaoke', frame: 90 },
  { name: 'hero', frame: 132 },
  { name: 'crossfade', frame: 156 },
];

const FIXTURE_MEDIA = ['host.mp4', 'scene_a.png', 'scene_b.png', 'audio.wav', 'subtitles.srt'];

let passed = 0;
let failed = 0;
const notes = [];

const report = (ok, name, detail) => {
  if (ok) {
    passed += 1;
    console.log(`✅ ${name}${detail ? ` (${detail})` : ''}`);
  } else {
    failed += 1;
    console.error(`❌ ${name}${detail ? ` (${detail})` : ''}`);
  }
};

const setup = () => {
  for (const file of FIXTURE_MEDIA) {
    const src = path.join(FIXTURE_DIR, file);
    assert.ok(fs.existsSync(src), `fixture 缺失: ${src}`);
  }
  fs.mkdirSync(PUBLIC_FIXTURE_DIR, { recursive: true });
  for (const file of FIXTURE_MEDIA) {
    fs.copyFileSync(path.join(FIXTURE_DIR, file), path.join(PUBLIC_FIXTURE_DIR, file));
  }
};

const cleanup = () => {
  try {
    fs.rmSync(PUBLIC_FIXTURE_DIR, { recursive: true, force: true });
  } catch (_e) {
    // 清理失败不影响测试结果
  }
};

const renderStill = (frame, outPath) => {
  execFileSync(
    'npx',
    [
      'remotion',
      'still',
      'src/index.tsx',
      'TalkingHeadVideo',
      '--props',
      FIXTURE_PROPS,
      '--frame',
      String(frame),
      outPath,
    ],
    { cwd: PROJECT_ROOT, stdio: ['ignore', 'pipe', 'pipe'] }
  );
  // 统一缩到 540x960 再对比：基线体积减半，且降低字体光栅化噪声导致的误报
  const tmpPath = outPath.replace(/\.png$/, '.scaled.png');
  execFileSync(
    'bash',
    ['-c', `ffmpeg -y -loglevel error -i "${outPath}" -vf scale=540:960 "${tmpPath}" && mv "${tmpPath}" "${outPath}"`],
    { encoding: 'utf8' }
  );
};

const ssim = (currentPath, baselinePath) => {
  // ffmpeg 把 SSIM 结果打到 stderr，统一经 shell 合并捕获
  const output = execFileSync(
    'bash',
    ['-c', `ffmpeg -i "${currentPath}" -i "${baselinePath}" -lavfi ssim -f null - 2>&1 | grep "SSIM"`],
    { encoding: 'utf8' }
  );
  const match = output.match(/All:(0?\.\d+|1\.0+)/);
  return match ? parseFloat(match[1]) : NaN;
};

const main = () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'visual-regression-'));
  try {
    setup();

    for (const { name, frame } of FRAMES) {
      const current = path.join(outDir, `${name}.png`);
      const baseline = path.join(BASELINE_DIR, `${name}.png`);

      renderStill(frame, current);
      if (!fs.existsSync(current)) {
        report(false, name, 'still 渲染失败');
        continue;
      }

      if (UPDATE_BASELINE || !fs.existsSync(baseline)) {
        fs.mkdirSync(BASELINE_DIR, { recursive: true });
        fs.copyFileSync(current, baseline);
        report(true, name, UPDATE_BASELINE ? '基线已更新' : '基线缺失，已落基线(bless)');
        continue;
      }

      const score = ssim(current, baseline);
      if (Number.isNaN(score)) {
        report(false, name, 'SSIM 解析失败');
      } else {
        report(score >= SSIM_THRESHOLD, name, `SSIM=${score.toFixed(4)}`);
        if (score < SSIM_THRESHOLD) {
          notes.push(`  ↳ ${name}: 当前帧 ${current} 与基线 ${baseline} 差异超阈值，可人工对比`);
        }
      }
    }
  } finally {
    cleanup();
  }

  for (const note of notes) console.warn(note);
  console.log(`\n${passed} 通过, ${failed} 失败（阈值 SSIM≥${SSIM_THRESHOLD}）`);
  if (failed > 0) process.exit(1);
};

main();

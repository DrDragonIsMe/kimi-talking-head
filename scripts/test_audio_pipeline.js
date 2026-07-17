#!/usr/bin/env node

/**
 * Phase 2 音频与配置链路测试。
 *
 * 覆盖：
 * 1. pipeline.sh 的 hero 音效 ffmpeg 合成命令产出合法 wav（时长、采样率）
 * 2. host_profile.example.json 的 BGM / SFX / 进度条配置字段齐全
 * 3. assets/bgm/piano-reflections.mp3 存在且是合法音频
 *
 * 运行：node scripts/test_audio_pipeline.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

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

const PROJECT_ROOT = path.join(__dirname, '..');

// 与 pipeline.sh 中完全一致的合成命令
const SFX_FILTER = "aevalsrc='sin(2*PI*(600*exp(-t*10)+120)*t)*exp(-t*9)':s=44100:d=0.25";

const ffprobeJson = (file, entries) =>
  JSON.parse(
    execFileSync('ffprobe', ['-v', 'error', '-show_entries', entries, '-of', 'json', file], {
      encoding: 'utf8',
    })
  );

test('SFX 合成：产出 0.25s / 44.1kHz 的合法 wav', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sfx-test-'));
  const out = path.join(dir, 'hero_pop.wav');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', SFX_FILTER, out]);
  assert.ok(fs.existsSync(out) && fs.statSync(out).size > 1000, 'wav 文件未生成或过小');

  const info = ffprobeJson(out, 'format=duration:stream=sample_rate,codec_name');
  const duration = parseFloat(info.format.duration);
  assert.ok(Math.abs(duration - 0.25) < 0.02, `时长异常: ${duration}`);
  assert.strictEqual(String(info.streams[0].sample_rate), '44100');
});

test('SFX 合成：波形非静音（有实际能量）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sfx-test-'));
  const out = path.join(dir, 'hero_pop.wav');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', SFX_FILTER, out]);
  const stats = execFileSync(
    'ffmpeg',
    ['-i', out, '-af', 'astats=metadata=1', '-f', 'null', '-'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
  ).toString();
  const stderr = execFileSync('bash', ['-c', `ffmpeg -i "${out}" -af astats -f null - 2>&1 | grep -E "RMS level|Peak level" | head -2`], { encoding: 'utf8' });
  assert.ok(!/RMS level dB:\s*-inf/.test(stderr), `波形为静音: ${stderr}`);
});

test('host_profile.example.json：BGM / SFX 配置齐全', () => {
  const profile = JSON.parse(
    fs.readFileSync(path.join(PROJECT_ROOT, 'config', 'host_profile.example.json'), 'utf8')
  );
  assert.strictEqual(typeof profile.style.bgm, 'string');
  assert.strictEqual(typeof profile.style.bgm_volume, 'number');
  assert.strictEqual(typeof profile.style.sfx_enabled, 'boolean');
  assert.strictEqual(typeof profile.style.sfx_volume, 'number');
  assert.strictEqual(profile.video_layout.hybrid.showProgressBar, true);
});

test('默认 BGM 素材存在且可解码', () => {
  const profile = JSON.parse(
    fs.readFileSync(path.join(PROJECT_ROOT, 'config', 'host_profile.example.json'), 'utf8')
  );
  const bgmPath = path.join(PROJECT_ROOT, profile.style.bgm);
  assert.ok(fs.existsSync(bgmPath), `BGM 文件不存在: ${bgmPath}`);
  const info = ffprobeJson(bgmPath, 'format=duration');
  assert.ok(parseFloat(info.format.duration) > 5, 'BGM 时长异常');
});

console.log(`\n${passed} 通过, ${failed} 失败`);
if (failed > 0) process.exit(1);

#!/usr/bin/env node

/**
 * 字幕 DNA 注册表与 sanitizeOutputName 校验。
 *
 * 覆盖：
 * 1. 六套字幕 DNA 文件存在性及结构完整性
 * 2. sanitizeOutputName 函数
 *
 * 运行：node scripts/test_caption_dna.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

// 从 job-store 加载 sanitizeOutputName
const { sanitizeOutputName } = require(path.join(__dirname, '..', 'api', 'job-store'));

const EXPECTED_DNA_IDS = ['classic', 'loud', 'keynote', 'cream', 'editorial', 'documentary'];

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
// 1. 字幕 DNA 文件存在性
// ---------------------------------------------------------------------------

test('所有六套 DNA 源文件存在', () => {
  for (const id of EXPECTED_DNA_IDS) {
    const filePath = path.join(__dirname, '..', 'src', 'themes', 'captions', `${id}.ts`);
    assert.ok(fs.existsSync(filePath), `DNA 文件缺失: src/themes/captions/${id}.ts`);
  }
});

test('captions/index.ts 注册所有六套 DNA', () => {
  const content = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'themes', 'captions', 'index.ts'),
    'utf8'
  );
  for (const id of EXPECTED_DNA_IDS) {
    const upper = id.toUpperCase() + '_DNA';
    assert.ok(
      content.includes(upper),
      `index.ts 未注册 ${id}（缺少 ${upper}）`
    );
  }
});

test('CAPTION_DNAS 对象包含所有六套 DNA', () => {
  const content = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'themes', 'captions', 'index.ts'),
    'utf8'
  );
  for (const id of EXPECTED_DNA_IDS) {
    assert.ok(
      content.includes(`${id}:`),
      `CAPTION_DNAS 对象缺少 ${id} 键`
    );
  }
});

test('getCaptionDna: 未知 id 回退到 classic', () => {
  const content = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'themes', 'captions', 'index.ts'),
    'utf8'
  );
  assert.ok(content.includes('falling back to "classic"'), 'getCaptionDna 有回退警告');
  assert.ok(content.includes('return CLASSIC_DNA'), '未知 id 回退到 CLASSIC_DNA');
});

test('getCaptionDna: 空 id 回退到 classic', () => {
  const content = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'themes', 'captions', 'index.ts'),
    'utf8'
  );
  assert.ok(content.includes('if (!id) return CLASSIC_DNA'), '空 id 返回 CLASSIC_DNA');
});

// ---------------------------------------------------------------------------
// 2. 每个 DNA 的类型字段完整性
// ---------------------------------------------------------------------------

test('每个 DNA 导出包含必需字段', () => {
  const requiredFields = [
    'id', 'label', 'wordReveal', 'fontFamily', 'fontWeight',
    'heroFontWeight', 'colors', 'motion', 'hero',
  ];
  const colorFields = ['text', 'accent', 'heroText', 'cardBackground', 'cardBorder'];
  const motionFields = ['wordInSeconds', 'fromScale', 'fromY', 'fromX', 'currentScale', 'currentGlow'];
  const heroFields = ['fontSize', 'entrance', 'entranceSeconds', 'exitSeconds', 'holdSeconds', 'dimOpacity', 'scrimOpacity', 'breathe', 'glow', 'fromScale', 'fromY'];

  for (const id of EXPECTED_DNA_IDS) {
    const filePath = path.join(__dirname, '..', 'src', 'themes', 'captions', `${id}.ts`);
    const content = fs.readFileSync(filePath, 'utf8');

    for (const field of requiredFields) {
      assert.ok(
        new RegExp(`\\b${field}\\s*:`).test(content),
        `${id}.ts 缺少字段 ${field}`
      );
    }

    for (const field of colorFields) {
      assert.ok(
        new RegExp(`\\b${field}\\s*:`).test(content),
        `${id}.ts colors 缺少 ${field}`
      );
    }

    for (const field of motionFields) {
      assert.ok(
        new RegExp(`\\b${field}\\s*:`).test(content),
        `${id}.ts motion 缺少 ${field}`
      );
    }

    for (const field of heroFields) {
      assert.ok(
        new RegExp(`\\b${field}\\s*:`).test(content),
        `${id}.ts hero 缺少 ${field}`
      );
    }
  }
});

// ---------------------------------------------------------------------------
// 3. sanitizeOutputName
// ---------------------------------------------------------------------------

test('sanitizeOutputName: 保留合法字符', () => {
  assert.strictEqual(sanitizeOutputName('my_video'), 'my_video');
  assert.strictEqual(sanitizeOutputName('my-video'), 'my-video');
  assert.strictEqual(sanitizeOutputName('测试视频'), '测试视频');
  assert.strictEqual(sanitizeOutputName('Test_Video_01'), 'Test_Video_01');
});

test('sanitizeOutputName: 替换非法字符并合并连续下划线', () => {
  assert.strictEqual(sanitizeOutputName('my video.mp4'), 'my_video_mp4');
  // @#$% 替换为 _，再合并连续 _ 为单个 _
  assert.strictEqual(sanitizeOutputName('test@#$%'), 'test_');
  assert.strictEqual(sanitizeOutputName('hello/world'), 'hello_world');
});

test('sanitizeOutputName: 合并连续下划线', () => {
  assert.strictEqual(sanitizeOutputName('a  b'), 'a_b');
  assert.strictEqual(sanitizeOutputName('a@#b'), 'a_b');
});

test('sanitizeOutputName: 截断到 80 字符', () => {
  const longName = 'a'.repeat(100);
  const result = sanitizeOutputName(longName);
  assert.strictEqual(result.length, 80);
});

test('sanitizeOutputName: 空字符串输入', () => {
  const result = sanitizeOutputName('');
  assert.strictEqual(result, '');
});

test('sanitizeOutputName: 混合中英文和数字', () => {
  const result = sanitizeOutputName('我的Video_2024-01');
  assert.strictEqual(result, '我的Video_2024-01');
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${passed} 通过, ${failed} 失败`);
if (failed > 0) process.exit(1);
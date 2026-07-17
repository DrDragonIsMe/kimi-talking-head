#!/usr/bin/env node

/**
 * 词级卡拉 OK 字幕链路测试（require 真实模块，非内联拷贝）。
 *
 * 覆盖：
 * 1. align_subtitles.py 词级导出（子进程集成：分词规则、时间单调性）
 * 2. parse_srt.js 的 attachWords / normalizeForMatch（匹配合并与降级）
 * 3. locate_hero_moments.js 的 locateMoments（窗口、密度、偏移）
 * 4. generate_storyboard.js 的 sanitizeHeroPhrase（严格校验）
 *
 * 运行：node scripts/test_karaoke_words.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { attachWords, normalizeForMatch } = require('./parse_srt');
const { locateMoments, MIN_SPACING_SECONDS } = require('./locate_hero_moments');
const { sanitizeHeroPhrase } = require('./generate_storyboard');

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
// 1. align_subtitles.py 集成
// ---------------------------------------------------------------------------

const runAlign = (scriptText, whisperWords) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'karaoke-align-'));
  const scriptPath = path.join(dir, 'script.txt');
  const whisperPath = path.join(dir, 'whisper.json');
  const srtPath = path.join(dir, 'out.srt');
  const wordsPath = path.join(dir, 'words.json');
  fs.writeFileSync(scriptPath, scriptText);
  let t = 0;
  const words = [];
  for (const ch of scriptText) {
    if (ch.trim()) {
      words.push({ word: ch, start: t, end: t + 0.2 });
      t += 0.22;
    }
  }
  fs.writeFileSync(whisperPath, JSON.stringify({ segments: [{ words }] }));
  execFileSync('python3', [
    path.join(__dirname, 'align_subtitles.py'),
    scriptPath,
    whisperPath,
    srtPath,
    wordsPath,
  ]);
  return JSON.parse(fs.readFileSync(wordsPath, 'utf8'));
};

test('align: 拉丁串保持整词，CJK 两字分词，标点依附前词', () => {
  const cues = runAlign('今天聊聊AI治理。', null);
  const tokens = cues.flatMap((c) => c.words.map((w) => w.text));
  assert.deepStrictEqual(tokens, ['今天', '聊聊', 'AI', '治理。']);
});

test('align: 3 字 CJK 串不拆出落单字', () => {
  const cues = runAlign('来聊聊，好', null);
  const tokens = cues.flatMap((c) => c.words.map((w) => w.text));
  assert.deepStrictEqual(tokens, ['来聊聊，', '好']);
});

test('align: 词级时间单调递增且在 cue 范围内', () => {
  const cues = runAlign('大家好，今天我们来聊聊AI治理的三个误区。第一个误区，就是把AI当成万能工具。', null);
  for (const cue of cues) {
    let prev = -Infinity;
    for (const w of cue.words) {
      assert.ok(w.start >= prev, `词时间回退: ${w.text}`);
      assert.ok(w.end >= w.start);
      assert.ok(w.start >= cue.start - 0.01 && w.end <= cue.end + 0.01, `词超出 cue: ${w.text}`);
      prev = w.start;
    }
  }
});

test('align: 零时长标点词不产生 end<=start 的 cue（真实事故回归）', () => {
  // 模拟 Whisper 给标点零时长：正文词 0.2s，逗号 start==end
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'karaoke-zero-'));
  const scriptPath = path.join(dir, 'script.txt');
  const whisperPath = path.join(dir, 'whisper.json');
  const srtPath = path.join(dir, 'out.srt');
  const wordsPath = path.join(dir, 'words.json');
  fs.writeFileSync(scriptPath, '交叉学科门类，首批就有15个专业。');
  const words = [];
  let t = 0;
  for (const ch of '交叉学科门类，首批就有15个专业。') {
    const dur = ch === '，' ? 0 : 0.2;
    words.push({ word: ch, start: t, end: t + dur });
    t += 0.22;
  }
  fs.writeFileSync(whisperPath, JSON.stringify({ segments: [{ words }] }));
  execFileSync('python3', [
    path.join(__dirname, 'align_subtitles.py'),
    scriptPath, whisperPath, srtPath, wordsPath,
  ]);
  const cues = JSON.parse(fs.readFileSync(wordsPath, 'utf8'));
  assert.ok(cues.length > 0);
  for (const cue of cues) {
    assert.ok(cue.end > cue.start, `零时长 cue: ${cue.text} (${cue.start}-${cue.end})`);
  }
});

// ---------------------------------------------------------------------------
// 2. parse_srt.js
// ---------------------------------------------------------------------------

test('normalizeForMatch: 忽略空白与中英文标点', () => {
  assert.strictEqual(normalizeForMatch('三个误区。'), '三个误区');
  assert.strictEqual(normalizeForMatch(' AI 治理,  '), 'AI治理');
});

test('attachWords: 文本一致时挂载并应用偏移', () => {
  const cues = [{ start: 2, end: 4, text: '今天聊聊AI。' }];
  const wordCues = [{
    start: 0, end: 2, text: '今天聊聊AI。',
    words: [
      { text: '今天', start: 0, end: 0.4 },
      { text: '聊聊', start: 0.4, end: 0.8 },
      { text: 'AI。', start: 0.8, end: 2 },
    ],
  }];
  const { attached, dropped } = attachWords(cues, wordCues, 2);
  assert.strictEqual(attached, 1);
  assert.strictEqual(dropped, 0);
  assert.strictEqual(cues[0].words.length, 3);
  assert.strictEqual(cues[0].words[0].start, 2);
});

test('attachWords: 文本不一致时降级为无词', () => {
  const cues = [{ start: 2, end: 4, text: '完全不同的文本' }];
  const wordCues = [{
    start: 0, end: 2, text: 'x',
    words: [{ text: '别的', start: 2.1, end: 2.9 }],
  }];
  const { attached, dropped } = attachWords(cues, wordCues, 0);
  assert.strictEqual(attached, 0);
  assert.strictEqual(dropped, 1);
  assert.strictEqual(cues[0].words, undefined);
});

// ---------------------------------------------------------------------------
// 3. locate_hero_moments.js
// ---------------------------------------------------------------------------

const WORD_CUES = [{
  index: 1, start: 0, end: 4.4, text: '今天我们来聊聊AI治理的三个误区。',
  words: [
    { text: '今天', start: 0, end: 0.44 },
    { text: '我们', start: 0.44, end: 0.88 },
    { text: '来聊聊', start: 0.88, end: 1.54 },
    { text: 'AI', start: 1.54, end: 1.98 },
    { text: '治理', start: 1.98, end: 2.42 },
    { text: '的三', start: 2.42, end: 2.86 },
    { text: '个误区。', start: 2.86, end: 4.4 },
  ],
}];

test('locateMoments: 窗内定位成功并应用偏移', () => {
  const storyboard = [{ id: 's1', start: 0, end: 4.4, narration: '今天我们来聊聊AI治理的三个误区。', hero_phrase: '三个误区' }];
  const { moments } = locateMoments(storyboard, WORD_CUES, { offsetSeconds: 2 });
  assert.strictEqual(moments.length, 1);
  assert.strictEqual(moments[0].text, '三个误区');
  assert.ok(Math.abs(moments[0].start - 4.42) < 0.001);
  assert.ok(Math.abs(moments[0].end - 6.4) < 0.001);
});

test('locateMoments: 窗外命中被丢弃', () => {
  const storyboard = [{ id: 's1', start: 3.5, end: 4.4, narration: '个误区。', hero_phrase: '今天' }];
  const { moments, dropped } = locateMoments(storyboard, WORD_CUES, {});
  assert.strictEqual(moments.length, 0);
  assert.strictEqual(dropped, 1);
});

test('locateMoments: 最小间距与每分钟上限生效', () => {
  const storyboard = [];
  for (let i = 0; i < 6; i++) {
    storyboard.push({ id: `s${i}`, start: 0, end: 4.4, narration: 'x', hero_phrase: '误区' });
  }
  // 同一短语定位到同一时刻，间距规则应只保留 1 个
  const { moments } = locateMoments(storyboard, WORD_CUES, {});
  assert.strictEqual(moments.length, 1);

  // 构造跨时间的词序列，验证间距
  const spacedWords = [{
    index: 1, start: 0, end: 30, text: 'x',
    words: [
      { text: '误区', start: 0, end: 1 },
      { text: '误区', start: 5, end: 6 },
      { text: '误区', start: 5 + MIN_SPACING_SECONDS, end: 6 + MIN_SPACING_SECONDS },
    ],
  }];
  const spacedBoard = [
    { id: 'a', start: 0, end: 30, narration: 'x', hero_phrase: '误区' },
    { id: 'b', start: 0, end: 30, narration: 'x', hero_phrase: '误区' },
  ];
  const spaced = locateMoments(spacedBoard, spacedWords, {});
  // 两次定位都命中第一个词（同一时刻），第二个被间距过滤
  assert.strictEqual(spaced.moments.length, 1);
});

test('locateMoments: 无词数据时返回空', () => {
  const { moments } = locateMoments([{ hero_phrase: 'x', start: 0, end: 1 }], [], {});
  assert.strictEqual(moments.length, 0);
});

// ---------------------------------------------------------------------------
// 4. generate_storyboard.js
// ---------------------------------------------------------------------------

test('sanitizeHeroPhrase: 只接受 narration 内的 2-6 字短语', () => {
  const narration = '今天我们来聊聊AI治理的三个误区。';
  assert.strictEqual(sanitizeHeroPhrase('三个误区', narration), '三个误区');
  assert.strictEqual(sanitizeHeroPhrase('AI', narration), 'AI');
  assert.strictEqual(sanitizeHeroPhrase('不在这里', narration), null);
  assert.strictEqual(sanitizeHeroPhrase('一', narration), null);
  assert.strictEqual(sanitizeHeroPhrase('这个短语实在是太长了', narration), null);
  assert.strictEqual(sanitizeHeroPhrase(null, narration), null);
  assert.strictEqual(sanitizeHeroPhrase(123, narration), null);
  assert.strictEqual(sanitizeHeroPhrase(' 三个误区 ', narration), '三个误区');
});

test('sanitizeHeroPhrase: 拒绝跨词残片（虚词开头/结尾）', () => {
  const narration = '人工智能现在到底是怎么改变人力资源管理的，真的落地了。';
  assert.strictEqual(sanitizeHeroPhrase('的三', '治理的三'), null);
  assert.strictEqual(sanitizeHeroPhrase('误区了', '三个误区了'), null);
  assert.strictEqual(sanitizeHeroPhrase('是怎', narration), null);
  assert.strictEqual(sanitizeHeroPhrase('真的落地', narration), '真的落地');
  assert.strictEqual(sanitizeHeroPhrase('数字员工', '数字员工已经入职。'), '数字员工');
});

// ---------------------------------------------------------------------------

console.log(`\n${passed} 通过, ${failed} 失败`);
if (failed > 0) process.exit(1);

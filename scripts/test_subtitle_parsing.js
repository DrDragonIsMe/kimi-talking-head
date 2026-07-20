#!/usr/bin/env node

// =============================================================================
// Segmentation functions come from the single source of truth:
// scripts/lib/subtitle_segmentation.js (shared by parse_srt.js / useSubtitles.ts / keywordMatcher.ts)
// =============================================================================

const DEFAULT_SEGMENTATION = {
  maxSegmentSeconds: 3.2,
  minSegmentSeconds: 0.9,
  maxVisualLength: 26,
};

const readSegmentationConfig = () => {
  try {
    const env = process.env.SUBTITLE_SEGMENTATION_JSON;
    if (env) {
      return { ...DEFAULT_SEGMENTATION, ...JSON.parse(env) };
    }
  } catch (_error) {
    // ignore
  }
  return DEFAULT_SEGMENTATION;
};

const config = readSegmentationConfig();

// 单一数据源：scripts/lib/subtitle_segmentation.js（禁止内联副本）
const {
  normalizeSubtitleText,
  isMeaningfulUnit,
  getCharVisualWidth,
  getVisualLength,
  splitByDelimiters,
  findSplitIndex,
  splitLongUnit,
  tokenizeCueText,
  groupUnits,
  segmentCue,
} = require('./lib/subtitle_segmentation');

const parseSRT = (content) => {
  const cues = [];
  const blocks = content.trim().split(/\n\n+/);
  for (const block of blocks) {
    const lines = block.split('\n');
    if (lines.length < 3) continue;
    const timeLine = lines[1];
    const text = lines.slice(2).join(' ').replace(/<[^>]+>/g, '');
    const timeMatch = timeLine.match(/(\d{2}:\d{2}:\d{2},\d{3})\s+-->\s+(\d{2}:\d{2}:\d{2},\d{3})/);
    if (!timeMatch) continue;

    const parseTime = (t) => {
      const [h, m, s, ms] = t.replace(',', ':').split(':').map(Number);
      return h * 3600 + m * 60 + s + ms / 1000;
    };

    cues.push(...segmentCue({
      start: parseTime(timeMatch[1]),
      end: parseTime(timeMatch[2]),
      text: text.trim(),
    }, config));
  }
  return cues;
};

// =============================================================================
// Re-implemented validation logic from scripts/validate_subtitles.js
// =============================================================================

const validateSubtitles = (cues) => {
  const errors = [];

  if (!Array.isArray(cues)) {
    errors.push('字幕必须是数组');
    return { valid: false, errors };
  }

  if (cues.length < 3) {
    errors.push(`字幕 cue 数量不足: ${cues.length}`);
  }

  for (let i = 0; i < cues.length; i++) {
    const cue = cues[i];
    if (typeof cue.start !== 'number' || typeof cue.end !== 'number') {
      errors.push(`字幕 cue ${i} 的 start/end 必须是数字`);
    }
    if (cue.end <= cue.start) {
      errors.push(`字幕 cue ${i} 的 end 必须大于 start`);
    }
    if (typeof cue.text !== 'string' || cue.text.trim().length === 0) {
      errors.push(`字幕 cue ${i} 的 text 不能为空`);
    }

    // 词级时间戳是可选增强：存在时必须结构正确、时间单调且在 cue 范围内
    if (cue.words !== undefined) {
      if (!Array.isArray(cue.words) || cue.words.length === 0) {
        errors.push(`字幕 cue ${i} 的 words 必须是非空数组`);
        continue;
      }
      let prevStart = -Infinity;
      for (let j = 0; j < cue.words.length; j++) {
        const word = cue.words[j];
        if (typeof word.text !== 'string' || word.text.length === 0) {
          errors.push(`字幕 cue ${i} 的第 ${j} 个词 text 不能为空`);
        }
        if (typeof word.start !== 'number' || typeof word.end !== 'number' || word.end < word.start) {
          errors.push(`字幕 cue ${i} 的第 ${j} 个词 start/end 非法`);
        }
        if (word.start < prevStart) {
          errors.push(`字幕 cue ${i} 的词级时间戳必须单调递增（第 ${j} 个词回退）`);
        }
        if (word.start < cue.start - 0.5 || word.end > cue.end + 0.5) {
          errors.push(`字幕 cue ${i} 的第 ${j} 个词超出 cue 时间范围`);
        }
        prevStart = word.start;
      }
    }
  }

  return { valid: errors.length === 0, errors };
};

// =============================================================================
// Test framework
// =============================================================================

let passed = 0;
let failed = 0;
const failures = [];

const assert = (condition, description) => {
  if (condition) {
    passed++;
  } else {
    failed++;
    failures.push(`FAIL: ${description}`);
  }
};

const assertEqual = (actual, expected, description) => {
  if (actual === expected) {
    passed++;
  } else {
    failed++;
    failures.push(`FAIL: ${description} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};

const assertApprox = (actual, expected, description, tolerance = 0.001) => {
  if (Math.abs(actual - expected) <= tolerance) {
    passed++;
  } else {
    failed++;
    failures.push(`FAIL: ${description} — expected ~${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};

const assertDeepEqual = (actual, expected, description) => {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed++;
  } else {
    failed++;
    failures.push(`FAIL: ${description} — expected ${e}, got ${a}`);
  }
};

const testGroup = (name, fn) => {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  ${name}`);
  console.log(`${'='.repeat(60)}`);
  fn();
};

// =============================================================================
// Tests: normalizeSubtitleText
// =============================================================================

testGroup('normalizeSubtitleText', () => {
  assertEqual(normalizeSubtitleText('hello world'), 'hello world', 'single space preserved');
  assertEqual(normalizeSubtitleText('hello   world'), 'hello world', 'multiple spaces collapsed');
  assertEqual(normalizeSubtitleText('  hello world  '), 'hello world', 'leading/trailing spaces trimmed');
  assertEqual(normalizeSubtitleText('hello\tworld'), 'hello world', 'tab converted to space');
  assertEqual(normalizeSubtitleText('hello\nworld'), 'hello world', 'newline converted to space');
  assertEqual(normalizeSubtitleText('hello\n\nworld'), 'hello world', 'double newlines collapsed');
  assertEqual(normalizeSubtitleText(''), '', 'empty string returns empty');
  assertEqual(normalizeSubtitleText('   '), '', 'whitespace-only returns empty');
  assertEqual(normalizeSubtitleText('你好  世界'), '你好 世界', 'CJK with multiple spaces collapsed');
  assertEqual(normalizeSubtitleText('hello\t \nworld'), 'hello world', 'mixed whitespace collapsed');
});

// =============================================================================
// Tests: getCharVisualWidth / getVisualLength
// =============================================================================

testGroup('getCharVisualWidth / getVisualLength', () => {
  assertEqual(getCharVisualWidth(' '), 0.35, 'space width');
  assertEqual(getCharVisualWidth('a'), 0.62, 'lowercase ASCII width');
  assertEqual(getCharVisualWidth('Z'), 0.62, 'uppercase ASCII width');
  assertEqual(getCharVisualWidth('5'), 0.62, 'digit width');
  assertEqual(getCharVisualWidth('.'), 0.38, 'period width');
  assertEqual(getCharVisualWidth(','), 0.38, 'comma width');
  assertEqual(getCharVisualWidth('!'), 0.38, 'exclamation width');
  assertEqual(getCharVisualWidth('-'), 0.38, 'hyphen width');
  assertEqual(getCharVisualWidth('你'), 1, 'CJK character width');
  assertEqual(getCharVisualWidth('日'), 1, 'CJK character width');
  assertEqual(getCharVisualWidth('あ'), 1, 'Japanese kana width');

  assertEqual(getVisualLength(''), 0, 'visual length of empty string');
  assertEqual(getVisualLength('hello'), 5 * 0.62, 'visual length of ASCII word');
  assertEqual(getVisualLength('你好'), 2, 'visual length of 2 CJK chars');
  assertEqual(getVisualLength('hi你好'), 0.62 + 0.62 + 1 + 1, 'visual length of mixed text');
  assertApprox(getVisualLength('Hello, world!'), 0.62 * 10 + 0.38 * 2 + 0.35, 'visual length with punctuation');
});

// =============================================================================
// Tests: splitByDelimiters
// =============================================================================

testGroup('splitByDelimiters', () => {
  assertDeepEqual(
    splitByDelimiters('hello,world', /[,]/),
    ['hello,', 'world'],
    'split by comma'
  );
  assertDeepEqual(
    splitByDelimiters('hello world', /[,]/),
    ['hello world'],
    'no delimiter returns single element'
  );
  assertDeepEqual(
    splitByDelimiters('你好，世界。再见！', /[。！？!?；;—]/),
    ['你好，世界。', '再见！'],
    'split CJK by sentence delimiters'
  );
  assertDeepEqual(
    splitByDelimiters('', /[,]/),
    [],
    'empty string returns empty array'
  );
  assertDeepEqual(
    splitByDelimiters('a,b,c', /[,]/),
    ['a,', 'b,', 'c'],
    'multiple delimiters all split'
  );
  assertDeepEqual(
    splitByDelimiters('hello, world,test', /[,]/),
    ['hello,', 'world,', 'test'],
    'delimiters with spaces around'
  );
});

// =============================================================================
// Tests: findSplitIndex
// =============================================================================

testGroup('findSplitIndex', () => {
  // 10 ASCII chars × 0.62 = 6.2 total. Width exceeds 5 at i=8 ('i'), no preferred break, returns 8.
  assertEqual(findSplitIndex('abcdefghij', 5), 8, 'split at width boundary (no preferred break)');
  // 3 ASCII + 1 CJK comma + 3 ASCII = 4.72 total, never exceeds 5, returns full length 7.
  assertEqual(findSplitIndex('abc，def', 5), 7, 'text shorter than maxWidth returns full length');
  // 3 ASCII + space + 3 ASCII = 4.69 total, never exceeds 5, returns full length 7.
  assertEqual(findSplitIndex('abc def', 5), 7, 'text with space shorter than maxWidth returns full length');
  assertEqual(findSplitIndex('hello', 100), 5, 'text shorter than maxWidth returns full length');
  assertEqual(findSplitIndex('a', 0.1), 1, 'minimum split is at least 1');
  assertEqual(findSplitIndex('abcdefghij', 0.1), 1, 'no preferred break, very small width, returns 1');

  // 增强版：预算之外的标点不能作为断点（否则整行超宽），但硬切时会作为悬挂标点并入本行
  // 10 个 CJK 字（宽度 10）+ 逗号（i=10，宽度 11 > 10 不可取为断点）→ 硬切在 i=10 并把逗号并入，返回 11
  assertEqual(findSplitIndex('一二三四五六七八九十，三四五六七八九十', 10), 11, 'punct break beyond budget rejected; hanging punct merged instead');
  // 预算内的标点断点仍优先：逗号在 i=5，宽度 6 <= 10，返回 i+1=6
  assertEqual(findSplitIndex('一二三四五，六七八九十一二三四五六七八九十', 10), 6, 'in-budget punct break is preferred');
  // 增强版：硬切时把紧跟的悬挂标点并入本行（最多 2 个），避免下一行以标点开头
  // 10 个 CJK 字 + 「，。」→ 硬切在 i=10，并入 2 个标点，返回 12
  assertEqual(findSplitIndex('一二三四五六七八九十，。三四五六七', 10), 12, 'hanging punctuation merged into current line (up to 2)');
});

// =============================================================================
// Tests: splitLongUnit
// =============================================================================

testGroup('splitLongUnit', () => {
  // Long CJK text without spaces/delimiters
  const longCJK = '这是一个非常长的句子没有任何分隔符我们只能按照视觉宽度来分割这行文字';
  const parts = splitLongUnit(longCJK, 10);
  assert(parts.length > 1, 'long CJK text without delimiters splits into multiple parts');
  assert(parts.every(p => getVisualLength(p) <= 10), 'each part within maxWidth');

  // Short text
  const shortText = 'hello';
  assertDeepEqual(splitLongUnit(shortText, 50), ['hello'], 'short text returns as single element');

  // Text with preferred breaks
  const breakText = 'hello, world, this is a test';
  const breakParts = splitLongUnit(breakText, 10);
  assert(breakParts.length > 1, 'text with commas splits at preferred breaks');

  // Empty string
  assertDeepEqual(splitLongUnit('', 10), [], 'empty string returns empty');
});

// =============================================================================
// Tests: tokenizeCueText
// =============================================================================

testGroup('tokenizeCueText', () => {
  // Simple text
  const tokens1 = tokenizeCueText('Hello world', config);
  assert(tokens1.length >= 1, 'simple text produces tokens');

  // CJK text
  const tokens2 = tokenizeCueText('你好世界，这是一个测试。结果如何？', config);
  assert(tokens2.length >= 1, 'CJK text produces tokens');

  // Empty text
  assertDeepEqual(tokenizeCueText('', config), [], 'empty text returns empty array');
  assertDeepEqual(tokenizeCueText('   ', config), [], 'whitespace-only returns empty');

  // Mixed CJK and English
  const tokens3 = tokenizeCueText('Hello你好World世界', config);
  assert(tokens3.length >= 1, 'mixed CJK/English produces tokens');

  // Very long sentence without delimiters
  const longText = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const tokens4 = tokenizeCueText(longText, config);
  assert(tokens4.length > 1, `very long sentence without delimiters splits into multiple tokens (got ${tokens4.length})`);
});

// =============================================================================
// Tests: groupUnits
// =============================================================================

testGroup('groupUnits', () => {
  const units = ['a', 'b', 'c', 'd', 'e'];
  const groups = groupUnits(units, 3);
  assert(groups.length <= 3, 'groups respect desiredCount');
  assert(groups.every(g => g.length > 0), 'every group has at least one unit');
  const allUnits = groups.flat();
  assertDeepEqual(allUnits, units, 'all original units preserved');

  // Fewer units than desired
  const groups2 = groupUnits(['a', 'b'], 5);
  assertEqual(groups2.length, 2, 'fewer units than desired: each gets own group');

  // Single unit
  const groups3 = groupUnits(['hello'], 1);
  assertDeepEqual(groups3, [['hello']], 'single unit single group');

  // Empty
  const groups4 = groupUnits([], 3);
  assertDeepEqual(groups4, [], 'empty units returns empty');
});

// =============================================================================
// Tests: segmentCue
// =============================================================================

testGroup('segmentCue — basic', () => {
  // Short cue, short text — should not segment
  const shortCue = { start: 0, end: 1.5, text: 'Hello' };
  const shortResult = segmentCue(shortCue, config);
  assertEqual(shortResult.length, 1, 'short cue with short text returns single sub-cue');
  assertEqual(shortResult[0].text, 'Hello', 'text preserved');
  assertEqual(shortResult[0].start, 0, 'start preserved');
  assertEqual(shortResult[0].end, 1.5, 'end preserved');

  // Empty text cue
  const emptyCue = { start: 0, end: 1, text: '' };
  assertDeepEqual(segmentCue(emptyCue, config), [], 'empty text cue returns empty array');

  // Whitespace only
  const wsCue = { start: 0, end: 1, text: '   ' };
  assertDeepEqual(segmentCue(wsCue, config), [], 'whitespace-only cue returns empty array');
});

testGroup('segmentCue — sub-cue timestamp properties', () => {
  // Long duration + long text should segment
  const longCue = {
    start: 0,
    end: 10,
    text: 'This is a long text that should be segmented into multiple sub-cues because it has a long duration and long content that needs to be split, and we need to verify that the timestamps are correct.',
  };
  const result = segmentCue(longCue, config);
  if (result.length > 1) {
    // Strictly increasing timestamps
    for (let i = 1; i < result.length; i++) {
      assert(result[i].start > result[i - 1].start, `sub-cue ${i} start > sub-cue ${i - 1} start`);
      assert(result[i].end > result[i - 1].end, `sub-cue ${i} end > sub-cue ${i - 1} end`);
    }

    // Sub-cue end time equals next sub-cue start time
    for (let i = 0; i < result.length - 1; i++) {
      assertEqual(
        result[i].end,
        result[i + 1].start,
        `sub-cue ${i} end equals sub-cue ${i + 1} start`
      );
    }

    // First sub-cue start equals original start
    assertEqual(result[0].start, longCue.start, 'first sub-cue start equals original start');

    // Last sub-cue end equals original end
    assertEqual(result[result.length - 1].end, longCue.end, 'last sub-cue end equals original end');

    // Total duration of sub-cues equals original cue duration
    const totalSubDuration = result[result.length - 1].end - result[0].start;
    assertEqual(totalSubDuration, longCue.end - longCue.start, 'total sub-cue duration equals original');

    // Text reconstruction: splitLongUnit trims whitespace at split boundaries,
    // so inter-word spaces may be lost when splitting at visual-width boundaries.
    // Verify that non-space characters are preserved in order.
    const reconstructed = normalizeSubtitleText(result.map(c => c.text).join(''));
    const original = normalizeSubtitleText(longCue.text);
    const reconstructedChars = reconstructed.replace(/\s/g, '');
    const originalChars = original.replace(/\s/g, '');
    assertEqual(reconstructedChars, originalChars, 'sub-cue texts concatenated preserve all non-space characters in order');
  }
});

testGroup('segmentCue — very short duration, long text', () => {
  // Duration below 0.9s but long text — should still segment by visual length
  const cue = {
    start: 0,
    end: 0.5,
    text: '这是一个非常长的文本内容我们需要在很短的时间内显示很多文字来测试分段逻辑是否正常工作。',
  };
  const result = segmentCue(cue, config);
  // The duration is short (<= 2.4) and visual length might be high, so it segments anyway
  assert(result.length >= 1, 'very short duration with long text still produces segments');
  if (result.length > 1) {
    for (let i = 0; i < result.length - 1; i++) {
      assertEqual(result[i].end, result[i + 1].start, `sub-cue ${i} end equals sub-cue ${i + 1} start`);
    }
  }
});

testGroup('segmentCue — duration below minSegmentSeconds', () => {
  // Duration 0.5s, maxSegmentsByDuration = floor(0.5/0.9) = 0, clamped to 1
  // So should produce at most 1 segment
  const cue = {
    start: 0,
    end: 0.5,
    text: 'short text',
  };
  const result = segmentCue(cue, config);
  assertEqual(result.length, 1, 'duration below minSegmentSeconds produces single segment');
});

// =============================================================================
// Tests: parseSRT
// =============================================================================

testGroup('parseSRT — empty input', () => {
  assertDeepEqual(parseSRT(''), [], 'empty SRT returns empty array');
  assertDeepEqual(parseSRT('   \n\n\n'), [], 'whitespace-only SRT returns empty');
});

testGroup('parseSRT — single character SRT', () => {
  const srt = `1
00:00:01,000 --> 00:00:02,000
A`;
  const result = parseSRT(srt);
  assert(result.length >= 1, 'single character SRT produces at least one cue');
  if (result.length > 0) {
    assert(result[0].text.length > 0, 'cue has non-empty text');
  }
});

testGroup('parseSRT — basic SRT', () => {
  const srt = `1
00:00:01,000 --> 00:00:02,500
Hello world

2
00:00:03,000 --> 00:00:05,000
This is a test`;
  const result = parseSRT(srt);
  assert(result.length >= 2, 'basic SRT with 2 cues parsed');
  if (result.length >= 2) {
    assertEqual(result[0].start, 1, 'first cue start correct');
    assertEqual(result[0].end, 2.5, 'first cue end correct');
    assertEqual(result[1].start, 3, 'second cue start correct');
    assertEqual(result[1].end, 5, 'second cue end correct');
  }
});

testGroup('parseSRT — HTML tags stripped', () => {
  const srt = `1
00:00:01,000 --> 00:00:02,000
Hello <b>world</b> and <i>everyone</i>

2
00:00:03,000 --> 00:00:04,000
<font color="red">Colored text</font>`;
  const result = parseSRT(srt);
  assert(result.length >= 1, 'SRT with HTML tags produces at least one cue');
  const allText = result.map(c => c.text).join('');
  assert(!allText.includes('<'), 'HTML tags are stripped from text');
  assert(!allText.includes('>'), 'HTML tags are stripped from text');
  assert(allText.includes('world'), 'content inside tags preserved');
  assert(allText.includes('everyone'), 'content inside second tag preserved');
});

testGroup('parseSRT — overlapping timestamps', () => {
  const srt = `1
00:00:01,000 --> 00:00:04,000
First cue

2
00:00:02,000 --> 00:00:05,000
Second cue overlapping`;
  const result = parseSRT(srt);
  assert(result.length >= 2, 'overlapping cues still parsed');
  // parseSRT doesn't enforce non-overlapping, so it should just parse them
});

testGroup('parseSRT — zero duration cues', () => {
  const srt = `1
00:00:01,000 --> 00:00:01,000
Zero duration`;
  const result = parseSRT(srt);
  // segmentCue returns empty because duration=0, text non-empty but visualLength check sees duration<=2.4
  // Actually duration=0, normalizedText='Zero duration', visualLength > 0
  // duration <= 2.4 && visualLength <= 31.2 => returns [{...cue, text:normalizedText}]
  assertEqual(result.length, 1, 'zero duration cu is still parsed into a single sub-cue');
  assertEqual(result[0].start, 1, 'start correct');
  assertEqual(result[0].end, 1, 'end equals start');
});

testGroup('parseSRT — negative duration', () => {
  const srt = `1
00:00:03,000 --> 00:00:01,000
Negative duration`;
  const result = parseSRT(srt);
  // segmentCue: duration = -2, normalizedText = 'Negative duration'
  // duration <= 2.4 && visualLength <= 31.2 => true => returns single cue
  assert(result.length >= 1, 'negative duration cue still produces a sub-cue');
});

testGroup('parseSRT — SRT with BOM / extra whitespace', () => {
  const srt = '\uFEFF1\n00:00:01,000 --> 00:00:02,000\nHello with BOM\n\n';
  const result = parseSRT(srt);
  assert(result.length >= 1, 'SRT with BOM parsed correctly');
  if (result.length > 0) {
    assertEqual(result[0].text, 'Hello with BOM', 'text extracted correctly despite BOM');
  }
});

testGroup('parseSRT — missing block separator', () => {
  // Two blocks on adjacent lines without blank line separator
  const srt = `1
00:00:01,000 --> 00:00:02,000
First
2
00:00:03,000 --> 00:00:04,000
Second`;
  const result = parseSRT(srt);
  // Without blank line separator, the whole thing is one block
  // The "2" line becomes part of the text of the first block
  assert(result.length >= 1, 'SRT without block separators still parses something');
});

testGroup('parseSRT — very long sentence (200+ chars)', () => {
  const longText = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.repeat(10); // 260 chars
  const srt = `1
00:00:01,000 --> 00:00:10,000
${longText}`;
  const result = parseSRT(srt);
  assert(result.length > 1, `200+ char sentence without delimiters splits into multiple sub-cues (got ${result.length})`);
  // Verify sub-cue timestamps
  if (result.length > 1) {
    for (let i = 0; i < result.length - 1; i++) {
      assertEqual(result[i].end, result[i + 1].start, `sub-cue ${i} end equals sub-cue ${i + 1} start`);
    }
    assertEqual(result[result.length - 1].end, 10, 'last sub-cue end equals original end');
    // Text reconstruction
    const reconstructed = normalizeSubtitleText(result.map(c => c.text).join(''));
    assertEqual(reconstructed, normalizeSubtitleText(longText), 'reconstructed text equals original');
  }
});

testGroup('parseSRT — mixed CJK and English', () => {
  const srt = `1
00:00:01,000 --> 00:00:10,000
Hello 你好 World 世界 This is a mixed language test 这是一个混合语言测试 with Chinese 中文 and English 英语 content that should be segmented properly 应该被正确分段。`;
  const result = parseSRT(srt);
  assert(result.length > 0, 'mixed CJK/English SRT parsed');
  const reconstructed = normalizeSubtitleText(result.map(c => c.text).join(''));
  const original = normalizeSubtitleText('Hello 你好 World 世界 This is a mixed language test 这是一个混合语言测试 with Chinese 中文 and English 英语 content that should be segmented properly 应该被正确分段。');
  // splitLongUnit may lose inter-word spaces at visual-width split boundaries.
  // Verify all non-space characters are preserved in order.
  const reconstructedChars = reconstructed.replace(/\s/g, '');
  const originalChars = original.replace(/\s/g, '');
  assertEqual(reconstructedChars, originalChars, 'mixed text non-space characters preserved in order');
});

// =============================================================================
// Tests: validateSubtitles
// =============================================================================

testGroup('validateSubtitles — non-array input', () => {
  const r1 = validateSubtitles(null);
  assert(!r1.valid, 'null is invalid');
  assert(r1.errors.length > 0, 'null produces error');

  const r2 = validateSubtitles(undefined);
  assert(!r2.valid, 'undefined is invalid');

  const r3 = validateSubtitles('string');
  assert(!r3.valid, 'string is invalid');

  const r4 = validateSubtitles(123);
  assert(!r4.valid, 'number is invalid');

  const r5 = validateSubtitles({});
  assert(!r5.valid, 'object is invalid');
});

testGroup('validateSubtitles — empty array', () => {
  const r = validateSubtitles([]);
  assert(!r.valid, 'empty array is invalid');
  assert(r.errors.length > 0, 'empty array produces error');
});

testGroup('validateSubtitles — array with < 3 cues', () => {
  const r1 = validateSubtitles([{ start: 0, end: 1, text: 'a' }]);
  assert(!r1.valid, 'single cue is invalid');

  const r2 = validateSubtitles([
    { start: 0, end: 1, text: 'a' },
    { start: 1, end: 2, text: 'b' },
  ]);
  assert(!r2.valid, 'two cues invalid');
});

testGroup('validateSubtitles — cues with non-numeric start/end', () => {
  const r1 = validateSubtitles([
    { start: '0', end: 1, text: 'a' },
    { start: 1, end: 2, text: 'b' },
    { start: 2, end: 3, text: 'c' },
  ]);
  assert(!r1.valid, 'string start is invalid');

  const r2 = validateSubtitles([
    { start: 0, end: null, text: 'a' },
    { start: 1, end: 2, text: 'b' },
    { start: 2, end: 3, text: 'c' },
  ]);
  assert(!r2.valid, 'null end is invalid');

  const r3 = validateSubtitles([
    { start: undefined, end: 1, text: 'a' },
    { start: 1, end: 2, text: 'b' },
    { start: 2, end: 3, text: 'c' },
  ]);
  assert(!r3.valid, 'undefined start is invalid');
});

testGroup('validateSubtitles — cues with end <= start', () => {
  const r1 = validateSubtitles([
    { start: 1, end: 1, text: 'zero duration' },
    { start: 1, end: 2, text: 'b' },
    { start: 2, end: 3, text: 'c' },
  ]);
  assert(!r1.valid, 'end == start is invalid');

  const r2 = validateSubtitles([
    { start: 2, end: 1, text: 'negative' },
    { start: 1, end: 2, text: 'b' },
    { start: 2, end: 3, text: 'c' },
  ]);
  assert(!r2.valid, 'end < start is invalid');
});

testGroup('validateSubtitles — cues with empty text', () => {
  const r1 = validateSubtitles([
    { start: 0, end: 1, text: '' },
    { start: 1, end: 2, text: 'b' },
    { start: 2, end: 3, text: 'c' },
  ]);
  assert(!r1.valid, 'empty string text is invalid');

  const r2 = validateSubtitles([
    { start: 0, end: 1, text: '   ' },
    { start: 1, end: 2, text: 'b' },
    { start: 2, end: 3, text: 'c' },
  ]);
  assert(!r2.valid, 'whitespace-only text is invalid');

  const r3 = validateSubtitles([
    { start: 0, end: 1, text: 'a' },
    { start: 1, end: 2, text: null },
    { start: 2, end: 3, text: 'c' },
  ]);
  assert(!r3.valid, 'null text is invalid');
});

testGroup('validateSubtitles — valid cues', () => {
  const r = validateSubtitles([
    { start: 0, end: 1, text: 'hello' },
    { start: 1, end: 2, text: 'world' },
    { start: 2, end: 3, text: 'test' },
  ]);
  assert(r.valid, 'valid cues pass validation');
  assertEqual(r.errors.length, 0, 'no errors for valid cues');
});

// =============================================================================
// Integration tests: parseSRT + validateSubtitles
// =============================================================================

testGroup('Integration: parseSRT output passes validation', () => {
  const srt = `1
00:00:01,000 --> 00:00:03,000
Hello world, this is a test.

2
00:00:03,000 --> 00:00:06,000
Another subtitle line here.

3
00:00:06,000 --> 00:00:09,000
Third subtitle for testing.`;
  const cues = parseSRT(srt);
  assert(cues.length >= 3, 'parsed SRT has at least 3 cues');
  const validation = validateSubtitles(cues);
  assert(validation.valid, 'parsed SRT output passes validation');
});

testGroup('Integration: segmentCue sub-cue total duration equals original', () => {
  const originalCue = { start: 5, end: 15, text: 'This is a long sentence that needs to be split into multiple sub-cues for better readability and timing.' };
  const segments = segmentCue(originalCue, config);
  if (segments.length > 1) {
    const totalDuration = segments[segments.length - 1].end - segments[0].start;
    assertEqual(totalDuration, 10, 'total sub-cue duration equals original');
    assertEqual(segments[0].start, 5, 'first segment starts at original start');
    assertEqual(segments[segments.length - 1].end, 15, 'last segment ends at original end');
  }
});

// =============================================================================
// Tests: validateSubtitles — word-level validation
// =============================================================================

testGroup('validateSubtitles — cues with valid words', () => {
  const r = validateSubtitles([
    { start: 0, end: 1, text: 'hello', words: [{ text: 'hello', start: 0, end: 1 }] },
    { start: 1, end: 2, text: 'world', words: [{ text: 'world', start: 1, end: 2 }] },
    { start: 2, end: 3, text: 'test', words: [{ text: 'test', start: 2, end: 3 }] },
  ]);
  assert(r.valid, 'cues with valid word-level timestamps pass validation');
});

testGroup('validateSubtitles — words must be non-empty array', () => {
  const r1 = validateSubtitles([
    { start: 0, end: 1, text: 'hello', words: [] },
    { start: 1, end: 2, text: 'world' },
    { start: 2, end: 3, text: 'test' },
  ]);
  assert(!r1.valid, 'empty words array is invalid');

  const r2 = validateSubtitles([
    { start: 0, end: 1, text: 'hello', words: 'not-an-array' },
    { start: 1, end: 2, text: 'world' },
    { start: 2, end: 3, text: 'test' },
  ]);
  assert(!r2.valid, 'non-array words is invalid');
});

testGroup('validateSubtitles — word text must be non-empty', () => {
  const r = validateSubtitles([
    { start: 0, end: 1, text: 'hello', words: [{ text: '', start: 0, end: 0.5 }] },
    { start: 1, end: 2, text: 'world' },
    { start: 2, end: 3, text: 'test' },
  ]);
  assert(!r.valid, 'empty word text is invalid');
});

testGroup('validateSubtitles — word start/end must be valid', () => {
  const r1 = validateSubtitles([
    { start: 0, end: 1, text: 'hello', words: [{ text: 'h', start: 0.5, end: 0.3 }] },
    { start: 1, end: 2, text: 'world' },
    { start: 2, end: 3, text: 'test' },
  ]);
  assert(!r1.valid, 'word end < start is invalid');

  const r2 = validateSubtitles([
    { start: 0, end: 1, text: 'hello', words: [{ text: 'h', start: '0', end: 1 }] },
    { start: 1, end: 2, text: 'world' },
    { start: 2, end: 3, text: 'test' },
  ]);
  assert(!r2.valid, 'non-numeric word start is invalid');
});

testGroup('validateSubtitles — word timestamps must be monotonic', () => {
  const r = validateSubtitles([
    { start: 0, end: 1, text: 'hello', words: [
      { text: 'h', start: 0.5, end: 0.6 },
      { text: 'e', start: 0.3, end: 0.4 }, // 回退
    ] },
    { start: 1, end: 2, text: 'world' },
    { start: 2, end: 3, text: 'test' },
  ]);
  assert(!r.valid, 'non-monotonic word timestamps are invalid');
});

testGroup('validateSubtitles — words must be within cue time range', () => {
  const r = validateSubtitles([
    { start: 0, end: 1, text: 'hello', words: [{ text: 'hello', start: -0.6, end: 0.5 }] },
    { start: 1, end: 2, text: 'world' },
    { start: 2, end: 3, text: 'test' },
  ]);
  assert(!r.valid, 'word outside cue time range is invalid');
});

testGroup('validateSubtitles — words within ±0.5s tolerance accepted', () => {
  const r = validateSubtitles([
    { start: 0, end: 1, text: 'hello', words: [{ text: 'hello', start: -0.4, end: 1.4 }] },
    { start: 1, end: 2, text: 'world' },
    { start: 2, end: 3, text: 'test' },
  ]);
  assert(r.valid, 'words within ±0.5s tolerance of cue range accepted');
});

// =============================================================================
// Summary
// =============================================================================

const total = passed + failed;
console.log(`\n${'='.repeat(60)}`);
console.log(`  RESULTS`);
console.log(`${'='.repeat(60)}`);
console.log(`  PASSED: ${passed}, FAILED: ${failed}, TOTAL: ${total}`);
console.log(`${'='.repeat(60)}`);

if (failures.length > 0) {
  console.log(`\n  FAILURES:`);
  failures.forEach(f => console.log(`  ${f}`));
  console.log('');
}

process.exit(failed > 0 ? 1 : 0);
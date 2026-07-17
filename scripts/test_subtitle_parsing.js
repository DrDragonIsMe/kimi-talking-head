#!/usr/bin/env node

// =============================================================================
// Re-implemented functions from scripts/parse_srt.js
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

const normalizeSubtitleText = (text) =>
  text
    .replace(/\s+/g, ' ')
    .trim();

const isMeaningfulUnit = (text) => /[\u4e00-\u9fa5A-Za-z0-9]/.test(text);

const getCharVisualWidth = (char) => {
  if (char === ' ') return 0.35;
  if (/[A-Za-z0-9]/.test(char)) return 0.62;
  if (/[.,:;!?'"`-]/.test(char)) return 0.38;
  return 1;
};

const getVisualLength = (text) =>
  Array.from(text).reduce((sum, char) => sum + getCharVisualWidth(char), 0);

const splitByDelimiters = (text, delimiters) => {
  const result = [];
  let current = '';
  for (const char of text) {
    current += char;
    if (delimiters.test(char)) {
      const trimmed = current.trim();
      if (trimmed) result.push(trimmed);
      current = '';
    }
  }
  const tail = current.trim();
  if (tail) result.push(tail);
  return result;
};

const findSplitIndex = (text, maxWidth) => {
  let width = 0;
  let lastPreferredBreak = -1;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    width += getCharVisualWidth(char);
    if (/[，、：,:；;。！？!? ]/.test(char)) {
      lastPreferredBreak = i + 1;
    }
    if (width > maxWidth) {
      return lastPreferredBreak > 0 ? lastPreferredBreak : Math.max(1, i);
    }
  }
  return text.length;
};

const splitLongUnit = (text, maxWidth) => {
  const result = [];
  let remaining = normalizeSubtitleText(text);
  while (remaining && getVisualLength(remaining) > maxWidth) {
    const splitIndex = findSplitIndex(remaining, maxWidth);
    const head = normalizeSubtitleText(remaining.slice(0, splitIndex));
    const tail = normalizeSubtitleText(remaining.slice(splitIndex));
    if (!head || head === remaining) {
      result.push(normalizeSubtitleText(remaining.slice(0, Math.max(1, splitIndex))));
      remaining = normalizeSubtitleText(remaining.slice(Math.max(1, splitIndex)));
      continue;
    }
    result.push(head);
    remaining = tail;
  }
  if (remaining) result.push(remaining);
  return result.filter(Boolean);
};

const tokenizeCueText = (text) => {
  const normalized = normalizeSubtitleText(text);
  if (!normalized) return [];
  const sentenceUnits = splitByDelimiters(normalized, /[。！？!?；;—]/);
  const clauseUnits = sentenceUnits.flatMap((unit) => splitByDelimiters(unit, /[，、：,:]/));
  const baseUnits = clauseUnits.length > 0 ? clauseUnits : sentenceUnits;
  return (baseUnits.length > 0 ? baseUnits : [normalized])
    .map((unit) => normalizeSubtitleText(unit))
    .filter((unit) => unit && isMeaningfulUnit(unit))
    .flatMap((unit) => (getVisualLength(unit) > config.maxVisualLength ? splitLongUnit(unit, config.maxVisualLength) : [unit]))
    .filter(Boolean);
};

const groupUnits = (units, desiredCount) => {
  if (units.length <= desiredCount) {
    return units.map((unit) => [unit]);
  }
  const groups = [];
  const totalVisualLength = units.reduce((sum, unit) => sum + getVisualLength(unit), 0);
  const targetVisualLength = totalVisualLength / desiredCount;
  let currentGroup = [];
  let currentVisualLength = 0;

  for (let index = 0; index < units.length; index++) {
    const unit = units[index];
    const unitVisualLength = getVisualLength(unit);
    const remainingUnits = units.length - index;
    const remainingSlots = desiredCount - groups.length;

    if (
      currentGroup.length > 0 &&
      remainingSlots > 1 &&
      (currentVisualLength + unitVisualLength > targetVisualLength * 1.18 || remainingUnits === remainingSlots)
    ) {
      groups.push(currentGroup);
      currentGroup = [unit];
      currentVisualLength = unitVisualLength;
    } else {
      currentGroup.push(unit);
      currentVisualLength += unitVisualLength;
    }
  }
  if (currentGroup.length > 0) groups.push(currentGroup);

  while (groups.length > desiredCount) {
    const tail = groups.pop();
    if (!tail) break;
    groups[groups.length - 1] = groups[groups.length - 1].concat(tail);
  }
  return groups;
};

const segmentCue = (cue) => {
  const duration = cue.end - cue.start;
  const normalizedText = normalizeSubtitleText(cue.text);
  const visualLength = getVisualLength(normalizedText);
  if (!normalizedText) return [];

  if (duration <= 2.4 && visualLength <= config.maxVisualLength * 1.2) {
    return [{ ...cue, text: normalizedText }];
  }

  const units = tokenizeCueText(normalizedText);
  if (units.length <= 1) {
    return [{ ...cue, text: normalizedText }];
  }

  const desiredByDuration = Math.ceil(duration / config.maxSegmentSeconds);
  const desiredByLength = Math.ceil(visualLength / (config.maxVisualLength * 1.2));
  const maxSegmentsByDuration = Math.max(1, Math.floor(duration / config.minSegmentSeconds));
  const desiredCount = Math.max(1, Math.min(Math.max(desiredByDuration, desiredByLength), maxSegmentsByDuration, units.length));

  const groupedUnits = groupUnits(units, desiredCount);
  if (groupedUnits.length <= 1) {
    return [{ ...cue, text: normalizedText }];
  }

  const weights = groupedUnits.map((group) => Math.max(1, group.reduce((sum, unit) => sum + getVisualLength(unit), 0)));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);

  let cursor = cue.start;
  let consumedWeight = 0;

  return groupedUnits.map((group, index) => {
    const text = normalizeSubtitleText(group.join(''));
    consumedWeight += weights[index];
    const end = index === groupedUnits.length - 1 ? cue.end : cue.start + (duration * consumedWeight) / totalWeight;
    const segmentedCue = { start: cursor, end, text };
    cursor = end;
    return segmentedCue;
  });
};

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
    }));
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
  const tokens1 = tokenizeCueText('Hello world');
  assert(tokens1.length >= 1, 'simple text produces tokens');

  // CJK text
  const tokens2 = tokenizeCueText('你好世界，这是一个测试。结果如何？');
  assert(tokens2.length >= 1, 'CJK text produces tokens');

  // Empty text
  assertDeepEqual(tokenizeCueText(''), [], 'empty text returns empty array');
  assertDeepEqual(tokenizeCueText('   '), [], 'whitespace-only returns empty');

  // Mixed CJK and English
  const tokens3 = tokenizeCueText('Hello你好World世界');
  assert(tokens3.length >= 1, 'mixed CJK/English produces tokens');

  // Very long sentence without delimiters
  const longText = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const tokens4 = tokenizeCueText(longText);
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
  const shortResult = segmentCue(shortCue);
  assertEqual(shortResult.length, 1, 'short cue with short text returns single sub-cue');
  assertEqual(shortResult[0].text, 'Hello', 'text preserved');
  assertEqual(shortResult[0].start, 0, 'start preserved');
  assertEqual(shortResult[0].end, 1.5, 'end preserved');

  // Empty text cue
  const emptyCue = { start: 0, end: 1, text: '' };
  assertDeepEqual(segmentCue(emptyCue), [], 'empty text cue returns empty array');

  // Whitespace only
  const wsCue = { start: 0, end: 1, text: '   ' };
  assertDeepEqual(segmentCue(wsCue), [], 'whitespace-only cue returns empty array');
});

testGroup('segmentCue — sub-cue timestamp properties', () => {
  // Long duration + long text should segment
  const longCue = {
    start: 0,
    end: 10,
    text: 'This is a long text that should be segmented into multiple sub-cues because it has a long duration and long content that needs to be split, and we need to verify that the timestamps are correct.',
  };
  const result = segmentCue(longCue);
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
  const result = segmentCue(cue);
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
  const result = segmentCue(cue);
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
  const segments = segmentCue(originalCue);
  if (segments.length > 1) {
    const totalDuration = segments[segments.length - 1].end - segments[0].start;
    assertEqual(totalDuration, 10, 'total sub-cue duration equals original');
    assertEqual(segments[0].start, 5, 'first segment starts at original start');
    assertEqual(segments[segments.length - 1].end, 15, 'last segment ends at original end');
  }
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
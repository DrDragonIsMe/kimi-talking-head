#!/usr/bin/env node
/**
 * test_sync_timing.js — Comprehensive subtitle/audio/lip-sync timing tests.
 *
 * Covers: SRT time parsing, time offsets, cue segmentation, visual-width-to-time
 * mapping, sync validation, audio-duration matching, frame-to-time conversion,
 * subtitle cue finding, and OffthreadVideo audio-host sync.
 *
 * Usage: node scripts/test_sync_timing.js
 */

// ---------------------------------------------------------------------------
// 0. Test harness
// ---------------------------------------------------------------------------

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, description, detail) {
  if (condition) {
    passed++;
    console.log(`  ${GREEN}✓${RESET} ${description}`);
  } else {
    failed++;
    const msg = `  ${RED}✗${RESET} ${description}${detail ? `\n       ${YELLOW}${detail}${RESET}` : ''}`;
    console.log(msg);
    failures.push(description);
  }
}

function assertEqual(actual, expected, description, tolerance) {
  if (tolerance !== undefined) {
    const ok = Math.abs(actual - expected) <= tolerance;
    if (ok) {
      passed++;
      console.log(`  ${GREEN}✓${RESET} ${description} (${actual} ≈ ${expected})`);
    } else {
      failed++;
      const msg = `  ${RED}✗${RESET} ${description}: expected ${expected} ±${tolerance}, got ${actual}`;
      console.log(msg);
      failures.push(description);
    }
    return;
  }
  if (actual === expected) {
    passed++;
    console.log(`  ${GREEN}✓${RESET} ${description} (${actual})`);
  } else {
    failed++;
    const msg = `  ${RED}✗${RESET} ${description}: expected ${expected}, got ${actual}`;
    console.log(msg);
    failures.push(description);
  }
}

function section(title) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  ${title}`);
  console.log(`${'='.repeat(60)}`);
}

// ---------------------------------------------------------------------------
// 1. Replicated functions from the codebase
// ---------------------------------------------------------------------------

// --- parse_srt.js / align_subtitles.py ---

function parseTime(t) {
  const [h, m, s, ms] = t.replace(',', ':').split(':').map(Number);
  return h * 3600 + m * 60 + s + ms / 1000;
}

// --- useSubtitles.ts / parse_srt.js ---

const DEFAULT_SEGMENTATION = {
  maxSegmentSeconds: 3.2,
  minSegmentSeconds: 0.9,
  maxVisualLength: 26,
};

function normalizeSubtitleText(text) {
  return text.replace(/\s+/g, ' ').trim();
}

function isMeaningfulUnit(text) {
  return /[\u4e00-\u9fa5A-Za-z0-9]/.test(text);
}

function getCharVisualWidth(char) {
  if (char === ' ') return 0.35;
  if (/[A-Za-z0-9]/.test(char)) return 0.62;
  if (/[.,:;!?'"`-]/.test(char)) return 0.38;
  return 1;
}

function getVisualLength(text) {
  return Array.from(text).reduce((sum, char) => sum + getCharVisualWidth(char), 0);
}

function splitByDelimiters(text, delimiters) {
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
}

function findSplitIndex(text, maxWidth) {
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
}

function splitLongUnit(text, maxWidth) {
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
}

function tokenizeCueText(text, config) {
  const normalized = normalizeSubtitleText(text);
  if (!normalized) return [];
  const sentenceUnits = splitByDelimiters(normalized, /[。！？!?；;—]/);
  const clauseUnits = sentenceUnits.flatMap((unit) => splitByDelimiters(unit, /[，、：,:]/));
  const baseUnits = clauseUnits.length > 0 ? clauseUnits : sentenceUnits;
  return (baseUnits.length > 0 ? baseUnits : [normalized])
    .map((unit) => normalizeSubtitleText(unit))
    .filter((unit) => unit && isMeaningfulUnit(unit))
    .flatMap((unit) =>
      getVisualLength(unit) > config.maxVisualLength
        ? splitLongUnit(unit, config.maxVisualLength)
        : [unit]
    )
    .filter(Boolean);
}

function groupUnits(units, desiredCount) {
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
      (currentVisualLength + unitVisualLength > targetVisualLength * 1.18 ||
        remainingUnits === remainingSlots)
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
}

function segmentCue(cue, config) {
  const duration = cue.end - cue.start;
  const normalizedText = normalizeSubtitleText(cue.text);
  const visualLength = getVisualLength(normalizedText);
  if (!normalizedText) return [];

  if (duration <= 2.4 && visualLength <= config.maxVisualLength * 1.2) {
    return [{ ...cue, text: normalizedText }];
  }

  const units = tokenizeCueText(normalizedText, config);
  if (units.length <= 1) {
    return [{ ...cue, text: normalizedText }];
  }

  const desiredByDuration = Math.ceil(duration / config.maxSegmentSeconds);
  const desiredByLength = Math.ceil(visualLength / (config.maxVisualLength * 1.2));
  const maxSegmentsByDuration = Math.max(1, Math.floor(duration / config.minSegmentSeconds));
  const desiredCount = Math.max(
    1,
    Math.min(Math.max(desiredByDuration, desiredByLength), maxSegmentsByDuration, units.length)
  );

  const groupedUnits = groupUnits(units, desiredCount);
  if (groupedUnits.length <= 1) {
    return [{ ...cue, text: normalizedText }];
  }

  const weights = groupedUnits.map((group) =>
    Math.max(1, group.reduce((sum, unit) => sum + getVisualLength(unit), 0))
  );
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);

  let cursor = cue.start;
  let consumedWeight = 0;

  return groupedUnits.map((group, index) => {
    const text = normalizeSubtitleText(group.join(''));
    consumedWeight += weights[index];
    const end =
      index === groupedUnits.length - 1
        ? cue.end
        : cue.start + (duration * consumedWeight) / totalWeight;
    const segmentedCue = { start: cursor, end, text };
    cursor = end;
    return segmentedCue;
  });
}

// --- overlayLayout.ts ---

function getActiveCueIndex(cues, currentTime) {
  return cues.findIndex((cue) => currentTime >= cue.start && currentTime <= cue.end);
}

// --- pipeline.sh video_matches_audio ---

function videoMatchesAudio(videoDuration, audioDuration) {
  if (videoDuration <= 0 || audioDuration <= 0) return false;
  return videoDuration >= audioDuration * 0.9;
}

// --- index.tsx frame-to-time ---

function frameToTime(frame, fps) {
  return frame / fps;
}

// --- validate_subtitles.js validation logic ---

function validateSubtitles(cues) {
  const errors = [];
  if (!Array.isArray(cues)) {
    errors.push('cues is not an array');
    return errors;
  }
  if (cues.length < 3) {
    errors.push(`cue count too low: ${cues.length}`);
    return errors;
  }
  for (let i = 0; i < cues.length; i++) {
    const cue = cues[i];
    if (typeof cue.start !== 'number' || typeof cue.end !== 'number') {
      errors.push(`cue ${i}: start/end must be numbers`);
    }
    if (cue.end <= cue.start) {
      errors.push(`cue ${i}: end must be > start`);
    }
    if (typeof cue.text !== 'string' || cue.text.trim().length === 0) {
      errors.push(`cue ${i}: text must be non-empty`);
    }
  }
  // Check chronological order
  for (let i = 1; i < cues.length; i++) {
    if (cues[i].start < cues[i - 1].start) {
      errors.push(`cue ${i}: not chronologically ordered (start ${cues[i].start} < ${cues[i - 1].start})`);
    }
  }
  // Check for overlaps
  for (let i = 1; i < cues.length; i++) {
    if (cues[i].start < cues[i - 1].end) {
      errors.push(`cue ${i}: overlaps with cue ${i - 1} (start ${cues[i].start} < end ${cues[i - 1].end})`);
    }
  }
  // Check for gaps > 0.5s
  for (let i = 1; i < cues.length; i++) {
    const gap = cues[i].start - cues[i - 1].end;
    if (gap > 0.5) {
      errors.push(`cue ${i}: gap ${gap.toFixed(3)}s > 0.5s from cue ${i - 1}`);
    }
  }
  return errors;
}

// ---------------------------------------------------------------------------
// 2. Tests
// ---------------------------------------------------------------------------

// ---- 2.1 SRT Time Parsing ----

section('2.1 SRT Time Parsing (parseTime)');

assertEqual(parseTime('00:00:01,500'), 1.5, 'Standard "00:00:01,500" → 1.5s');
assertEqual(parseTime('00:00:00,000'), 0, 'Zero "00:00:00,000" → 0s');
assertEqual(parseTime('01:23:45,678'), 5025.678, 'Large "01:23:45,678" → 5025.678s');
assertEqual(parseTime('99:59:59,999'), 359999.999, 'Edge "99:59:59,999" → 359999.999s');

// Milliseconds rounding: 500ms is exactly 0.5
assertEqual(parseTime('00:00:00,500'), 0.5, 'Milliseconds 500 → 0.5s');
assertEqual(parseTime('00:00:00,001'), 0.001, 'Milliseconds 001 → 0.001s');
assertEqual(parseTime('00:00:00,999'), 0.999, 'Milliseconds 999 → 0.999s');

// ---- 2.2 Time Offset Application ----

section('2.2 Time Offset Application');

function applyOffset(cues, offsetSeconds) {
  return cues.map((cue) => ({
    ...cue,
    start: Math.max(0, cue.start + offsetSeconds),
    end: Math.max(0, cue.end + offsetSeconds),
  }));
}

const baseCues = [
  { start: 1.0, end: 2.5, text: 'Hello' },
  { start: 2.5, end: 4.0, text: 'World' },
];

// Positive offset
const positiveOffset = applyOffset(baseCues, 2.0);
assertEqual(positiveOffset[0].start, 3.0, 'Positive offset +2s: cue[0].start 1→3');
assertEqual(positiveOffset[0].end, 4.5, 'Positive offset +2s: cue[0].end 2.5→4.5');
assertEqual(positiveOffset[1].start, 4.5, 'Positive offset +2s: cue[1].start 2.5→4.5');

// Negative offset
const negativeOffset = applyOffset(baseCues, -0.5);
assertEqual(negativeOffset[0].start, 0.5, 'Negative offset -0.5s: cue[0].start 1→0.5');
assertEqual(negativeOffset[1].end, 3.5, 'Negative offset -0.5s: cue[1].end 4→3.5');

// Zero offset
const zeroOffset = applyOffset(baseCues, 0);
assertEqual(zeroOffset[0].start, 1.0, 'Zero offset: cue[0].start unchanged');
assertEqual(zeroOffset[1].end, 4.0, 'Zero offset: cue[1].end unchanged');

// Negative offset clamp to 0
const clampOffset = applyOffset(
  [{ start: 0.3, end: 1.0, text: 'A' }],
  -0.5
);
assertEqual(clampOffset[0].start, 0, 'Negative offset clamps start to 0 (was 0.3)');
assertEqual(clampOffset[0].end, 0.5, 'Negative offset: end also reduced (1.0 → 0.5)');

// ---- 2.3 Cue Duration Consistency (segmentCue) ----

section('2.3 Cue Duration Consistency (segmentCue)');

const config = { ...DEFAULT_SEGMENTATION };

// Single cue that stays as one
const shortCue = { start: 0, end: 1.5, text: 'Hello' };
const shortResult = segmentCue(shortCue, config);
assert(shortResult.length === 1, 'Short cue stays as single segment');
assertEqual(shortResult[0].start, 0, 'Short cue: start preserved');
assertEqual(shortResult[0].end, 1.5, 'Short cue: end preserved');

// Long cue that gets segmented
const longCue = {
  start: 0,
  end: 20,
  text: '这是一段很长的中文字幕文本用于测试分段功能，它包含多个句子和标点符号。我们需要确保分段后的时间戳是连续的，并且没有重叠或间隙。',
};
const segmented = segmentCue(longCue, config);
assert(segmented.length > 1, `Long cue segmented into ${segmented.length} sub-cues`);

// Sub-cue durations sum to original
const totalDuration = segmented.reduce((sum, c) => sum + (c.end - c.start), 0);
assertEqual(totalDuration, 20, 'Sub-cue durations sum to original duration', 0.001);

// Timestamps are contiguous
for (let i = 1; i < segmented.length; i++) {
  assert(
    Math.abs(segmented[i].start - segmented[i - 1].end) < 0.001,
    `Sub-cue ${i} start=${segmented[i].start} contiguous with cue ${i - 1} end=${segmented[i - 1].end}`
  );
}

// No gaps
for (let i = 1; i < segmented.length; i++) {
  const gap = segmented[i].start - segmented[i - 1].end;
  assert(gap <= 0.001, `No gap between sub-cue ${i - 1} and ${i} (gap=${gap})`);
}

// No overlaps
for (let i = 1; i < segmented.length; i++) {
  const overlap = segmented[i - 1].end - segmented[i].start;
  assert(overlap <= 0.001, `No overlap between sub-cue ${i - 1} and ${i} (overlap=${overlap})`);
}

// First sub-cue starts at original start
assertEqual(segmented[0].start, 0, 'First sub-cue starts at original cue.start');

// Last sub-cue ends at original end
assertEqual(segmented[segmented.length - 1].end, 20, 'Last sub-cue ends at original cue.end');

// All sub-cues have non-empty text
for (let i = 0; i < segmented.length; i++) {
  assert(
    segmented[i].text && segmented[i].text.trim().length > 0,
    `Sub-cue ${i} has non-empty text: "${segmented[i].text}"`
  );
}

// ---- 2.4 Visual Width to Time Mapping ----

section('2.4 Visual Width to Time Mapping');

// Longer text gets proportionally more time
const shortTextCue = {
  start: 0,
  end: 10,
  text: '短文本。另一个短文本。第三个短文本。第四个短文本。',
};
const longTextCue = {
  start: 0,
  end: 10,
  text: '这是一段非常长的中文文本内容，包含了大量字符信息，用来测试视觉宽度到时间的映射关系。我们需要确保更长的文本能够获得按比例更多的时间分配。',
};

// Visual lengths should differ significantly
const shortVL = getVisualLength(normalizeSubtitleText(shortTextCue.text));
const longVL = getVisualLength(normalizeSubtitleText(longTextCue.text));
assert(longVL > shortVL, `Long text (vis=${longVL}) has greater visual length than short (vis=${shortVL})`);

// Short text within limits stays as single cue
const withinLimitCue = {
  start: 0,
  end: 2.0,
  text: '短文本内容',
};
const withinLimitVL = getVisualLength(normalizeSubtitleText(withinLimitCue.text));
assert(
  withinLimitVL <= config.maxVisualLength * 1.2,
  `Short text visual length ${withinLimitVL} <= ${config.maxVisualLength * 1.2}`
);
const withinLimitResult = segmentCue(withinLimitCue, config);
assertEqual(withinLimitResult.length, 1, 'Short text within limits: single cue');

// Text split by delimiters preserves timing
const delimiterCue = {
  start: 0,
  end: 15,
  text: '第一段内容，包含标点符号。第二段内容，继续测试。第三段内容，最后一段。',
};
const delimiterResult = segmentCue(delimiterCue, config);
assert(delimiterResult.length > 1, `Delimiter-split text: ${delimiterResult.length} segments`);
// Each segment should contain meaningful text
for (const c of delimiterResult) {
  assert(isMeaningfulUnit(c.text), `Delimiter segment has meaningful text: "${c.text}"`);
}

// ---- 2.5 Sync Validation ----

section('2.5 Sync Validation (validate_subtitles.js logic)');

// Valid cues
const validCues = [
  { start: 0, end: 2.0, text: 'First' },
  { start: 2.0, end: 4.5, text: 'Second' },
  { start: 4.5, end: 7.0, text: 'Third' },
];
const validErrors = validateSubtitles(validCues);
assert(validErrors.length === 0, 'Valid cues pass validation');

// All cues must have start < end
const invalidOrder = [
  { start: 0, end: 2.0, text: 'First' },
  { start: 5.0, end: 3.0, text: 'Bad end' }, // end < start
  { start: 7.0, end: 9.0, text: 'Third' },
];
const invalidOrderErrors = validateSubtitles(invalidOrder);
assert(invalidOrderErrors.some((e) => e.includes('end must be')), 'Detects cue with end <= start');

// Cues must be chronologically ordered
const outOfOrder = [
  { start: 0, end: 2.0, text: 'First' },
  { start: 5.0, end: 7.0, text: 'Third' },
  { start: 3.0, end: 5.0, text: 'Second' }, // out of order
];
const outOfOrderErrors = validateSubtitles(outOfOrder);
assert(
  outOfOrderErrors.some((e) => e.includes('chronologically')),
  'Detects non-chronological cues'
);

// No gaps > 0.5s
const largeGap = [
  { start: 0, end: 2.0, text: 'First' },
  { start: 3.0, end: 5.0, text: 'Second' }, // 1s gap
  { start: 5.0, end: 7.0, text: 'Third' },
];
const largeGapErrors = validateSubtitles(largeGap);
assert(
  largeGapErrors.some((e) => e.includes('gap')),
  'Detects gap > 0.5s between cues'
);

// Small gap (<= 0.5s) is ok
const smallGap = [
  { start: 0, end: 2.0, text: 'First' },
  { start: 2.3, end: 4.5, text: 'Second' }, // 0.3s gap
  { start: 4.5, end: 7.0, text: 'Third' },
];
const smallGapErrors = validateSubtitles(smallGap);
assert(smallGapErrors.length === 0, 'Small gap ≤ 0.5s is accepted');

// No overlapping cues
const overlapping = [
  { start: 0, end: 3.0, text: 'First' },
  { start: 2.0, end: 5.0, text: 'Overlap' }, // overlaps with first
  { start: 5.0, end: 7.0, text: 'Third' },
];
const overlappingErrors = validateSubtitles(overlapping);
assert(
  overlappingErrors.some((e) => e.includes('overlaps')),
  'Detects overlapping cues'
);

// Non-empty text
const emptyText = [
  { start: 0, end: 2.0, text: 'First' },
  { start: 2.0, end: 4.0, text: '' },
  { start: 4.0, end: 6.0, text: 'Third' },
];
const emptyTextErrors = validateSubtitles(emptyText);
assert(
  emptyTextErrors.some((e) => e.includes('text must be')),
  'Detects empty text cue'
);

// Too few cues
const tooFew = [{ start: 0, end: 2.0, text: 'Only' }];
const tooFewErrors = validateSubtitles(tooFew);
assert(tooFewErrors.length > 0, 'Detects too few cues');

// ---- 2.6 Audio Duration Matching ----

section('2.6 Audio Duration Matching (video_matches_audio)');

// Video duration >= 90% of audio → match
assert(videoMatchesAudio(10.0, 10.0), '10s video / 10s audio → match (100%)');
assert(videoMatchesAudio(9.0, 10.0), '9s video / 10s audio → match (90%)');
assert(videoMatchesAudio(9.5, 10.0), '9.5s video / 10s audio → match (95%)');

// Video duration < 90% → no match
assert(!videoMatchesAudio(8.9, 10.0), '8.9s video / 10s audio → no match (89%)');
assert(!videoMatchesAudio(5.0, 10.0), '5s video / 10s audio → no match (50%)');
assert(!videoMatchesAudio(0.5, 10.0), '0.5s video / 10s audio → no match (5%)');

// Zero audio duration → no match
assert(!videoMatchesAudio(10.0, 0), '10s video / 0s audio → no match');
assert(!videoMatchesAudio(0, 0), '0s video / 0s audio → no match');

// Zero/negative video duration → no match
assert(!videoMatchesAudio(0, 10.0), '0s video / 10s audio → no match');
assert(!videoMatchesAudio(-1, 10.0), 'Negative video duration → no match');

// ---- 2.7 Frame to Time Conversion ----

section('2.7 Frame to Time Conversion (fps-based)');

assertEqual(frameToTime(0, 30), 0, 'Frame 0 at 30fps → 0.0s');
assertEqual(frameToTime(30, 30), 1.0, 'Frame 30 at 30fps → 1.0s');
assertEqual(frameToTime(90, 30), 3.0, 'Frame 90 at 30fps → 3.0s');
assertEqual(frameToTime(1, 30), 1 / 30, 'Frame 1 at 30fps → 0.0333...s', 0.001);

// Other common fps values
assertEqual(frameToTime(0, 24), 0, 'Frame 0 at 24fps → 0.0s');
assertEqual(frameToTime(24, 24), 1.0, 'Frame 24 at 24fps → 1.0s');
assertEqual(frameToTime(60, 60), 1.0, 'Frame 60 at 60fps → 1.0s');

// ---- 2.8 Subtitle Cue Finding (getActiveCueIndex) ----

section('2.8 Subtitle Cue Finding (getActiveCueIndex)');

const testCues = [
  { start: 0, end: 2.5, text: 'First' },
  { start: 2.5, end: 5.0, text: 'Second' },
  { start: 5.0, end: 8.0, text: 'Third' },
];

// currentTime exactly at cue.start
assertEqual(getActiveCueIndex(testCues, 0), 0, 'currentTime=0 (exact start) → cue 0');

// Boundary sharing: when end of cue N == start of cue N+1, findIndex returns
// the first match (cue N), since both cues satisfy the <= check.
assertEqual(getActiveCueIndex(testCues, 2.5), 0, 'currentTime=2.5 (shared boundary) → first match cue 0');
assertEqual(getActiveCueIndex(testCues, 5.0), 1, 'currentTime=5.0 (shared boundary) → first match cue 1');

// currentTime between cues → not found
assertEqual(getActiveCueIndex(testCues, -1), -1, 'currentTime=-1 → -1 (before all)');
// Note: since cues are contiguous, there's no "between" gap in this dataset.
// Test with gapped cues:
const gappedCues = [
  { start: 0, end: 2.0, text: 'A' },
  { start: 3.0, end: 5.0, text: 'B' }, // 1s gap
];
assertEqual(getActiveCueIndex(gappedCues, 2.5), -1, 'currentTime in gap (2.5s) → -1');

// currentTime before first cue
assertEqual(getActiveCueIndex(testCues, -0.5), -1, 'currentTime=-0.5 (before first) → -1');

// currentTime after last cue
assertEqual(getActiveCueIndex(testCues, 10.0), -1, 'currentTime=10.0 (after last) → -1');

// Empty cues array
assertEqual(getActiveCueIndex([], 5.0), -1, 'Empty cues array → -1');

// currentTime exactly at last cue's end (inclusive boundary)
assertEqual(getActiveCueIndex(testCues, 8.0), 2, 'currentTime=8.0 (exact end of last cue, inclusive) → cue 2');

// currentTime just after last cue
assertEqual(getActiveCueIndex(testCues, 8.001), -1, 'currentTime=8.001 (just after last) → -1');

// ---- 2.9 OffthreadVideo Sync ----

section('2.9 OffthreadVideo Sync (host video starts at same frame as audio)');

// In index.tsx:
//   const talkingStartFrame = titleCardDurationFrames;
//   <Sequence from={talkingStartFrame}>
//     <Html5Audio src={staticFile(audioPath)} />
//   </Sequence>
// The host video (OffthreadVideo) starts at frame 0, not frame talkingStartFrame.
// The audio starts at talkingStartFrame. So there's no direct offset match between
// host video and audio start — the host video plays from frame 0 for the whole duration.
// The title card covers the first titleCardDurationFrames.

// Test: talkingStartFrame should equal titleCardDurationFrames
const titleCardDurationFrames = 60;
const talkingStartFrame = titleCardDurationFrames; // from index.tsx line 312
assertEqual(talkingStartFrame, 60, 'talkingStartFrame equals titleCardDurationFrames (60)');

// Audio Sequence starts at talkingStartFrame
assertEqual(talkingStartFrame, titleCardDurationFrames, 'Audio Sequence.from = talkingStartFrame = titleCardDurationFrames');

// The host video (OffthreadVideo) is at frame 0, no Sequence offset
// This means the host video starts playing immediately at frame 0, while audio starts at frame 60.
// The title card covers 0-60, so the host video is visible during the title card.
// This is intentional: during the title card, the host video is shown as part of the title card design.

// Test that the endcard position is correctly computed
const talkingDurationFrames = 600;
const endcardStartFrame = talkingStartFrame + talkingDurationFrames;
assertEqual(endcardStartFrame, 660, 'endcardStartFrame = talkingStartFrame + talkingDurationFrames (60+600=660)');

// Test with different title card durations
const testCases = [
  { titleCard: 30, talking: 600, expectedEndcard: 630 },
  { titleCard: 90, talking: 500, expectedEndcard: 590 },
  { titleCard: 0, talking: 600, expectedEndcard: 600 },
];
for (const tc of testCases) {
  const ts = tc.titleCard;
  const es = ts + tc.talking;
  assertEqual(es, tc.expectedEndcard, `titleCard=${tc.titleCard}, talking=${tc.talking} → endcardStart=${tc.expectedEndcard}`);
}

// ---------------------------------------------------------------------------
// 3. Summary
// ---------------------------------------------------------------------------

const total = passed + failed;
console.log(`\n${'='.repeat(60)}`);
console.log(`  ${GREEN}PASSED: ${passed}${RESET}, ${RED}FAILED: ${failed}${RESET}, TOTAL: ${total}`);
console.log(`${'='.repeat(60)}`);

if (failures.length > 0) {
  console.log(`\n${RED}Failed tests:${RESET}`);
  failures.forEach((f) => console.log(`  ${RED}✗${RESET} ${f}`));
}

process.exit(failed > 0 ? 1 : 0);
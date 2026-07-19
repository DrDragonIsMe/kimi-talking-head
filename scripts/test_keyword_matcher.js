#!/usr/bin/env node
/**
 * Comprehensive tests for keyword matching and scene style logic.
 * Functions are copied inline from src/utils/keywordMatcher.ts.
 *
 * Usage: node scripts/test_keyword_matcher.js
 */

// ---------------------------------------------------------------------------
// Inline copies of types and constants from keywordMatcher.ts
// ---------------------------------------------------------------------------

const FILLER_PREFIXES = [
  '各位好', '今天聊', '简单说', '最后', '这是', '这个',
  '它的核心逻辑是', '说明', '核心看的是', '目标是',
  '第一', '第二', '第三', '第四', '第五',
  '第一笔', '第二笔', '第三笔', '第四笔', '第五笔',
];

const SCENE_STYLES = {
  data: {
    id: 'data', label: '数据增长', bgColor: '#eef7f7', accentColor: '#00D4FF',
    effect: 'chart-lines', highlightColor: '#00D4FF',
    keywords: ['增长', '提升', '数据', '指标', '效率', '提高', '增加', '翻倍', 'ROI', '转化率', '业绩', '营收', '利润', 'GMV', 'DAU', '留存', '增长率', '同比', '环比', 'KPI', '完成率', '达成'],
  },
  risk: {
    id: 'risk', label: '风险危机', bgColor: '#fdf1f0', accentColor: '#FF4444',
    effect: 'pulse-warning', highlightColor: '#FF6B6B',
    keywords: ['离职', '风险', '问题', '挑战', '危机', '流失', '痛点', '困境', '难题', '瓶颈', '下滑', '下降', '亏损', '裁员', '纠纷', '合规', '违规', '仲裁', '诉讼', '赔偿', '成本', '浪费', '低效', '混乱'],
  },
  solution: {
    id: 'solution', label: '解决方案', bgColor: '#f4f1fb', accentColor: '#7B61FF',
    effect: 'grid-flow', highlightColor: '#7B61FF',
    keywords: ['解决', '方案', '系统', '工具', '重构', '优化', '升级', '改造', '落地', '实施', '部署', '上线', '打通', '整合', '一体化', '数字化', '自动化', '平台', '引擎', '模块', '功能'],
  },
  people: {
    id: 'people', label: '人才组织', bgColor: '#fbf5e8', accentColor: '#FFB347',
    effect: 'warm-glow', highlightColor: '#FFB347',
    keywords: ['团队', '人才', '组织', '员工', 'HR', '招聘', '培养', '晋升', '绩效', '薪酬', '福利', '文化', '凝聚力', '归属感', '敬业度', '满意度', '体验', '关怀', '成长', '发展', '梯队', '储备'],
  },
  future: {
    id: 'future', label: 'AI未来', bgColor: '#edf7f1', accentColor: '#00FF88',
    effect: 'cyber-particles', highlightColor: '#00FF88',
    keywords: ['AI', '智能', '未来', '自动', '预测', '模型', '算法', '机器学习', '深度学习', '大模型', 'GPT', '颠覆', '革命', '下一代', '前沿', '创新', '神经网络', 'NLP', '生成式', 'Agent', '数字员工'],
  },
  neutral: {
    id: 'neutral', label: '默认', bgColor: '#FAFAF7', accentColor: '#94A3B8',
    effect: null, highlightColor: '#64748B', keywords: [],
  },
};

const DEFAULT_STYLE = SCENE_STYLES.neutral;

const OPENING_GREETINGS = [
  /^各位好[，、,]?/,
  /^大家好[，、,]?/,
  /^哈喽[，、,]?/,
  /^嗨[，、,]?/,
];

// ---------------------------------------------------------------------------
// Inline copies of functions from keywordMatcher.ts
// ---------------------------------------------------------------------------

function normalizeTriggerText(text) {
  return text
    .toLowerCase()
    .replace(/[\s""''"'"'""]/g, '')
    .replace(/[，、：:；;。！？!?]/g, '');
}

function extractDataBarTriggerKeywords(item) {
  const keywords = [];
  const label = item.label?.trim();
  const value = item.value?.trim();

  if (label && label.length >= 2) {
    keywords.push(label);
  }
  if (value && value.length >= 1) {
    keywords.push(value);
    const numericMatch = value.match(/\d+(?:\.\d+)?/);
    if (numericMatch && numericMatch[0] !== value) {
      keywords.push(numericMatch[0]);
    }
  }

  return [...new Set(keywords.filter(Boolean))];
}

function extractQuoteTriggerKeywords(quote, author) {
  const keywords = [];
  const normalizedQuote = normalizeDisplayText(quote);

  if (author && author.trim().length >= 2) {
    keywords.push(author.trim());
  }

  const words = normalizedQuote
    .split(/[，、：:；。！？!?\s]+/)
    .map((w) => w.replace(/[\[\]{}()""''"'"《》<>]/g, '').trim())
    .filter((w) => w.length >= 2 && !/^\d+(\.\d+)?%?$/.test(w));

  words.sort((a, b) => b.length - a.length);
  keywords.push(...words.slice(0, 6));

  return [...new Set(keywords.filter(Boolean))];
}

function findTriggerCue(cues, keywords) {
  if (!keywords.length) return null;

  const normalizedKeywords = keywords.map(normalizeTriggerText);

  for (const cue of cues) {
    const normalizedCue = normalizeTriggerText(cue.text);
    if (normalizedKeywords.some((kw) => normalizedCue.includes(kw))) {
      return cue;
    }
  }

  return null;
}

function findQuoteTriggerCue(cues, quote, author) {
  const keywords = extractQuoteTriggerKeywords(quote, author);
  if (!keywords.length) return null;

  const normalizedKeywords = keywords.map(normalizeTriggerText);
  const normalizedAuthor = author ? normalizeTriggerText(author) : '';
  let bestCue = null;
  let bestScore = 0;

  for (const cue of cues) {
    const normalizedCue = normalizeTriggerText(cue.text);
    const score = normalizedKeywords.reduce((sum, kw) => sum + (normalizedCue.includes(kw) ? 1 : 0), 0);
    const authorHit = normalizedAuthor && normalizedCue.includes(normalizedAuthor);
    const effectiveScore = authorHit ? Math.max(score, 100) : score;
    if (effectiveScore > bestScore) {
      bestScore = effectiveScore;
      bestCue = cue;
    }
  }

  if (bestScore >= 2 || bestScore >= 100) {
    return bestCue;
  }

  return null;
}

function getKeywordWeight(keyword) {
  if (/^[A-Z0-9]+$/.test(keyword)) {
    return keyword.length >= 3 ? 2.5 : 1.2;
  }
  if (keyword.length >= 4) return 2;
  if (keyword.length === 3) return 1.5;
  if (keyword.length === 2) return 1;
  return 0.5;
}

function createKeywordMatcher(keyword) {
  const weight = getKeywordWeight(keyword);
  if (/^[\u4e00-\u9fa5]$/.test(keyword)) {
    const regex = new RegExp(`(?:^|[^\\u4e00-\\u9fa5])${keyword}(?:[^\\u4e00-\\u9fa5]|$)`, 'gi');
    return { regex, weight };
  }
  return { regex: new RegExp(keyword, 'gi'), weight };
}

function isOpeningGreeting(text) {
  const prefix = text.slice(0, 30);
  return OPENING_GREETINGS.some((p) => p.test(prefix));
}

function matchSceneStyle(text) {
  const scores = {};

  for (const [key, style] of Object.entries(SCENE_STYLES)) {
    scores[key] = 0;
    for (const keyword of style.keywords) {
      const { regex, weight } = createKeywordMatcher(keyword);
      const matches = text.match(regex);
      if (matches) {
        scores[key] += matches.length * weight;
      }
    }
  }

  let bestKey = null;
  let bestScore = 0;
  for (const [key, score] of Object.entries(scores)) {
    if (score > bestScore) {
      bestScore = score;
      bestKey = key;
    }
  }

  if (bestKey && bestScore > 0) {
    const runnerUp = Object.entries(scores)
      .filter(([key]) => key !== bestKey)
      .sort((a, b) => b[1] - a[1])[0];

    if (isOpeningGreeting(text) && bestScore < 3) {
      return DEFAULT_STYLE;
    }

    if (runnerUp && bestScore - runnerUp[1] < 1.0) {
      return DEFAULT_STYLE;
    }
    return SCENE_STYLES[bestKey];
  }

  return DEFAULT_STYLE;
}

function extractHighlightWords(text, style) {
  const words = [];
  for (const keyword of style.keywords) {
    if (text.includes(keyword)) {
      words.push(keyword);
    }
  }
  const numbers = text.match(/\d+%?|\d+\.\d+%?/g);
  if (numbers) {
    words.push(...numbers);
  }
  return [...new Set(words)];
}

function extractTalkingPoints(text, style, maxPoints = 4) {
  const scored = [];
  for (const keyword of style.keywords) {
    if (text.includes(keyword)) {
      const occurrences = (text.split(keyword).length - 1);
      const specificity = keyword.length * 0.3 + (keyword.length >= 4 ? 2 : 0);
      scored.push({ word: keyword, score: occurrences * 10 + specificity });
    }
  }
  const numbers = text.match(/\d+%?|\d+\.\d+%?/g) || [];
  for (const num of [...new Set(numbers)]) {
    scored.push({ word: num, score: 8 + num.length * 0.5 });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, maxPoints).map((s) => s.word);
}

function normalizeDisplayText(text) {
  return text
    .replace(/[【\[]+/g, '')
    .replace(/[】\]]+/g, '')
    .replace(/\s+/g, ' ')
    .replace(/"|"/g, '"')
    .replace(/："/g, '："')
    .trim();
}

function splitByDelimiters(text, delimiters) {
  const result = [];
  let current = '';

  for (const char of text) {
    current += char;
    if (delimiters.test(char)) {
      result.push(current.trim());
      current = '';
    }
  }

  if (current.trim()) {
    result.push(current.trim());
  }

  return result.filter(Boolean);
}

function balanceLines(chunks, maxLines) {
  if (chunks.length === 0) {
    return [];
  }

  const joinedLength = chunks.join('').length;
  const target = Math.ceil(joinedLength / maxLines);
  const lines = [];
  let current = '';

  for (const chunk of chunks) {
    const candidate = `${current}${chunk}`;
    if (current && candidate.length > target && lines.length < maxLines - 1) {
      lines.push(current);
      current = chunk;
    } else {
      current = candidate;
    }
  }

  if (current) {
    lines.push(current);
  }

  return lines;
}

function getCharVisualWidth(char) {
  if (char === ' ') {
    return 0.35;
  }

  if (/[A-Za-z0-9]/.test(char)) {
    return 0.62;
  }

  if (/[.,:;!?"'`\-]/.test(char)) {
    return 0.38;
  }

  return 1;
}

function getVisualLength(text) {
  return Array.from(text).reduce((sum, char) => sum + getCharVisualWidth(char), 0);
}

function trimLineForDisplay(text) {
  return text.replace(/\s+/g, ' ').trim();
}

function clampLineByWidth(text, maxWidth) {
  let current = '';
  let width = 0;

  for (const char of text) {
    const nextWidth = width + getCharVisualWidth(char);
    if (nextWidth > maxWidth) {
      break;
    }
    current += char;
    width = nextWidth;
  }

  return trimLineForDisplay(current);
}

function findSplitIndex(text, maxWidth) {
  let width = 0;
  let lastPreferredBreak = -1;
  let lastPreferredBreakWidth = 0;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    width += getCharVisualWidth(char);

    if (/[，、：,:；;。！？!? ]/.test(char)) {
      lastPreferredBreak = i + 1;
      lastPreferredBreakWidth = width;
    }

    if (width > maxWidth) {
      // 只有不超预算的断点才可取：预算之外的标点（如行尾逗号）不能作为断点，
      // 否则整行会超过 maxWidth
      if (lastPreferredBreak > 0 && lastPreferredBreakWidth <= maxWidth) {
        return lastPreferredBreak;
      }
      // 硬切：把紧跟的句读标点并入本行（悬挂标点），避免下一行以标点开头
      let cut = Math.max(1, i);
      let merged = 0;
      while (cut < text.length && merged < 2 && /[，、：,:；;。！？!?）)》」』]/.test(text[cut])) {
        cut++;
        merged++;
      }
      return cut;
    }
  }

  return text.length;
}

function forceWrapLines(text, maxLines, maxWidth) {
  const remainingLines = Math.max(1, maxLines);
  let remaining = trimLineForDisplay(text);
  const lines = [];

  for (let lineIndex = 0; lineIndex < remainingLines; lineIndex++) {
    const isLastLine = lineIndex === remainingLines - 1;
    if (!remaining) {
      break;
    }

    if (isLastLine) {
      if (getVisualLength(remaining) <= maxWidth) {
        lines.push(trimLineForDisplay(remaining));
      } else {
        lines.push(clampLineByWidth(remaining, maxWidth));
      }
      break;
    }

    if (getVisualLength(remaining) <= maxWidth) {
      lines.push(trimLineForDisplay(remaining));
      break;
    }

    const splitIndex = findSplitIndex(remaining, maxWidth);
    const head = trimLineForDisplay(remaining.slice(0, splitIndex));
    const tail = trimLineForDisplay(remaining.slice(splitIndex));

    if (!head) {
      lines.push(clampLineByWidth(remaining, maxWidth));
      remaining = trimLineForDisplay(remaining.slice(1));
      continue;
    }

    lines.push(head);
    remaining = tail;
  }

  return lines.filter(Boolean);
}

function formatSubtitleLines(text, maxLines = 2, maxCharsPerLine = 22) {
  const normalized = normalizeDisplayText(text);
  if (!normalized) {
    return [];
  }

  const sentenceChunks = splitByDelimiters(normalized, /[。！？!?；;]/);
  const clauseChunks = sentenceChunks.length > 1 ? sentenceChunks : splitByDelimiters(normalized, /[，、：,:]/);
  const maxWidth = Math.max(10, maxCharsPerLine);
  let lines = balanceLines(clauseChunks, maxLines).map(trimLineForDisplay).filter(Boolean);

  if (lines.length > maxLines) {
    const merged = lines.slice(0, maxLines - 1);
    merged.push(lines.slice(maxLines - 1).join(''));
    lines = merged;
  }

  const joined = lines.join('');
  if (
    lines.length === 1 ||
    lines.some((line) => getVisualLength(line) > maxWidth) ||
    getVisualLength(joined) > maxWidth * maxLines
  ) {
    return forceWrapLines(normalized, maxLines, maxWidth);
  }

  return lines
    .map((line) => trimLineForDisplay(line))
    .filter(Boolean)
    .flatMap((line) => getVisualLength(line) > maxWidth ? forceWrapLines(line, 1, maxWidth) : [line]);
}

function cleanupClause(text) {
  let cleaned = normalizeDisplayText(text)
    .replace(/^[0-9]+[、.．]/, '')
    .replace(/^(第[一二三四五六七八九十]+[笔点阶段轮次个条]|[一二三四五六七八九十]+[、.．])/, '')
    .replace(/^主题：/, '')
    .trim();

  for (const prefix of FILLER_PREFIXES) {
    if (cleaned.startsWith(prefix) && cleaned.length > prefix.length + 4) {
      cleaned = cleaned.slice(prefix.length);
      break;
    }
  }

  return cleaned.replace(/^，+|，+$/g, '').trim();
}

function extractInsightStatements(text, style, maxPoints = 3) {
  const normalized = normalizeDisplayText(text);
  const clauses = splitByDelimiters(normalized, /[。！？!?；;，、]/)
    .map(cleanupClause)
    .filter((clause) => clause.length >= 5 && clause.length <= 22);

  const scored = clauses.map((clause) => {
    let score = clause.length;
    for (const keyword of style.keywords) {
      if (clause.includes(keyword)) {
        score += keyword.length >= 4 ? 8 : 4;
      }
    }
    if (/\d/.test(clause)) {
      score += 6;
    }
    if (/AI|智能|平台|系统|增长|招聘|组织|员工|融资/.test(clause)) {
      score += 5;
    }
    return { clause, score };
  });

  const deduped = [];
  for (const item of scored.sort((a, b) => b.score - a.score)) {
    if (!deduped.some((existing) => existing.includes(item.clause) || item.clause.includes(existing))) {
      deduped.push(item.clause);
    }
    if (deduped.length >= maxPoints) {
      break;
    }
  }

  if (deduped.length > 0) {
    return deduped;
  }

  return extractTalkingPoints(normalized, style, maxPoints);
}

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, label) {
  if (condition) {
    passed++;
  } else {
    failed++;
    failures.push(label);
    console.error(`  FAIL: ${label}`);
  }
}

function assertEqual(actual, expected, label) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    passed++;
  } else {
    failed++;
    const msg = `${label} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`;
    failures.push(msg);
    console.error(`  FAIL: ${msg}`);
  }
}

// ---------------------------------------------------------------------------
// 1. normalizeTriggerText
// ---------------------------------------------------------------------------
console.log('\n=== normalizeTriggerText ===');

assertEqual(normalizeTriggerText('Hello World'), 'helloworld', 'lowercase + remove spaces');
assertEqual(normalizeTriggerText('增长数据'), '增长数据', 'Chinese chars unchanged');
assertEqual(normalizeTriggerText('AI 智能'), 'ai智能', 'mix CJK + English');
assertEqual(normalizeTriggerText('"Hello"'), 'hello', 'remove curly quotes');
assertEqual(normalizeTriggerText('测试，数据；增长。'), '测试数据增长', 'remove CJK punctuation');
assertEqual(normalizeTriggerText(''), '', 'empty string');
assertEqual(normalizeTriggerText('   \t\n  '), '', 'whitespace only');
assertEqual(normalizeTriggerText('Hello-World'), 'hello-world', 'hyphen preserved');
assertEqual(normalizeTriggerText('A.I. 智能'), 'a.i.智能', 'dots preserved between letters');

// ---------------------------------------------------------------------------
// 2. matchSceneStyle — accuracy
// ---------------------------------------------------------------------------
console.log('\n=== matchSceneStyle — accuracy ===');

assertEqual(
  matchSceneStyle('我们的业务增长迅速，数据指标表现优异').id,
  'data',
  'text with "增长" and "数据" → data style'
);

assertEqual(
  matchSceneStyle('员工离职风险上升，面临严峻挑战').id,
  'risk',
  'text with "离职" and "风险" → risk style'
);

assertEqual(
  matchSceneStyle('AI技术正在改变未来，智能系统将颠覆行业').id,
  'future',
  'text with "AI" and "智能" → future style'
);

assertEqual(
  matchSceneStyle('团队建设需要优秀人才，组织发展至关重要').id,
  'people',
  'text with "团队" and "人才" → people style'
);

assertEqual(
  matchSceneStyle('我们提供完整的系统解决方案，优化现有工具').id,
  'solution',
  'text with "系统" and "方案" → solution style'
);

// Opening greeting with weak signals → neutral
assertEqual(
  matchSceneStyle('各位好，今天我们来聊聊最近的情况').id,
  'neutral',
  'opening greeting with weak signals → neutral'
);

assertEqual(
  matchSceneStyle('大家好，欢迎收看本期节目').id,
  'neutral',
  '"大家好" opening greeting → neutral'
);

// Empty / no keywords → neutral
assertEqual(
  matchSceneStyle('').id,
  'neutral',
  'empty string → neutral'
);

assertEqual(
  matchSceneStyle('今天天气真好，适合出去走走').id,
  'neutral',
  'no matching keywords → neutral'
);

// Ambiguous: equal scores → neutral
// "风险" matches risk, "数据" matches data — both have weight=1 (2-char), so equal scores
// But "风险" is 2 chars (weight=1), "数据" is 2 chars (weight=1). Let's use one keyword each.
assertEqual(
  matchSceneStyle('风险数据').id,
  'neutral',
  'equal scores for risk and data → neutral (ambiguous)'
);

// Longer keyword should dominate
assertEqual(
  matchSceneStyle('我们的增长率显著提升，但同时也面临一些挑战').id,
  'data',
  '"增长率" (3-char weight=1.5) + "提升" (2-char weight=1) → data wins over "挑战" (2-char weight=1)'
);

// ---------------------------------------------------------------------------
// 3. matchSceneStyle — boundary
// ---------------------------------------------------------------------------
console.log('\n=== matchSceneStyle — boundary ===');

assertEqual(
  matchSceneStyle('   ').id,
  'neutral',
  'whitespace-only string → neutral'
);

// Very long text
const longDataText = '增长 '.repeat(200) + '数据 '.repeat(200);
const longResult = matchSceneStyle(longDataText);
assert(
  longResult.id === 'data',
  'very long text (1000+ chars) with data keywords → data'
);

// Special characters
assertEqual(
  matchSceneStyle('@#$%^&*()_+').id,
  'neutral',
  'only special characters → neutral'
);

// Only numbers
assertEqual(
  matchSceneStyle('12345 67890').id,
  'neutral',
  'text with only numbers → neutral'
);

// Mixed Chinese/English with keywords
assertEqual(
  matchSceneStyle('Our AI system is very intelligent, 智能系统非常先进').id,
  'future',
  'mixed Chinese/English with AI keywords → future'
);

// ---------------------------------------------------------------------------
// 4. extractHighlightWords
// ---------------------------------------------------------------------------
console.log('\n=== extractHighlightWords ===');

const dataStyle = SCENE_STYLES.data;
assertEqual(
  extractHighlightWords('增长数据提升', dataStyle),
  ['增长', '提升', '数据'],
  'extracts matching keywords from data style'
);

assertEqual(
  extractHighlightWords('我们的ROI提升了30%', dataStyle),
  ['提升', 'ROI', '30%'],
  'extracts keywords + percentage numbers'
);

assertEqual(
  extractHighlightWords('no match here', dataStyle),
  [],
  'no matching keywords → empty array'
);

assertEqual(
  extractHighlightWords('', dataStyle),
  [],
  'empty text → empty array'
);

// ---------------------------------------------------------------------------
// 5. extractTalkingPoints
// ---------------------------------------------------------------------------
console.log('\n=== extractTalkingPoints ===');

const points = extractTalkingPoints('我们的增长数据非常亮眼，增长幅度达到50%，效率提升明显', dataStyle, 4);
assert(points.length <= 4, 'talking points respects maxPoints=4');
assert(points.includes('增长'), 'talking points includes "增长"');
assert(points.includes('数据'), 'talking points includes "数据"');
// "50%" (score 9.5) is outscored by keywords "增长" (20.6), "数据"/"提升"/"效率" (10.6 each)
assertEqual(points.length, 4, 'talking points returns 4 top-scored items');

// Test with a prominent number: use a longer number to boost its score
const pointsWithNum = extractTalkingPoints('提升150%', dataStyle, 2);
assert(pointsWithNum.includes('150%'), 'talking points includes prominent number "150%"');

assertEqual(
  extractTalkingPoints('', dataStyle, 4),
  [],
  'empty text → empty talking points'
);

assertEqual(
  extractTalkingPoints('no keywords here', dataStyle, 4),
  [],
  'no matching keywords → empty talking points'
);

// Test maxPoints = 2
const points2 = extractTalkingPoints('提升效率，提高转化率，增加营收', dataStyle, 2);
assertEqual(points2.length, 2, 'maxPoints=2 returns exactly 2 points');

// ---------------------------------------------------------------------------
// 6. normalizeDisplayText
// ---------------------------------------------------------------------------
console.log('\n=== normalizeDisplayText ===');

assertEqual(normalizeDisplayText('【重要】测试内容'), '重要测试内容', 'removes both opening and closing brackets');
assertEqual(normalizeDisplayText('测试[内容]'), '测试内容', 'removes both opening and closing bracket variants');
assertEqual(normalizeDisplayText('  多余空格  '), '多余空格', 'trims whitespace');
assertEqual(normalizeDisplayText('多个   空格'), '多个 空格', 'collapses multiple spaces to one');
assertEqual(normalizeDisplayText('他说"你好"'), '他说"你好"', 'removes Chinese quotes');
assertEqual(normalizeDisplayText(''), '', 'empty string');

// ---------------------------------------------------------------------------
// 7. formatSubtitleLines
// ---------------------------------------------------------------------------
console.log('\n=== formatSubtitleLines ===');

// Short text: single line
const shortLines = formatSubtitleLines('你好', 2, 22);
assertEqual(shortLines.length, 1, 'short text → single line');
assertEqual(shortLines[0], '你好', 'short text preserved');

// Empty / whitespace
assertEqual(formatSubtitleLines('', 2, 22), [], 'empty string → empty array');
assertEqual(formatSubtitleLines('   ', 2, 22), [], 'whitespace only → empty array');

// Long text: split into multiple lines
const longText = '这是一个非常长的测试句子用来验证字幕分割功能是否正常工作';
const longLines = formatSubtitleLines(longText, 2, 22);
assert(longLines.length >= 1, 'long text produces at least 1 line');
assert(longLines.length <= 2, 'long text respects maxLines=2');

// CJK punctuation: split at delimiters
const cjkText = '第一句话。第二句话！第三句话？';
const cjkLines = formatSubtitleLines(cjkText, 3, 22);
assert(cjkLines.length >= 1, 'CJK punctuation produces at least 1 line');

// maxLines respected
const maxLines2 = formatSubtitleLines('第一句。第二句。第三句。第四句。', 2, 22);
assert(maxLines2.length <= 2, 'maxLines=2 respected for multi-sentence text');

// maxCharsPerLine respected
const narrowLines = formatSubtitleLines('这是一个测试句子', 2, 10);
for (const line of narrowLines) {
  const visualLen = getVisualLength(line);
  assert(visualLen <= 10, `line "${line}" visual length ${visualLen} <= maxCharsPerLine 10`);
}

// 行尾标点超出预算时不能作为断点（否则整行超宽、nowrap 时向右溢出）
const punctTailText = '有创业公司刚成立就拿到了六千六百万美元融资，后续还有新产品。';
const punctTailLines = formatSubtitleLines(punctTailText, 2, 19);
assert(punctTailLines.length >= 2, 'punct-tail text wraps into multiple lines');
for (const line of punctTailLines) {
  const visualLen = getVisualLength(line);
  assert(visualLen <= 20, `line "${line}" visual length ${visualLen} <= 19 + 1 hanging punct`);
  assert(!/^[，、：,:；;。！？!?）)》」』]/.test(line), `line "${line}" must not start with punctuation`);
}

// 整句只有一个行尾标点时的悬挂标点容差：允许标点悬挂出行（最多超 1 个视觉宽度）
const singleClauseText = '有创业公司刚成立就拿到了六千六百万美元融资，';
const singleClauseLines = formatSubtitleLines(singleClauseText, 2, 21);
assertEqual(singleClauseLines.length, 1, 'single clause with trailing comma stays one line');
assert(
  getVisualLength(singleClauseLines[0]) <= 22,
  `hanging punct line visual length ${getVisualLength(singleClauseLines[0])} <= 21 + 1`
);

// 预算内的标点断点仍然优先
const breakableText = '超过一半的企业高管说，他们公司已经把AI智能体跑在了真实业务里';
const breakableLines = formatSubtitleLines(breakableText, 2, 19);
assertEqual(breakableLines[0], '超过一半的企业高管说，', 'splits at in-budget punctuation first');

// ---------------------------------------------------------------------------
// 8. extractInsightStatements
// ---------------------------------------------------------------------------
console.log('\n=== extractInsightStatements ===');

const insightText = 'AI技术发展迅速。智能系统正在改变行业。未来值得期待。';
const insights = extractInsightStatements(insightText, SCENE_STYLES.future, 3);
assert(insights.length >= 1, 'extracts at least 1 insight statement');
assert(insights.length <= 3, 'respects maxPoints=3');

// Empty text
assertEqual(
  extractInsightStatements('', SCENE_STYLES.future, 3),
  [],
  'empty text → empty insights'
);

// Short text (no clauses >= 5 chars)
const shortInsights = extractInsightStatements('AI。智能。', SCENE_STYLES.future, 3);
assert(Array.isArray(shortInsights), 'short text returns array (may be empty or talking points)');

// ---------------------------------------------------------------------------
// 9. extractDataBarTriggerKeywords
// ---------------------------------------------------------------------------
console.log('\n=== extractDataBarTriggerKeywords ===');

// Normal label/value pair
assertEqual(
  extractDataBarTriggerKeywords({ label: '营收', value: '500万' }),
  ['营收', '500万', '500'],
  'normal label/value pair → label + value + numeric'
);

// Label with special characters
assertEqual(
  extractDataBarTriggerKeywords({ label: '【营收】', value: '500万' }),
  ['【营收】', '500万', '500'],
  'label with special characters preserved'
);

// Value with percentage
assertEqual(
  extractDataBarTriggerKeywords({ label: '增长率', value: '30%' }),
  ['增长率', '30%', '30'],
  'value with percentage → numeric extracted'
);

// Pure numeric value (no extra string)
assertEqual(
  extractDataBarTriggerKeywords({ label: '数量', value: '100' }),
  ['数量', '100'],
  'pure numeric value → no extra numeric keyword (value === numericMatch)'
);

// Empty label
assertEqual(
  extractDataBarTriggerKeywords({ label: '', value: '500万' }),
  ['500万', '500'],
  'empty label → only value keywords'
);

// Empty value
assertEqual(
  extractDataBarTriggerKeywords({ label: '营收', value: '' }),
  ['营收'],
  'empty value → only label keyword'
);

// Both empty
assertEqual(
  extractDataBarTriggerKeywords({ label: '', value: '' }),
  [],
  'both empty → empty array'
);

// Label shorter than 2 chars
assertEqual(
  extractDataBarTriggerKeywords({ label: 'A', value: '100万' }),
  ['100万', '100'],
  'label < 2 chars → skipped'
);

// Missing properties
assertEqual(
  extractDataBarTriggerKeywords({}),
  [],
  'missing label and value → empty array'
);

// ---------------------------------------------------------------------------
// 10. findTriggerCue
// ---------------------------------------------------------------------------
console.log('\n=== findTriggerCue ===');

const sampleCues = [
  { start: 0, end: 1, text: '大家好，欢迎收看' },
  { start: 1, end: 2, text: '今天我们来聊聊AI技术' },
  { start: 2, end: 3, text: '数据增长是一个重要话题' },
];

// Keywords found in cue
const foundCue = findTriggerCue(sampleCues, ['AI']);
assert(foundCue !== null, 'finds cue with "AI" keyword');
assertEqual(foundCue.text, '今天我们来聊聊AI技术', 'returns correct cue text');

// Keywords not found
const notFound = findTriggerCue(sampleCues, ['区块链']);
assertEqual(notFound, null, 'returns null when keyword not found');

// Empty keywords array
assertEqual(findTriggerCue(sampleCues, []), null, 'empty keywords → null');

// Empty cues array
assertEqual(findTriggerCue([], ['AI']), null, 'empty cues → null');

// Multiple keywords, first match wins
const multiFound = findTriggerCue(sampleCues, ['数据', 'AI']);
assert(multiFound !== null, 'finds cue with multiple keywords');
assertEqual(multiFound.text, '今天我们来聊聊AI技术', 'first matching cue returned (AI before 数据)');

// ---------------------------------------------------------------------------
// 11. findQuoteTriggerCue
// ---------------------------------------------------------------------------
console.log('\n=== findQuoteTriggerCue ===');

const quoteCues = [
  { start: 0, end: 1, text: '欢迎收看本期节目' },
  { start: 1, end: 2, text: '正如马云所说，未来已来' },
  { start: 2, end: 3, text: '智能时代已经到来' },
];

// Quote keywords found in cue with author
const quoteFound = findQuoteTriggerCue(quoteCues, '未来已来，智能时代', '马云');
assert(quoteFound !== null, 'finds cue with quote keywords + author');
assertEqual(quoteFound.text, '正如马云所说，未来已来', 'returns best matching cue');

// No match
const quoteNotFound = findQuoteTriggerCue(quoteCues, '区块链技术革命', '中本聪');
assertEqual(quoteNotFound, null, 'returns null when no quote keywords match');

// Empty quote
assertEqual(findQuoteTriggerCue(quoteCues, '', ''), null, 'empty quote → null');

// Author match boosts score significantly
const authorCues = [
  { start: 0, end: 1, text: '大家好' },
  { start: 1, end: 2, text: '张教授认为AI很重要' },
];
const authorFound = findQuoteTriggerCue(authorCues, 'AI很重要', '张教授');
assert(authorFound !== null, 'author match in cue boosts score');
assertEqual(authorFound.text, '张教授认为AI很重要', 'returns cue with author match');

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
const total = passed + failed;
console.log(`\n${'='.repeat(60)}`);
console.log(`PASSED: ${passed}, FAILED: ${failed}, TOTAL: ${total}`);
if (failed > 0) {
  console.log(`\nFailed tests:`);
  failures.forEach((f) => console.log(`  - ${f}`));
  process.exit(1);
} else {
  console.log('All tests passed!');
  process.exit(0);
}
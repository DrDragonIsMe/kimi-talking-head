export interface SceneStyle {
  id: string;
  label: string;
  bgColor: string;
  accentColor: string;
  effect: 'chart-lines' | 'pulse-warning' | 'grid-flow' | 'warm-glow' | 'cyber-particles' | null;
  highlightColor: string;
  keywords: string[];
}

const FILLER_PREFIXES = [
  '各位好',
  '今天聊',
  '简单说',
  '最后',
  '这是',
  '这个',
  '它的核心逻辑是',
  '说明',
  '核心看的是',
  '目标是',
  '第一',
  '第二',
  '第三',
  '第四',
  '第五',
  '第一笔',
  '第二笔',
  '第三笔',
  '第四笔',
  '第五笔',
];

export const SCENE_STYLES: Record<string, SceneStyle> = {
  data: {
    id: 'data',
    label: '数据增长',
    bgColor: '#eef7f7',
    accentColor: '#00D4FF',
    effect: 'chart-lines',
    highlightColor: '#00D4FF',
    keywords: ['增长', '提升', '数据', '指标', '效率', '提高', '增加', '翻倍', 'ROI', '转化率', '业绩', '营收', '利润', 'GMV', 'DAU', '留存', '增长率', '同比', '环比', 'KPI', '完成率', '达成'],
  },
  risk: {
    id: 'risk',
    label: '风险危机',
    bgColor: '#fdf1f0',
    accentColor: '#FF4444',
    effect: 'pulse-warning',
    highlightColor: '#FF6B6B',
    keywords: ['离职', '风险', '问题', '挑战', '危机', '流失', '痛点', '困境', '难题', '瓶颈', '下滑', '下降', '亏损', '裁员', '纠纷', '合规', '违规', '仲裁', '诉讼', '赔偿', '成本', '浪费', '低效', '混乱'],
  },
  solution: {
    id: 'solution',
    label: '解决方案',
    bgColor: '#f4f1fb',
    accentColor: '#7B61FF',
    effect: 'grid-flow',
    highlightColor: '#7B61FF',
    keywords: ['解决', '方案', '系统', '工具', '重构', '优化', '升级', '改造', '落地', '实施', '部署', '上线', '打通', '整合', '一体化', '数字化', '自动化', '平台', '引擎', '模块', '功能'],
  },
  people: {
    id: 'people',
    label: '人才组织',
    bgColor: '#fbf5e8',
    accentColor: '#FFB347',
    effect: 'warm-glow',
    highlightColor: '#FFB347',
    keywords: ['团队', '人才', '组织', '员工', 'HR', '招聘', '培养', '晋升', '绩效', '薪酬', '福利', '文化', '凝聚力', '归属感', '敬业度', '满意度', '体验', '关怀', '成长', '发展', '梯队', '储备'],
  },
  future: {
    id: 'future',
    label: 'AI未来',
    bgColor: '#edf7f1',
    accentColor: '#00FF88',
    effect: 'cyber-particles',
    highlightColor: '#00FF88',
    keywords: ['AI', '智能', '未来', '自动', '预测', '模型', '算法', '机器学习', '深度学习', '大模型', 'GPT', '颠覆', '革命', '下一代', '前沿', '创新', '神经网络', 'NLP', '生成式', 'Agent', '数字员工'],
  },
  neutral: {
    id: 'neutral',
    label: '默认',
    bgColor: '#FAFAF7',
    accentColor: '#94A3B8',
    effect: null,
    highlightColor: '#64748B',
    keywords: [],
  },
};

export const DEFAULT_STYLE = SCENE_STYLES.neutral;

export function normalizeTriggerText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\s""''“”‘’]/g, '')
    .replace(/[，、：:；;。！？!?]/g, '');
}

export function extractDataBarTriggerKeywords(item: { label: string; value: string }): string[] {
  const keywords: string[] = [];
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

export function extractQuoteTriggerKeywords(quote: string, author?: string): string[] {
  const keywords: string[] = [];
  const normalizedQuote = normalizeDisplayText(quote);

  if (author && author.trim().length >= 2) {
    keywords.push(author.trim());
  }

  const words = normalizedQuote
    .split(/[，、：:；。！？!?\s]+/)
    .map((w) => w.replace(/[\[\]{}()""''“”《》<>]/g, '').trim())
    .filter((w) => w.length >= 2 && !/^\d+(\.\d+)?%?$/.test(w));

  words.sort((a, b) => b.length - a.length);
  keywords.push(...words.slice(0, 6));

  return [...new Set(keywords.filter(Boolean))];
}

export function findTriggerCue(
  cues: Array<{ start: number; end: number; text: string }>,
  keywords: string[]
): { start: number; end: number; text: string } | null {
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

export function findQuoteTriggerCue(
  cues: Array<{ start: number; end: number; text: string }>,
  quote: string,
  author?: string
): { start: number; end: number; text: string } | null {
  const keywords = extractQuoteTriggerKeywords(quote, author);
  if (!keywords.length) return null;

  const normalizedKeywords = keywords.map(normalizeTriggerText);
  const normalizedAuthor = author ? normalizeTriggerText(author) : '';
  let bestCue: { start: number; end: number; text: string } | null = null;
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

function getKeywordWeight(keyword: string): number {
  // 英文缩写/专有词：3 字符及以上信息密度高；2 字符缩写（如 AI）权重适中，避免主导
  if (/^[A-Z0-9]+$/.test(keyword)) {
    return keyword.length >= 3 ? 2.5 : 1.2;
  }
  // 长度越长，语义越具体
  if (keyword.length >= 4) return 2;
  if (keyword.length === 3) return 1.5;
  if (keyword.length === 2) return 1;
  return 0.5;
}

function createKeywordMatcher(keyword: string): { regex: RegExp; weight: number } {
  const weight = getKeywordWeight(keyword);
  // 对单字中文关键词加词边界，避免匹配到多字词内部
  if (/^[\u4e00-\u9fa5]$/.test(keyword)) {
    const regex = new RegExp(`(?:^|[^\\u4e00-\\u9fa5])${keyword}(?:[^\\u4e00-\\u9fa5]|$)`, 'gi');
    return { regex, weight };
  }
  return { regex: new RegExp(keyword, 'gi'), weight };
}

const OPENING_GREETINGS = [
  /^各位好[，、,]?/,
  /^大家好[，、,]?/,
  /^哈喽[，、,]?/,
  /^嗨[，、,]?/,
];

function isOpeningGreeting(text: string): boolean {
  const prefix = text.slice(0, 30);
  return OPENING_GREETINGS.some((p) => p.test(prefix));
}

export function matchSceneStyle(text: string): SceneStyle {
  const scores: Record<string, number> = {};

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

  let bestKey: string | null = null;
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

    // 开场白段落若主题信号不强，保持默认中性风格
    if (isOpeningGreeting(text) && bestScore < 3) {
      return DEFAULT_STYLE;
    }

    // 如果最高分不够突出（与次高分差距过小），视为模糊，返回默认风格
    if (runnerUp && bestScore - runnerUp[1] < 1.0) {
      return DEFAULT_STYLE;
    }
    return SCENE_STYLES[bestKey];
  }

  return DEFAULT_STYLE;
}

export function extractHighlightWords(text: string, style: SceneStyle): string[] {
  const words: string[] = [];
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

export function extractTalkingPoints(text: string, style: SceneStyle, maxPoints = 4): string[] {
  const scored: { word: string; score: number }[] = [];
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

export function normalizeDisplayText(text: string): string {
  return text
    .replace(/[【\[]+/g, '')
    .replace(/[】\]]+/g, '')
    .replace(/\s+/g, ' ')
    .replace(/“|”/g, '"')
    .replace(/："/g, '："')
    .trim();
}

function splitByDelimiters(text: string, delimiters: RegExp): string[] {
  const result: string[] = [];
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

function balanceLines(chunks: string[], maxLines: number): string[] {
  if (chunks.length === 0) {
    return [];
  }

  const joinedLength = chunks.join('').length;
  const target = Math.ceil(joinedLength / maxLines);
  const lines: string[] = [];
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

function getCharVisualWidth(char: string): number {
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

function getVisualLength(text: string): number {
  return Array.from(text).reduce((sum, char) => sum + getCharVisualWidth(char), 0);
}

function trimLineForDisplay(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function clampLineByWidth(text: string, maxWidth: number): string {
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

function findSplitIndex(text: string, maxWidth: number): number {
  let width = 0;
  let lastPreferredBreak = -1;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    width += getCharVisualWidth(char);

    if (/[，、：,:；;。！？!? ]/.test(char)) {
      lastPreferredBreak = i + 1;
    }

    if (width > maxWidth) {
      if (lastPreferredBreak > 0) {
        return lastPreferredBreak;
      }
      return Math.max(1, i);
    }
  }

  return text.length;
}

function forceWrapLines(text: string, maxLines: number, maxWidth: number): string[] {
  const remainingLines = Math.max(1, maxLines);
  let remaining = trimLineForDisplay(text);
  const lines: string[] = [];

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

export function formatSubtitleLines(text: string, maxLines = 2, maxCharsPerLine = 22): string[] {
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

function cleanupClause(text: string): string {
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

export function extractInsightStatements(text: string, style: SceneStyle, maxPoints = 3): string[] {
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

  const deduped: string[] = [];
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

#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const inputPath = process.argv[2];
const profilePath = process.argv[3] || path.join(process.cwd(), 'config', 'host_profile.json');

if (!inputPath) {
  console.error('Usage: node extract_data_bars.js <article-file> [profile-json]');
  process.exit(1);
}

const raw = fs.readFileSync(inputPath, 'utf8');

const profile = fs.existsSync(profilePath)
  ? JSON.parse(fs.readFileSync(profilePath, 'utf8'))
  : {};

const config = {
  maxItems: 5,
  ...(profile.content_overlay?.dataBars || {}),
};

const cleanLine = (line) =>
  line
    .replace(/^#+\s*/g, '')
    .replace(/\*\*|__|\*|_/g, '')
    .replace(/`/g, '')
    .replace(/[ \t]+/g, ' ')
    .trim();

const cleanText = raw
  .split('\n')
  .map(cleanLine)
  .filter(Boolean)
  .join(' ')
  .replace(/https?:\/\/\S+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const stripMarkdown = (text) =>
  text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, ' ')
    .replace(/\[[^\]]+\]\([^)]+\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const text = stripMarkdown(cleanText);

// 提取标题，用于给无主体数据做 label
const titleMatch = cleanText.match(/^#\s+(.+)$/m) || cleanText.match(/^(.{4,40})/);
const articleTitle = titleMatch ? titleMatch[1].trim() : '';

const patterns = [
  // 中文主体 + 数字 + 单位，如 "Factorial，1.5亿美元"
  {
    regex: /([\u4e00-\u9fa5A-Za-z][\u4e00-\u9fa5A-Za-z\s]*?)[,，、\s]+(\d+(?:\.\d+)?)\s*(亿美元)/gu,
    unit: '亿美元',
  },
  {
    regex: /([\u4e00-\u9fa5A-Za-z][\u4e00-\u9fa5A-Za-z\s]*?)[,，、\s]+(\d+(?:\.\d+)?)\s*(万美元)/gu,
    unit: '万美元',
  },
  {
    regex: /([\u4e00-\u9fa5A-Za-z][\u4e00-\u9fa5A-Za-z\s]*?)[,，、\s]+(\d+(?:\.\d+)?)\s*(百万美元)/gu,
    unit: '百万美元',
  },
  {
    regex: /([\u4e00-\u9fa5A-Za-z][\u4e00-\u9fa5A-Za-z\s]*?)[,，、\s]+(\d+(?:\.\d+)?)\s*(千万美元)/gu,
    unit: '千万美元',
  },
  // 数字 + 单位 + 中文名词，如 "拿下了1.841亿美元融资"
  {
    regex: /(\d+(?:\.\d+)?)\s*(亿美元)\s*([\u4e00-\u9fa5]{1,6})/gu,
    unit: '亿美元',
    labelGroup: 3,
  },
  {
    regex: /(\d+(?:\.\d+)?)\s*(万美元)\s*([\u4e00-\u9fa5]{1,6})/gu,
    unit: '万美元',
    labelGroup: 3,
  },
  // 百分比
  {
    regex: /([\u4e00-\u9fa5A-Za-z][\u4e00-\u9fa5A-Za-z\s]*?)[,，、\s]+(\d+(?:\.\d+)?)\s*%/gu,
    unit: '%',
  },
  // 家 / 倍 / 个月
  {
    regex: /([\u4e00-\u9fa5A-Za-z][\u4e00-\u9fa5A-Za-z\s]*?)[,，、\s]+(\d+(?:\.\d+)?)\s*(家)/gu,
    unit: '家',
  },
  {
    regex: /([\u4e00-\u9fa5A-Za-z][\u4e00-\u9fa5A-Za-z\s]*?)[,，、\s]+(\d+(?:\.\d+)?)\s*(倍)/gu,
    unit: '倍',
  },
  {
    regex: /([\u4e00-\u9fa5A-Za-z][\u4e00-\u9fa5A-Za-z\s]*?)[,，、\s]+(\d+(?:\.\d+)?)\s*(个月)/gu,
    unit: '个月',
  },
  // 英文数字 + 单位
  {
    regex: /([A-Za-z][A-Za-z\s]*?)[,，、\s]+\$?(\d+(?:\.\d+)?)\s*(billion)/giu,
    unit: '亿美元',
  },
  {
    regex: /([A-Za-z][A-Za-z\s]*?)[,，、\s]+\$?(\d+(?:\.\d+)?)\s*(million)/giu,
    unit: '万美元',
  },
];

const normalizeLabel = (label) => {
  if (!label) return '';
  const cleaned = label
    .replace(/[，、：,:；;。！？!?\"\'\`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  // 去掉常见无意义前缀
  return cleaned
    .replace(/^(这是|一个|本月|这笔|这笔融资|本轮|本轮融资|总|共|大约|约|达到|拿下|获得|完成|完成?了)/, '')
    .trim();
};

const isWeakLabel = (label) => {
  if (!label || label.length < 2) return true;
  const weakWords = new Set(['是', '一个', '这笔', '本月', '总', '共', '约', '拿下', '获得', '完成', '融资', '融资盘点', '盘点']);
  return weakWords.has(label);
};

const deriveLabelFromContext = (matchIndex, matchEnd) => {
  // 从当前句中提取有意义的主体词
  const sentenceStart = Math.max(0, text.lastIndexOf('。', matchIndex - 1) + 1);
  const sentenceEnd = text.indexOf('。', matchEnd);
  const sentence = text.slice(sentenceStart, sentenceEnd > matchEnd ? sentenceEnd : matchEnd + 20);

  // 优先匹配 "X公司"、"XXX AI" 等主体
  const companyMatch = sentence.match(/([A-Za-z][A-Za-z\s]*(?:AI|Tech|\.io)?|[\u4e00-\u9fa5]{2,}(?:AI|科技|智能|平台|公司))/);
  if (companyMatch) {
    const candidate = companyMatch[1].trim();
    if (candidate.length >= 2 && !isWeakLabel(candidate)) {
      return candidate;
    }
  }

  // 从标题提取关键词
  if (articleTitle) {
    const titleWords = articleTitle.match(/[\u4e00-\u9fa5]{2,}/g) || [];
    const meaningful = titleWords.find((word) => !isWeakLabel(word) && word.length >= 2);
    if (meaningful) return meaningful;
  }

  return '';
};

const entries = [];

for (const pattern of patterns) {
  const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
  let match;
  while ((match = regex.exec(text)) !== null) {
    let rawLabel;
    let value;
    let unit;

    if (pattern.labelGroup) {
      rawLabel = match[pattern.labelGroup];
      value = parseFloat(match[1]);
      unit = pattern.unit;
    } else {
      rawLabel = match[1];
      value = parseFloat(match[2]);
      unit = pattern.unit;
    }

    let label = normalizeLabel(rawLabel);

    // 特殊规则：总金额 / 融资总额（优先于上下文推断）
    const surroundingText = text.slice(Math.max(0, match.index - 30), match.index + match[0].length + 10);
    const hasTotalCue = /(一共|总共|共|拿下了)/.test(surroundingText);
    const hasFundingWord = /(融资|募资|投资)/.test(surroundingText);
    if (unit === '亿美元' && hasTotalCue && hasFundingWord) {
      label = '融资总额';
    }

    // 如果 label 太弱，尝试从上下文找更合适的主题词
    if (isWeakLabel(label)) {
      const contextualLabel = deriveLabelFromContext(match.index, match.index + match[0].length);
      if (contextualLabel) {
        label = contextualLabel;
      }
    }

    if (!label || isWeakLabel(label)) {
      label = '关键数据';
    }

    const valueText = `${match[pattern.labelGroup ? 1 : 2]}${unit}`;
    const numericValue = value * (unit === '亿美元' ? 10000 : unit === '百万美元' ? 100 : unit === '千万美元' ? 1000 : 1);

    entries.push({
      label,
      value: valueText,
      numericValue,
      originalValue: value,
      unit,
    });
  }
}

// 去重策略：
// 1. 相同 (label, value, unit) 完全去重；
// 2. 相同 (value, unit) 下若存在 preferred label，仅保留 preferred；
// 3. 否则保留不同 label 的条目（如不同公司相同金额）。
const preferredLabels = new Set(['融资总额', '总投资', '总额', '总计', '合计']);
const groupByValue = new Map();
for (const entry of entries) {
  const key = `${entry.originalValue}|${entry.unit}`;
  if (!groupByValue.has(key)) {
    groupByValue.set(key, []);
  }
  groupByValue.get(key).push(entry);
}

const uniqueEntries = [];
for (const group of groupByValue.values()) {
  // 优先选择 preferred label
  const preferred = group.find((e) => preferredLabels.has(e.label));
  if (preferred) {
    uniqueEntries.push(preferred);
    continue;
  }

  // 否则按 (label, value, unit) 去重并保留
  const labelMap = new Map();
  for (const entry of group) {
    const key = `${entry.label}|${entry.originalValue}|${entry.unit}`;
    if (!labelMap.has(key) || entry.label.length > labelMap.get(key).label.length) {
      labelMap.set(key, entry);
    }
  }

  const dedupedGroup = Array.from(labelMap.values());
  // 先排非弱 label，再按 label 长度选最佳
  const nonWeak = dedupedGroup.filter((e) => !isWeakLabel(e.label));
  const candidates = nonWeak.length > 0 ? nonWeak : dedupedGroup;
  candidates.sort((a, b) => b.label.length - a.label.length);

  for (const entry of candidates) {
    uniqueEntries.push(entry);
  }
}

// 若条目不足且存在 fallback，补齐
if (uniqueEntries.length === 0 && Array.isArray(config.fallbackItems) && config.fallbackItems.length > 0) {
  uniqueEntries = config.fallbackItems.map((item) => ({
    label: item.label,
    value: item.value,
    numericValue: item.percent || 50,
    originalValue: item.percent || 50,
    unit: '',
  }));
}

// 取前 maxItems 条
const limitedEntries = uniqueEntries.slice(0, config.maxItems);

// 计算 percent：以最大 numericValue 为 100%
const maxNumeric = Math.max(...limitedEntries.map((e) => e.numericValue), 1);
const dataBars = limitedEntries.map((entry) => ({
  label: entry.label,
  value: entry.value,
  percent: Math.round((entry.numericValue / maxNumeric) * 100),
}));

console.log(JSON.stringify(dataBars, null, 2));

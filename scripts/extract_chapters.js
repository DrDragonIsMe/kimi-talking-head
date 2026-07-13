#!/usr/bin/env node

/**
 * Extract video chapters from scene visuals.
 * Priority: Kimi Code API -> fallback to rule-based extraction.
 */

const fs = require('fs');
const { isConfigured, generateJson } = require('./kimi_client');

const inputPath = process.argv[2];
const outputPath = process.argv[3];
const fallbackMode = process.argv.includes('--fallback-only');

if (!inputPath || !outputPath) {
  console.error('Usage: node extract_chapters.js <scene_visuals.json> <chapters.json>');
  process.exit(1);
}

const sceneVisuals = JSON.parse(fs.readFileSync(inputPath, 'utf8'));

const ORDINAL_MARKER = /第[一二三四五六七八九十]+[，、,\s]*/g;
const CHINESE_PHRASE = /[\u4e00-\u9fa5]{2,6}/;
const STOP_CLAUSES = ['我挑重点说', '报告里列了几条', '什么意思', '就是车', '也就是说', '但问题是', '这背后反映', '全球数据也在', '报告给出了几个', '说一个我自己的'];

// 开场白/过渡词，标题应跳过
const OPENING_PREFIXES = [
  /^各位好[，、,\s]*/,
  /^大家好[，、,\s]*/,
  /^我是[^，。！？；]{0,8}[，、,\s]*/,
  /^今天想[，、,\s]*/,
  /^今天聊[，、,\s]*/,
  /^简单说[，、,\s]*/,
  /^我们来看[，、,\s]*/,
  /^接下来[，、,\s]*/,
];

const TRANSITION_WORDS = ['所以', '但是', '不过', '然而', '其实', '也就是说', '换句话说', '首先', '其次', '最后', '总之', '总的来看', '综合来看', '另一方面', '更重要的是'];

function clean(text) {
  return text.replace(/[""''""]/g, '').replace(/\s+/g, ' ').trim();
}

function isStop(text) {
  return STOP_CLAUSES.some((sw) => text.includes(sw));
}

function removeOpeningPrefix(text) {
  let result = text;
  for (const prefix of OPENING_PREFIXES) {
    result = result.replace(prefix, '');
  }
  return result.trim();
}

function removeTransitionPrefix(text) {
  for (const word of TRANSITION_WORDS) {
    if (text.startsWith(word)) {
      return text.slice(word.length).replace(/^[，、,\s]+/, '');
    }
  }
  return text;
}

function isSubstantive(text) {
  const chineseChars = text.match(/[\u4e00-\u9fa5]/g) || [];
  return chineseChars.length >= 4;
}

function trimToTitle(text, maxLen = 12) {
  let cleaned = clean(text)
    .replace(/[，、]/g, ' ')
    .trim();

  cleaned = removeOpeningPrefix(cleaned);
  cleaned = removeTransitionPrefix(cleaned);
  cleaned = cleaned.replace(/\s+/g, ' ').trim();

  if (!cleaned) return '';
  if (cleaned.length <= maxLen) return cleaned;

  // 优先在 maxLen 内的最后一个空格或语义边界处断开
  const cut = cleaned.slice(0, maxLen);
  const lastSpace = cut.lastIndexOf(' ');
  if (lastSpace > 2) {
    return cut.slice(0, lastSpace).trim();
  }
  // 中文语义边界：避免截断在助词/虚词后
  const boundary = cut.search(/[的地了得着过在是就都把而但和与为让给](?=[^\s]{0,2}$)/);
  if (boundary > 4) {
    return cut.slice(0, boundary).trim();
  }
  return cut.trim();
}

function splitIntoClauses(text) {
  // 口播文本常把标点替换为空格，因此同时用标点和空格分句
  return clean(text)
    .replace(/[，、]/g, ' ')
    .split(/[。！？；;\s]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 6 && s.length <= 50 && !isStop(s));
}

function scoreClause(clause) {
  let score = 0;
  const cleaned = removeTransitionPrefix(removeOpeningPrefix(clause)).trim();
  if (!cleaned) return 0;

  // 长度适中（完整短语优先）
  if (cleaned.length >= 8 && cleaned.length <= 16) score += 10;
  else if (cleaned.length >= 6) score += 6;

  // 不是开场白/过渡句
  if (!OPENING_PREFIXES.some((p) => p.test(clause))) score += 5;
  if (!TRANSITION_WORDS.some((w) => clause.startsWith(w))) score += 3;

  // 包含信息密度指标：数字、英文专有词、中文实词
  if (/\d/.test(cleaned)) score += 3;
  if (/[A-Z]{2,}|[A-Z][a-zA-Z]+/.test(cleaned)) score += 2;
  const chineseChars = (cleaned.match(/[\u4e00-\u9fa5]/g) || []).length;
  score += chineseChars * 0.4;

  return score;
}

function extractTitleCandidates(text) {
  const clauses = splitIntoClauses(text);
  const scored = clauses
    .map((clause) => ({ clause, score: scoreClause(clause) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.map((item) => item.clause);
}

const QUERY_TERM_MAP = {
  ai: 'AI',
  hr: 'HR',
  employ: 'Employ',
  id: 'ID.me',
  idme: 'ID.me',
  'id.me': 'ID.me',
  idme身份验证: 'ID.me身份验证',
  gartner: 'Gartner',
  fbi: 'FBI',
  jazzhr: 'JazzHR',
  lever: 'Lever',
  jobvite: 'Jobvite',
  brighthire: 'BrightHire',
};

function normalizeQueryPart(part) {
  const lower = part.toLowerCase().replace(/[^a-z0-9.]/g, '');
  return QUERY_TERM_MAP[lower] || part;
}

function titleFromQuery(query) {
  if (!query) return '';
  const parts = query
    .split(/\s+/)
    .filter(Boolean)
    .map(normalizeQueryPart)
    .filter((p) => p.length >= 2);

  // 去重（保留首次出现）
  const seen = new Set();
  const unique = [];
  for (const p of parts) {
    const key = p.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(p);
    }
  }

  // 优先保留中文词
  const chineseParts = unique.filter((p) => /[\u4e00-\u9fa5]/.test(p));
  if (chineseParts.length > 0) {
    const title = chineseParts.slice(0, 3).join(' · ');
    return title.length <= 14 ? title : title.slice(0, 14).replace(/[·\s]+$/, '');
  }

  // 英文词：最多取 3 个，用 · 连接
  const enParts = unique.filter((p) => /^[a-zA-Z0-9.]+$/.test(p));
  if (enParts.length >= 1) {
    // 优先取 2 个，避免截断；若总长短则可取 3 个
    let parts = enParts.slice(0, 3);
    let title = parts.join(' · ');
    if (title.length > 22 && parts.length > 2) {
      parts = enParts.slice(0, 2);
      title = parts.join(' · ');
    }
    return title.length <= 22 ? title : title.slice(0, 22).replace(/[·\s]+$/, '');
  }

  return unique.slice(0, 2).join(' · ');
}

function isFragment(text) {
  // 判断是否为不完整的句子碎片
  const endings = ['的', '了', '着', '过', '在', '是', '就', '都', '把', '被', '让', '给', '对', '向', '把', '一个', '这个', '这些', '那些', '这样', '那样', '一下', '一下', '重要', '严重', '很大', '非常'];
  if (endings.some((e) => text.endsWith(e))) return true;
  // 以数字、英文缩写或标点结尾，通常是片段
  if (/[0-9A-Za-z.]+$/.test(text)) return true;
  // 开头是过渡词且后面内容很短
  if (TRANSITION_WORDS.some((w) => text.startsWith(w)) && text.length < 10) return true;
  return false;
}

function fallbackSceneTitle(scene, index) {
  const text = scene.text || '';
  const query = scene.query || '';

  // 1. 优先从 query 生成稳定标题（query 是结构化的关键词，比口播碎片更可靠）
  const queryTitle = titleFromQuery(query);
  const queryTitleRich = queryTitle && queryTitle.length >= 6 && queryTitle.split('·').length >= 2;
  if (queryTitleRich) return queryTitle;

  // 2. 尝试从文本中提取完整候选句
  const candidates = extractTitleCandidates(text);
  if (candidates.length > 0) {
    const picked = candidates.find((c) => {
      const t = trimToTitle(c, 14);
      return t.length >= 6 && t.length <= 14 && !isFragment(t) && !OPENING_PREFIXES.some((p) => p.test(c));
    }) || candidates[0];
    const title = trimToTitle(picked, 14);
    if (title.length >= 6 && !isFragment(title)) return title;
  }

  // 3. 使用简单的 query 标题或兜底
  if (queryTitle && queryTitle.length >= 4) return queryTitle;
  return `第 ${index + 1} 段`;
}

function legacyExtractSceneTitle(scene, index) {
  const text = scene.text || '';
  const markers = [];
  let m;
  while ((m = ORDINAL_MARKER.exec(text)) !== null) {
    markers.push(m.index + m[0].length);
  }

  const candidates = [];
  for (let i = 0; i < markers.length; i++) {
    const start = markers[i];
    const end = i + 1 < markers.length ? markers[i + 1] : text.length;
    const segment = text.slice(start, end);
    const firstStop = segment.search(/[。！？；;,，]/);
    const clause = clean(firstStop >= 0 ? segment.slice(0, firstStop) : segment);
    if (clause.length >= 2 && !isStop(clause)) {
      const phraseMatch = clause.match(CHINESE_PHRASE);
      if (phraseMatch) {
        candidates.push(phraseMatch[0]);
      }
    }
  }

  if (candidates.length > 0) {
    const unique = [];
    for (const c of candidates) {
      if (!unique.includes(c)) {
        unique.push(c);
      }
      if (unique.length >= 3) break;
    }
    return unique.join(' · ').slice(0, 12).replace(/[\s·]+$/, '');
  }

  return fallbackSceneTitle(scene, index);
}

function fallbackChapters() {
  return sceneVisuals.map((scene, index) => ({
    start: scene.start,
    end: scene.end,
    title: legacyExtractSceneTitle(scene, index),
  }));
}

async function generateWithAi() {
  const scenesPayload = sceneVisuals.map((sv, index) => ({
    index: index + 1,
    start: sv.start,
    end: sv.end,
    text: (sv.text || '').slice(0, 400),
  }));

  const prompt = `You are a JSON generator. Output ONLY a valid JSON object, no explanations, no markdown, no reasoning, no code comments.

Task: Generate short Chinese chapter titles (6-10 Chinese characters each) for the following video scenes.
Rules:
1. Title should summarize the core content of the scene.
2. Skip opening greetings like "各位好" or self-introductions.
3. If a scene has multiple parallel points, connect them with " · ", total length <= 14 characters.
4. Keep original scene order.
5. Output must be valid JSON in this exact format: {"chapters": [{"index": 1, "title": "..."}, ...]}

Example output for a different video:
{"chapters": [{"index": 1, "title": "AI假候选人渗透招聘"}, {"index": 2, "title": "身份验证成新防线"}]}

Scenes:
${JSON.stringify(scenesPayload, null, 2)}`;

  const result = await generateJson(
    [
      { role: 'system', content: 'Output valid JSON only. Never output reasoning, explanations, markdown, or anything outside the JSON object.' },
      { role: 'user', content: prompt },
    ],
    2000
  );

  if (!Array.isArray(result.chapters)) {
    throw new Error('AI response missing "chapters" array');
  }

  return sceneVisuals.map((scene, index) => {
    const aiChapter = result.chapters.find((c) => c.index === index + 1);
    const rawTitle = aiChapter?.title?.trim();
    const title = rawTitle ? trimToTitle(rawTitle, 14) : fallbackSceneTitle(scene, index);
    return {
      start: scene.start,
      end: scene.end,
      title: title || fallbackSceneTitle(scene, index),
    };
  });
}

async function main() {
  let chapters;
  let source = 'fallback';

  if (!fallbackMode && isConfigured()) {
    try {
      chapters = await generateWithAi();
      source = 'kimi-code';
      console.log('🤖 使用 Kimi Code API 生成章节面包屑');
    } catch (err) {
      console.warn(`⚠️ Kimi Code API 失败，回退到规则提取: ${err.message}`);
      chapters = fallbackChapters();
    }
  } else {
    if (fallbackMode) {
      console.log('🛠️  强制使用本地规则提取章节面包屑');
    } else {
      console.log('🛠️  Kimi Code API 未配置，使用本地规则提取章节面包屑');
    }
    chapters = fallbackChapters();
  }

  fs.writeFileSync(outputPath, JSON.stringify(chapters, null, 2), 'utf8');
  console.log(`章节面包屑已生成 (${source}): ${outputPath}，共 ${chapters.length} 章`);
}

main().catch((err) => {
  console.error('生成章节面包屑失败:', err.message);
  process.exit(1);
});

#!/usr/bin/env node

/**
 * Generate a structured storyboard (分镜脚本) from subtitles.
 *
 * Usage:
 *   node generate_storyboard.js <subtitles.srt> <output.json> [config-path] [video-title]
 *
 * Output:
 *   JSON array of shots, each with timing, narration, shot type, camera,
 *   lighting, setting, description, and an English visual prompt.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const kimiClient = require('./kimi_client');

const srtPath = process.argv[2];
const outputJsonPath = process.argv[3];
const configPath = process.argv[4] || path.join(path.resolve(__dirname, '..'), 'config', 'host_profile.json');
const videoTitle = process.argv[5] || '';

if (require.main === module && (!srtPath || !outputJsonPath)) {
  console.error('Usage: node generate_storyboard.js <subtitles.srt> <output.json> [config-path] [video-title]');
  process.exit(1);
}

const DEFAULT_CONFIG = {
  enabled: true,
  max_shot_duration: 12,
  min_shot_duration: 3,
  shot_types: ['wide shot', 'medium shot', 'close-up', 'extreme close-up', 'over-the-shoulder', 'insert'],
  camera_movements: ['static', 'slow push-in', 'slow pull-out', 'gentle pan', 'tracking', 'handheld'],
  transitions: ['cut', 'fade', 'dissolve'],
  styles: ['editorial portrait', 'business documentary', 'cinematic', 'data visualization', 'abstract'],
  llm: {
    enabled: true,
    provider: 'kimi',
    max_tokens: 12000,
    max_retries: 2,
    cache: true,
  },
};

let runtimeConfig = null;
let diskCache = null;
let diskCachePath = '';
let diskCacheDirty = false;

function loadStoryboardConfig() {
  if (runtimeConfig) return runtimeConfig;
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    const full = JSON.parse(raw);
    const cfg = full.scene_visuals?.storyboard || {};
    runtimeConfig = {
      ...DEFAULT_CONFIG,
      ...cfg,
      llm: { ...DEFAULT_CONFIG.llm, ...(cfg.llm || {}) },
    };
  } catch (_e) {
    runtimeConfig = { ...DEFAULT_CONFIG };
  }
  return runtimeConfig;
}

function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function getTextHash(text) {
  return crypto.createHash('sha256').update(text).digest('hex').slice(0, 32);
}

function getCachePath() {
  if (!outputJsonPath) return '';
  const dir = path.dirname(outputJsonPath);
  return path.join(dir, 'storyboard_cache.json');
}

function loadCache() {
  if (diskCache) return diskCache;
  diskCachePath = getCachePath();
  if (!diskCachePath) {
    diskCache = { version: '1.0', items: {} };
    return diskCache;
  }
  try {
    const raw = fs.readFileSync(diskCachePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && parsed.version && typeof parsed.items === 'object') {
      diskCache = parsed;
      console.log(`💾 已加载分镜缓存: ${Object.keys(parsed.items).length} 条`);
    } else {
      diskCache = { version: '1.0', items: {} };
    }
  } catch (_e) {
    diskCache = { version: '1.0', items: {} };
  }
  return diskCache;
}

function saveCache() {
  if (!diskCacheDirty || !diskCachePath || !diskCache) return;
  try {
    ensureDir(diskCachePath);
    fs.writeFileSync(diskCachePath, JSON.stringify(diskCache, null, 2));
    diskCacheDirty = false;
  } catch (err) {
    console.warn(`  无法写入分镜缓存: ${err.message}`);
  }
}

function readCachedShots(narrationText) {
  const cfg = loadStoryboardConfig();
  if (!cfg.llm.cache) return null;
  const cache = loadCache();
  const hash = getTextHash(narrationText);
  return cache.items[hash] || null;
}

function writeCachedShots(narrationText, shots) {
  const cfg = loadStoryboardConfig();
  if (!cfg.llm.cache || !shots) return;
  const cache = loadCache();
  const hash = getTextHash(narrationText);
  cache.items[hash] = shots;
  cache.generated_at = new Date().toISOString();
  diskCacheDirty = true;
}

const cleanText = (text) =>
  text
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const parseSRT = (content) => {
  const cues = [];
  const blocks = content.trim().split(/\n\n+/);
  for (const block of blocks) {
    const lines = block.split('\n');
    if (lines.length < 3) continue;
    const timeLine = lines[1];
    const text = lines.slice(2).join(' ');
    const match = timeLine.match(/(\d{2}:\d{2}:\d{2},\d{3})\s+-->\s+(\d{2}:\d{2}:\d{2},\d{3})/);
    if (!match) continue;
    const parseTime = (t) => {
      const [h, m, s, ms] = t.replace(',', ':').split(':').map(Number);
      return h * 3600 + m * 60 + s + ms / 1000;
    };
    cues.push({ start: parseTime(match[1]), end: parseTime(match[2]), text: cleanText(text) });
  }
  return cues;
};

function isSentenceEnd(text) {
  return /[。！？；]$/.test(text.trim());
}

function buildShotsFromCues(cues, cfg) {
  if (cues.length === 0) return [];

  const maxDur = cfg.max_shot_duration;
  const minDur = cfg.min_shot_duration;
  const shots = [];

  let current = {
    start: cues[0].start,
    end: cues[0].end,
    text: cues[0].text,
  };

  for (let i = 1; i < cues.length; i++) {
    const cue = cues[i];
    const duration = current.end - current.start;

    const shouldSplit =
      duration >= maxDur ||
      (isSentenceEnd(current.text) && duration >= minDur);

    if (shouldSplit) {
      shots.push({ ...current });
      current = { start: cue.start, end: cue.end, text: cue.text };
    } else {
      current.end = cue.end;
      current.text += ' ' + cue.text;
    }
  }

  // finalize last
  if (current.text.trim()) {
    shots.push(current);
  }

  // merge trailing tiny shots into previous to satisfy min duration
  const merged = [];
  for (const shot of shots) {
    const duration = shot.end - shot.start;
    if (merged.length > 0 && duration < minDur) {
      const prev = merged[merged.length - 1];
      prev.end = shot.end;
      prev.text += ' ' + shot.text;
    } else {
      merged.push({ ...shot });
    }
  }

  return merged.map((s, idx) => ({
    id: `shot_${String(idx + 1).padStart(3, '0')}`,
    start: s.start,
    end: s.end,
    duration: Number((s.end - s.start).toFixed(3)),
    narration: s.text.trim(),
  }));
}

function buildFallbackShots(rawShots, cfg) {
  const shotTypes = cfg.shot_types;
  const cameras = cfg.camera_movements;
  const transitions = cfg.transitions;
  const styles = cfg.styles;

  return rawShots.map((shot, idx) => ({
    ...shot,
    shot_type: idx === 0 ? 'medium shot' : shotTypes[idx % shotTypes.length],
    subject: '主持人',
    setting: '简洁专业演播室',
    camera: idx === 0 ? 'static' : cameras[idx % cameras.length],
    lighting: '柔和面光，浅灰背景',
    description: `第 ${idx + 1} 镜：配合台词展示相关内容。`,
    visual_prompt: `Medium shot of a professional Chinese business host, clean studio background, soft key light, neutral gray backdrop, no text, no watermark`,
    style: styles[0],
    transition_from_prev: idx === 0 ? 'open' : transitions[0],
  }));
}

// hero_phrase 必须是 narration 的精确子串、2-6 字、且读起来是完整语义单元
// （不是跨词残片），否则视为 null（LLM 输出不可信，严格校验）。
const HERO_BAD_LEADING = /^[的了是在把被将和与或及就又都也才]/;
const HERO_BAD_TRAILING = /[的了和与或及把被是在]$/;

function sanitizeHeroPhrase(value, narration) {
  if (typeof value !== 'string') return null;
  const phrase = value.replace(/\s+/g, '');
  const length = Array.from(phrase).length;
  if (length < 2 || length > 6) return null;
  if (HERO_BAD_LEADING.test(phrase) || HERO_BAD_TRAILING.test(phrase)) return null;
  if (!narration || !narration.replace(/\s+/g, '').includes(phrase)) return null;
  return phrase;
}

async function enrichShotsWithLLM(rawShots, title, cfg) {
  if (!kimiClient.isConfigured() || !cfg.llm.enabled) {
    console.log('🤖 LLM 未配置或已禁用，使用默认分镜');
    return buildFallbackShots(rawShots, cfg);
  }

  const cacheKey = rawShots.map((s) => s.narration).join('\n');
  const cached = readCachedShots(cacheKey);
  if (cached) {
    console.log('💾 分镜缓存命中');
    return cached;
  }

  const shotTypes = cfg.shot_types.join(', ');
  const cameras = cfg.camera_movements.join(', ');
  const transitions = cfg.transitions.join(', ');
  const styles = cfg.styles.join(', ');

  const prompt = `You are a video storyboard editor for a Chinese business-news explainer video.
Given the video title and a list of narration shots (each with id, timing, and Chinese narration), produce a structured storyboard.

Rules:
1. shot_type must be one of: ${shotTypes}
2. camera must be one of: ${cameras}
3. transition_from_prev must be one of: ${transitions}. The first shot should be "open".
4. style must be one of: ${styles}
5. subject, setting, lighting, description should be in Chinese.
6. visual_prompt must be a detailed but concise English prompt suitable for AI image generation or stock-photo search (under 40 words). No text, no watermark, no logo, no UI screenshot.
7. Each visual should directly reflect the narration content, not generic business imagery.
8. Keep Chinese fields brief to avoid truncation.
9. hero_phrase: optionally pick ONE payoff phrase (2-4 Chinese characters, or a short Latin/number term) from this shot's narration that deserves a full-screen emphasis moment. Pick the conclusion or the surprising claim, NOT the topic word. It must be an exact substring of the narration AND a complete semantic unit that reads well standalone — never a fragment crossing word boundaries. Good examples: 数字员工, 真的落地, 万能工具, 三个误区. Bad examples (fragments, will be rejected): 狠剧变, 的三, 个误, 误区了. Use null when nothing earns the emphasis — most shots should be null.

Output strictly as a JSON array of objects in the same order as the input shots, with these exact fields:
id, start, end, duration, narration, shot_type, subject, setting, camera, lighting, description, visual_prompt, style, transition_from_prev, hero_phrase

Video title: ${title || 'business insight'}

Input shots:
${JSON.stringify(rawShots, null, 2)}`;

  const maxAttempts = cfg.llm.max_retries || 2;
  const baseTokens = cfg.llm.max_tokens || 4000;
  const perShotTokens = 500;
  const maxTokens = Math.max(baseTokens, rawShots.length * perShotTokens);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const currentPrompt = attempt > 1
        ? `${prompt}\n\nIMPORTANT: Return ONLY the JSON array. No explanations, no markdown, no preamble. Keep visual_prompt concise (under 30 words) to fit within output limits.`
        : prompt;

      const res = await kimiClient.generateJson(
        [
          { role: 'system', content: 'You are a JSON-only API. Output strictly valid JSON, no other text.' },
          { role: 'user', content: currentPrompt },
        ],
        maxTokens
      );

      const shotArray = Array.isArray(res) ? res : (res && Array.isArray(res.shots) ? res.shots : null);
      if (!shotArray) {
        throw new Error('LLM did not return a JSON array or an object with a shots array');
      }

      const enriched = rawShots.map((raw, idx) => {
        const llm = shotArray[idx] || {};
        return {
          ...raw,
          shot_type: cfg.shot_types.includes(llm.shot_type) ? llm.shot_type : cfg.shot_types[idx % cfg.shot_types.length],
          subject: llm.subject || '主持人',
          setting: llm.setting || '简洁专业演播室',
          camera: cfg.camera_movements.includes(llm.camera) ? llm.camera : cfg.camera_movements[idx % cfg.camera_movements.length],
          lighting: llm.lighting || '柔和面光，浅灰背景',
          description: llm.description || `第 ${idx + 1} 镜：${raw.narration.slice(0, 40)}`,
          visual_prompt: (llm.visual_prompt || '').trim() || `Professional Chinese business host, clean studio, soft light, no text`,
          style: cfg.styles.includes(llm.style) ? llm.style : cfg.styles[0],
          transition_from_prev: idx === 0 ? 'open' : (cfg.transitions.includes(llm.transition_from_prev) ? llm.transition_from_prev : cfg.transitions[0]),
          hero_phrase: sanitizeHeroPhrase(llm.hero_phrase, raw.narration),
        };
      });

      writeCachedShots(cacheKey, enriched);
      console.log(`🤖 分镜生成成功: ${enriched.length} 个镜头`);
      return enriched;
    } catch (err) {
      console.warn(`  ⚠️ 分镜 LLM 失败（第 ${attempt}/${maxAttempts} 次）: ${err.message.slice(0, 120)}`);
      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  }

  console.warn('  ⚠️ 分镜 LLM 最终失败，回退到默认分镜');
  return buildFallbackShots(rawShots, cfg);
}

const main = async () => {
  const cfg = loadStoryboardConfig();

  if (!cfg.enabled) {
    console.log('分镜生成已禁用');
    fs.writeFileSync(outputJsonPath, '[]');
    return;
  }

  const srtContent = fs.readFileSync(srtPath, 'utf8');
  const cues = parseSRT(srtContent);
  if (cues.length === 0) {
    console.log('No subtitle cues found, empty storyboard written.');
    fs.writeFileSync(outputJsonPath, '[]');
    return;
  }

  const rawShots = buildShotsFromCues(cues, cfg);
  console.log(`🎬 从字幕提取 ${rawShots.length} 个原始镜头`);

  const enriched = await enrichShotsWithLLM(rawShots, videoTitle, cfg);

  ensureDir(outputJsonPath);
  fs.writeFileSync(outputJsonPath, JSON.stringify(enriched, null, 2));
  saveCache();
  console.log(`🎬 分镜脚本已保存: ${outputJsonPath}`);
};

if (require.main === module) {
  main().catch((err) => {
    console.error('❌ 分镜生成失败:', err.message);
    process.exit(1);
  });
}

module.exports = { sanitizeHeroPhrase };

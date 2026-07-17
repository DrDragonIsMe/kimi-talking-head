#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');
const https = require('https');
const http = require('http');
const crypto = require('crypto');

// Optional LLM helper for content-aware keywords. Falls back to heuristic extraction.
const kimiClient = require('./kimi_client');

const srtPath = process.argv[2];
const outputJsonPath = process.argv[3];
const outputDir = process.argv[4];
const videoTitle = process.argv[5] || '';
const projectDir = path.resolve(__dirname, '..');
const configPath = process.argv[6] || path.join(projectDir, 'config', 'host_profile.json');
const storyboardPath = process.argv[7] || '';

if (!srtPath || !outputJsonPath || !outputDir) {
  console.error('Usage: node prepare_scene_visuals.js <subtitles.srt> <output.json> <output-dir> [video-title] [config-path] [storyboard-path]');
  process.exit(1);
}

const SCENE_DURATION = 42; // seconds per scene
const TARGET_WIDTH = 1080;
const TARGET_HEIGHT = 1440;

// Use LLM to translate scene meaning into a precise English image query.
// This is the single most effective way to improve relevance of stock-photo results.
const LLM_KEYWORD_CACHE = new Map();

// LLM result disk cache (keyed by content hash). Survives re-runs and saves API costs.
let keywordDiskCache = null;
let keywordDiskCachePath = '';
let keywordDiskCacheDirty = false;

// Runtime configuration loaded from host_profile.json + env overrides.
let runtimeConfig = {};

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

const extractKeywords = (text) => {
  const companies = text.match(/[A-Z][a-zA-Z0-9]*(?:\s[A-Z][a-zA-Z0-9]*)*/g) || [];
  const amounts = text.match(/\d+(?:\.\d+)?(?:亿|万|千|百|美元|元|%)/g) || [];
  const concepts = ['startup', 'funding', 'investment', 'workforce', 'AI', 'HR', 'recruiting', 'talent']
    .filter((w) => text.toLowerCase().includes(w.toLowerCase()));
  const unique = Array.from(new Set([...companies, ...amounts, ...concepts]));
  return unique.slice(0, 8).join(' ');
};

const sanitizeSearchQuery = (q) =>
  q
    .replace(/[，。！？、；：""''（）【】]/g, ' ')
    .replace(/[^\x00-\x7F]+/g, ' ') // remove remaining CJK if any
    .replace(/\s+/g, ' ')
    .trim();

// -------------- 配置与缓存 --------------

function getLlmConfig(sceneVisualsConfig = {}) {
  const env = process.env;
  const cfg = sceneVisualsConfig.llm || {};
  return {
    enabled: cfg.enabled !== false && kimiClient.isConfigured(),
    provider: cfg.provider || env.SCENE_VISUALS_LLM_PROVIDER || 'kimi',
    max_tokens: cfg.max_tokens || Number(env.SCENE_VISUALS_LLM_MAX_TOKENS) || 1200,
    concurrency: cfg.concurrency || Number(env.SCENE_VISUALS_LLM_CONCURRENCY) || 3,
    cache: cfg.cache !== false && env.SCENE_VISUALS_LLM_CACHE !== '0',
    timeout_ms: cfg.timeout_ms || Number(env.SCENE_VISUALS_LLM_TIMEOUT_MS) || 120000,
    prompt_template: cfg.prompt_template || '',
  };
}

function getTextHash(text) {
  return crypto.createHash('sha256').update(text).digest('hex').slice(0, 32);
}

function getKeywordCachePath() {
  if (!outputJsonPath) return '';
  const dir = path.dirname(outputJsonPath);
  return path.join(dir, 'scene_keywords.json');
}

function loadKeywordCache() {
  if (keywordDiskCache) return keywordDiskCache;
  keywordDiskCachePath = getKeywordCachePath();
  if (!keywordDiskCachePath) {
    keywordDiskCache = { version: '1.0', items: {} };
    return keywordDiskCache;
  }
  try {
    const raw = fs.readFileSync(keywordDiskCachePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && parsed.version && typeof parsed.items === 'object') {
      keywordDiskCache = parsed;
      console.log(`💾 已加载关键词缓存: ${Object.keys(parsed.items).length} 条`);
    } else {
      keywordDiskCache = { version: '1.0', items: {} };
    }
  } catch (_e) {
    keywordDiskCache = { version: '1.0', items: {} };
  }
  return keywordDiskCache;
}

function saveKeywordCache() {
  if (!keywordDiskCacheDirty || !keywordDiskCachePath || !keywordDiskCache) return;
  try {
    ensureDir(keywordDiskCachePath);
    fs.writeFileSync(keywordDiskCachePath, JSON.stringify(keywordDiskCache, null, 2));
    keywordDiskCacheDirty = false;
  } catch (err) {
    console.warn(`  无法写入关键词缓存: ${err.message}`);
  }
}

function readCachedKeywords(text) {
  const cfg = getLlmConfig(runtimeConfig);
  if (!cfg.cache) return null;
  const cache = loadKeywordCache();
  const hash = getTextHash(text);
  const item = cache.items[hash];
  if (!item || !item.search_query) return null;
  return {
    query: item.search_query,
    prompt: item.visual_prompt || item.search_query,
    summary: item.chinese_summary || '',
  };
}

function writeCachedKeywords(text, result) {
  const cfg = getLlmConfig(runtimeConfig);
  if (!cfg.cache || !result) return;
  const cache = loadKeywordCache();
  const hash = getTextHash(text);
  cache.items[hash] = {
    search_query: result.query,
    visual_prompt: result.prompt,
    chinese_summary: result.summary,
    created_at: new Date().toISOString(),
  };
  cache.generated_at = new Date().toISOString();
  keywordDiskCacheDirty = true;
}

// Run async tasks with a concurrency limit. Keeps LLM/network pressure bounded.
async function asyncPool(tasks, concurrency) {
  const results = new Array(tasks.length);
  const executing = new Set();
  for (let i = 0; i < tasks.length; i++) {
    const p = Promise.resolve().then(() => tasks[i]()).then((value) => {
      results[i] = { status: 'fulfilled', value };
      executing.delete(p);
    }).catch((reason) => {
      results[i] = { status: 'rejected', reason };
      executing.delete(p);
    });
    executing.add(p);
    if (executing.size >= concurrency) {
      await Promise.race(executing);
    }
  }
  await Promise.all(executing);
  return results;
}

async function extractKeywordsWithLLM(text, title, shots = []) {
  const shotSignature = shots.length ? `|${shots.map((s) => s.visual_prompt).join('|')}` : '';
  const cacheInput = `${text.slice(0, 500)}${shotSignature}`.slice(0, 1200);
  const cacheKey = cacheInput.slice(0, 300);
  if (LLM_KEYWORD_CACHE.has(cacheKey)) {
    return LLM_KEYWORD_CACHE.get(cacheKey);
  }

  const cfg = getLlmConfig(runtimeConfig);
  if (!cfg.enabled) {
    return null;
  }

  // 1) Disk cache hit
  const cached = readCachedKeywords(cacheInput);
  if (cached) {
    LLM_KEYWORD_CACHE.set(cacheKey, cached);
    return cached;
  }

  const defaultPrompt = `You are a visual editor for a Chinese business-news explainer video.
Given the spoken Chinese text of one scene and the video title, produce a precise English image-search query and a richer AI-image prompt that directly reflect the scene's core visual idea.

Rules:
1. The search query must be in English, 3-6 keywords, highly visual, and optimized for stock-photo sites (Pexels/Unsplash).
2. Prefer concrete, visualizable concepts: scenes, actions, objects, moods, settings. Avoid abstract nouns.
3. If the scene mentions data/charts, risk, AI, recruitment, or talent, include a matching visual keyword.
4. Keep the Chinese summary under 20 characters.
5. If storyboard shots are provided, synthesize their visual directions into one cohesive scene image prompt.

Output strictly as JSON:
{
  "search_query": "english keywords for stock photo search",
  "visual_prompt": "detailed English prompt for AI image generation, 1-2 sentences, no text/logo/watermark",
  "chinese_summary": "中文摘要"
}

Video title: ${title || 'business insight'}
Scene text: """${text.slice(0, 500)}"""
${shots.length ? `Storyboard shots for this scene:\n${shots.map((s) => `- ${s.shot_type}: ${s.visual_prompt}`).join('\n')}\nSynthesize these directions into a single cohesive visual.` : ''}`;

  const prompt = cfg.prompt_template || defaultPrompt;
  const startMs = Date.now();
  const maxAttempts = cfg.max_retries || 2;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      // On retry, append an extra instruction to force JSON-only output.
      const currentPrompt = attempt > 1
        ? `${prompt}\n\nIMPORTANT: Return ONLY the JSON object. No explanations, no markdown, no preamble.`
        : prompt;

      const res = await kimiClient.generateJson(
        [
          { role: 'system', content: 'You are a JSON-only API. Output strictly valid JSON, no other text.' },
          { role: 'user', content: currentPrompt },
        ],
        cfg.max_tokens
        // Note: kimi-for-coding only supports temperature=1, so we leave it at default.
      );

      const searchQuery = sanitizeSearchQuery(res.search_query || '');
      const visualPrompt = (res.visual_prompt || '').trim();
      const summary = (res.chinese_summary || '').trim();

      if (!searchQuery) {
        throw new Error('LLM returned empty search_query');
      }

      const result = {
        query: searchQuery,
        prompt: visualPrompt || searchQuery,
        summary,
      };

      LLM_KEYWORD_CACHE.set(cacheKey, result);
      writeCachedKeywords(cacheInput, result);

      const elapsed = Date.now() - startMs;
      console.log(`  🤖 LLM 关键词提取成功 (${elapsed}ms): ${searchQuery.slice(0, 60)}`);
      return result;
    } catch (err) {
      if (attempt < maxAttempts) {
        console.warn(`  ⚠️ LLM 关键词提取失败（第 ${attempt}/${maxAttempts} 次），1s 后重试: ${err.message.slice(0, 80)}`);
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } else {
        console.warn(`  ⚠️ LLM 关键词提取最终失败，回退到启发式提取: ${err.message.slice(0, 120)}`);
        return null;
      }
    }
  }

  return null;
}

const toSlug = (text, index) => {
  const base = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 60);
  return `${String(index + 1).padStart(2, '0')}-${base || 'scene'}`;
};

function commandExists(cmd) {
  try {
    execSync(`which ${cmd}`, { stdio: 'ignore' });
    return true;
  } catch (_e) {
    return false;
  }
}

function loadConfig() {
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    const full = JSON.parse(raw);
    runtimeConfig = full.scene_visuals || {};
    return runtimeConfig;
  } catch (_e) {
    runtimeConfig = {};
    return runtimeConfig;
  }
}

function loadStoryboard() {
  if (!storyboardPath) return null;
  try {
    const raw = fs.readFileSync(storyboardPath, 'utf8');
    const shots = JSON.parse(raw);
    if (!Array.isArray(shots)) return null;
    return shots;
  } catch (_e) {
    return null;
  }
}

function getShotsForScene(shots, start, end) {
  if (!shots || shots.length === 0) return [];
  return shots.filter((s) => s.start >= start && s.start < end);
}

function buildQueryFromShots(sceneShots) {
  if (!sceneShots || sceneShots.length === 0) return '';
  // Combine keywords from all shot visual prompts, weighted by shot duration,
  // to produce a short stock-photo query that reflects the whole scene.
  const stopWords = new Set(['a', 'an', 'the', 'of', 'in', 'on', 'at', 'with', 'and', 'or', 'for', 'to', 'from', 'by', 'is', 'are', 'no', 'text', 'watermark', 'logo', 'background', 'style', 'light', 'soft', 'bright', 'clean', 'modern', 'professional', 'realistic', 'cinematic']);
  const freq = new Map();
  for (const shot of sceneShots) {
    const prompt = (shot.visual_prompt || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
    const weight = Math.max(1, Math.round((shot.duration || 1) * 10));
    for (const w of prompt.split(/\s+/)) {
      if (w.length > 2 && !stopWords.has(w)) {
        freq.set(w, (freq.get(w) || 0) + weight);
      }
    }
  }
  const sorted = Array.from(freq.entries()).sort((a, b) => b[1] - a[1]).map(([w]) => w);
  return sorted.slice(0, 6).join(' ');
}

function buildPromptFromShots(sceneShots, basePrompt) {
  if (!sceneShots || sceneShots.length === 0) return basePrompt;
  const shotPrompts = sceneShots
    .map((s) => s.visual_prompt)
    .filter(Boolean);
  if (shotPrompts.length === 0) return basePrompt;

  // Deduplicate loosely while preserving order.
  const seen = new Set();
  const unique = [];
  for (const p of shotPrompts) {
    const key = p.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 80);
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(p);
    }
  }

  const shotDescriptions = unique.join(' | ');
  return `${basePrompt} Shot-by-shot direction: ${shotDescriptions}`;
}

function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function isValidImage(filePath) {
  return fs.existsSync(filePath) && fs.statSync(filePath).size > 2000;
}

// -------------- 网络下载 --------------

function downloadWithCurl(url, dest) {
  ensureDir(dest);
  // 优先使用 curl：更快、更稳、自动处理重定向和重试
  return new Promise((resolve, reject) => {
    const tmpDest = `${dest}.download`;
    try { fs.unlinkSync(tmpDest); } catch (_e) {}
    const args = ['-L', '--fail', '--retry', '2', '--retry-delay', '1', '--connect-timeout', '10', '--max-time', '90', '-o', tmpDest, url];
    const child = spawnSync('curl', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    if (child.status !== 0) {
      try { fs.unlinkSync(tmpDest); } catch (_e) {}
      reject(new Error(child.stderr?.toString()?.trim() || `curl failed: ${child.status}`));
      return;
    }
    try { fs.renameSync(tmpDest, dest); } catch (err) {
      try { fs.unlinkSync(tmpDest); } catch (_e) {}
      reject(err);
      return;
    }
    resolve(dest);
  });
}

function downloadWithNode(url, dest) {
  return new Promise((resolve, reject) => {
    ensureDir(dest);
    const tmpDest = `${dest}.download`;
    try { fs.unlinkSync(tmpDest); } catch (_e) {}
    const client = url.startsWith('https:') ? https : http;
    const file = fs.createWriteStream(tmpDest);
    const req = client.get(url, { timeout: 30000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        fs.unlinkSync(tmpDest);
        downloadWithNode(res.headers.location, dest).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200) {
        file.close();
        fs.unlinkSync(tmpDest);
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      res.pipe(file);
      file.on('finish', () => {
        file.close(() => {
          try {
            fs.renameSync(tmpDest, dest);
            resolve(dest);
          } catch (err) {
            try { fs.unlinkSync(tmpDest); } catch (_e) {}
            reject(err);
          }
        });
      });
    });
    req.on('error', (err) => {
      try { file.destroy(); fs.unlinkSync(tmpDest); } catch (_e) {}
      reject(err);
    });
    req.on('timeout', () => {
      req.destroy();
      try { file.destroy(); fs.unlinkSync(tmpDest); } catch (_e) {}
      reject(new Error('Request timeout'));
    });
  });
}

async function downloadFile(url, dest) {
  if (commandExists('curl')) {
    try {
      return await downloadWithCurl(url, dest);
    } catch (err) {
      console.warn(`  curl 下载失败: ${err.message}，回退到 Node http`);
    }
  }
  return downloadWithNode(url, dest);
}

function httpGetJson(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https:') ? https : http;
    const req = client.get(url, { headers, timeout: 20000 }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
          return;
        }
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`JSON parse error: ${e.message}`));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
  });
}

// -------------- 图片提供商 --------------

async function fetchWithUnsplashApi(query, _prompt, filePath, config) {
  const accessKey = config.access_key || process.env.UNSPLASH_ACCESS_KEY || '';
  if (!accessKey) {
    throw new Error('Unsplash access key not configured');
  }
  const orientation = config.orientation || 'portrait';
  const encodedQuery = encodeURIComponent(query);
  const url = `https://api.unsplash.com/search/photos?query=${encodedQuery}&orientation=${orientation}&per_page=10&client_id=${accessKey}`;
  const data = await httpGetJson(url);
  const results = data.results || [];
  if (!results.length) {
    throw new Error(`No Unsplash results for "${query}"`);
  }
  // 按相关性取第一张
  const pick = results[0];
  const downloadUrl = pick.urls?.raw || pick.urls?.full || pick.urls?.regular;
  if (!downloadUrl) {
    throw new Error('Unsplash result missing image URL');
  }
  // 请求指定尺寸以接近目标分辨率
  const sizedUrl = `${downloadUrl}&w=${TARGET_WIDTH}&h=${TARGET_HEIGHT}&fit=crop`;
  await downloadFile(sizedUrl, filePath);
  return {
    provider: 'unsplash',
    sourceUrl: pick.links?.html || `https://unsplash.com/?utm_source=kimi-talking-head&utm_medium=referral`,
    license: 'Unsplash License',
    author: pick.user?.name || pick.user?.username || 'Unknown',
    attributionRequired: true,
  };
}

async function fetchWithPicsum(query, _prompt, filePath, _config) {
  // Lorem Picsum 提供 CC0 风格的随机占位图，无需 API Key；用 query seed 保证同一场景稳定
  const seed = Buffer.from(query || 'scene').toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 32);
  const url = `https://picsum.photos/seed/${seed}/${TARGET_WIDTH}/${TARGET_HEIGHT}`;
  await downloadFile(url, filePath);
  return {
    provider: 'picsum',
    sourceUrl: `https://picsum.photos/`,
    license: 'Public Domain / CC0-like',
    author: 'Lorem Picsum',
    attributionRequired: false,
  };
}

async function fetchWithUnsplash(query, prompt, filePath, config) {
  try {
    return await fetchWithUnsplashApi(query, prompt, filePath, config);
  } catch (err) {
    console.warn(`  Unsplash API 不可用 (${err.message})，降级到 Picsum`);
    return await fetchWithPicsum(query, prompt, filePath, config);
  }
}

async function fetchWithPexels(query, _prompt, filePath, config) {
  const apiKey = config.api_key || process.env.PEXELS_API_KEY || '';
  if (!apiKey) {
    throw new Error('Pexels API key not configured');
  }
  const orientation = config.orientation || 'portrait';
  const encodedQuery = encodeURIComponent(query);
  const url = `https://api.pexels.com/v1/search?query=${encodedQuery}&orientation=${orientation}&per_page=10`;
  const data = await httpGetJson(url, { Authorization: apiKey });
  const photos = data.photos || [];
  if (!photos.length) {
    throw new Error(`No Pexels results for "${query}"`);
  }
  const pick = photos[0];
  // Pexels 提供多个尺寸，优先下载接近目标分辨率的版本
  const src = pick.src || {};
  const imageUrl = src.large2x || src.large || src.original || src.medium;
  if (!imageUrl) {
    throw new Error('Pexels result missing image URL');
  }
  await downloadFile(imageUrl, filePath);
  return {
    provider: 'pexels',
    sourceUrl: pick.url || 'https://www.pexels.com',
    license: 'Pexels License (free to use)',
    author: pick.photographer || 'Unknown',
    attributionRequired: false,
  };
}

// Pexels 视频搜索：与图片同链路（API key 复用 pexels 配置或 PEXELS_API_KEY）。
// 返回 MP4 直链，优先竖屏、宽度 ≥750 的最小视频文件。
async function fetchWithPexelsVideo(query, _prompt, filePath, config) {
  const apiKey = config.api_key || process.env.PEXELS_API_KEY || '';
  if (!apiKey) {
    throw new Error('Pexels API key not configured');
  }
  const orientation = config.orientation || 'portrait';
  const encodedQuery = encodeURIComponent(query);
  const url = `https://api.pexels.com/v1/videos/search?query=${encodedQuery}&orientation=${orientation}&per_page=10`;
  const data = await httpGetJson(url, { Authorization: apiKey });
  const videos = data.videos || [];
  if (!videos.length) {
    throw new Error(`No Pexels video results for "${query}"`);
  }

  // 在前 3 个结果里找最合适的文件：优先宽 ≥750 的最小文件（省带宽），兜底取可用最大
  let bestFile = null;
  let bestVideo = null;
  for (const video of videos.slice(0, 3)) {
    const files = (video.video_files || []).filter(
      (f) => f.link && (f.file_type || '').includes('mp4')
    );
    if (!files.length) continue;
    const sorted = files.slice().sort((a, b) => (a.width || 0) - (b.width || 0));
    const pick = sorted.find((f) => (f.width || 0) >= 750) || sorted[sorted.length - 1];
    if (pick) {
      bestFile = pick;
      bestVideo = video;
      break;
    }
  }
  if (!bestFile) {
    throw new Error(`No usable MP4 file in Pexels video results for "${query}"`);
  }

  await downloadFile(bestFile.link, filePath);
  return {
    provider: 'pexels_video',
    type: 'video',
    // Pexels 返回的片段时长（秒），渲染端用它做 Loop 循环铺满场景
    duration: typeof bestVideo.duration === 'number' ? bestVideo.duration : undefined,
    sourceUrl: bestVideo.url || 'https://www.pexels.com',
    license: 'Pexels License (free to use)',
    author: bestVideo.user?.name || 'Unknown',
    attributionRequired: false,
  };
}

function findArkcliGenOutput(cwd) {
  // arkcli +gen 默认把产物下载到 CWD，文件名通常是 <task-id>.png 或 prompt 相关
  const files = fs.readdirSync(cwd).filter((f) => /\.(png|jpg|jpeg)$/i.test(f));
  // 取最新生成的文件
  const sorted = files
    .map((f) => ({ name: f, mtime: fs.statSync(path.join(cwd, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  return sorted.length ? path.join(cwd, sorted[0].name) : null;
}

async function fetchWithWanx(query, prompt, filePath, config) {
  if (!commandExists('arkcli')) {
    throw new Error('arkcli not installed, cannot use wanx provider');
  }
  const model = config.model || process.env.WANX_MODEL || '';
  const size = config.size || '1024x1024';
  const finalPrompt = prompt || query || 'business editorial visual';
  const tmpDir = path.join(path.dirname(filePath), `.wanx-${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });
  try {
    const args = ['+gen', '--no-open', '--save-to', tmpDir];
    if (model) args.push('--model', model);
    // 尺寸参数在 arkcli 中不一定叫 --size；先尝试 --size，失败也不影响服务端默认
    if (size) args.push('--size', size);
    args.push(finalPrompt);

    const result = spawnSync('arkcli', args, {
      cwd: tmpDir,
      encoding: 'utf8',
      timeout: 120000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (result.status !== 0) {
      throw new Error(result.stderr || result.stdout || 'arkcli +gen failed');
    }
    const generated = findArkcliGenOutput(tmpDir);
    if (!generated || !fs.existsSync(generated)) {
      throw new Error('arkcli +gen did not produce an image file');
    }
    ensureDir(filePath);
    fs.copyFileSync(generated, filePath);
    return {
      provider: 'wanx',
      sourceUrl: '',
      license: 'Generated',
      author: 'Wuxiang / Ark',
      attributionRequired: false,
    };
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_e) {}
  }
}

function hslToHex(h, s, l) {
  s /= 100;
  l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))));
  return `#${f(0).toString(16).padStart(2, '0')}${f(8).toString(16).padStart(2, '0')}${f(4).toString(16).padStart(2, '0')}`;
}

function generatePlaceholderImage(filePath) {
  ensureDir(filePath);

  if (isValidImage(filePath)) {
    return;
  }

  const width = TARGET_WIDTH;
  const height = TARGET_HEIGHT;
  const hue = Math.floor(Math.random() * 360);
  const color = hslToHex(hue, 30, 95);
  try {
    if (commandExists('magick')) {
      execSync(`magick -size ${width}x${height} xc:"${color}" "${filePath}"`, { stdio: 'ignore' });
    } else if (commandExists('convert')) {
      execSync(`convert -size ${width}x${height} xc:"${color}" "${filePath}"`, { stdio: 'ignore' });
    } else {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="${color}"/></svg>`;
      fs.writeFileSync(`${filePath}.svg`, svg);
      try {
        execSync(`rsvg-convert "${filePath}.svg" -o "${filePath}"`, { stdio: 'ignore' });
      } catch (_e) {
        fs.renameSync(`${filePath}.svg`, filePath.replace(/\.png$/, '.svg'));
      }
      try { fs.unlinkSync(`${filePath}.svg`); } catch (_e) {}
    }
  } catch (error) {
    console.warn(`警告：无法生成占位图 ${filePath}: ${error.message}`);
  }
}

async function fetchWithPlaceholder(_query, _prompt, filePath, _config) {
  generatePlaceholderImage(filePath);
  if (!isValidImage(filePath)) {
    throw new Error('Failed to generate placeholder image');
  }
  return {
    provider: 'placeholder',
    sourceUrl: '',
    license: 'Placeholder',
    author: '',
    attributionRequired: false,
  };
}

const PROVIDERS = {
  pexels: fetchWithPexels,
  pexels_video: fetchWithPexelsVideo,
  unsplash: fetchWithUnsplash,
  wanx: fetchWithWanx,
  placeholder: fetchWithPlaceholder,
};

// provider 名 → 产物扩展名与类型
const PROVIDER_MEDIA = {
  pexels_video: { ext: '.mp4', type: 'video' },
};
const providerMedia = (providerName) => PROVIDER_MEDIA[providerName] || { ext: '.png', type: 'image' };

function isValidMedia(filePath) {
  // 与 isValidImage 同标准的宽松校验：存在且非小文件（视频至少 50KB）
  if (!fs.existsSync(filePath)) return false;
  const size = fs.statSync(filePath).size;
  return filePath.endsWith('.mp4') ? size > 50 * 1024 : size > 2000;
}

// preferVideo=true 时把 pexels_video 插到链首，图片 provider 兜底
async function fetchSceneVisual(query, prompt, basePathNoExt, config, preferVideo) {
  let providers = (config.providers || ['placeholder']).filter((p) => PROVIDERS[p]);
  if (!providers.length) providers = ['placeholder'];
  if (preferVideo && !providers.includes('pexels_video')) {
    providers = ['pexels_video', ...providers];
  }

  for (const providerName of providers) {
    const media = providerMedia(providerName);
    const filePath = `${basePathNoExt}${media.ext}`;
    try {
      console.log(`  尝试 ${providerName}: "${query.slice(0, 60)}${query.length > 60 ? '...' : ''}"`);
      // 视频 provider 复用 pexels 的 api_key 配置段
      const providerConfig =
        providerName === 'pexels_video'
          ? { ...(config.pexels || {}), ...(config.pexels_video || {}) }
          : config[providerName] || {};
      const meta = await PROVIDERS[providerName](query, prompt, filePath, providerConfig);
      if (isValidMedia(filePath)) {
        console.log(`  ✅ ${providerName} 成功 -> ${filePath}`);
        return { meta: { ...meta, type: media.type }, filePath };
      }
    } catch (err) {
      console.warn(`  ⚠️ ${providerName} 失败: ${err.message}`);
    }
  }

  throw new Error(`All scene visual providers failed for ${basePathNoExt}`);
}

// -------------- 主流程 --------------

const CONCURRENCY = 4;
const BATCH_DELAY_MS = 200;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const main = async () => {
  const config = loadConfig();
  const srtContent = fs.readFileSync(srtPath, 'utf8');
  const cues = parseSRT(srtContent);
  if (cues.length === 0) {
    fs.writeFileSync(outputJsonPath, '[]');
    console.log('No subtitle cues found, empty scene visuals written.');
    process.exit(0);
  }

  const totalDuration = cues[cues.length - 1].end;
  const sceneCount = Math.max(1, Math.ceil(totalDuration / SCENE_DURATION));
  const segmentDuration = totalDuration / sceneCount;

  const shots = loadStoryboard();
  if (shots) {
    console.log(`🎬 已加载分镜脚本: ${shots.length} 个镜头`);
  }

  const buildSceneText = (i) => {
    const start = i * segmentDuration;
    const end = i === sceneCount - 1 ? totalDuration : (i + 1) * segmentDuration;
    const segmentCues = cues.filter((c) => c.start >= start && c.start < end);
    const text = segmentCues.map((c) => c.text).join(' ');
    const sceneShots = getShotsForScene(shots, start, end);
    return { start, end, text, shots: sceneShots };
  };

  const buildSceneInfo = (i, llmResult) => {
    const { start, end, text, shots: sceneShots } = buildSceneText(i);

    // 1) Try LLM-driven, content-aware keywords first.
    // 2) Fallback to heuristic extraction.
    const fallbackQuery = extractKeywords(text) || extractKeywords(videoTitle) || 'business editorial visual';

    // If storyboard shots are available, derive query/prompt from them.
    const shotQuery = buildQueryFromShots(sceneShots);
    const shotAiPrompt = sceneShots && sceneShots.length > 0
      ? sceneShots.map((s) => s.visual_prompt).filter(Boolean).join(' | ')
      : '';
    // Prefer LLM result (which can synthesize shots + text), then storyboard, then fallback.
    const query = llmResult?.query || shotQuery || fallbackQuery;
    const aiPrompt = llmResult?.prompt || shotAiPrompt || fallbackQuery;
    const summary = llmResult?.summary || '';

    const slug = toSlug(query, i);
    // 扩展名在抓取时按 provider 决定（pexels_video→.mp4，图片→.png）
    const basePathNoExt = path.join(outputDir, slug);

    // Build a prompt that explicitly ties the image to the scene meaning.
    let prompt = `Vertical editorial visual for a Chinese business news explainer. Topic: ${videoTitle || 'business insight'}. Scene focus: ${query}. Narrative hint: ${text.slice(0, 300)}. Editorial business magazine, realistic, cinematic soft light, data-driven workplace scenes. Clean composition, premium newsroom art direction, no text, no letters, no watermark, no logo, no UI screenshot.`;
    prompt = buildPromptFromShots(sceneShots, prompt);

    return { start, end, text, query, aiPrompt, summary, slug, basePathNoExt, prompt, shots: sceneShots };
  };

  // Pre-extract LLM keywords with controlled concurrency so we don't hammer the API.
  const prepareSceneLlmResults = async () => {
    const cfg = getLlmConfig(config);
    if (!cfg.enabled) {
      console.log('🤖 LLM 关键词提取已禁用，使用启发式提取');
      return {};
    }

    const tasks = [];
    for (let i = 0; i < sceneCount; i++) {
      tasks.push((async () => {
        const { text, shots: sceneShots } = buildSceneText(i);
        const result = await extractKeywordsWithLLM(text, videoTitle, sceneShots);
        return { index: i, result };
      }));
    }

    console.log(`🤖 开始为 ${sceneCount} 个场景提取关键词（LLM 并发: ${cfg.concurrency}）...`);
    const startMs = Date.now();
    const results = await asyncPool(tasks, cfg.concurrency);
    const elapsed = Date.now() - startMs;

    const map = {};
    let successCount = 0;
    results.forEach((r) => {
      if (r.status === 'fulfilled') {
        map[r.value.index] = r.value.result;
        if (r.value.result) successCount++;
      }
    });

    console.log(`🤖 LLM 关键词提取完成: ${successCount}/${sceneCount} 个场景成功，耗时 ${elapsed}ms`);
    return map;
  };

  const processScene = async (i, llmResult) => {
    const info = buildSceneInfo(i, llmResult);

    // media_type: image（默认）| video（全视频 B-roll）| mixed（奇偶交替）
    const mediaType = config.media_type || 'image';
    const preferVideo = mediaType === 'video' || (mediaType === 'mixed' && i % 2 === 0);

    // 复用检查：两种扩展名都算（按偏好排序）
    const reuseCandidates = preferVideo
      ? [`${info.basePathNoExt}.mp4`, `${info.basePathNoExt}.png`]
      : [`${info.basePathNoExt}.png`, `${info.basePathNoExt}.mp4`];
    const reusedPath =
      process.env.FORCE_VISUALS !== '1' ? reuseCandidates.find((p) => isValidMedia(p)) : null;

    let meta;
    let filePath;
    if (reusedPath) {
      console.log(`♻️  复用场景画面: ${reusedPath}`);
      filePath = reusedPath;
      meta = {
        provider: 'reused',
        type: reusedPath.endsWith('.mp4') ? 'video' : 'image',
        sourceUrl: '',
        license: 'Reused',
        author: '',
        attributionRequired: false,
      };
    } else {
      const result = await fetchSceneVisual(info.query, info.prompt, info.basePathNoExt, config, preferVideo);
      meta = result.meta;
      filePath = result.filePath;
    }
    const relativePath = path.relative(path.join(process.cwd(), 'public'), filePath);
    const sceneVisual = {
      start: info.start,
      end: info.end,
      type: meta.type || 'image',
      ...(typeof meta.duration === 'number' ? { duration: meta.duration } : {}),
      prompt: info.prompt,
      query: info.query,
      text: info.text.slice(0, 400),
      summary: info.summary,
      aiPrompt: info.aiPrompt,
      provider: meta.provider,
      path: relativePath,
      sourceUrl: meta.sourceUrl,
      license: meta.license,
      author: meta.author,
      attributionRequired: meta.attributionRequired,
    };
    if (info.shots && info.shots.length > 0) {
      sceneVisual.shots = info.shots.map((s) => ({
        id: s.id,
        start: s.start,
        end: s.end,
        duration: s.duration,
        shot_type: s.shot_type,
        subject: s.subject,
        setting: s.setting,
        camera: s.camera,
        lighting: s.lighting,
        description: s.description,
        visual_prompt: s.visual_prompt,
        style: s.style,
        transition_from_prev: s.transition_from_prev,
      }));
    }
    return sceneVisual;
  };

  // Phase 1: content-aware keyword extraction (LLM + cache).
  const llmResults = await prepareSceneLlmResults();

  // Phase 2: download / reuse images.
  const visuals = [];
  for (let i = 0; i < sceneCount; i += CONCURRENCY) {
    const batch = [];
    const upper = Math.min(i + CONCURRENCY, sceneCount);
    console.log(`🖼️  准备场景画面 ${i + 1}-${upper} / ${sceneCount}（并发 ${upper - i}）`);
    for (let j = i; j < upper; j++) {
      batch.push(processScene(j, llmResults[j]));
    }
    const batchResults = await Promise.all(batch);
    visuals.push(...batchResults);
    if (upper < sceneCount) {
      await sleep(BATCH_DELAY_MS);
    }
  }

  saveKeywordCache();
  fs.writeFileSync(outputJsonPath, JSON.stringify(visuals, null, 2));
  console.log(`Prepared ${visuals.length} scene visuals to ${outputJsonPath}`);
};

main().catch((err) => {
  console.error('❌ 场景画面准备失败:', err.message);
  process.exit(1);
});

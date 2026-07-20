#!/usr/bin/env node
/**
 * Build scene_visuals.json from already-downloaded scene images.
 * Used when we want to reuse existing visuals instead of re-searching/generating.
 *
 * 全局素材缓存（建议18）：
 * - 按 query/prompt 计算 sha1 作为缓存 key，缓存目录 public/scene_visuals/_cache/
 * - 命中（内容一致）时在素材目录创建符号链接复用缓存文件，跳过重复拷贝
 * - 未命中或内容已变化时把本地素材写入缓存，供后续任务复用
 * - LRU 清理：超过 500 个文件或 2GB 时按 mtime 从最旧开始删除
 * - 可用 SCENE_VISUALS_CACHE_DIR 覆盖缓存目录（测试用）
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CACHE_EXTS = ['jpg', 'jpeg', 'png', 'webp', 'mp4'];
const CACHE_MAX_FILES = 500;
const CACHE_MAX_BYTES = 2 * 1024 * 1024 * 1024; // 2GB

const publicDir = path.resolve(__dirname, '..', 'public');

const cacheDir = () =>
  process.env.SCENE_VISUALS_CACHE_DIR || path.join(publicDir, 'scene_visuals', '_cache');

const cacheKey = (query) =>
  crypto.createHash('sha1').update(String(query || '')).digest('hex');

const fileHash = (file) => crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex');

const sameFileContent = (a, b) => {
  const sa = fs.statSync(a);
  const sb = fs.statSync(b);
  return sa.size === sb.size && fileHash(a) === fileHash(b);
};

// 命中返回缓存文件绝对路径并刷新 mtime（LRU recency），未命中返回 null
const cacheLookup = (key, dir = cacheDir()) => {
  for (const ext of CACHE_EXTS) {
    const file = path.join(dir, `${key}.${ext}`);
    if (fs.existsSync(file)) {
      const now = new Date();
      try {
        fs.utimesSync(file, now, now);
      } catch {
        // mtime 刷新失败不影响复用
      }
      return file;
    }
  }
  return null;
};

// 把素材写入缓存，返回缓存文件路径（已存在则覆盖，保证内容最新）
const cacheStore = (key, srcFile, dir = cacheDir()) => {
  const ext = path.extname(srcFile).slice(1).toLowerCase();
  const dest = path.join(dir, `${key}.${ext}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(srcFile, dest);
  return dest;
};

// LRU 清理：文件数超过 maxFiles 或总大小超过 maxBytes 时，按 mtime 从最旧开始删除
const pruneCache = (dir = cacheDir(), { maxFiles = CACHE_MAX_FILES, maxBytes = CACHE_MAX_BYTES } = {}) => {
  if (!fs.existsSync(dir)) return { removed: 0 };
  const entries = fs
    .readdirSync(dir)
    .filter((f) => CACHE_EXTS.includes(path.extname(f).slice(1).toLowerCase()))
    .map((f) => {
      const st = fs.statSync(path.join(dir, f));
      return { file: path.join(dir, f), size: st.size, mtime: st.mtimeMs };
    })
    .sort((a, b) => a.mtime - b.mtime); // 最旧在前

  let totalBytes = entries.reduce((sum, e) => sum + e.size, 0);
  let removed = 0;
  while (entries.length > maxFiles || totalBytes > maxBytes) {
    const oldest = entries.shift();
    fs.unlinkSync(oldest.file);
    totalBytes -= oldest.size;
    removed += 1;
  }
  return { removed };
};

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
    cues.push({
      start: parseTime(match[1]),
      end: parseTime(match[2]),
      text: cleanText(text),
    });
  }
  return cues;
};

const filenameToSummary = (name) => {
  const base = name.replace(/\.[^.]+$/, '').replace(/^\d+-/, '');
  const map = {
    'ai-startup-seed-funding-modern-tech-studio': '建筑AI获400万美元种子轮',
    'glass-installation-contractor-bidding-documents': '玻璃安装投标细分AI服务',
    'ai-business-workflow-diagram-modern-tech': 'AI赋能建筑行业流程闭环',
    'modern-corporate-office-hr-ai': '薪灵AI智能HR场景',
    'ai-technology-construction-business-workflow': 'AI助力建筑行业流程优化',
    'bright-modern-ai-startup-studio': 'AI落地黄金公式分享',
  };
  return map[base] || base.replace(/-/g, ' ');
};

// 解析单张素材文件：命中全局缓存时建符号链接复用，未命中/内容变化时写入缓存。
// 返回最终应引用的文件名（位于 imageDir 内）。
const resolveCachedFile = (imageDir, file, query) => {
  const srcFile = path.join(imageDir, file);
  const key = cacheKey(query);
  const cached = cacheLookup(key);
  if (cached) {
    try {
      if (sameFileContent(cached, srcFile)) {
        const linkName = `${key}${path.extname(cached)}`;
        const linkPath = path.join(imageDir, linkName);
        if (!fs.existsSync(linkPath)) {
          try {
            fs.symlinkSync(cached, linkPath);
          } catch {
            fs.copyFileSync(cached, linkPath);
          }
        }
        return linkName;
      }
      // query 相同但内容已更新：刷新缓存，使用本地新文件
      cacheStore(key, srcFile);
      return file;
    } catch {
      return file;
    }
  }
  try {
    cacheStore(key, srcFile);
  } catch {
    // 缓存写入失败不阻断主流程
  }
  return file;
};

const main = () => {
  const srtPath = process.argv[2];
  const imageDir = process.argv[3];
  const outputPath = process.argv[4];
  const audioDuration = parseFloat(process.argv[5]);

  if (!srtPath || !imageDir || !outputPath || Number.isNaN(audioDuration)) {
    console.error(
      'Usage: node build_scene_visuals_from_existing.js <subtitles.srt> <image-dir> <output.json> <audio-duration>'
    );
    process.exit(1);
  }

  const cues = parseSRT(fs.readFileSync(srtPath, 'utf8'));

  const imageFiles = fs
    .readdirSync(imageDir)
    .filter((f) => /\.(png|jpg|jpeg|webp)$/i.test(f))
    .sort();

  if (imageFiles.length === 0) {
    console.error(`No images found in ${imageDir}`);
    process.exit(1);
  }

  const segmentDuration = audioDuration / imageFiles.length;
  const relativeImageDir = path.relative(publicDir, imageDir);

  const sceneVisuals = imageFiles.map((file, index) => {
    const start = index * segmentDuration;
    const end = index === imageFiles.length - 1 ? audioDuration : (index + 1) * segmentDuration;
    const segmentCues = cues.filter((c) => c.start >= start && c.start < end);
    const text = segmentCues.map((c) => c.text).join(' ');
    const summary = filenameToSummary(file);
    const query = summary;
    const resolvedFile = resolveCachedFile(imageDir, file, query);

    return {
      start,
      end,
      prompt: `Vertical editorial visual for a Chinese business news explainer. ${summary}. Clean modern business aesthetic, no text or watermarks.`,
      query,
      text,
      summary,
      aiPrompt: summary,
      provider: 'local',
      path: path.join(relativeImageDir, resolvedFile).replace(/\\/g, '/'),
      sourceUrl: '',
      license: 'local',
      author: '',
      attributionRequired: false,
    };
  });

  const { removed } = pruneCache();
  if (removed > 0) {
    console.log(`Cache pruned: removed ${removed} oldest file(s) from ${cacheDir()}`);
  }

  fs.writeFileSync(outputPath, JSON.stringify(sceneVisuals, null, 2), 'utf8');
  console.log(`Wrote ${sceneVisuals.length} scene visuals to ${outputPath}`);
};

if (require.main === module) {
  main();
}

module.exports = {
  cacheKey,
  cacheLookup,
  cacheStore,
  pruneCache,
  sameFileContent,
  resolveCachedFile,
  CACHE_MAX_FILES,
  CACHE_MAX_BYTES,
};

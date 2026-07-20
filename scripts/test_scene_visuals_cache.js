#!/usr/bin/env node
/**
 * Tests for the global asset cache in scripts/build_scene_visuals_from_existing.js (建议18)。
 *
 * Usage: node scripts/test_scene_visuals_cache.js
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SCRIPT = path.join(__dirname, 'build_scene_visuals_from_existing.js');
const cache = require(SCRIPT);

let failures = 0;

function assert(cond, message) {
  if (cond) {
    console.log(`  ✅ ${message}`);
  } else {
    failures += 1;
    console.error(`  ❌ ${message}`);
  }
}

const mkTmp = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

console.log('=== scene visuals cache ===');

// 1. cacheKey：按 query 算 hash，稳定且随输入变化
{
  const k1 = cache.cacheKey('办公室场景');
  const k2 = cache.cacheKey('办公室场景');
  const k3 = cache.cacheKey('其他场景');
  assert(k1 === k2, 'cacheKey is deterministic');
  assert(k1 !== k3, 'cacheKey varies with query');
  assert(/^[0-9a-f]{40}$/.test(k1), 'cacheKey is a sha1 hex digest');
}

// 2. cacheStore + cacheLookup：写入后可命中，且返回缓存文件路径
{
  const dir = mkTmp('scene-cache-');
  const src = path.join(dir, 'src.png');
  fs.writeFileSync(src, 'fake-png-bytes');
  const key = cache.cacheKey('q1');
  const dest = cache.cacheStore(key, src, dir);
  assert(dest === path.join(dir, `${key}.png`), 'cacheStore places file under <hash>.<ext>');
  const hit = cache.cacheLookup(key, dir);
  assert(hit === dest, 'cacheLookup finds stored file');
  assert(cache.cacheLookup(cache.cacheKey('q2'), dir) === null, 'cacheLookup misses unknown key');
}

// 3. pruneCache：文件数超限时按 mtime 从最旧删除
{
  const dir = mkTmp('scene-cache-');
  for (let i = 0; i < 5; i += 1) {
    const f = path.join(dir, `k${i}.png`);
    fs.writeFileSync(f, `data-${i}`);
    const t = new Date(Date.now() - (5 - i) * 1000); // k0 最旧
    fs.utimesSync(f, t, t);
  }
  const { removed } = cache.pruneCache(dir, { maxFiles: 3, maxBytes: 1 << 30 });
  assert(removed === 2, `pruneCache removes oldest files beyond maxFiles (removed ${removed})`);
  const left = fs.readdirSync(dir).sort();
  assert(left.join(',') === 'k2.png,k3.png,k4.png', 'pruneCache keeps the newest files');
}

// 4. pruneCache：总大小超限时按 mtime 从最旧删除
{
  const dir = mkTmp('scene-cache-');
  for (let i = 0; i < 3; i += 1) {
    const f = path.join(dir, `k${i}.png`);
    fs.writeFileSync(f, Buffer.alloc(100, i));
    const t = new Date(Date.now() - (3 - i) * 1000);
    fs.utimesSync(f, t, t);
  }
  const { removed } = cache.pruneCache(dir, { maxFiles: 100, maxBytes: 150 });
  assert(removed === 2, `pruneCache removes files beyond maxBytes (removed ${removed})`);
  assert(fs.readdirSync(dir).join(',') === 'k2.png', 'pruneCache keeps newest within byte budget');
}

// 5. pruneCache：未超限时不删除
{
  const dir = mkTmp('scene-cache-');
  fs.writeFileSync(path.join(dir, 'a.png'), 'x');
  const { removed } = cache.pruneCache(dir, { maxFiles: 10, maxBytes: 1 << 30 });
  assert(removed === 0 && fs.existsSync(path.join(dir, 'a.png')), 'pruneCache keeps files under limits');
}

// 6. 端到端：CLI 首次运行写入缓存，二次运行命中缓存并创建符号链接
{
  const dir = mkTmp('scene-e2e-');
  const imageDir = path.join(dir, 'images');
  const cacheDir = path.join(dir, 'cache');
  fs.mkdirSync(imageDir);
  fs.writeFileSync(path.join(imageDir, '01-modern-corporate-office-hr-ai.png'), 'image-bytes-v1');
  const srt = path.join(dir, 'subtitles.srt');
  fs.writeFileSync(srt, '1\n00:00:00,000 --> 00:00:02,000\n薪灵AI智能HR场景\n');
  const out = path.join(dir, 'scene_visuals.json');

  const env = { ...process.env, SCENE_VISUALS_CACHE_DIR: cacheDir };
  const r1 = spawnSync('node', [SCRIPT, srt, imageDir, out, '2'], { encoding: 'utf-8', env });
  assert(r1.status === 0, `first CLI run exits 0 (${r1.stderr.trim()})`);
  const cached = fs.readdirSync(cacheDir);
  assert(cached.length === 1, 'first run stores one file in global cache');

  const r2 = spawnSync('node', [SCRIPT, srt, imageDir, out, '2'], { encoding: 'utf-8', env });
  assert(r2.status === 0, `second CLI run exits 0 (${r2.stderr.trim()})`);
  const visuals = JSON.parse(fs.readFileSync(out, 'utf-8'));
  const refName = path.basename(visuals[0].path);
  assert(refName === cached[0], 'second run references the cache-hash filename');
  const linkPath = path.join(imageDir, refName);
  assert(fs.lstatSync(linkPath).isSymbolicLink(), 'cache hit reuses asset via symlink');
  assert(fs.readFileSync(linkPath, 'utf-8') === 'image-bytes-v1', 'symlink resolves to cached content');
}

// 7. 端到端：query 相同但内容变化时刷新缓存，使用本地新文件
{
  const dir = mkTmp('scene-e2e-');
  const imageDir = path.join(dir, 'images');
  const cacheDir = path.join(dir, 'cache');
  fs.mkdirSync(imageDir);
  const img = path.join(imageDir, '01-modern-corporate-office-hr-ai.png');
  fs.writeFileSync(img, 'image-bytes-v1');
  const srt = path.join(dir, 'subtitles.srt');
  fs.writeFileSync(srt, '1\n00:00:00,000 --> 00:00:02,000\n薪灵AI智能HR场景\n');
  const out = path.join(dir, 'scene_visuals.json');
  const env = { ...process.env, SCENE_VISUALS_CACHE_DIR: cacheDir };

  spawnSync('node', [SCRIPT, srt, imageDir, out, '2'], { encoding: 'utf-8', env });
  fs.writeFileSync(img, 'image-bytes-v2-updated');
  const r = spawnSync('node', [SCRIPT, srt, imageDir, out, '2'], { encoding: 'utf-8', env });
  assert(r.status === 0, 'CLI run with updated image exits 0');
  const visuals = JSON.parse(fs.readFileSync(out, 'utf-8'));
  assert(
    path.basename(visuals[0].path) === '01-modern-corporate-office-hr-ai.png',
    'updated content keeps referencing the local file'
  );
  const cachedFile = path.join(cacheDir, fs.readdirSync(cacheDir)[0]);
  assert(fs.readFileSync(cachedFile, 'utf-8') === 'image-bytes-v2-updated', 'cache entry is refreshed with new content');
}

console.log('');
if (failures > 0) {
  console.error(`FAILED: ${failures} assertion(s)`);
  process.exit(1);
}
console.log('PASSED: all assertions');

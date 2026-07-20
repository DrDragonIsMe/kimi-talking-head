const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// pipeline 的 9 个阶段（与 scripts/lib/state.sh 的 PHASES 保持一致）
const PHASES = ['script', 'tts', 'whisper', 'subtitles', 'storyboard', 'visuals', 'lipsync', 'postprocess', 'render'];

function hashText(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

// 键序无关的稳定序列化，用于 config 快照对比（configDirty）
function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}

// 递归收集两个 config 对象之间发生变化的叶子路径（dot 形式）
function diffConfigPaths(prev, next, prefix, out) {
  const prevIsObj = prev && typeof prev === 'object' && !Array.isArray(prev);
  const nextIsObj = next && typeof next === 'object' && !Array.isArray(next);
  if (!prevIsObj || !nextIsObj) {
    if (stableStringify(prev) !== stableStringify(next)) out.push(prefix);
    return;
  }
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
  for (const key of keys) {
    const p = prefix ? `${prefix}.${key}` : key;
    if (!(key in prev) || !(key in next)) {
      out.push(p);
    } else {
      diffConfigPaths(prev[key], next[key], p, out);
    }
  }
}

// 由 diff 推导最早受影响阶段（没改的不重跑）：
//   articleText/articleHash 变化                     → script
//   voice.* 变化                                     → tts
//   content_overlay.subtitles.segmentation 变化      → subtitles
//   scene_visuals.* 变化                             → visuals
//   其它（title_card / dna / fonts / layout / style…）→ render
// prev/next: { articleHash?, articleText?, config? }
function computeInvalidationPhase(prev, next) {
  const p = prev || {};
  const n = next || {};

  if (p.articleHash && n.articleHash) {
    if (p.articleHash !== n.articleHash) return 'script';
  } else if (p.articleText !== undefined || n.articleText !== undefined) {
    if ((p.articleText || '') !== (n.articleText || '')) return 'script';
  }

  const changed = [];
  diffConfigPaths(p.config || {}, n.config || {}, '', changed);
  if (!changed.length) return 'render';

  let best = 'render';
  for (const changedPath of changed) {
    const top = changedPath.split('.')[0];
    let phase = 'render';
    if (top === 'voice') {
      phase = 'tts';
    } else if (
      changedPath === 'content_overlay.subtitles.segmentation' ||
      changedPath.startsWith('content_overlay.subtitles.segmentation.')
    ) {
      phase = 'subtitles';
    } else if (top === 'scene_visuals') {
      phase = 'visuals';
    }
    if (PHASES.indexOf(phase) < PHASES.indexOf(best)) best = phase;
  }
  return best;
}

function isInside(baseDir, resolved) {
  return resolved.startsWith(path.resolve(baseDir) + path.sep);
}

// 版本重跑的工作目录复用：整体 clone 上一版本 workdir（fs.cpSync 递归复制目录内容，
// dereference 展开符号链接，无平台相关回退），再把 .pipeline_state.json 里的旧绝对路径改写到新目录，
// 并将失效阶段及其之后全部置回 pending，让 pipeline.sh 的断点续跑逻辑自动跳过未变更阶段。
function prepareReuseWorkdir({ tempDir, prevRunName, newRunName, invalidationPhase }) {
  const src = path.resolve(tempDir, prevRunName);
  const dst = path.resolve(tempDir, newRunName);
  if (!isInside(tempDir, src) || !isInside(tempDir, dst)) {
    throw new Error(`workdir path escapes temp/: ${prevRunName} -> ${newRunName}`);
  }
  if (src === dst || !fs.existsSync(src)) {
    return { copied: false, stateReset: false };
  }

  // fs.cpSync(src, dst) 复制的是 src 的内容到 dst（等价于 cp -R src/. dst），Node >= 16.7
  fs.mkdirSync(dst, { recursive: true });
  fs.cpSync(src, dst, { recursive: true, dereference: true });

  const statePath = path.join(dst, '.pipeline_state.json');
  if (!fs.existsSync(statePath)) {
    return { copied: true, stateReset: false };
  }
  // (a) 旧 workdir 绝对路径 → 新 workdir
  const raw = fs.readFileSync(statePath, 'utf8').split(src).join(dst);
  let state = null;
  try {
    state = JSON.parse(raw);
  } catch (_err) {
    state = null;
  }
  if (!state) {
    return { copied: true, stateReset: false };
  }
  // (b) 失效阶段及之后重置为 pending
  let cut = PHASES.indexOf(invalidationPhase);
  if (cut < 0) cut = PHASES.length - 1;
  PHASES.forEach((phase, i) => {
    if (i >= cut && state[phase]) {
      state[phase] = {
        status: 'pending',
        started_at: null,
        completed_at: null,
        output: null,
        attempt: 0,
        error: null,
      };
    }
  });
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
  return { copied: true, stateReset: true };
}

// 执行预估：聚合最近 limit 个已完成版本的耗时（finishedAt - startedAt），按 kind 分组
function aggregateEstimates(jobs, limit = 20) {
  const records = [];
  for (const job of jobs || []) {
    const versions = Array.isArray(job.versions) ? job.versions : [];
    for (const v of versions) {
      if (v.status !== 'completed' || !v.startedAt || !v.finishedAt) continue;
      const seconds = (new Date(v.finishedAt) - new Date(v.startedAt)) / 1000;
      if (Number.isFinite(seconds) && seconds >= 0) {
        records.push({ kind: v.kind === 'rebuild' ? 'rebuild' : 'full', seconds, finishedAt: v.finishedAt });
      }
    }
  }
  records.sort((a, b) => new Date(b.finishedAt) - new Date(a.finishedAt));
  const recent = records.slice(0, limit);
  const agg = (kind) => {
    const arr = recent.filter((r) => r.kind === kind);
    if (!arr.length) return null;
    const avgSeconds = Math.round((arr.reduce((s, r) => s + r.seconds, 0) / arr.length) * 10) / 10;
    return { avgSeconds, samples: arr.length };
  };
  return { full: agg('full'), rebuild: agg('rebuild') };
}

// 成本预估（update_suggestions.md §15）：按文章长度与配置粗估 LLM token 与各阶段耗时。
// 公式（口播稿字符数近似取文章字符数）：
//   口播稿生成 ≈ 3×文章字符数 token；分镜 LLM ≈ 8×口播稿字符数 token
//   TTS ≈ 4 字/秒 → 音频时长；唇形同步 ≈ 2×音频时长；渲染 ≈ 1×音频时长
// configOverrides.scene_visuals.storyboard.llm.enabled === false 时分镜 token 记 0。
// 返回 { tokens: { script, storyboard, total }, seconds: { tts, lipSync, render, total } }
function estimateCost(articleText, configOverrides) {
  const articleChars = (articleText || '').length;
  const scriptTokens = Math.round(3 * articleChars);

  const storyboardLlm = configOverrides && configOverrides.scene_visuals
    && configOverrides.scene_visuals.storyboard
    && configOverrides.scene_visuals.storyboard.llm;
  const storyboardEnabled = !storyboardLlm || storyboardLlm.enabled !== false;
  const storyboardTokens = storyboardEnabled ? Math.round(8 * articleChars) : 0;

  const ttsSeconds = Math.round((articleChars / 4) * 10) / 10;
  const lipSyncSeconds = Math.round(ttsSeconds * 2 * 10) / 10;
  const renderSeconds = ttsSeconds;

  return {
    tokens: {
      script: scriptTokens,
      storyboard: storyboardTokens,
      total: scriptTokens + storyboardTokens,
    },
    seconds: {
      tts: ttsSeconds,
      lipSync: lipSyncSeconds,
      render: renderSeconds,
      total: Math.round((ttsSeconds + lipSyncSeconds + renderSeconds) * 10) / 10,
    },
  };
}

module.exports = {
  PHASES,
  hashText,
  stableStringify,
  computeInvalidationPhase,
  prepareReuseWorkdir,
  aggregateEstimates,
  estimateCost,
};

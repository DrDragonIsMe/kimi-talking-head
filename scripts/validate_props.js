#!/usr/bin/env node

/**
 * Remotion 渲染前 props 预检（fail-fast）。
 *
 * 用法：node scripts/validate_props.js [props.json 路径]
 *
 * 增强字段（heroMoments / bgmPath / sfxHeroPath 等）缺失视为未启用，合法；
 * 存在时则必须结构正确、引用文件真实存在。任何错误以退出码 1 终止，
 * 避免 heredoc 拼装的非法 props 到渲染阶段才暴露。
 */

const fs = require('fs');
const path = require('path');

const propsPath = process.argv[2] || path.join(process.cwd(), 'public', 'props.json');

const errors = [];
const warnings = [];

const fail = (msg) => errors.push(msg);
const warn = (msg) => warnings.push(msg);

let props;
try {
  props = JSON.parse(fs.readFileSync(propsPath, 'utf8'));
} catch (error) {
  console.error(`❌ props 文件无法解析: ${propsPath} (${error.message})`);
  process.exit(1);
}

const publicDir = path.dirname(path.resolve(propsPath));
const fileExistsUnderPublic = (relPath) => {
  if (typeof relPath !== 'string' || relPath.length === 0) return false;
  const resolved = path.resolve(publicDir, relPath);
  // 防路径穿越出 public/
  if (!resolved.startsWith(publicDir + path.sep)) return false;
  return fs.existsSync(resolved);
};

// ---- 必填与类型 ----
for (const field of ['audioPath', 'srtPath', 'hostVideoPath', 'title']) {
  if (typeof props[field] !== 'string') fail(`${field} 必须是字符串`);
}

if (!Array.isArray(props.subtitles) || props.subtitles.length === 0) {
  fail('subtitles 必须是非空数组');
}

const durationFields = [
  'titleCardDurationFrames',
  'talkingDurationFrames',
  'endcardDurationFrames',
  'totalDurationFrames',
];
for (const field of durationFields) {
  if (typeof props[field] !== 'number' || props[field] <= 0) {
    fail(`${field} 必须是正数`);
  }
}
if (durationFields.every((f) => typeof props[f] === 'number')) {
  const expected =
    props.titleCardDurationFrames + props.talkingDurationFrames + props.endcardDurationFrames;
  if (Math.abs(expected - props.totalDurationFrames) > 2) {
    fail(
      `totalDurationFrames (${props.totalDurationFrames}) 与 title+talking+endcard (${expected}) 不一致`
    );
  }
}

const talkingSeconds =
  typeof props.talkingDurationFrames === 'number' ? props.talkingDurationFrames / 30 : Infinity;

// ---- heroMoments（可选增强）----
if (props.heroMoments !== undefined) {
  if (!Array.isArray(props.heroMoments)) {
    fail('heroMoments 必须是数组');
  } else {
    let prevStart = -Infinity;
    props.heroMoments.forEach((moment, i) => {
      if (typeof moment.start !== 'number' || typeof moment.end !== 'number' || moment.end <= moment.start) {
        fail(`heroMoments[${i}] 的 start/end 非法`);
        return;
      }
      if (typeof moment.text !== 'string' || moment.text.trim().length === 0) {
        fail(`heroMoments[${i}] 的 text 不能为空`);
      }
      if (moment.start < prevStart) fail(`heroMoments[${i}] 未按 start 排序`);
      if (moment.start < 0 || moment.end > talkingSeconds) {
        fail(`heroMoments[${i}] (${moment.start}-${moment.end}) 超出正文时长范围`);
      }
      if (prevStart > -Infinity && moment.start - prevStart < 5) {
        warn(`heroMoments[${i}] 与前一个 hero 间距 <5s，可能过密`);
      }
      prevStart = moment.start;
    });
  }
}

// ---- sceneVisuals ----
if (props.sceneVisuals !== undefined) {
  if (!Array.isArray(props.sceneVisuals)) {
    fail('sceneVisuals 必须是数组');
  } else {
    let prevEnd = -Infinity;
    props.sceneVisuals.forEach((scene, i) => {
      if (typeof scene.start !== 'number' || typeof scene.end !== 'number' || scene.end <= scene.start) {
        fail(`sceneVisuals[${i}] 的 start/end 非法`);
        return;
      }
      if (scene.start < prevEnd - 0.001) fail(`sceneVisuals[${i}] 与前一场景时间重叠`);
      if (scene.type !== undefined && !['image', 'video'].includes(scene.type)) {
        fail(`sceneVisuals[${i}] 的 type 必须是 image 或 video，当前: ${scene.type}`);
      }
      if (typeof scene.path !== 'string' || !fileExistsUnderPublic(scene.path)) {
        fail(`sceneVisuals[${i}] 的素材文件不存在: ${scene.path}`);
      }
      prevEnd = scene.end;
    });
  }
}

// ---- BGM / SFX（可选增强）----
for (const field of ['bgmPath', 'sfxHeroPath']) {
  const value = props[field];
  if (value === undefined || value === null) continue;
  if (typeof value !== 'string') {
    fail(`${field} 必须是字符串或 null`);
    continue;
  }
  if (!fileExistsUnderPublic(value)) {
    fail(`${field} 对应的文件不存在: ${value}`);
  }
}
if (props.bgmVolume !== undefined && (typeof props.bgmVolume !== 'number' || props.bgmVolume < 0)) {
  fail('bgmVolume 必须是非负数字');
}
if (props.sfxVolume !== undefined && (typeof props.sfxVolume !== 'number' || props.sfxVolume < 0)) {
  fail('sfxVolume 必须是非负数字');
}

// ---- 字幕 DNA ----
const dna = props.contentOverlay?.subtitles?.dna;
if (dna !== undefined && !['classic', 'loud', 'keynote', 'cream', 'editorial', 'documentary'].includes(dna)) {
  fail(`contentOverlay.subtitles.dna 必须是 classic / loud / keynote / cream / editorial / documentary 之一，当前: ${dna}`);
}

// ---- 输出 ----
for (const msg of warnings) console.warn(`⚠️  ${msg}`);
if (errors.length > 0) {
  for (const msg of errors) console.error(`❌ ${msg}`);
  console.error(`\nprops 预检失败: ${errors.length} 个错误 (${propsPath})`);
  process.exit(1);
}
console.log(
  `props 预检通过: ${props.subtitles?.length ?? 0} 条字幕, ${props.heroMoments?.length ?? 0} 个 hero, ${props.sceneVisuals?.length ?? 0} 个场景${warnings.length > 0 ? `（${warnings.length} 条告警）` : ''}`
);

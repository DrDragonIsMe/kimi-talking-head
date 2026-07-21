#!/usr/bin/env node
/**
 * generate_customer_persona.js
 *
 * 为「客户说」系列随机生成一个脱敏的客户身份与对应的人物形象，并输出可用于
 * 品牌徽章、host.photo_source、host.video_source 的文案与路径。
 *
 * 用法：
 *   node scripts/generate_customer_persona.js <profile_path>
 *
 * 输出（stdout JSON）：
 *   {
 *     "label": "客户说 · 星*科技 · 林*雨",
 *     "badgeText": "客户说 · 星*科技 · 林*雨",
 *     "maskedName": "林*雨",
 *     "maskedCompany": "星*科技",
 *     "fullName": "林小雨",
 *     "company": "星瀚科技",
 *     "title": "HR总监",
 *     "industry": "零售科技",
 *     "hostName": "客户说 · 林*雨",
 *     "photoSource": "assets/host/customers/customer_3.png",
 *     "videoSource": "assets/host/customers/customer_3.mp4",
 *     "voiceSource": "assets/voice/customers/voice_2.wav"
 *   }
 *
 * 脱敏规则：保留首尾字符，中间替换为 *；长度为 2 时只保留首字。
 * 人物素材：从 profile.customer_persona.photoDir / videoDir / voiceDir 中随机挑选，
 *          目录不存在或为空时回退到 profile 原有 host.photo_source / host.video_source /
 *          voice.reference_audio。
 */

const fs = require('fs');
const path = require('path');

function mask(str) {
  if (!str || typeof str !== 'string') return str;
  if (str.length <= 1) return str;
  if (str.length === 2) return str[0] + '*';
  return str[0] + '*'.repeat(str.length - 2) + str[str.length - 1];
}

function pick(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return '';
  return arr[Math.floor(Math.random() * arr.length)];
}

function scanFiles(dir, extensions) {
  const root = path.resolve(dir);
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root)
    .filter((f) => extensions.some((ext) => f.toLowerCase().endsWith(ext)))
    .map((f) => path.join(dir, f).replace(/\\/g, '/'))
    .sort();
}

function relativeToProject(absOrRel) {
  if (path.isAbsolute(absOrRel)) {
    const projectDir = path.resolve(__dirname, '..');
    const rel = path.relative(projectDir, absOrRel);
    return rel.replace(/\\/g, '/');
  }
  return absOrRel.replace(/\\/g, '/');
}

function main() {
  const profilePath = process.argv[2];
  if (!profilePath) {
    console.error('Usage: node scripts/generate_customer_persona.js <profile_path>');
    process.exit(1);
  }

  let profile = {};
  try {
    profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
  } catch (err) {
    console.error(`Failed to read profile: ${profilePath}`, err.message);
    process.exit(1);
  }

  const cfg = profile.customer_persona;
  if (!cfg || !cfg.enabled) {
    console.log(JSON.stringify({
      label: '',
      badgeText: '',
      maskedName: '',
      maskedCompany: '',
      fullName: '',
      company: '',
      title: '',
      industry: '',
      hostName: '',
      photoSource: profile.host?.photo_source || '',
      videoSource: profile.host?.video_source || '',
      voiceSource: profile.voice?.reference_audio || ''
    }));
    return;
  }

  const projectDir = path.resolve(__dirname, '..');

  // 随机身份
  const surname = pick(cfg.surnames || ['林']);
  const givenName = pick(cfg.givenNames || ['小雨']);
  const title = pick(cfg.titles || ['HR总监']);
  const industry = pick(cfg.industries || ['零售科技']);
  const prefix = pick(cfg.companyPrefixes || ['星']);
  const suffix = pick(cfg.companySuffixes || ['科技']);

  const fullName = surname + givenName;
  const company = prefix + suffix;

  const maskedName = mask(fullName);
  const maskedCompany = mask(company);

  const format = cfg.format || '客户说 · {{company}} · {{maskedName}}';
  const label = format
    .replace(/\{\{company\}\}/g, maskedCompany)
    .replace(/\{\{maskedName\}\}/g, maskedName)
    .replace(/\{\{title\}\}/g, title)
    .replace(/\{\{industry\}\}/g, industry);

  // 随机人物形象（图片 / 视频 / 声音）
  const photoDir = cfg.photoDir || 'assets/host/customers';
  const videoDir = cfg.videoDir || 'assets/host/customers';
  const voiceDir = cfg.voiceDir || 'assets/voice/customers';

  const photoFiles = scanFiles(path.resolve(projectDir, photoDir), ['.png', '.jpg', '.jpeg', '.webp']);
  const videoFiles = scanFiles(path.resolve(projectDir, videoDir), ['.mp4', '.mov', '.webm']);
  const voiceFiles = scanFiles(path.resolve(projectDir, voiceDir), ['.wav', '.m4a', '.mp3']);

  const photoSource = photoFiles.length > 0
    ? relativeToProject(pick(photoFiles))
    : (profile.host?.photo_source || '');
  const videoSource = videoFiles.length > 0
    ? relativeToProject(pick(videoFiles))
    : (profile.host?.video_source || '');
  const voiceSource = voiceFiles.length > 0
    ? relativeToProject(pick(voiceFiles))
    : (profile.voice?.reference_audio || '');

  console.log(JSON.stringify({
    label,
    badgeText: label,
    maskedName,
    maskedCompany,
    fullName,
    company,
    title,
    industry,
    hostName: `客户说 · ${maskedName}`,
    photoSource,
    videoSource,
    voiceSource
  }));
}

main();

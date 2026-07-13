#!/usr/bin/env node

/**
 * Extract product launch assets from an article:
 * - slogan: one-sentence positioning
 * - cta: call-to-action phrase
 * - features: 3-5 selling points
 *
 * Priority: Kimi Code API -> fallback local rules.
 */

const fs = require('fs');
const path = require('path');
const { isConfigured, generateJson } = require('./kimi_client');

const inputPath = process.argv[2];
const profilePath = process.argv[3];

if (!inputPath) {
  console.error('Usage: node extract_product_features.js <article-file> [profile-file]');
  process.exit(1);
}

function stripMarkdown(md) {
  return md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*[-=*]{3,}\s*$/gm, ' ')
    .replace(/(\*\*\*|___)([^\1]*?)\1/g, '$2')
    .replace(/(\*\*|__)([^\1]*?)\1/g, '$2')
    .replace(/(\*|_)([^\1]*?)\1/g, '$2')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '');
}

function normalizeWhitespace(text) {
  return text.replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim();
}

function cleanText(raw) {
  const ext = path.extname(inputPath).toLowerCase();
  if (ext === '.md' || ext === '.markdown') {
    return normalizeWhitespace(stripMarkdown(raw));
  }
  return normalizeWhitespace(raw);
}

function loadProfile() {
  if (!profilePath || !fs.existsSync(profilePath)) return {};
  try {
    return JSON.parse(fs.readFileSync(profilePath, 'utf8'));
  } catch (_e) {
    return {};
  }
}

function extractTitle(raw) {
  const match = raw.match(/^#\s*(.+)$/m);
  return match ? match[1].trim() : '';
}

function fallbackExtract(text, profile) {
  const productBrand = profile.product?.brand || '薪灵AI';
  const productTagline = profile.product?.tagline || '';

  // Slogan: prefer first sentence, or tagline, or brand + generic
  const firstSentenceMatch = text.match(/^([^。！？!?]{10,60})[。！？!?]/);
  const slogan = firstSentenceMatch
    ? firstSentenceMatch[1].trim()
    : productTagline || `${productBrand}，让业务更高效`;

  // CTA: look for action words near the end
  const ctaKeywords = /立即|扫码|体验|试用|点击|下载|预约|注册|了解|查看|使用|开启|申请|获取/;
  const sentences = text.split(/[。！？!?]/).map((s) => s.trim()).filter(Boolean);
  let cta = '';
  for (let i = sentences.length - 1; i >= Math.max(0, sentences.length - 5); i--) {
    if (ctaKeywords.test(sentences[i]) && sentences[i].length >= 8 && sentences[i].length <= 40) {
      cta = sentences[i];
      break;
    }
  }
  if (!cta) {
    cta = `立即体验 ${productBrand}`;
  }

  // Features: extract list-like items or numeric claims
  const features = [];
  const seen = new Set();

  // Markdown list items in raw
  const raw = fs.readFileSync(inputPath, 'utf8');
  const listPattern = /^\s*[-*+]\s+(.{4,30})$/gm;
  let match;
  while ((match = listPattern.exec(raw)) !== null) {
    const item = match[1].trim().replace(/[。！？!?;；]/g, '');
    if (!seen.has(item)) {
      seen.add(item);
      features.push(item);
    }
  }

  // Numbered claims
  const claimPattern = /([^。！？!?]{4,22})(?:可以|能够|支持|实现|提供|帮助|让|为)/g;
  while ((match = claimPattern.exec(text)) !== null) {
    const item = match[1].trim();
    if (!seen.has(item) && item.length >= 6) {
      seen.add(item);
      features.push(item);
    }
  }

  return {
    slogan,
    cta,
    features: features.slice(0, 5),
  };
}

async function generateWithAi(content, profile) {
  const product = profile.product || {};
  const brand = product.brand || '薪灵AI';

  const prompt = `请从以下产品文案中提取产品发布视频需要的信息。
品牌：${brand}
要求：
1. slogan：一句话定位，15-30 字，突出核心价值。
2. cta：行动号召文案，8-20 字，如"立即体验 ${brand}"。
3. features：3-5 个核心卖点，每个 4-12 字，简洁有力。
4. 输出 JSON 格式：{"slogan": "...", "cta": "...", "features": ["...", "..."]}

文案：
${content.slice(0, 8000)}`;

  const result = await generateJson(
    [
      { role: 'system', content: 'You are a senior Chinese product marketing copywriter. Output valid JSON only.' },
      { role: 'user', content: prompt },
    ],
    2000
  );

  const slogan = typeof result.slogan === 'string' ? result.slogan.trim() : '';
  const cta = typeof result.cta === 'string' ? result.cta.trim() : '';
  const features = Array.isArray(result.features) ? result.features.map((f) => String(f).trim()).filter(Boolean) : [];

  if (!slogan || features.length === 0) {
    throw new Error('AI response missing required fields');
  }

  return { slogan, cta, features };
}

async function main() {
  const raw = fs.readFileSync(inputPath, 'utf8');
  const text = cleanText(raw);
  const profile = loadProfile();

  let result;
  let source = 'fallback';

  if (isConfigured()) {
    try {
      result = await generateWithAi(text, profile);
      source = 'kimi-code';
      console.log('🤖 使用 Kimi Code API 提取产品卖点');
    } catch (err) {
      console.warn(`⚠️ Kimi Code API 失败，回退到本地规则: ${err.message}`);
      result = fallbackExtract(text, profile);
    }
  } else {
    result = fallbackExtract(text, profile);
  }

  // Ensure minimum fields
  if (!result.slogan) {
    result.slogan = profile.product?.slogan || '把数据，变成决策';
  }
  if (!result.cta) {
    result.cta = profile.product?.cta || `立即体验 ${profile.product?.brand || '薪灵AI'}`;
  }
  if (result.features.length === 0) {
    result.features = profile.product?.pills?.slice(0, 5) || ['核心功能一', '核心功能二', '核心功能三'];
  }

  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error('提取产品卖点失败:', err.message);
  process.exit(1);
});

#!/usr/bin/env node

/**
 * Generate a spoken video script from an article.
 * Priority: Kimi Code API -> fallback to Markdown stripping.
 */

const fs = require('fs');
const path = require('path');
const { isConfigured, generateJson } = require('./kimi_client');

const inputPath = process.argv[2];
const outputPath = process.argv[3];
const template = process.argv[4] || 'editorial';
const fallbackMode = process.argv.includes('--fallback-only');

if (!inputPath || !outputPath) {
  console.error('Usage: node generate_script.js <input-file> <output-file> [template]');
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

function fallbackScript(content) {
  const ext = path.extname(inputPath).toLowerCase();
  let scriptText;
  if (ext === '.md' || ext === '.markdown') {
    scriptText = normalizeWhitespace(stripMarkdown(content));
  } else {
    scriptText = normalizeWhitespace(content);
  }
  return scriptText;
}

function buildPrompt(content, templateType) {
  const base = `请将以下文章改写成一段适合中文短视频口播的脚本。
要求：
1. 用第一人称"我"的口吻，自然、口语化、有节奏感，适合朗读。
2. 保留核心观点、关键数据和结论，去除过于书面化的表达。
3. 适当加入过渡词和口语化连接，如"各位好"、"简单来说"、"一句话总结"、"也就是说"。
4. 总字数控制在 800-1500 字之间（约 2-4 分钟口播）。
5. 不要分点列出，要连贯成篇。
6. 输出 JSON 格式：{"script": "..."}

文章：
${content.slice(0, 12000)}`;

  if (templateType === 'product-launch') {
    return `请将以下产品文案改写成一段适合中文短视频口播的产品发布脚本。
要求：
1. 用第一人称"我"的口吻，热情、有说服力，像产品发布会一样。
2. 结构必须包含：
   - 开场：点出用户痛点（1-2 句）
   - 转折：引出产品/方案（1-2 句）
   - 核心卖点：自然带出 3-5 个功能亮点，不要念列表，要融入叙述
   - 收尾：一句话总结价值 + 明确的行动号召
3. 适当加入过渡词，如"各位好"、"你有没有遇到过"、"所以我们做了"、"更重要的是"、"现在就可以"。
4. 总字数控制在 800-1500 字之间（约 2-4 分钟口播）。
5. 不要分点列出，要连贯成篇。
6. 输出 JSON 格式：{"script": "..."}

文案：
${content.slice(0, 12000)}`;
  }

  return base;
}

async function generateWithAi(content) {
  const prompt = buildPrompt(content, template);

  const result = await generateJson(
    [
      { role: 'system', content: 'You are a senior Chinese video scriptwriter. Output valid JSON only.' },
      { role: 'user', content: prompt },
    ],
    8000
  );

  if (!result.script || typeof result.script !== 'string') {
    throw new Error('AI response missing "script" field');
  }

  return result.script.trim();
}

async function main() {
  const content = fs.readFileSync(inputPath, 'utf-8');
  let scriptText;
  let source = 'fallback';

  if (!fallbackMode && isConfigured()) {
    try {
      scriptText = await generateWithAi(content);
      source = 'kimi-code';
      console.log(`🤖 使用 Kimi Code API 生成口播稿 (template=${template})`);
    } catch (err) {
      console.warn(`⚠️ Kimi Code API 失败，回退到本地处理: ${err.message}`);
      scriptText = fallbackScript(content);
    }
  } else {
    if (fallbackMode) {
      console.log('🛠️  强制使用本地 fallback 生成口播稿');
    } else {
      console.log('🛠️  Kimi Code API 未配置，使用本地处理生成口播稿');
    }
    scriptText = fallbackScript(content);
  }

  fs.writeFileSync(outputPath, scriptText, 'utf-8');
  console.log(`口播稿已生成 (${source}): ${outputPath} (${scriptText.length} 字符)`);
}

main().catch((err) => {
  console.error('生成口播稿失败:', err.message);
  process.exit(1);
});

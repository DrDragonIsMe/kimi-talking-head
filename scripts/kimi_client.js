#!/usr/bin/env node

/**
 * Kimi Code API client (OpenAI-compatible).
 * Loads config from environment variables (or .env file via dotenv if available).
 *
 * Required env:
 *   KIMI_CODE_BASE_URL  - e.g. https://api.kimi.com/coding/v1
 *   KIMI_CODE_API_KEY   - your API key
 *   KIMI_CODE_MODEL     - e.g. kimi-for-coding
 */

const https = require('https');
const { URL } = require('url');

// Try to load .env if dotenv is installed
let envLoaded = false;
try {
  require('dotenv').config();
  envLoaded = true;
} catch (_e) {
  // dotenv not installed, rely on process.env
}

const BASE_URL = process.env.KIMI_CODE_BASE_URL || '';
const API_KEY = process.env.KIMI_CODE_API_KEY || '';
const MODEL = process.env.KIMI_CODE_MODEL || 'kimi-for-coding';

function isConfigured() {
  return !!(BASE_URL && API_KEY);
}

function callKimiCode(messages, options = {}) {
  return new Promise((resolve, reject) => {
    if (!isConfigured()) {
      return reject(new Error('Kimi Code API not configured. Set KIMI_CODE_BASE_URL and KIMI_CODE_API_KEY.'));
    }

    const maxTokens = options.maxTokens || 4000;
    const responseFormat = options.jsonMode ? { type: 'json_object' } : undefined;

    const payload = JSON.stringify({
      model: MODEL,
      messages,
      max_tokens: maxTokens,
      ...(options.temperature !== undefined ? { temperature: options.temperature } : { temperature: 1 }),
      ...(responseFormat ? { response_format: responseFormat } : {}),
    });

    const url = new URL(`${BASE_URL.replace(/\/$/, '')}/chat/completions`);
    const reqOptions = {
      hostname: url.hostname,
      path: url.pathname,
      port: url.port || 443,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
        'Content-Length': Buffer.byteLength(payload),
      },
      timeout: options.timeout || 120000,
    };

    const req = https.request(reqOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) {
            return reject(new Error(`Kimi Code API error: ${parsed.error.message || JSON.stringify(parsed.error)}`));
          }
          const choice = parsed.choices && parsed.choices[0];
          const content = choice?.message?.content?.trim() || '';
          const reasoning = choice?.message?.reasoning_content?.trim() || '';
          resolve({ content, reasoning, usage: parsed.usage });
        } catch (err) {
          reject(new Error(`Failed to parse Kimi Code response: ${err.message}\nRaw: ${data.slice(0, 500)}`));
        }
      });
    });

    req.on('error', (err) => reject(new Error(`Kimi Code request failed: ${err.message}`)));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Kimi Code request timed out'));
    });

    req.write(payload);
    req.end();
  });
}

function extractJson(text) {
  // 1. Direct parse if the whole text is JSON
  const trimmed = text.trim();
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try {
      return JSON.parse(trimmed);
    } catch (_e) {
      // fall through
    }
  }

  // 2. Extract from markdown JSON block
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1].trim());
    } catch (_e) {
      // fall through
    }
  }

  // 3. Find first JSON object/array by brace balancing
  const startIdx = text.search(/[\{\[]/);
  if (startIdx === -1) {
    throw new Error('No JSON object or array found in response');
  }

  const openChar = text[startIdx];
  const closeChar = openChar === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = startIdx; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === '\\') {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === openChar) {
      depth++;
    } else if (ch === closeChar) {
      depth--;
      if (depth === 0) {
        const candidate = text.slice(startIdx, i + 1);
        try {
          return JSON.parse(candidate);
        } catch (_e) {
          break;
        }
      }
    }
  }

  throw new Error('Failed to parse JSON from response text');
}

async function generateJson(messages, maxTokens = 4000, temperature) {
  const options = { jsonMode: true, maxTokens };
  if (temperature !== undefined) options.temperature = temperature;
  const res = await callKimiCode(messages, options);
  const text = res.content || res.reasoning;
  if (!text) {
    throw new Error('Kimi Code returned empty content and reasoning');
  }

  try {
    return extractJson(text);
  } catch (err) {
    throw new Error(`Failed to parse JSON from Kimi Code response: ${err.message}\nText: ${text.slice(0, 800)}`);
  }
}

module.exports = {
  isConfigured,
  callKimiCode,
  generateJson,
  BASE_URL,
  API_KEY,
  MODEL,
};

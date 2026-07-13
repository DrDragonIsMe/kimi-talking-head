#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const inputPath = process.argv[2] || path.join(process.cwd(), 'public', 'subtitles.json');

if (!fs.existsSync(inputPath)) {
  console.error(`Subtitles file not found: ${inputPath}`);
  process.exit(1);
}

const cues = JSON.parse(fs.readFileSync(inputPath, 'utf8'));

if (!Array.isArray(cues)) {
  console.error('字幕必须是数组');
  process.exit(1);
}

if (cues.length < 3) {
  console.error(`字幕 cue 数量不足: ${cues.length}`);
  process.exit(1);
}

for (let i = 0; i < cues.length; i++) {
  const cue = cues[i];
  if (typeof cue.start !== 'number' || typeof cue.end !== 'number') {
    console.error(`字幕 cue ${i} 的 start/end 必须是数字`);
    process.exit(1);
  }
  if (cue.end <= cue.start) {
    console.error(`字幕 cue ${i} 的 end 必须大于 start`);
    process.exit(1);
  }
  if (typeof cue.text !== 'string' || cue.text.trim().length === 0) {
    console.error(`字幕 cue ${i} 的 text 不能为空`);
    process.exit(1);
  }
}

console.log(`字幕校验通过: ${cues.length} 条 cue`);

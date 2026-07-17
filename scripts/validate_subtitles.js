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

  // 词级时间戳是可选增强：存在时必须结构正确、时间单调且在 cue 范围内
  if (cue.words !== undefined) {
    if (!Array.isArray(cue.words) || cue.words.length === 0) {
      console.error(`字幕 cue ${i} 的 words 必须是非空数组`);
      process.exit(1);
    }
    let prevStart = -Infinity;
    for (let j = 0; j < cue.words.length; j++) {
      const word = cue.words[j];
      if (typeof word.text !== 'string' || word.text.length === 0) {
        console.error(`字幕 cue ${i} 的第 ${j} 个词 text 不能为空`);
        process.exit(1);
      }
      if (typeof word.start !== 'number' || typeof word.end !== 'number' || word.end < word.start) {
        console.error(`字幕 cue ${i} 的第 ${j} 个词 start/end 非法`);
        process.exit(1);
      }
      if (word.start < prevStart) {
        console.error(`字幕 cue ${i} 的词级时间戳必须单调递增（第 ${j} 个词回退）`);
        process.exit(1);
      }
      if (word.start < cue.start - 0.5 || word.end > cue.end + 0.5) {
        console.error(`字幕 cue ${i} 的第 ${j} 个词超出 cue 时间范围`);
        process.exit(1);
      }
      prevStart = word.start;
    }
  }
}

console.log(`字幕校验通过: ${cues.length} 条 cue`);

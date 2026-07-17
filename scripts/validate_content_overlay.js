#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const profilePath = process.argv[2] || path.join(process.cwd(), 'config', 'host_profile.json');

if (!fs.existsSync(profilePath)) {
  console.error(`Profile not found: ${profilePath}`);
  process.exit(1);
}

const profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
const overlay = profile.content_overlay || {};

const defaultLayout = {
  sequence: ['editorial-left', 'editorial-right', 'editorial-balanced'],
  holdCues: 3,
};

const validPresets = new Set(defaultLayout.sequence);

function validate() {
  const errors = [];

  if (overlay.layout) {
    if (!Array.isArray(overlay.layout.sequence) || overlay.layout.sequence.length === 0) {
      errors.push('content_overlay.layout.sequence 必须是数组');
    } else {
      for (const preset of overlay.layout.sequence) {
        if (!validPresets.has(preset)) {
          errors.push(`content_overlay.layout.sequence 包含无效预设: ${preset}`);
        }
      }
    }
    if (typeof overlay.layout.holdCues !== 'number' || overlay.layout.holdCues < 1) {
      errors.push('content_overlay.layout.holdCues 必须是正整数');
    }
  }

  if (overlay.subtitles) {
    const s = overlay.subtitles;
    if (typeof s.maxLines !== 'number') errors.push('subtitles.maxLines 必须是数字');
    if (typeof s.maxCharsPerLine !== 'number') errors.push('subtitles.maxCharsPerLine 必须是数字');
    if (s.dna !== undefined && !['classic', 'loud', 'keynote'].includes(s.dna)) {
      errors.push('subtitles.dna 必须是 classic / loud / keynote 之一');
    }
    if (s.segmentation) {
      const seg = s.segmentation;
      if (typeof seg.maxSegmentSeconds !== 'number') errors.push('subtitles.segmentation.maxSegmentSeconds 必须是数字');
      if (typeof seg.minSegmentSeconds !== 'number') errors.push('subtitles.segmentation.minSegmentSeconds 必须是数字');
      if (typeof seg.maxVisualLength !== 'number') errors.push('subtitles.segmentation.maxVisualLength 必须是数字');
    }
  }

  if (overlay.talkingPoints) {
    const tp = overlay.talkingPoints;
    if (typeof tp.enabled !== 'boolean') errors.push('talkingPoints.enabled 必须是布尔值');
    if (typeof tp.maxItems !== 'number') errors.push('talkingPoints.maxItems 必须是数字');
  }

  if (overlay.dataBars) {
    const db = overlay.dataBars;
    if (typeof db.enabled !== 'boolean') errors.push('dataBars.enabled 必须是布尔值');
    if (typeof db.maxItems !== 'number') errors.push('dataBars.maxItems 必须是数字');
  }

  if (overlay.quoteHighlight) {
    const qh = overlay.quoteHighlight;
    if (typeof qh.enabled !== 'boolean') errors.push('quoteHighlight.enabled 必须是布尔值');
  }

  return errors;
}

const errors = validate();
if (errors.length > 0) {
  console.error('content_overlay 校验失败:');
  for (const err of errors) {
    console.error(`  - ${err}`);
  }
  process.exit(1);
}

console.log('content_overlay 校验通过');

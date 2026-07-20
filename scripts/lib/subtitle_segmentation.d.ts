/**
 * subtitle_segmentation.d.ts — scripts/lib/subtitle_segmentation.js 的类型声明。
 * 供 src/ 下的 TS 文件 import；实现以 .js 文件为唯一数据源。
 */

export interface SubtitleSegmentationConfig {
  maxSegmentSeconds: number;
  minSegmentSeconds: number;
  maxVisualLength: number;
}

export interface SegmentationCue {
  start: number;
  end: number;
  text: string;
}

export function normalizeSubtitleText(text: string): string;
export function isMeaningfulUnit(text: string): boolean;
export function getCharVisualWidth(char: string): number;
export function getVisualLength(text: string): number;
export function splitByDelimiters(text: string, delimiters: RegExp): string[];
export function findSplitIndex(text: string, maxWidth: number): number;
export function splitLongUnit(text: string, maxWidth: number): string[];
export function tokenizeCueText(text: string, config: SubtitleSegmentationConfig): string[];
export function groupUnits(units: string[], desiredCount: number): string[][];
export function segmentCue(cue: SegmentationCue, config: SubtitleSegmentationConfig): SegmentationCue[];
export function trimLineForDisplay(text: string): string;
export function clampLineByWidth(text: string, maxWidth: number): string;
export function forceWrapLines(text: string, maxLines: number, maxWidth: number): string[];

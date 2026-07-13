import React, { useMemo } from 'react';
import { useCurrentFrame, useVideoConfig } from 'remotion';
import type { ThemeConfig } from '../themes';
import type { SubtitleCue } from '../hooks/useSubtitles';

interface DynamicTypingSubtitlesProps {
  subtitles: SubtitleCue[];
  theme: ThemeConfig;
  maxLines?: number;
  charsPerLine?: number;
  bottomOffset?: number;
}

function splitIntoLines(text: string, charsPerLine: number, maxLines: number): string[] {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (!cleaned) return [];

  const result: string[] = [];
  let current = '';

  for (const char of cleaned) {
    if (current.length >= charsPerLine && /[，。！？、；]/.test(char)) {
      current += char;
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  if (current.trim()) {
    result.push(current.trim());
  }

  if (result.length === 0) {
    result.push(cleaned);
  }

  return result.slice(0, maxLines);
}

export const DynamicTypingSubtitles: React.FC<DynamicTypingSubtitlesProps> = ({
  subtitles,
  theme,
  maxLines = 2,
  charsPerLine = 14,
  bottomOffset = 120,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const currentTime = frame / fps;

  const activeCue = useMemo(() => {
    return subtitles.find((cue) => currentTime >= cue.start && currentTime <= cue.end) ?? null;
  }, [subtitles, currentTime]);

  if (!activeCue) return null;

  const lines = splitIntoLines(activeCue.text, charsPerLine, maxLines);
  const fullText = lines.join('');
  const cueStartFrame = activeCue.start * fps;
  const cueDurationFrames = (activeCue.end - activeCue.start) * fps;
  const progress = Math.min(1, Math.max(0, (frame - cueStartFrame) / cueDurationFrames));
  const visibleCharCount = Math.floor(fullText.length * progress);

  return (
    <div
      style={{
        position: 'absolute',
        left: 80,
        right: 80,
        bottom: bottomOffset,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 12,
        pointerEvents: 'none',
        textAlign: 'center',
      }}
    >
      {lines.map((line, lineIndex) => {
        const lineStart = lines.slice(0, lineIndex).join('').length;
        return (
          <div
            key={lineIndex}
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              justifyContent: 'center',
              fontFamily: theme.typography.fontFamily,
              fontSize: 52,
              fontWeight: 700,
              lineHeight: 1.35,
            }}
          >
            {Array.from(line).map((char, charIndex) => {
              const globalIndex = lineStart + charIndex;
              const isVisible = globalIndex < visibleCharCount;
              const isCurrent = globalIndex === visibleCharCount;
              return (
                <span
                  key={`${lineIndex}-${charIndex}`}
                  style={{
                    color: isCurrent || isVisible ? theme.colors.primary : theme.colors.textMuted,
                    opacity: isVisible || isCurrent ? 1 : 0.35,
                    transition: 'none',
                    textShadow: isCurrent ? `0 0 18px ${theme.colors.glow}` : 'none',
                  }}
                >
                  {char}
                </span>
              );
            })}
          </div>
        );
      })}
    </div>
  );
};

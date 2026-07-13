import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, Easing } from 'remotion';
import { useSubtitles, SubtitleCue } from '../hooks/useSubtitles';
import { matchSceneStyle, findQuoteTriggerCue } from '../utils/keywordMatcher';
import { getActiveCueIndex, getOverlayLayoutPreset, OverlayLayoutConfig } from '../utils/overlayLayout';
import type { ContentOverlayConfig, QuoteHighlightData } from '../index';

const CREAM = '#FAFAF7';
const INK = '#151A19';

interface QuoteHighlightProps {
  srtPath: string;
  subtitles?: SubtitleCue[];
  data: QuoteHighlightData | null;
  config: ContentOverlayConfig['quoteHighlight'];
  layout?: OverlayLayoutConfig;
}

export const QuoteHighlight: React.FC<QuoteHighlightProps> = ({ srtPath, subtitles, data, config, layout }) => {
  const { fps } = useVideoConfig();
  const frame = useCurrentFrame();
  const currentTime = frame / fps;
  const loadedSubtitles = subtitles || useSubtitles(srtPath);

  const currentCue = loadedSubtitles.find(
    cue => currentTime >= cue.start && currentTime <= cue.end
  );
  const currentCueIndex = getActiveCueIndex(loadedSubtitles, currentTime);
  const overlayLayout = getOverlayLayoutPreset(currentCueIndex, layout);

  if (!config.enabled) return null;

  const quote = data?.quote || config.fallbackQuote;
  const author = data?.author || config.fallbackAuthor;

  if (!quote || quote.length < 4) return null;

  // 引用高亮只在首次命中其关键字的字幕 cue 中出现一次
  const triggerCue = findQuoteTriggerCue(loadedSubtitles, quote, author);
  if (!triggerCue || !currentCue || triggerCue.start !== currentCue.start || triggerCue.end !== currentCue.end) {
    return null;
  }

  const style = matchSceneStyle(currentCue.text);
  const accentColor = style ? style.accentColor : '#00b498';

  const cueProgress = (currentTime - currentCue.start) / Math.max(0.001, currentCue.end - currentCue.start);

  const opacity = interpolate(cueProgress * 100, [0, 14], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });
  const y = interpolate(cueProgress * 100, [0, 14], [20, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });

  const width = overlayLayout.quoteHighlight.width;
  const isNarrow = width <= 320;

  return (
    <AbsoluteFill
      style={{
        justifyContent: 'flex-start',
        alignItems: 'flex-start',
        paddingLeft: overlayLayout.quoteHighlight.left,
        paddingTop: overlayLayout.quoteHighlight.top,
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          width,
          opacity,
          transform: `translateY(${y}px)`,
          padding: '22px 22px 24px',
          borderRadius: 28,
          background: 'rgba(250,250,247,0.78)',
          border: '1px solid rgba(21,26,25,0.08)',
          boxShadow: '0 18px 40px rgba(21,26,25,0.08)',
          backdropFilter: 'blur(12px)',
        }}
      >
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 10,
            padding: '8px 12px',
            borderRadius: 999,
            background: `${accentColor}12`,
            border: `1px solid ${accentColor}28`,
            color: accentColor,
            fontSize: 16,
            fontWeight: 800,
            letterSpacing: 1,
          }}
        >
          {config.label}
        </div>

        <div
          style={{
            marginTop: 16,
            color: INK,
            fontSize: isNarrow ? 26 : 28,
            fontWeight: 900,
            lineHeight: 1.26,
            letterSpacing: 0.3,
          }}
        >
          <span
            style={{
              color: accentColor,
              fontSize: isNarrow ? 34 : 38,
              lineHeight: 1,
              marginRight: 6,
              fontFamily: 'Georgia, serif',
            }}
          >
            "
          </span>
          {quote}
        </div>

        <div
          style={{
            marginTop: 14,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <div
            style={{
              width: 80,
              height: 5,
              borderRadius: 999,
              background: accentColor,
            }}
          />
          <div style={{ flex: 1, height: 1, background: '#E3E9E7' }} />
        </div>

        {author ? (
          <div
            style={{
              marginTop: 10,
              color: 'rgba(21,26,25,0.62)',
              fontSize: 16,
              fontWeight: 700,
              letterSpacing: 0.5,
            }}
          >
            {author}
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};

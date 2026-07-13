import React from 'react';
import { useCurrentFrame, useVideoConfig, interpolate, Easing } from 'remotion';
import { SubtitleCue } from '../hooks/useSubtitles';
import { matchSceneStyle, extractInsightStatements } from '../utils/keywordMatcher';

interface HybridInsightCardProps {
  subtitles: SubtitleCue[];
  enabled?: boolean;
  maxItems?: number;
  mainLabel?: string;
  position?: 'bottom-left' | 'bottom-right' | 'bottom-center';
}

const FONT_FAMILY = '"Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif';

export const HybridInsightCard: React.FC<HybridInsightCardProps> = ({
  subtitles,
  enabled = true,
  maxItems = 1,
  mainLabel = '观点洞察',
  position = 'bottom-left',
}) => {
  const { fps } = useVideoConfig();
  const frame = useCurrentFrame();
  const currentTime = frame / fps;

  const currentCue = subtitles.find(
    (cue) => currentTime >= cue.start && currentTime <= cue.end
  );

  if (!enabled || !currentCue) return null;

  const style = matchSceneStyle(currentCue.text);
  const points = extractInsightStatements(currentCue.text, style, maxItems);

  if (points.length === 0) return null;

  const cueProgress = (currentTime - currentCue.start) / (currentCue.end - currentCue.start);
  const fadeProgress = cueProgress * 100;

  const opacity = interpolate(fadeProgress, [0, 18, 82, 100], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });

  const translateY = interpolate(fadeProgress, [0, 18], [28, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });

  const justifyContent = position.includes('right')
    ? 'flex-end'
    : position === 'bottom-center'
    ? 'center'
    : 'flex-start';
  const alignItems = 'flex-end';
  const paddingHorizontal = position === 'bottom-center' ? 0 : 40;
  const paddingBottom = -40;
  const textAlign = position === 'bottom-center' ? 'center' : 'left';

  return (
    <div
      style={{
        position: 'absolute',
        left: paddingHorizontal,
        right: paddingHorizontal,
        bottom: paddingBottom,
        display: 'flex',
        justifyContent,
        alignItems,
        pointerEvents: 'none',
        opacity,
        transform: `translateY(${translateY}px)`,
      }}
    >
      <div
        style={{
          maxWidth: 740,
          padding: '22px 26px 24px',
          borderRadius: 24,
          background: 'rgba(10,10,18,0.58)',
          border: `1.5px solid ${style.accentColor}35`,
          backdropFilter: 'blur(18px) saturate(140%)',
          WebkitBackdropFilter: 'blur(18px) saturate(140%)',
          boxShadow: `0 18px 44px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.08)`,
        }}
      >
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 12px',
            borderRadius: 999,
            background: `${style.accentColor}18`,
            border: `1px solid ${style.accentColor}35`,
            marginBottom: 14,
          }}
        >
          <div
            style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: style.accentColor,
              boxShadow: `0 0 8px ${style.accentColor}`,
            }}
          />
          <span
            style={{
              fontFamily: FONT_FAMILY,
              color: style.accentColor,
              fontSize: 15,
              fontWeight: 800,
              letterSpacing: 1.1,
            }}
          >
            {mainLabel}
          </span>
        </div>

        <div
          style={{
            fontFamily: FONT_FAMILY,
            color: '#fff',
            fontSize: 34,
            fontWeight: 800,
            lineHeight: 1.32,
            letterSpacing: 0.3,
            textAlign,
            textShadow: '0 2px 14px rgba(0,0,0,0.35)',
          }}
        >
          {points[0]}
        </div>

        <div
          style={{
            marginTop: 18,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <div
            style={{
              height: 3,
              width: 80,
              borderRadius: 999,
              background: style.accentColor,
              boxShadow: `0 0 10px ${style.accentColor}`,
            }}
          />
          <div
            style={{
              flex: 1,
              height: 1,
              background: 'rgba(255,255,255,0.12)',
            }}
          />
        </div>
      </div>
    </div>
  );
};

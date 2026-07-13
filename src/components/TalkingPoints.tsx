import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, Easing } from 'remotion';
import { useSubtitles, SubtitleCue } from '../hooks/useSubtitles';
import { matchSceneStyle, extractInsightStatements } from '../utils/keywordMatcher';
import { getActiveCueIndex, getOverlayLayoutPreset, OverlayLayoutConfig } from '../utils/overlayLayout';
import type { ContentOverlayConfig } from '../index';

const CREAM = '#FAFAF7';
const TILE_STRONG = '#E3E9E7';
const INK = '#151A19';

interface TalkingPointsProps {
  srtPath: string;
  subtitles?: SubtitleCue[];
  config: ContentOverlayConfig['talkingPoints'];
  layout?: OverlayLayoutConfig;
}

export const TalkingPoints: React.FC<TalkingPointsProps> = ({ srtPath, subtitles, config, layout }) => {
  const { fps } = useVideoConfig();
  const frame = useCurrentFrame();
  const currentTime = frame / fps;
  const loadedSubtitles = subtitles || useSubtitles(srtPath);

  const currentCue = loadedSubtitles.find(
    cue => currentTime >= cue.start && currentTime <= cue.end
  );
  const currentCueIndex = getActiveCueIndex(loadedSubtitles, currentTime);
  const overlayLayout = getOverlayLayoutPreset(currentCueIndex, layout);

  if (!currentCue) return null;
  if (!config.enabled) return null;

  const style = matchSceneStyle(currentCue.text);
  const points = extractInsightStatements(currentCue.text, style, config.maxItems);

  if (points.length === 0) return null;

  const cueProgress = (currentTime - currentCue.start) / (currentCue.end - currentCue.start);
  const leadPoint = points[0];
  const secondaryPoints = points.slice(1, config.maxItems);
  const leadOpacity = interpolate(cueProgress * 100, [0, 15], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });
  const leadY = interpolate(cueProgress * 100, [0, 15], [24, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });

  return (
    <AbsoluteFill
      style={{
        justifyContent: 'flex-start',
        alignItems: 'flex-start',
        paddingLeft: overlayLayout.talkingPoints.left,
        paddingTop: overlayLayout.talkingPoints.top,
        pointerEvents: 'none',
      }}
    >
      <div style={{ width: overlayLayout.talkingPoints.width, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div
          style={{
            opacity: leadOpacity,
            transform: `translateY(${leadY}px)`,
            padding: '20px 22px 22px',
            borderRadius: 28,
            background: CREAM,
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
              background: `${style.accentColor}12`,
              border: `1px solid ${style.accentColor}30`,
              color: style.accentColor,
              fontSize: 16,
              fontWeight: 800,
              letterSpacing: 1.2,
            }}
          >
            {config.mainLabel}
          </div>
          <div
            style={{
              marginTop: 16,
              color: INK,
              fontSize: overlayLayout.talkingPoints.width <= 368 ? 32 : 36,
              fontWeight: 900,
              lineHeight: 1.22,
              letterSpacing: 0.5,
            }}
          >
            {leadPoint}
          </div>
          <div
            style={{
              marginTop: 14,
              display: 'flex',
              gap: 10,
              alignItems: 'center',
            }}
          >
            <div
              style={{
                width: 140,
                height: 5,
                borderRadius: 999,
                background: style.accentColor,
              }}
            />
            <div
              style={{
                flex: 1,
                height: 1,
                background: TILE_STRONG,
              }}
            />
          </div>
        </div>

        {secondaryPoints.length > 0 ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            {secondaryPoints.map((point, index) => {
              const delay = 10 + index * 8;
              const progress = interpolate(
                cueProgress * 100,
                [delay, delay + 16],
                [0, 1],
                { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) }
              );
              const y = interpolate(
                cueProgress * 100,
                [delay, delay + 16],
                [16, 0],
                { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) }
              );

              return (
                <div
                  key={`${index}-${point}`}
                  style={{
                    opacity: progress,
                    transform: `translateY(${y}px)`,
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 16,
                    padding: '18px 20px',
                    borderRadius: 24,
                    background: CREAM,
                    border: '1px solid rgba(21,26,25,0.08)',
                    boxShadow: '0 10px 24px rgba(21,26,25,0.06)',
                    backdropFilter: 'blur(12px)',
                  }}
                >
                  <div
                    style={{
                      width: 42,
                      height: 42,
                      borderRadius: 12,
                      background: `${style.accentColor}16`,
                      color: style.accentColor,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 18,
                      fontWeight: 900,
                      flexShrink: 0,
                    }}
                  >
                    {String(index + 2).padStart(2, '0')}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div
                      style={{
                        color: 'rgba(21,26,25,0.46)',
                        fontSize: 14,
                        fontWeight: 800,
                        letterSpacing: 1.2,
                      }}
                    >
                      {config.secondaryLabel}
                    </div>
                    <div
                      style={{
                        marginTop: 6,
                        color: INK,
                        fontSize: overlayLayout.talkingPoints.width <= 368 ? 24 : 26,
                        fontWeight: 800,
                        lineHeight: 1.24,
                      }}
                    >
                      {point}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};

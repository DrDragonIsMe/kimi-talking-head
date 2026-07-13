import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, Easing } from 'remotion';
import { useSubtitles, SubtitleCue } from '../hooks/useSubtitles';
import { matchSceneStyle, extractDataBarTriggerKeywords, findTriggerCue } from '../utils/keywordMatcher';
import { getActiveCueIndex, getOverlayLayoutPreset, OverlayLayoutConfig } from '../utils/overlayLayout';
import type { ContentOverlayConfig, DataBarItem } from '../index';

const CREAM = '#FAFAF7';
const TILE_STRONG = '#E3E9E7';
const INK = '#151A19';

interface DataBarsProps {
  srtPath: string;
  subtitles?: SubtitleCue[];
  items: DataBarItem[];
  config: ContentOverlayConfig['dataBars'];
  layout?: OverlayLayoutConfig;
}

export const DataBars: React.FC<DataBarsProps> = ({ srtPath, subtitles, items, config, layout }) => {
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

  const candidateItems = (items.length > 0 ? items : config.fallbackItems).slice(0, config.maxItems);

  // 每个数据条只在首次命中其触发关键字的字幕 cue 中出现一次
  const visibleItems = candidateItems.filter((item) => {
    const keywords = extractDataBarTriggerKeywords(item);
    const triggerCue = findTriggerCue(loadedSubtitles, keywords);
    return triggerCue && currentCue && triggerCue.start === currentCue.start && triggerCue.end === currentCue.end;
  });

  if (visibleItems.length === 0 || !currentCue) return null;

  const style = matchSceneStyle(currentCue.text);
  const accentColor = style ? style.accentColor : '#00b498';
  const highlightColor = style ? style.highlightColor : '#00d4c8';

  const cueProgress = (currentTime - currentCue.start) / Math.max(0.001, currentCue.end - currentCue.start);

  const containerOpacity = interpolate(cueProgress * 100, [0, 12], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });
  const containerY = interpolate(cueProgress * 100, [0, 12], [18, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });

  const width = overlayLayout.dataBars.width;
  const isNarrow = width <= 320;

  return (
    <AbsoluteFill
      style={{
        justifyContent: 'flex-start',
        alignItems: 'flex-start',
        paddingLeft: overlayLayout.dataBars.left,
        paddingTop: overlayLayout.dataBars.top,
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          width,
          opacity: containerOpacity,
          transform: `translateY(${containerY}px)`,
          padding: '20px 22px 22px',
          borderRadius: 28,
          background: 'rgba(250,250,247,0.72)',
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
            background: 'rgba(21,26,25,0.05)',
            color: INK,
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
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          {visibleItems.map((item, index) => {
            const delay = 10 + index * 8;
            const progress = interpolate(
              cueProgress * 100,
              [delay, delay + 18],
              [0, Math.max(0, Math.min(100, item.percent))],
              { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) }
            );

            return (
              <div key={`${index}-${item.label}`}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    color: INK,
                    fontSize: isNarrow ? 16 : 17,
                    fontWeight: 700,
                  }}
                >
                  <span
                    style={{
                      maxWidth: '65%',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {item.label}
                  </span>
                  <span style={{ color: 'rgba(21,26,25,0.62)', fontWeight: 800 }}>{item.value}</span>
                </div>
                <div
                  style={{
                    marginTop: 8,
                    height: 10,
                    borderRadius: 999,
                    background: TILE_STRONG,
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      width: `${progress}%`,
                      height: '100%',
                      borderRadius: 999,
                      background: `linear-gradient(90deg, ${accentColor} 0%, ${highlightColor} 100%)`,
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
};

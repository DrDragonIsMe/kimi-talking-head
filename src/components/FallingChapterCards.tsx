import React from 'react';
import { useCurrentFrame, useVideoConfig, interpolate, Easing, spring } from 'remotion';
import { inkAlpha, Z } from '../themes/tokens';

export interface Chapter {
  start: number;
  end: number;
  title: string;
}

interface FallingChapterCardsProps {
  chapters: Chapter[];
  enabled?: boolean;
  primaryColor?: string;
  position?: 'top-right' | 'top-left';
  maxVisible?: number;
  cardWidth?: number;
  /** 整体缩放系数：卡片宽度、内边距、序号徽标与字号全部同比放大 */
  scale?: number;
}

const FONT_FAMILY = '"Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif';

export const FallingChapterCards: React.FC<FallingChapterCardsProps> = ({
  chapters,
  enabled = true,
  primaryColor = '#00b498',
  position = 'top-right',
  maxVisible = 5,
  cardWidth = 530,
  scale = 1,
}) => {
  const { fps, height } = useVideoConfig();
  const frame = useCurrentFrame();
  const currentTime = frame / fps;

  // 所有像素尺寸同比缩放，保证卡片与字体等比例放大
  const s = (n: number) => Math.round(n * scale);
  const scaledCardWidth = s(cardWidth);

  if (!enabled || !chapters || chapters.length === 0) return null;

  // Determine which chapters have been "revealed" (spoken).
  // A card starts falling slightly before its start time so it lands right as the host begins.
  const revealOffsetSeconds = 0.25;

  const visibleChapters = chapters
    .map((chapter, index) => ({ chapter, index }))
    .filter(({ chapter }) => currentTime >= chapter.start - revealOffsetSeconds)
    .slice(-maxVisible);

  if (visibleChapters.length === 0) return null;

  const isRight = position === 'top-right';

  return (
    <div
      style={{
        position: 'absolute',
        // 卡片堆叠起点：画布高度的 1/6 处
        top: Math.round(height / 6),
        [isRight ? 'right' : 'left']: 252,
        display: 'flex',
        flexDirection: 'column',
        gap: s(16),
        pointerEvents: 'none',
        zIndex: Z.cards,
        width: scaledCardWidth,
      }}
    >
      {visibleChapters.map(({ chapter, index }, listIndex) => {
        const isActive = currentTime >= chapter.start && currentTime < chapter.end;
        const isPast = currentTime >= chapter.end;

        const entryFrame = Math.max(0, (chapter.start - revealOffsetSeconds) * fps);
        const entryProgress = Math.min(1, Math.max(0, (frame - entryFrame) / (fps * 0.55)));

        const yOffset = interpolate(entryProgress, [0, 1], [-90, 0], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
          easing: Easing.out(Easing.cubic),
        });

        const opacity = interpolate(entryProgress, [0, 0.6, 1], [0, 1, isPast ? 0.62 : 1], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        });

        const entryScale = spring({
          fps,
          frame: frame - entryFrame,
          config: { damping: 18, stiffness: 180, mass: 0.8 },
        });

        // Active card pulses subtly with the accent color.
        const glowOpacity = isActive
          ? interpolate(frame % fps, [0, fps / 2, fps], [0.18, 0.35, 0.18], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            })
          : 0;

        return (
          <div
            key={`${index}-${chapter.title}`}
            style={{
              width: scaledCardWidth,
              padding: `${s(24)}px ${s(28)}px`,
              borderRadius: s(24),
              background: isActive
                ? `linear-gradient(135deg, ${inkAlpha(0.72)} 0%, ${inkAlpha(0.58)} 100%)`
                : inkAlpha(0.58),
              border: `1.5px solid ${isActive ? primaryColor : `${primaryColor}35`}`,
              backdropFilter: 'blur(18px) saturate(140%)',
              WebkitBackdropFilter: 'blur(18px) saturate(140%)',
              boxShadow: isActive
                ? `0 14px 34px ${inkAlpha(0.32)}, 0 0 24px ${primaryColor}${Math.round(glowOpacity * 255).toString(16).padStart(2, '0')}`
                : `0 10px 24px ${inkAlpha(0.25)}`,
              transform: `translateY(${yOffset}px) scale(${0.88 + entryScale * 0.12})`,
              opacity,
              transformOrigin: isRight ? 'right top' : 'left top',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: s(16),
              }}
            >
              <div
                style={{
                  flexShrink: 0,
                  width: s(40),
                  height: s(40),
                  borderRadius: s(12),
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: isActive ? primaryColor : `${primaryColor}22`,
                  border: `1px solid ${isActive ? primaryColor : `${primaryColor}55`}`,
                  boxShadow: isActive ? `0 0 10px ${primaryColor}` : 'none',
                }}
              >
                <span
                  style={{
                    fontFamily: FONT_FAMILY,
                    fontSize: s(20),
                    fontWeight: 900,
                    color: isActive ? '#0a0a12' : primaryColor,
                  }}
                >
                  {index + 1}
                </span>
              </div>
              <div
                style={{
                  flex: 1,
                  minWidth: 0,
                }}
              >
                <div
                  style={{
                    fontFamily: FONT_FAMILY,
                    fontSize: s(24),
                    fontWeight: isActive ? 800 : 700,
                    color: isPast ? 'rgba(255,255,255,0.72)' : '#fff',
                    lineHeight: 1.45,
                    letterSpacing: 0.3,
                    textShadow: isActive ? `0 0 12px ${primaryColor}40` : 'none',
                  }}
                >
                  {chapter.title}
                </div>
                {isActive ? (
                  <div
                    style={{
                      marginTop: s(8),
                      height: 2,
                      width: '40%',
                      borderRadius: 999,
                      background: primaryColor,
                      boxShadow: `0 0 8px ${primaryColor}`,
                    }}
                  />
                ) : null}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

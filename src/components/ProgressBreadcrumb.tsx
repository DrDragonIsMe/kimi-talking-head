import React from 'react';
import { useCurrentFrame, useVideoConfig, interpolate, Easing } from 'remotion';

export interface Chapter {
  start: number;
  end: number;
  title: string;
}

interface ProgressBreadcrumbProps {
  chapters: Chapter[];
  enabled?: boolean;
  primaryColor?: string;
}

const FONT_FAMILY = '"Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif';

export const ProgressBreadcrumb: React.FC<ProgressBreadcrumbProps> = ({
  chapters,
  enabled = true,
  primaryColor = '#00b498',
}) => {
  const { fps } = useVideoConfig();
  const frame = useCurrentFrame();
  const currentTime = frame / fps;

  if (!enabled || !chapters || chapters.length === 0) return null;

  const totalDuration = Math.max(
    chapters[chapters.length - 1].end,
    currentTime
  );

  const currentIndex = Math.max(
    0,
    chapters.findIndex((ch, i) => {
      const nextStart = chapters[i + 1]?.start ?? Infinity;
      return currentTime >= ch.start && currentTime < nextStart;
    })
  );

  const currentChapter = chapters[currentIndex];
  const progress = Math.min(1, Math.max(0, currentTime / totalDuration));

  const containerOpacity = interpolate(frame, [0, 16], [0, 1], {
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });
  const containerY = interpolate(frame, [0, 16], [-16, 0], {
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });

  return (
    <div
      style={{
        position: 'absolute',
        top: 56,
        left: '50%',
        width: '78%',
        maxWidth: 840,
        transform: `translateX(-50%) translateY(${containerY}px)`,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 12,
        pointerEvents: 'none',
        opacity: containerOpacity,
        zIndex: 10,
      }}
    >
      <div
        style={{
          width: '100%',
          height: 4,
          borderRadius: 999,
          background: 'rgba(255,255,255,0.14)',
          overflow: 'hidden',
          boxShadow: 'inset 0 1px 2px rgba(10,10,18,0.25)',
        }}
      >
        <div
          style={{
            width: `${progress * 100}%`,
            height: '100%',
            borderRadius: 999,
            background: primaryColor,
            boxShadow: `0 0 12px ${primaryColor}, 0 0 24px ${primaryColor}50`,
          }}
        />
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '8px 18px',
          borderRadius: 999,
          background: 'rgba(10,10,18,0.55)',
          border: `1px solid ${primaryColor}35`,
          backdropFilter: 'blur(14px) saturate(130%)',
          WebkitBackdropFilter: 'blur(14px) saturate(130%)',
          boxShadow: `0 10px 28px rgba(10,10,18,0.25), 0 0 16px ${primaryColor}18`,
        }}
      >
        <div
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: primaryColor,
            boxShadow: `0 0 10px ${primaryColor}`,
          }}
        />
        <span
          style={{
            fontFamily: FONT_FAMILY,
            fontSize: 17,
            fontWeight: 800,
            color: '#fff',
            letterSpacing: 0.5,
            textShadow: `0 0 12px ${primaryColor}50`,
          }}
        >
          {currentChapter?.title ?? ''}
        </span>
        <span
          style={{
            fontFamily: FONT_FAMILY,
            fontSize: 13,
            fontWeight: 600,
            color: 'rgba(255,255,255,0.55)',
          }}
        >
          {currentIndex + 1} / {chapters.length}
        </span>
      </div>

      {/* chapter markers on the track */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 4,
          pointerEvents: 'none',
        }}
      >
        {chapters.map((chapter, index) => {
          const isCurrent = index === currentIndex;
          const isPast = index < currentIndex;
          const left = Math.min(1, Math.max(0, chapter.start / totalDuration)) * 100;
          return (
            <div
              key={`${index}-${chapter.title}`}
              style={{
                position: 'absolute',
                left: `${left}%`,
                top: '50%',
                width: isCurrent ? 10 : 7,
                height: isCurrent ? 10 : 7,
                borderRadius: '50%',
                transform: 'translate(-50%, -50%)',
                background: isCurrent || isPast ? primaryColor : '#0a0a12',
                border: `2px solid ${isCurrent ? '#fff' : isPast ? primaryColor : 'rgba(255,255,255,0.35)'}`,
                boxShadow: isCurrent
                  ? `0 0 12px ${primaryColor}, 0 0 24px ${primaryColor}`
                  : isPast
                  ? `0 0 6px ${primaryColor}`
                  : '0 1px 4px rgba(10,10,18,0.4)',
              }}
            />
          );
        })}
      </div>
    </div>
  );
};

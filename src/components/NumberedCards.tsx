import React from 'react';
import { useCurrentFrame, interpolate, Easing } from 'remotion';
import type { ThemeConfig } from '../themes';

interface NumberedCardsProps {
  items: string[];
  theme: ThemeConfig;
  activeIndex?: number;
  position?: 'bottom-left' | 'right';
}

const CANVAS_WIDTH = 1080;
const CANVAS_HEIGHT = 1920;

export const NumberedCards: React.FC<NumberedCardsProps> = ({
  items,
  theme,
  activeIndex = -1,
  position = 'bottom-left',
}) => {
  const frame = useCurrentFrame();

  const cardWidth = position === 'right' ? 420 : 520;
  const gap = 16;
  const left = position === 'right' ? CANVAS_WIDTH - cardWidth - 56 : 56;
  const top = position === 'right' ? 420 : CANVAS_HEIGHT - 420;

  const visibleItems = items.slice(0, 5);

  return (
    <div
      style={{
        position: 'absolute',
        left,
        top,
        width: cardWidth,
        display: 'flex',
        flexDirection: 'column',
        gap,
        pointerEvents: 'none',
      }}
    >
      {visibleItems.map((item, index) => {
        const isActive = index <= activeIndex;
        const delay = index * 6;
        const opacity = interpolate(
          frame,
          [delay, delay + 12],
          [0, isActive ? 1 : 0.35],
          { extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) }
        );
        const y = interpolate(
          frame,
          [delay, delay + 12],
          [24, 0],
          { extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) }
        );

        return (
          <div
            key={`${index}-${item}`}
            style={{
              opacity,
              transform: `translateY(${y}px)`,
              display: 'flex',
              alignItems: 'center',
              gap: 16,
              padding: '18px 20px',
              borderRadius: 20,
              background: theme.colors.surface,
              border: `1px solid ${theme.colors.border}`,
              boxShadow: '0 14px 30px rgba(21,26,25,0.06)',
            }}
          >
            <div
              style={{
                flexShrink: 0,
                width: 48,
                height: 48,
                borderRadius: 14,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: isActive ? theme.colors.primary : theme.colors.surfaceStrong,
                color: isActive ? '#fff' : theme.colors.text,
                fontSize: 22,
                fontWeight: 800,
                fontFamily: theme.typography.fontFamily,
              }}
            >
              {String(index + 1).padStart(2, '0')}
            </div>
            <div
              style={{
                color: theme.colors.text,
                fontSize: 24,
                fontWeight: 700,
                lineHeight: 1.35,
                fontFamily: theme.typography.fontFamily,
              }}
            >
              {item}
            </div>
          </div>
        );
      })}
    </div>
  );
};

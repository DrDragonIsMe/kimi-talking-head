import React from 'react';
import { useCurrentFrame, interpolate } from 'remotion';

interface TalkingProgressBarProps {
  /** 正文（说话段）总帧数；进度 = 当前帧 / durationFrames */
  durationFrames: number;
  color?: string;
}

/**
 * 底部 4px 线性进度条。interpolate 驱动，确定性渲染。
 */
export const TalkingProgressBar: React.FC<TalkingProgressBarProps> = ({
  durationFrames,
  color = '#00e6c3',
}) => {
  const frame = useCurrentFrame();
  const progress = Math.min(1, Math.max(0, frame / Math.max(1, durationFrames)));
  const opacity = interpolate(frame, [0, 12], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        height: 4,
        background: 'rgba(255,255,255,0.10)',
        opacity,
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          width: `${(progress * 100).toFixed(2)}%`,
          height: '100%',
          background: color,
          boxShadow: `0 0 10px ${color}`,
        }}
      />
    </div>
  );
};

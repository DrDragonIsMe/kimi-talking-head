import React from 'react';
import { useCurrentFrame, interpolate } from 'remotion';

export const ChartLines: React.FC = () => {
  const frame = useCurrentFrame();

  const lines = Array.from({ length: 5 }, (_, i) => {
    const offset = i * 40;
    const progress = interpolate(frame, [0 + offset, 120 + offset], [0, 1], {
      extrapolateRight: 'clamp',
    });

    const points = Array.from({ length: 20 }, (_, j) => {
      const x = (j / 19) * 100;
      const baseY = 80 - (j / 19) * 60;
      const noise = Math.sin(j * 0.5 + frame * 0.02 + i) * 5;
      return `${x},${baseY + noise}`;
    }).join(' ');

    return (
      <polyline
        key={i}
        points={points}
        fill="none"
        stroke="#00D4FF"
        strokeWidth="1"
        opacity={0.15 + i * 0.05}
        strokeDasharray="1000"
        strokeDashoffset={1000 - progress * 1000}
      />
    );
  });

  return (
    <svg
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
      }}
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
    >
      {lines}
      {Array.from({ length: 8 }, (_, i) => {
        const y = 20 + Math.random() * 60;
        const x = interpolate(frame, [0, 180], [-10, 110], { extrapolateRight: 'clamp' });
        return (
          <text
            key={`num-${i}`}
            x={x + i * 15}
            y={y}
            fill="#00D4FF"
            fontSize="3"
            opacity={0.3}
          >
            {['+23%', '↑15%', '2.4x', '98%', '+47', '3.2x', '↑89%', '1.8x'][i]}
          </text>
        );
      })}
    </svg>
  );
};

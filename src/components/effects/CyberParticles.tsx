import React from 'react';
import { useCurrentFrame, interpolate } from 'remotion';

export const CyberParticles: React.FC = () => {
  const frame = useCurrentFrame();

  const particles = Array.from({ length: 30 }, (_, i) => {
    const seed = i * 137.5;
    const x = (seed % 100);
    const y = ((seed * 7) % 100);
    const size = 2 + (seed % 4);
    const speed = 0.3 + (seed % 5) * 0.1;
    const currentY = (y + frame * speed) % 100;
    const opacity = interpolate(currentY, [0, 50, 100], [0, 0.6, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

    return (
      <div
        key={i}
        style={{
          position: 'absolute',
          left: `${x}%`,
          top: `${currentY}%`,
          width: size,
          height: size,
          borderRadius: '50%',
          background: '#00FF88',
          opacity,
          boxShadow: `0 0 ${size * 2}px rgba(0,255,136,${opacity})`,
        }}
      />
    );
  });

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      {particles}

      <svg style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        opacity: 0.15,
      }}>
        {Array.from({ length: 8 }, (_, i) => {
          const x1 = 20 + (i % 3) * 30;
          const y1 = 20 + Math.floor(i / 3) * 30;
          const x2 = x1 + 15 + Math.sin(frame * 0.01 + i) * 10;
          const y2 = y1 + 15 + Math.cos(frame * 0.01 + i) * 10;

          return (
            <line
              key={i}
              x1={`${x1}%`}
              y1={`${y1}%`}
              x2={`${x2}%`}
              y2={`${y2}%`}
              stroke="#00FF88"
              strokeWidth="1"
              opacity={0.3 + Math.sin(frame * 0.02 + i) * 0.2}
            />
          );
        })}
      </svg>

      <div style={{
        position: 'absolute',
        left: 0,
        right: 0,
        height: 2,
        background: 'linear-gradient(90deg, transparent, rgba(0,255,136,0.3), transparent)',
        top: `${(frame * 0.3) % 100}%`,
      }} />
    </div>
  );
};

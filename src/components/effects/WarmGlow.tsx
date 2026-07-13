import React from 'react';
import { useCurrentFrame, interpolate } from 'remotion';

export const WarmGlow: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <div style={{
        position: 'absolute',
        top: '20%',
        left: '50%',
        transform: 'translateX(-50%)',
        width: 600,
        height: 400,
        borderRadius: '50%',
        background: 'radial-gradient(ellipse, rgba(255,179,71,0.12) 0%, transparent 70%)',
        filter: 'blur(60px)',
      }} />

      {Array.from({ length: 6 }, (_, i) => {
        const x = 15 + i * 14;
        const baseY = 60 + Math.sin(frame * 0.01 + i * 1.2) * 10;
        const opacity = 0.08 + Math.sin(frame * 0.02 + i) * 0.04;
        const scale = 0.8 + Math.sin(frame * 0.015 + i * 0.5) * 0.2;

        return (
          <div key={i} style={{
            position: 'absolute',
            left: `${x}%`,
            top: `${baseY}%`,
            width: 40 * scale,
            height: 60 * scale,
            opacity,
          }}>
            <svg viewBox="0 0 40 60" fill="rgba(255,179,71,0.3)">
              <circle cx="20" cy="12" r="10" />
              <path d="M10 25 Q20 20 30 25 L32 55 Q20 58 8 55 Z" />
            </svg>
          </div>
        );
      })}

      <svg style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        opacity: 0.1,
      }}>
        <path
          d="M 200 400 Q 300 300 400 400 T 600 400"
          fill="none"
          stroke="#FFB347"
          strokeWidth="2"
          strokeDasharray="10 5"
          strokeDashoffset={-frame * 0.5}
        />
      </svg>
    </div>
  );
};

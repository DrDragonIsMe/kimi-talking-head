import React from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';

export const Background: React.FC = () => {
  const frame = useCurrentFrame();
  const offset = (frame * 0.5) % 200;

  return (
    <AbsoluteFill style={{ zIndex: -1 }}>
      <div style={{
        position: 'absolute',
        inset: 0,
        background: 'linear-gradient(180deg, #0a0a1a 0%, #12122a 50%, #0a0a1a 100%)',
      }} />
      <div style={{
        position: 'absolute',
        inset: 0,
        backgroundImage: `
          linear-gradient(rgba(0,180,152,0.03) 1px, transparent 1px),
          linear-gradient(90deg, rgba(0,180,152,0.03) 1px, transparent 1px)
        `,
        backgroundSize: '60px 60px',
        transform: `translateY(${offset}px)`,
      }} />
      <div style={{
        position: 'absolute',
        top: -200,
        left: '50%',
        transform: 'translateX(-50%)',
        width: 800,
        height: 400,
        background: 'radial-gradient(ellipse, rgba(0,212,255,0.08) 0%, transparent 70%)',
        filter: 'blur(40px)',
      }} />
    </AbsoluteFill>
  );
};

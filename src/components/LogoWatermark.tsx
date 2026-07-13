import React from 'react';
import { AbsoluteFill, staticFile } from 'remotion';

export const LogoWatermark: React.FC = () => {
  return (
    <AbsoluteFill
      style={{
        justifyContent: 'flex-start',
        alignItems: 'flex-end',
        padding: '24px 32px',
        pointerEvents: 'none',
      }}
    >
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        opacity: 0.7,
      }}>
        <img
          src={staticFile('logo.png')}
          style={{ width: 28, height: 28, borderRadius: 6 }}
          alt="logo"
        />
        <span style={{
          fontSize: 16,
          color: '#fff',
          fontWeight: 600,
          letterSpacing: 1,
        }}>
          薪灵AI
        </span>
      </div>
    </AbsoluteFill>
  );
};

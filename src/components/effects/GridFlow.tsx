import React from 'react';
import { useCurrentFrame } from 'remotion';

export const GridFlow: React.FC = () => {
  const frame = useCurrentFrame();
  const offset = (frame * 0.8) % 100;

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <div style={{
        position: 'absolute',
        inset: 0,
        backgroundImage: `
          linear-gradient(rgba(123,97,255,0.08) 1px, transparent 1px),
          linear-gradient(90deg, rgba(123,97,255,0.08) 1px, transparent 1px)
        `,
        backgroundSize: '50px 50px',
        transform: `translateY(${offset}px)`,
      }} />

      {Array.from({ length: 12 }, (_, i) => {
        const x = 10 + (i % 4) * 25;
        const y = 10 + Math.floor(i / 4) * 30;
        const pulse = Math.sin(frame * 0.03 + i) * 0.5 + 0.5;

        return (
          <div key={i}>
            <div style={{
              position: 'absolute',
              left: `${x}%`,
              top: `${y}%`,
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: `rgba(123,97,255,${0.3 + pulse * 0.4})`,
              boxShadow: `0 0 15px rgba(123,97,255,${pulse * 0.5})`,
            }} />
            {i < 8 && (
              <div style={{
                position: 'absolute',
                left: `${x}%`,
                top: `${y}%`,
                width: `${25}%`,
                height: 1,
                background: `linear-gradient(90deg, rgba(123,97,255,0.2), transparent)`,
                transform: `rotate(${Math.atan2(30, 25) * (i % 2 === 0 ? 1 : -1)}rad)`,
                transformOrigin: 'left center',
              }} />
            )}
          </div>
        );
      })}
    </div>
  );
};

import React from 'react';
import { useCurrentFrame, interpolate, Easing } from 'remotion';

export const PulseWarning: React.FC = () => {
  const frame = useCurrentFrame();

  const pulse = interpolate(frame % 30, [0, 15, 30], [0.3, 0.8, 0.3], {
    easing: Easing.inOut(Easing.sin),
  });

  const shakeX = interpolate(frame % 10, [0, 5, 10], [0, 2, 0], {
    easing: Easing.inOut(Easing.sin),
  });

  return (
    <div style={{
      position: 'absolute',
      inset: 0,
      transform: `translateX(${shakeX}px)`,
    }}>
      <div style={{
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        width: 400,
        height: 400,
        borderRadius: '50%',
        background: `radial-gradient(circle, rgba(255,68,68,${pulse}) 0%, transparent 70%)`,
        filter: 'blur(40px)',
      }} />

      {Array.from({ length: 6 }, (_, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            top: `${i * 20}%`,
            left: 0,
            right: 0,
            height: 4,
            background: `linear-gradient(90deg, transparent, rgba(255,68,68,${0.1 + (i % 2) * 0.1}), transparent)`,
            transform: `translateX(${Math.sin(frame * 0.05 + i) * 20}px)`,
          }}
        />
      ))}

      <div style={{
        position: 'absolute',
        top: '30%',
        right: '15%',
        fontSize: 120,
        color: 'rgba(255,68,68,0.08)',
        fontWeight: 900,
      }}>
        !
      </div>
    </div>
  );
};

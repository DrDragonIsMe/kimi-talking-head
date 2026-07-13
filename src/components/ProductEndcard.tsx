import React from 'react';
import { AbsoluteFill, interpolate, Easing, staticFile, useCurrentFrame, OffthreadVideo } from 'remotion';
import type { ThemeConfig } from '../themes';

interface ProductEndcardProps {
  startFrame: number;
  durationFrames: number;
  brand?: string;
  tagline?: string;
  slogan?: string | string[];
  cta?: string;
  pills?: string[];
  primaryColor?: string;
  secondaryColor?: string;
  theme?: ThemeConfig;
}

const FONT_FAMILY = '"Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif';

export const ProductEndcard: React.FC<ProductEndcardProps> = ({
  startFrame,
  durationFrames,
  brand = '薪灵AI',
  tagline = '薪人薪事的AI引擎',
  slogan = ['把人力数据', '变成组织决策'],
  cta = '看薪灵如何重构你的人力系统',
  pills = ['预测离职', '智能定薪', '组织诊断', '人才画像', '合规风控'],
  primaryColor = '#00b498',
  secondaryColor = '#00d4c8',
  theme,
}) => {
  const frame = useCurrentFrame();
  const localFrame = frame - startFrame;
  const opacity = interpolate(localFrame, [0, 16], [0, 1], {
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });
  const y = interpolate(localFrame, [0, 22], [26, 0], {
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });
  const glow = interpolate(localFrame, [0, durationFrames / 2, durationFrames], [0.2, 0.45, 0.28], {
    extrapolateRight: 'clamp',
  });

  const bgGradient = theme
    ? `linear-gradient(180deg, ${theme.colors.backgroundGradient[0]} 0%, ${theme.colors.backgroundGradient[1]} 100%)`
    : 'linear-gradient(180deg, #FAFAF7 0%, #f3f3ee 100%)';
  const surface = theme?.colors.surface ?? '#fff';
  const surfaceStrong = theme?.colors.surfaceStrong ?? '#E3E9E7';
  const text = theme?.colors.text ?? '#151A19';
  const textMuted = theme?.colors.textMuted ?? 'rgba(21,26,25,0.62)';
  const border = theme?.colors.border ?? 'rgba(21,26,25,0.08)';

  const sloganLines = Array.isArray(slogan) ? slogan : [slogan];

  return (
    <AbsoluteFill
      style={{
        opacity,
        transform: `translateY(${y}px)`,
        background: bgGradient,
        fontFamily: theme?.typography.fontFamily ?? FONT_FAMILY,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: `
            linear-gradient(rgba(21,26,25,0.03) 1px, transparent 1px),
            linear-gradient(90deg, rgba(21,26,25,0.02) 1px, transparent 1px)
          `,
          backgroundSize: '62px 62px',
          opacity: 0.28,
        }}
      />

      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: theme ? `radial-gradient(circle at 80% 20%, ${theme.colors.glow} 0%, transparent 30%)` : 'none',
        }}
      />

      <div
        style={{
          position: 'absolute',
          top: 86,
          left: 72,
          right: 72,
          height: 2,
          background: `linear-gradient(90deg, ${primaryColor} 0%, ${surfaceStrong} 36%, transparent 100%)`,
        }}
      />

      <div
        style={{
          position: 'absolute',
          left: 72,
          top: 132,
          width: 660,
          bottom: 154,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div
          style={{
            width: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
          }}
        >
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 14,
              padding: '14px 18px',
              borderRadius: 16,
              background: surface,
              border: `1px solid ${border}`,
              boxShadow: '0 14px 28px rgba(21,26,25,0.06)',
            }}
          >
            <img
              src={staticFile('logo.png')}
              style={{ width: 38, height: 38, objectFit: 'contain' }}
              alt="logo"
            />
            <div style={{ textAlign: 'center' }}>
              <div style={{ color: text, fontSize: 28, fontWeight: 800 }}>{brand}</div>
              <div style={{ color: textMuted, fontSize: 18, marginTop: 4 }}>{tagline}</div>
            </div>
          </div>

          <div
            style={{
              marginTop: 30,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 10,
              padding: '10px 14px',
              borderRadius: 999,
              background: `${primaryColor}16`,
              color: primaryColor,
              fontSize: 18,
              fontWeight: 800,
            }}
          >
            {theme?.id === 'product-launch' ? '产品发布' : 'EDITORIAL END CARD'}
          </div>

          <div style={{ marginTop: 24, color: text, fontSize: 74, fontWeight: 500, lineHeight: 1.08 }}>
            {sloganLines.map((line, index) => (
              <React.Fragment key={index}>
                {index === sloganLines.length - 1 ? (
                  <span style={{ color: primaryColor, fontWeight: 800 }}>{line}</span>
                ) : (
                  line
                )}
                {index < sloganLines.length - 1 && <br />}
              </React.Fragment>
            ))}
          </div>

          <div
            style={{
              marginTop: 22,
              width: 220,
              height: 6,
              borderRadius: 999,
              background: primaryColor,
            }}
          />

          <div
            style={{
              marginTop: 32,
              display: 'flex',
              flexWrap: 'wrap',
              justifyContent: 'center',
              gap: 14,
              maxWidth: 700,
            }}
          >
            {pills.map((pill, index) => (
              <div
                key={pill}
                style={{
                  opacity: interpolate(localFrame, [42 + index * 6, 58 + index * 6], [0, 1], {
                    extrapolateRight: 'clamp',
                  }),
                  padding: '14px 18px',
                  borderRadius: 14,
                  background: index % 2 === 0 ? surfaceStrong : surface,
                  color: text,
                  fontSize: 22,
                  fontWeight: 700,
                  border: `1px solid ${border}`,
                }}
              >
                {pill}
              </div>
            ))}
          </div>

          <div
            style={{
              marginTop: 34,
              width: 360,
              padding: '26px 24px',
              borderRadius: 24,
              background: surface,
              border: `1px solid ${border}`,
              boxShadow: '0 18px 34px rgba(21,26,25,0.06)',
            }}
          >
            <div style={{ color: textMuted, fontSize: 14, fontWeight: 700, letterSpacing: 1.5 }}>
              CTA
            </div>
            <div style={{ marginTop: 12, color: text, fontSize: 34, fontWeight: 800, lineHeight: 1.25 }}>
              {cta}
            </div>
          </div>
        </div>
      </div>

      <div
        style={{
          position: 'absolute',
          right: 72,
          top: 206,
          width: 296,
          padding: '20px',
          borderRadius: 24,
          background: '#0B1413',
          color: '#a8d1c9',
          boxShadow: `0 24px 42px rgba(11,20,19,${glow})`,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          minHeight: 560,
        }}
      >
        <div
          style={{
            position: 'relative',
            width: '100%',
            height: 300,
            overflow: 'hidden',
            borderRadius: 18,
            background: '#182120',
            border: '1px solid rgba(255,255,255,0.08)',
          }}
        >
          <OffthreadVideo
            src={staticFile('host_video.mp4')}
            muted
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
            }}
          />
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: 'linear-gradient(180deg, rgba(11,20,19,0.06) 0%, rgba(11,20,19,0.14) 42%, rgba(11,20,19,0.72) 100%)',
            }}
          />
          <div
            style={{
              position: 'absolute',
              left: 16,
              top: 16,
              padding: '8px 12px',
              borderRadius: 999,
              background: 'rgba(250,250,247,0.92)',
              color: '#151A19',
              fontSize: 14,
              fontWeight: 800,
              letterSpacing: 1.1,
            }}
          >
            {brand} 推荐
          </div>
          <div
            style={{
              position: 'absolute',
              left: 22,
              right: 22,
              bottom: 18,
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: 15, lineHeight: 1.7, color: 'rgba(250,250,247,0.72)' }}>AI + HR SYSTEM</div>
            <div style={{ marginTop: 6, fontSize: 28, fontWeight: 800, color: '#fff', lineHeight: 1.18 }}>
              让组织决策
              <br />
              建立在真实人力数据上
            </div>
          </div>
        </div>

        <div style={{ marginTop: 18, fontSize: 16, lineHeight: 1.7, textAlign: 'center' }}>AI first, Deeply in human</div>
        <div style={{ fontSize: 24, fontWeight: 800, color: primaryColor, textAlign: 'center' }}>{brand}</div>
        <div style={{ fontSize: 20, fontWeight: 700, color: secondaryColor, textAlign: 'center' }}>{tagline}</div>
      </div>

      <div
        style={{
          position: 'absolute',
          left: 72,
          right: 72,
          bottom: 78,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          paddingTop: 26,
          borderTop: `1px solid ${border}`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <img
            src={staticFile('logo.png')}
            style={{ width: 24, height: 24, objectFit: 'contain' }}
            alt="logo"
          />
          <span style={{ color: textMuted, fontSize: 18, fontWeight: 600 }}>
            {brand} · 让组织管理更具效能
          </span>
        </div>
        <div
          style={{
            padding: '14px 22px',
            borderRadius: 12,
            background: primaryColor,
            color: '#fff',
            fontSize: 20,
            fontWeight: 800,
          }}
        >
          {cta}
        </div>
      </div>
    </AbsoluteFill>
  );
};

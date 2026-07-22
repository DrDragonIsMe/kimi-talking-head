import React from 'react';
import { AbsoluteFill, OffthreadVideo, staticFile, useCurrentFrame, interpolate, Easing } from 'remotion';
import type { ThemeConfig, VideoTemplate } from '../themes';
import type { SceneVisual } from '../index';
import { SceneMedia } from './SceneMedia';

interface TitleCardProps {
  title: string;
  subtitle?: string;
  durationFrames: number;
  primaryColor?: string;
  secondaryColor?: string;
  brand?: string;
  tagline?: string;
  pills?: string[];
  coverMeta?: {
    summary?: string;
    insight?: string;
    stats?: Array<{ label: string; value: string }>;
  };
  hostVideoPath?: string;
  template?: VideoTemplate;
  theme?: ThemeConfig;
  sceneVisuals?: SceneVisual[];
  features?: string[];
  /** 画面比例：9:16 竖屏（默认）/ 16:9 横屏（居中两栏变体）/ 1:1 正方形（竖向堆叠变体） */
  aspect?: '9:16' | '16:9' | '1:1';
}

const FONT_FAMILY = '"Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif';
const DEFAULT_PILLS = ['文章转视频', '声音克隆', '唇形同步', '自动字幕'];
const CREAM = '#FAFAF7';
const TILE = '#EDF1F0';
const TILE_STRONG = '#E3E9E7';
const INK = '#151A19';
const NAVY = '#0B1413';

export const TitleCard: React.FC<TitleCardProps> = ({
  title,
  subtitle,
  durationFrames,
  primaryColor = '#00b498',
  secondaryColor = '#00d4c8',
  brand = '薪灵AI',
  tagline = '薪人薪事的AI引擎',
  pills = DEFAULT_PILLS,
  coverMeta,
  hostVideoPath = 'host_video.mp4',
  template = 'editorial',
  theme,
  sceneVisuals = [],
  features = [],
  aspect = '9:16',
}) => {
  const frame = useCurrentFrame();

  if (template === 'product-launch') {
    return (
      <ProductLaunchTitleCard
        title={title}
        subtitle={subtitle}
        primaryColor={primaryColor}
        secondaryColor={secondaryColor}
        brand={brand}
        tagline={tagline}
        pills={pills}
        features={features}
        theme={theme}
        sceneVisuals={sceneVisuals}
      />
    );
  }

  // 横屏 16:9：居中两栏变体（左文案、右主播画面）
  if (aspect === '16:9') {
    return (
      <LandscapeTitleCard
        title={title}
        subtitle={subtitle}
        primaryColor={primaryColor}
        secondaryColor={secondaryColor}
        brand={brand}
        tagline={tagline}
        pills={pills}
        coverMeta={coverMeta}
        hostVideoPath={hostVideoPath}
        frame={frame}
      />
    );
  }

  // 正方形 1:1：竖向堆叠变体（上文案、下主播画面）
  if (aspect === '1:1') {
    return (
      <SquareTitleCard
        title={title}
        subtitle={subtitle}
        primaryColor={primaryColor}
        secondaryColor={secondaryColor}
        brand={brand}
        tagline={tagline}
        pills={pills}
        coverMeta={coverMeta}
        hostVideoPath={hostVideoPath}
        frame={frame}
      />
    );
  }

  const titleLength = title.replace(/\s+/g, '').length;
  const titleFontSize = titleLength > 18 ? 64 : titleLength > 12 ? 76 : 88;
  const summary = coverMeta?.summary || subtitle || '以文章核心结论生成封面摘要。';
  const insight = coverMeta?.insight || '从文章正文里提炼核心判断，而不是展示固定模板文案。';
  const statItems = ((coverMeta?.stats || []).slice(0, 3).length > 0
    ? (coverMeta?.stats || []).slice(0, 3)
    : [
        { label: '内容来源', value: '文章正文' },
        { label: '封面文案', value: '自动提炼' },
      ]);
  const rightCardStats = statItems.slice(0, 2);
  const rightCardTag = title.includes('融资') ? 'HR 科技融资盘点' : '本期焦点';
  const rightCardHeadline = insight.length > 22 ? `${insight.slice(0, 22).trim()}…` : insight;
  const featurePills = pills.length > 0 ? pills.slice(0, 4) : DEFAULT_PILLS;
  const rightGlow = interpolate(frame, [0, durationFrames / 2, durationFrames], [0.16, 0.24, 0.18], {
    extrapolateRight: 'clamp',
  });

  const opacity = interpolate(frame, [0, 16], [0, 1], {
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });
  const leftOpacity = interpolate(frame, [6, 22], [0, 1], {
    extrapolateRight: 'clamp',
  });
  const leftY = interpolate(frame, [6, 22], [26, 0], {
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });
  const rightOpacity = interpolate(frame, [12, 28], [0, 1], {
    extrapolateRight: 'clamp',
  });
  const rightX = interpolate(frame, [12, 28], [30, 0], {
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });
  const accentWidth = interpolate(frame, [18, 36], [120, 280], {
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });

  return (
    <AbsoluteFill
      style={{
        opacity,
        fontFamily: FONT_FAMILY,
        background: `
          radial-gradient(circle at 82% 16%, ${primaryColor}18 0%, transparent 22%),
          radial-gradient(circle at 22% 78%, ${secondaryColor}10 0%, transparent 20%),
          linear-gradient(180deg, ${CREAM} 0%, #f4f4f0 100%)
        `,
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
          backgroundSize: '64px 64px',
          opacity: 0.32,
        }}
      />

      <div
        style={{
          position: 'absolute',
          inset: '72px 48px 72px',
          borderRadius: 32,
          border: '1px solid rgba(21,26,25,0.06)',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.45)',
        }}
      />

      <div
        style={{
          position: 'absolute',
          top: 72,
          left: 48,
          right: 48,
          height: 2,
          background: `linear-gradient(90deg, ${primaryColor} 0%, ${TILE_STRONG} 28%, transparent 100%)`,
        }}
      />

      <div
        style={{
          position: 'absolute',
          left: 72,
          top: 104,
          padding: '10px 16px',
          borderRadius: 10,
          background: primaryColor,
          color: '#fff',
          fontSize: 20,
          fontWeight: 800,
          letterSpacing: 1.2,
        }}
      >
        EDITORIAL PREVIEW
      </div>

      <div
        style={{
          position: 'absolute',
          inset: 0,
          padding: '180px 72px 92px',
          display: 'flex',
          gap: 36,
        }}
      >
        <div
          style={{
            flex: '0 0 58%',
            opacity: leftOpacity,
            transform: `translateY(${leftY}px)`,
          }}
        >
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 14,
              padding: '14px 18px',
              borderRadius: 16,
              background: CREAM,
              border: '1px solid rgba(21,26,25,0.08)',
              boxShadow: '0 14px 28px rgba(21,26,25,0.06)',
            }}
          >
            <img
              src={staticFile('logo.png')}
              alt="logo"
              style={{ width: 34, height: 34, objectFit: 'contain' }}
            />
            <div>
              <div style={{ color: INK, fontSize: 24, fontWeight: 800, lineHeight: 1.1 }}>{brand}</div>
              <div style={{ color: 'rgba(21,26,25,0.62)', fontSize: 16, marginTop: 4 }}>{tagline}</div>
            </div>
          </div>

          <div
            style={{
              marginTop: 34,
              fontSize: titleFontSize,
              fontWeight: 500,
              lineHeight: 1.06,
              color: INK,
              letterSpacing: -1,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {title}
          </div>

          <div
            style={{
              marginTop: 22,
              width: accentWidth,
              height: 6,
              borderRadius: 999,
              background: primaryColor,
            }}
          />

          <div
            style={{
              marginTop: 26,
              maxWidth: 520,
              color: 'rgba(21,26,25,0.72)',
              fontSize: 30,
              lineHeight: 1.55,
              fontWeight: 500,
            }}
          >
            {summary}
          </div>

          <div
            style={{
              marginTop: 36,
              padding: '24px 26px 26px',
              borderRadius: 22,
              background: TILE,
              border: '1px solid rgba(21,26,25,0.05)',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.55)',
            }}
          >
            <div style={{ color: INK, fontSize: 18, fontWeight: 800, letterSpacing: 1.1 }}>关键数字</div>
            <div
              style={{
                display: 'flex',
                gap: 16,
                marginTop: 18,
              }}
            >
              {statItems.map((item) => (
                <div
                  key={`${item.label}-${item.value}`}
                  style={{
                    flex: 1,
                    minHeight: 120,
                    borderRadius: 18,
                    background: 'rgba(250,250,247,0.75)',
                    border: '1px solid rgba(21,26,25,0.06)',
                    padding: '18px 18px 16px',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                  }}
                >
                  <div style={{ color: 'rgba(21,26,25,0.52)', fontSize: 14, fontWeight: 700, letterSpacing: 0.8 }}>
                    {item.label}
                  </div>
                  <div style={{ color: INK, fontSize: 28, fontWeight: 800, lineHeight: 1.2 }}>
                    {item.value}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div
            style={{
              marginTop: 26,
              padding: '24px 26px',
              borderRadius: 18,
              background: NAVY,
              color: '#7ac9bc',
              boxShadow: '0 20px 38px rgba(11,20,19,0.18)',
            }}
          >
            <div style={{ fontSize: 18, lineHeight: 1.6, color: '#8ecfc5', letterSpacing: 1 }}>CORE TAKE</div>
            <div
              style={{
                marginTop: 14,
                fontSize: 34,
                fontWeight: 800,
                lineHeight: 1.3,
                color: primaryColor,
              }}
            >
              {insight}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 30 }}>
            {featurePills.map((pill, index) => {
              const pillOpacity = interpolate(frame, [16 + index * 2, 28 + index * 2], [0, 1], {
                extrapolateRight: 'clamp',
              });

              return (
                <div
                  key={pill}
                  style={{
                    opacity: pillOpacity,
                    padding: '14px 22px',
                    borderRadius: 12,
                    background: index === 0 ? primaryColor : CREAM,
                    color: index === 0 ? '#fff' : INK,
                    border: index === 0 ? 'none' : '1px solid rgba(21,26,25,0.08)',
                    fontSize: 19,
                    fontWeight: 700,
                    boxShadow: index === 0
                      ? '0 16px 28px rgba(0,180,152,0.18)'
                      : '0 10px 22px rgba(21,26,25,0.05)',
                  }}
                >
                  {pill}
                </div>
              );
            })}
          </div>
        </div>

        <div
          style={{
            flex: '0 0 38%',
            position: 'relative',
            opacity: rightOpacity,
            transform: `translateX(${rightX}px)`,
          }}
        >
          <div
            style={{
              position: 'absolute',
              inset: 0,
              borderRadius: 32,
              background: TILE_STRONG,
              border: '1px solid rgba(21,26,25,0.05)',
              boxShadow: `0 24px 42px rgba(21,26,25,${rightGlow})`,
            }}
          />

          <div
            style={{
              position: 'absolute',
              top: 28,
              left: 28,
              right: 28,
              bottom: 220,
              borderRadius: 28,
              overflow: 'hidden',
              background: '#d8dcdb',
              boxShadow: '0 24px 42px rgba(21,26,25,0.08)',
            }}
          >
            <OffthreadVideo
              src={staticFile(hostVideoPath)}
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
                background: 'linear-gradient(180deg, rgba(250,250,247,0.02) 0%, rgba(21,26,25,0.08) 100%)',
              }}
            />
          </div>

          <div
            style={{
              position: 'absolute',
              left: 28,
              right: 28,
              bottom: 28,
              padding: '22px 22px 24px',
              borderRadius: 24,
              background: CREAM,
              border: '1px solid rgba(21,26,25,0.08)',
            }}
          >
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 10,
                padding: '8px 12px',
                borderRadius: 999,
                background: `${primaryColor}14`,
                color: primaryColor,
                fontSize: 16,
                fontWeight: 800,
              }}
            >
              {rightCardTag}
            </div>
            <div
              style={{
                marginTop: 16,
                color: INK,
                fontSize: 28,
                fontWeight: 800,
                lineHeight: 1.32,
              }}
            >
              {rightCardHeadline}
            </div>
            <div
              style={{
                marginTop: 16,
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
              }}
            >
              {rightCardStats.map((item) => (
                <div
                  key={`${item.label}-${item.value}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 16,
                    padding: '12px 14px',
                    borderRadius: 14,
                    background: TILE,
                    border: '1px solid rgba(21,26,25,0.06)',
                  }}
                >
                  <div
                    style={{
                      color: 'rgba(21,26,25,0.54)',
                      fontSize: 14,
                      fontWeight: 700,
                      letterSpacing: 0.8,
                    }}
                  >
                    {item.label}
                  </div>
                  <div
                    style={{
                      color: INK,
                      fontSize: 20,
                      fontWeight: 800,
                      lineHeight: 1.2,
                      textAlign: 'right',
                    }}
                  >
                    {item.value}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};

const ProductLaunchTitleCard: React.FC<{
  title: string;
  subtitle?: string;
  primaryColor: string;
  secondaryColor: string;
  brand: string;
  tagline: string;
  pills: string[];
  features: string[];
  theme?: ThemeConfig;
  sceneVisuals: SceneVisual[];
}> = ({
  title,
  subtitle,
  primaryColor,
  secondaryColor,
  brand,
  tagline,
  pills,
  features,
  theme,
  sceneVisuals,
}) => {
  const frame = useCurrentFrame();
  const heroVisual = sceneVisuals[0];
  const titleLength = title.replace(/\s+/g, '').length;
  const titleFontSize = titleLength > 18 ? 64 : titleLength > 12 ? 72 : 84;

  const opacity = interpolate(frame, [0, 16], [0, 1], {
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });
  const heroOpacity = interpolate(frame, [0, 22], [0, 1], {
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });
  const contentOpacity = interpolate(frame, [10, 26], [0, 1], {
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });
  const contentY = interpolate(frame, [10, 26], [24, 0], {
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });

  const bgGradient = theme
    ? `linear-gradient(180deg, ${theme.colors.backgroundGradient[0]} 0%, ${theme.colors.backgroundGradient[1]} 100%)`
    : 'linear-gradient(180deg, #FAFAF7 0%, #E8F7F4 100%)';

  return (
    <AbsoluteFill
      style={{
        opacity,
        background: bgGradient,
        fontFamily: theme?.typography.fontFamily ?? FONT_FAMILY,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: theme ? `radial-gradient(circle at 20% 20%, ${theme.colors.glow} 0%, transparent 35%)` : 'none',
        }}
      />

      {/* 顶部品牌标签 */}
      <div
        style={{
          position: 'absolute',
          left: 56,
          top: 64,
          zIndex: 10,
          padding: '10px 16px',
          borderRadius: 999,
          background: primaryColor,
          color: '#fff',
          fontSize: 18,
          fontWeight: 800,
          letterSpacing: 1,
        }}
      >
        {brand}
      </div>

      {/* 上半区：产品主视觉 */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: 1080,
          height: 1056,
          opacity: heroOpacity,
          overflow: 'hidden',
        }}
      >
        {heroVisual ? (
          <SceneMedia
            visual={heroVisual}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
            }}
          />
        ) : (
          <div
            style={{
              width: '100%',
              height: '100%',
              background: `linear-gradient(135deg, ${secondaryColor}22 0%, ${primaryColor}14 100%)`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <span style={{ color: primaryColor, fontSize: 36, fontWeight: 700, opacity: 0.5 }}>产品主视觉</span>
          </div>
        )}
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            height: 200,
            background: 'linear-gradient(180deg, transparent 0%, rgba(250,250,247,0.92) 100%)',
          }}
        />
      </div>

      {/* 下半区：文案 */}
      <div
        style={{
          position: 'absolute',
          left: 56,
          right: 56,
          top: 1080,
          bottom: 80,
          opacity: contentOpacity,
          transform: `translateY(${contentY}px)`,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          textAlign: 'center',
        }}
      >
        <div style={{ color: 'rgba(21,26,25,0.5)', fontSize: 22, fontWeight: 700, letterSpacing: 1 }}>
          {tagline}
        </div>

        <div
          style={{
            marginTop: 18,
            fontSize: titleFontSize,
            fontWeight: 600,
            lineHeight: 1.08,
            color: '#151A19',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {title}
        </div>

        {subtitle ? (
          <div
            style={{
              marginTop: 16,
              fontSize: 32,
              color: primaryColor,
              fontWeight: 700,
            }}
          >
            {subtitle}
          </div>
        ) : null}

        <div
          style={{
            marginTop: 24,
            width: 160,
            height: 6,
            borderRadius: 999,
            background: primaryColor,
          }}
        />

        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', justifyContent: 'center', marginTop: 32 }}>
          {(features.length > 0 ? features : pills).slice(0, 3).map((pill, index) => {
            const pillOpacity = interpolate(frame, [20 + index * 3, 32 + index * 3], [0, 1], {
              extrapolateRight: 'clamp',
            });
            return (
              <div
                key={pill}
                style={{
                  opacity: pillOpacity,
                  padding: '14px 22px',
                  borderRadius: 999,
                  background: index === 0 ? primaryColor : 'rgba(255,255,255,0.82)',
                  color: index === 0 ? '#fff' : '#151A19',
                  border: index === 0 ? 'none' : '1px solid rgba(21,26,25,0.08)',
                  fontSize: 22,
                  fontWeight: 700,
                  boxShadow: index === 0
                    ? '0 14px 28px rgba(0,180,152,0.2)'
                    : '0 10px 22px rgba(21,26,25,0.05)',
                }}
              >
                {pill}
              </div>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
};

/**
 * 横屏 16:9（1920×1080）标题卡：居中两栏——左侧品牌/标题/摘要/特性胶囊，右侧主播画面。
 * 简单适配竖屏设计语言（同款色板与动效曲线），不引入新组件体系。
 */
const LandscapeTitleCard: React.FC<{
  title: string;
  subtitle?: string;
  primaryColor: string;
  secondaryColor: string;
  brand: string;
  tagline: string;
  pills: string[];
  coverMeta?: TitleCardProps['coverMeta'];
  hostVideoPath: string;
  frame: number;
}> = ({
  title,
  subtitle,
  primaryColor,
  secondaryColor,
  brand,
  tagline,
  pills,
  coverMeta,
  hostVideoPath,
  frame,
}) => {
  const opacity = interpolate(frame, [0, 16], [0, 1], {
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });
  const leftOpacity = interpolate(frame, [6, 22], [0, 1], {
    extrapolateRight: 'clamp',
  });
  const leftY = interpolate(frame, [6, 22], [26, 0], {
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });
  const rightOpacity = interpolate(frame, [12, 28], [0, 1], {
    extrapolateRight: 'clamp',
  });
  const rightX = interpolate(frame, [12, 28], [30, 0], {
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });
  const accentWidth = interpolate(frame, [18, 36], [120, 280], {
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });

  const titleLength = title.replace(/\s+/g, '').length;
  const titleFontSize = titleLength > 18 ? 56 : titleLength > 12 ? 68 : 80;
  const summary = coverMeta?.summary || subtitle || '以文章核心结论生成封面摘要。';
  const featurePills = (pills.length > 0 ? pills : DEFAULT_PILLS).slice(0, 4);

  return (
    <AbsoluteFill
      style={{
        opacity,
        fontFamily: FONT_FAMILY,
        background: `
          radial-gradient(circle at 86% 20%, ${primaryColor}18 0%, transparent 24%),
          radial-gradient(circle at 16% 82%, ${secondaryColor}10 0%, transparent 22%),
          linear-gradient(180deg, ${CREAM} 0%, #f4f4f0 100%)
        `,
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
          backgroundSize: '64px 64px',
          opacity: 0.32,
        }}
      />

      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          padding: '72px 88px',
          gap: 72,
        }}
      >
        {/* 左：文案栏 */}
        <div
          style={{
            flex: '1 1 auto',
            minWidth: 0,
            opacity: leftOpacity,
            transform: `translateY(${leftY}px)`,
          }}
        >
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 14,
              padding: '12px 18px',
              borderRadius: 16,
              background: CREAM,
              border: '1px solid rgba(21,26,25,0.08)',
              boxShadow: '0 14px 28px rgba(21,26,25,0.06)',
            }}
          >
            <img
              src={staticFile('logo.png')}
              alt="logo"
              style={{ width: 34, height: 34, objectFit: 'contain' }}
            />
            <div>
              <div style={{ color: INK, fontSize: 24, fontWeight: 800, lineHeight: 1.1 }}>{brand}</div>
              <div style={{ color: 'rgba(21,26,25,0.62)', fontSize: 16, marginTop: 4 }}>{tagline}</div>
            </div>
          </div>

          <div
            style={{
              marginTop: 30,
              fontSize: titleFontSize,
              fontWeight: 500,
              lineHeight: 1.1,
              color: INK,
              letterSpacing: -1,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {title}
          </div>

          <div
            style={{
              marginTop: 22,
              width: accentWidth,
              height: 6,
              borderRadius: 999,
              background: primaryColor,
            }}
          />

          <div
            style={{
              marginTop: 26,
              maxWidth: 880,
              color: 'rgba(21,26,25,0.72)',
              fontSize: 28,
              lineHeight: 1.55,
              fontWeight: 500,
            }}
          >
            {summary}
          </div>

          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 34 }}>
            {featurePills.map((pill) => (
              <div
                key={pill}
                style={{
                  padding: '10px 18px',
                  borderRadius: 999,
                  background: TILE,
                  border: '1px solid rgba(21,26,25,0.08)',
                  fontSize: 20,
                  fontWeight: 700,
                  color: INK,
                }}
              >
                {pill}
              </div>
            ))}
          </div>
        </div>

        {/* 右：主播画面卡 */}
        <div
          style={{
            flex: '0 0 400px',
            height: 640,
            opacity: rightOpacity,
            transform: `translateX(${rightX}px)`,
            borderRadius: 28,
            overflow: 'hidden',
            background: TILE_STRONG,
            border: '1px solid rgba(21,26,25,0.08)',
            boxShadow: '0 28px 60px rgba(21,26,25,0.14)',
          }}
        >
          <OffthreadVideo
            src={staticFile(hostVideoPath)}
            muted
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        </div>
      </div>
    </AbsoluteFill>
  );
};

/**
 * 正方形 1:1（1080×1080）标题卡：竖向堆叠——品牌行、标题、摘要、特性胶囊，底部主播画面卡。
 * 沿用横屏变体的色板与动效曲线，不引入新组件体系。
 */
const SquareTitleCard: React.FC<{
  title: string;
  subtitle?: string;
  primaryColor: string;
  secondaryColor: string;
  brand: string;
  tagline: string;
  pills: string[];
  coverMeta?: TitleCardProps['coverMeta'];
  hostVideoPath: string;
  frame: number;
}> = ({
  title,
  subtitle,
  primaryColor,
  secondaryColor,
  brand,
  tagline,
  pills,
  coverMeta,
  hostVideoPath,
  frame,
}) => {
  const opacity = interpolate(frame, [0, 16], [0, 1], {
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });
  const leftOpacity = interpolate(frame, [6, 22], [0, 1], {
    extrapolateRight: 'clamp',
  });
  const leftY = interpolate(frame, [6, 22], [26, 0], {
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });
  const rightOpacity = interpolate(frame, [12, 28], [0, 1], {
    extrapolateRight: 'clamp',
  });
  const rightY = interpolate(frame, [12, 28], [30, 0], {
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });
  const accentWidth = interpolate(frame, [18, 36], [120, 280], {
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });

  const titleLength = title.replace(/\s+/g, '').length;
  const titleFontSize = titleLength > 18 ? 52 : titleLength > 12 ? 64 : 76;
  const summary = coverMeta?.summary || subtitle || '以文章核心结论生成封面摘要。';
  const featurePills = (pills.length > 0 ? pills : DEFAULT_PILLS).slice(0, 4);

  return (
    <AbsoluteFill
      style={{
        opacity,
        fontFamily: FONT_FAMILY,
        background: `
          radial-gradient(circle at 84% 14%, ${primaryColor}18 0%, transparent 24%),
          radial-gradient(circle at 18% 84%, ${secondaryColor}10 0%, transparent 22%),
          linear-gradient(180deg, ${CREAM} 0%, #f4f4f0 100%)
        `,
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
          backgroundSize: '64px 64px',
          opacity: 0.32,
        }}
      />

      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          padding: '64px 72px',
        }}
      >
        {/* 上：文案区 */}
        <div
          style={{
            opacity: leftOpacity,
            transform: `translateY(${leftY}px)`,
          }}
        >
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 14,
              padding: '12px 18px',
              borderRadius: 16,
              background: CREAM,
              border: '1px solid rgba(21,26,25,0.08)',
              boxShadow: '0 14px 28px rgba(21,26,25,0.06)',
            }}
          >
            <img
              src={staticFile('logo.png')}
              alt="logo"
              style={{ width: 34, height: 34, objectFit: 'contain' }}
            />
            <div>
              <div style={{ color: INK, fontSize: 24, fontWeight: 800, lineHeight: 1.1 }}>{brand}</div>
              <div style={{ color: 'rgba(21,26,25,0.62)', fontSize: 16, marginTop: 4 }}>{tagline}</div>
            </div>
          </div>

          <div
            style={{
              marginTop: 28,
              fontSize: titleFontSize,
              fontWeight: 500,
              lineHeight: 1.1,
              color: INK,
              letterSpacing: -1,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {title}
          </div>

          <div
            style={{
              marginTop: 20,
              width: accentWidth,
              height: 6,
              borderRadius: 999,
              background: primaryColor,
            }}
          />

          <div
            style={{
              marginTop: 22,
              maxWidth: 900,
              color: 'rgba(21,26,25,0.72)',
              fontSize: 27,
              lineHeight: 1.5,
              fontWeight: 500,
            }}
          >
            {summary}
          </div>

          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 28 }}>
            {featurePills.map((pill) => (
              <div
                key={pill}
                style={{
                  padding: '10px 18px',
                  borderRadius: 999,
                  background: TILE,
                  border: '1px solid rgba(21,26,25,0.08)',
                  fontSize: 20,
                  fontWeight: 700,
                  color: INK,
                }}
              >
                {pill}
              </div>
            ))}
          </div>
        </div>

        {/* 下：主播画面卡（占满剩余高度） */}
        <div
          style={{
            flex: 1,
            minHeight: 0,
            marginTop: 32,
            opacity: rightOpacity,
            transform: `translateY(${rightY}px)`,
            borderRadius: 28,
            overflow: 'hidden',
            background: TILE_STRONG,
            border: '1px solid rgba(21,26,25,0.08)',
            boxShadow: '0 28px 60px rgba(21,26,25,0.14)',
          }}
        >
          <OffthreadVideo
            src={staticFile(hostVideoPath)}
            muted
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        </div>
      </div>
    </AbsoluteFill>
  );
};

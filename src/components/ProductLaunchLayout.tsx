import React, { useMemo } from 'react';
import { AbsoluteFill, OffthreadVideo, staticFile, useCurrentFrame, useVideoConfig, interpolate, Easing } from 'remotion';
import { DynamicTypingSubtitles } from './DynamicTypingSubtitles';
import { NumberedCards } from './NumberedCards';
import type { ThemeConfig } from '../themes';
import type { SceneVisual } from '../index';
import type { SubtitleCue } from '../hooks/useSubtitles';
import { matchSceneStyle } from '../utils/keywordMatcher';

interface ProductLaunchLayoutProps {
  audioPath: string;
  srtPath: string;
  subtitles: SubtitleCue[];
  hostVideoPath: string;
  sceneVisuals: SceneVisual[];
  features: string[];
  theme: ThemeConfig;
  primaryColor: string;
  secondaryColor: string;
}

const PRODUCT_KEYWORDS = [
  '功能', '界面', '页面', '截图', '产品', '平台', '系统', '工具', '数据', '图表', '看到', '展示', '操作', '点击', '入口',
];

function shouldShowProductVisual(cueText: string): boolean {
  const normalized = cueText.toLowerCase();
  return PRODUCT_KEYWORDS.some((kw) => normalized.includes(kw));
}

function getVisualForCue(sceneVisuals: SceneVisual[], cue: SubtitleCue): SceneVisual | null {
  return sceneVisuals.find((v) => cue.start >= v.start && cue.end <= v.end) ?? sceneVisuals[0] ?? null;
}

export const ProductLaunchLayout: React.FC<ProductLaunchLayoutProps> = ({
  subtitles,
  hostVideoPath,
  sceneVisuals,
  features,
  theme,
  primaryColor,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const currentTime = frame / fps;

  const activeCue = useMemo(() => {
    return subtitles.find((cue) => currentTime >= cue.start && currentTime <= cue.end) ?? null;
  }, [subtitles, currentTime]);

  const activeCueIndex = useMemo(() => {
    return activeCue ? subtitles.findIndex((c) => c.start === activeCue.start && c.end === activeCue.end) : -1;
  }, [activeCue, subtitles]);

  const isProductScene = activeCue ? shouldShowProductVisual(activeCue.text) : false;
  const visual = activeCue ? getVisualForCue(sceneVisuals, activeCue) : null;

  const hostOpacity = interpolate(frame, [0, 18], [0, isProductScene ? 0 : 1], {
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });
  const productOpacity = interpolate(frame, [0, 18], [0, isProductScene ? 1 : 0], {
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });

  const sceneStyle = activeCue ? matchSceneStyle(activeCue.text) : null;
  const bgGradient = sceneStyle
    ? `linear-gradient(180deg, ${sceneStyle.bgColor} 0%, ${theme.colors.backgroundGradient[1]} 100%)`
    : `linear-gradient(180deg, ${theme.colors.backgroundGradient[0]} 0%, ${theme.colors.backgroundGradient[1]} 100%)`;

  const activeFeatureIndex = Math.min(
    Math.max(0, Math.floor(activeCueIndex / 3)),
    features.length - 1
  );

  return (
    <AbsoluteFill style={{ background: bgGradient, overflow: 'hidden' }}>
      {/* 品牌光晕背景 */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: `radial-gradient(circle at 20% 20%, ${theme.colors.glow} 0%, transparent 35%)`,
          pointerEvents: 'none',
        }}
      />

      {/* 产品全屏层 */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          opacity: productOpacity,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 80,
        }}
      >
        {visual ? (
          <img
            src={staticFile(visual.path)}
            alt=""
            style={{
              maxWidth: '100%',
              maxHeight: '100%',
              objectFit: 'contain',
              borderRadius: 32,
              boxShadow: '0 32px 64px rgba(21,26,25,0.12)',
            }}
          />
        ) : (
          <div
            style={{
              width: 720,
              height: 1080,
              borderRadius: 32,
              background: theme.colors.surfaceStrong,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: theme.colors.textMuted,
              fontSize: 32,
              fontFamily: theme.typography.fontFamily,
            }}
          >
            产品视觉占位
          </div>
        )}
      </div>

      {/* 主播全屏层 */}
      <div
        style={{
          position: 'absolute',
          inset: 80,
          opacity: hostOpacity,
          borderRadius: 40,
          overflow: 'hidden',
          background: '#15151c',
          boxShadow: '0 32px 64px rgba(0,0,0,0.2)',
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
            background: 'linear-gradient(180deg, rgba(10,10,18,0.05) 0%, rgba(10,10,18,0.35) 100%)',
            pointerEvents: 'none',
          }}
        />
      </div>

      {/* 数字卡片卖点 */}
      {features.length > 0 && (
        <NumberedCards
          items={features}
          theme={theme}
          activeIndex={activeFeatureIndex}
          position={isProductScene ? 'right' : 'bottom-left'}
        />
      )}

      {/* 动态逐字字幕 */}
      <DynamicTypingSubtitles
        subtitles={subtitles}
        theme={theme}
        bottomOffset={isProductScene ? 120 : 160}
      />

      {/* 顶部品牌标签 */}
      <div
        style={{
          position: 'absolute',
          left: 56,
          top: 64,
          padding: '10px 16px',
          borderRadius: 999,
          background: primaryColor,
          color: '#fff',
          fontSize: 18,
          fontWeight: 800,
          letterSpacing: 1,
          fontFamily: theme.typography.fontFamily,
          pointerEvents: 'none',
        }}
      >
        产品发布
      </div>
    </AbsoluteFill>
  );
};

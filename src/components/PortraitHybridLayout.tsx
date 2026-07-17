import React from 'react';
import { AbsoluteFill, OffthreadVideo, staticFile, useCurrentFrame, useVideoConfig, interpolate, Easing } from 'remotion';
import { DynamicBackground } from './DynamicBackground';
import { Subtitles } from './Subtitles';
import { TopicTag } from './TopicTag';
import { BrandBadge } from './BrandBadge';
import { HybridInsightCard } from './HybridInsightCard';
import { FallingChapterCards } from './FallingChapterCards';
import { TalkingProgressBar } from './TalkingProgressBar';
import { AudioWaveform } from './AudioWaveform';
import { SubtitleCue, HeroMoment } from '../hooks/useSubtitles';
import type { ContentOverlayConfig, SceneVisual } from '../index';

interface PortraitHybridLayoutProps {
  audioPath: string;
  srtPath: string;
  subtitles: SubtitleCue[];
  hostVideoPath: string;
  sceneVisuals: SceneVisual[];
  contentOverlay?: ContentOverlayConfig;
  primaryColor: string;
  secondaryColor: string;
  brand: string;
  tagline: string;
  title: string;
  chapters?: Array<{ start: number; end: number; title: string }>;
  heroMoments?: HeroMoment[];
  /** 正文（说话段）总帧数，用于底部进度条；不传则不渲染进度条 */
  talkingDurationFrames?: number;
  hybridConfig?: {
    preset?: 'default' | 'host-focus' | 'visual-focus' | 'minimal' | 'balanced';
    mainVisualRatio?: number;
    mainVisualBorderRadius?: number;
    hostPosition?: string;
    hostWindowWidth?: number;
    hostWindowHeight?: number;
    hostBorderRadius?: number;
    showSubtitles?: boolean;
    showTalkingPoints?: boolean;
    showProgressBreadcrumb?: boolean;
    showProgressBar?: boolean;
    showWaveform?: boolean;
    showChapterCards?: boolean;
    showDataBars?: boolean;
    showQuoteHighlight?: boolean;
    topicTag?: {
      enabled?: boolean;
      label?: string;
      position?: string;
    };
    brandBadge?: {
      enabled?: boolean;
      position?: string;
      text?: string;
    };
  };
}

const CANVAS_WIDTH = 1080;
const CANVAS_HEIGHT = 1920;

type HybridConfig = NonNullable<PortraitHybridLayoutProps['hybridConfig']>;

const HYBRID_PRESETS: Record<
  string,
  Required<Pick<HybridConfig, 'mainVisualRatio' | 'hostWindowWidth' | 'hostWindowHeight'>> & HybridConfig
> = {
  default: {
    mainVisualRatio: 0.58,
    hostWindowWidth: 560,
    hostWindowHeight: 640,
    showSubtitles: true,
    showTalkingPoints: true,
    showProgressBreadcrumb: true,
    showChapterCards: true,
    showDataBars: false,
    showQuoteHighlight: false,
    topicTag: { enabled: true, label: '核心解读' },
    brandBadge: { enabled: true, text: '' },
  },
  'host-focus': {
    mainVisualRatio: 0.38,
    hostWindowWidth: 840,
    hostWindowHeight: 960,
    showSubtitles: true,
    showTalkingPoints: false,
    showProgressBreadcrumb: false,
    showChapterCards: false,
    showDataBars: false,
    showQuoteHighlight: false,
    topicTag: { enabled: true, label: '核心解读' },
    brandBadge: { enabled: false, text: '' },
  },
  'visual-focus': {
    mainVisualRatio: 0.72,
    hostWindowWidth: 440,
    hostWindowHeight: 500,
    showSubtitles: true,
    showTalkingPoints: false,
    showProgressBreadcrumb: true,
    showChapterCards: false,
    showDataBars: false,
    showQuoteHighlight: false,
    topicTag: { enabled: true, label: '核心解读' },
    brandBadge: { enabled: true, text: '' },
  },
  minimal: {
    mainVisualRatio: 0.5,
    hostWindowWidth: 640,
    hostWindowHeight: 720,
    showSubtitles: true,
    showTalkingPoints: false,
    showProgressBreadcrumb: false,
    showChapterCards: false,
    showDataBars: false,
    showQuoteHighlight: false,
    topicTag: { enabled: false, label: '核心解读' },
    brandBadge: { enabled: false, text: '' },
  },
  balanced: {
    mainVisualRatio: 0.5,
    hostWindowWidth: 640,
    hostWindowHeight: 720,
    showSubtitles: true,
    showTalkingPoints: true,
    showProgressBreadcrumb: true,
    showChapterCards: true,
    showDataBars: false,
    showQuoteHighlight: false,
    topicTag: { enabled: true, label: '核心解读' },
    brandBadge: { enabled: true, text: '' },
  },
};

export const PortraitHybridLayout: React.FC<PortraitHybridLayoutProps> = ({
  audioPath,
  srtPath,
  subtitles,
  hostVideoPath,
  sceneVisuals,
  contentOverlay = {} as ContentOverlayConfig,
  primaryColor,
  secondaryColor,
  brand,
  tagline,
  title,
  hybridConfig: rawHybridConfig = {},
  chapters = [],
  heroMoments = [],
  talkingDurationFrames,
}) => {
  const { fps } = useVideoConfig();
  const frame = useCurrentFrame();
  const currentTime = frame / fps;

  const preset = HYBRID_PRESETS[rawHybridConfig.preset ?? 'default'] ?? HYBRID_PRESETS.default;
  const hybridConfig = { ...preset, ...rawHybridConfig };

  const mainVisualRatio = hybridConfig.mainVisualRatio ?? 0.58;
  const mainVisualHeight = Math.round(CANVAS_HEIGHT * mainVisualRatio);
  const hostAreaTop = mainVisualHeight;
  const hostAreaHeight = CANVAS_HEIGHT - mainVisualHeight;

  const hostWidth = hybridConfig.hostWindowWidth ?? 560;
  const hostHeight = hybridConfig.hostWindowHeight ?? 640;
  const hostBorderRadius = hybridConfig.hostBorderRadius ?? 28;
  const hostLeft = Math.round((CANVAS_WIDTH - hostWidth) / 2);
  const hostTop = hostAreaTop + Math.round((hostAreaHeight - hostHeight) / 2);

  const mainVisualOpacity = interpolate(frame, [0, 18], [0, 1], {
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });
  const hostOpacity = interpolate(frame, [8, 26], [0, 1], {
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });
  const hostY = interpolate(frame, [8, 26], [30, 0], {
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });

  return (
    <AbsoluteFill style={{ background: '#0a0a12' }}>
      {/* 上层：主视觉资料画面 */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: CANVAS_WIDTH,
          height: mainVisualHeight,
          overflow: 'hidden',
          opacity: mainVisualOpacity,
        }}
      >
        <DynamicBackground
          srtPath={srtPath}
          subtitles={subtitles}
          sceneVisuals={sceneVisuals}
          layout={contentOverlay.layout}
          variant="hero"
        />
        {/* 顶部章节观点卡片，讲一个落一个 */}
        {hybridConfig.showChapterCards ?? true ? (
          <FallingChapterCards
            chapters={chapters}
            enabled={hybridConfig.showChapterCards ?? true}
            primaryColor={primaryColor}
            position="top-right"
            maxVisible={5}
            cardWidth={530}
          />
        ) : null}

        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            height: 160,
            background: 'linear-gradient(180deg, transparent 0%, rgba(10,10,18,0.55) 60%, rgba(10,10,18,0.92) 100%)',
            pointerEvents: 'none',
          }}
        />

        {/* 主视觉区观点洞察卡片 */}
        {hybridConfig.showTalkingPoints ?? true ? (
          <HybridInsightCard
            subtitles={subtitles}
            enabled={hybridConfig.showTalkingPoints ?? true}
            maxItems={1}
            mainLabel="观点洞察"
            position="bottom-left"
          />
        ) : null}
      </div>

      {/* 下层：主播窗口 */}
      <div
        style={{
          position: 'absolute',
          left: hostLeft,
          top: hostTop + hostY,
          width: hostWidth,
          height: hostHeight,
          borderRadius: hostBorderRadius,
          overflow: 'hidden',
          opacity: hostOpacity,
          background: '#15151c',
          border: '1px solid rgba(255,255,255,0.08)',
          boxShadow: '0 28px 60px rgba(10,10,18,0.45)',
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
            background: 'linear-gradient(180deg, rgba(10,10,18,0.05) 0%, rgba(10,10,18,0.25) 100%)',
            pointerEvents: 'none',
          }}
        />

        {/* 主播窗口内品牌角标 */}
        {hybridConfig.brandBadge?.enabled !== false ? (
          <div
            style={{
              position: 'absolute',
              left: 14,
              top: 14,
              pointerEvents: 'none',
            }}
          >
            <BrandBadge
              brand={hybridConfig.brandBadge?.text || brand}
              primaryColor={primaryColor}
              inline
            />
          </div>
        ) : null}
      </div>

      {/* 左上角主题标签 */}
      {hybridConfig.topicTag?.enabled !== false ? (
        <TopicTag
          label={hybridConfig.topicTag?.label || '核心解读'}
          currentTime={currentTime}
          subtitles={subtitles}
        />
      ) : null}

      {/* 底部大号字幕 */}
      {hybridConfig.showSubtitles !== false ? (
        <Subtitles
          srtPath={srtPath}
          subtitles={subtitles}
          config={{
            ...(contentOverlay.subtitles || {}),
            maxLines: 2,
            maxCharsPerLine: 22,
            fontSizeLarge: 58,
            fontSizeMedium: 50,
            fontSizeSmall: 44,
            headlineLabel: '',
          }}
          variant="hybrid-bottom"
          heroMoments={heroMoments}
        />
      ) : null}

      {/* 底部线性进度条 */}
      {hybridConfig.showProgressBar !== false && talkingDurationFrames ? (
        <TalkingProgressBar durationFrames={talkingDurationFrames} />
      ) : null}

      {/* 音频波形（进度条上方） */}
      {hybridConfig.showWaveform !== false ? (
        <AudioWaveform audioPath={audioPath} />
      ) : null}
    </AbsoluteFill>
  );
};

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
  brand: string;
  chapters?: Array<{ start: number; end: number; title: string }>;
  heroMoments?: HeroMoment[];
  /** 正文（说话段）总帧数，用于底部进度条；不传则不渲染进度条 */
  talkingDurationFrames?: number;
  /** 画面比例：9:16 竖屏（默认）/ 16:9 横屏（1920×1080 左右分栏）/ 1:1 正方形（1080×1080） */
  aspect?: '9:16' | '16:9' | '1:1';
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
    /** 章节观点卡片整体缩放系数（宽度、内边距、字号同比），默认 1.3 */
    chapterCardScale?: number;
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

// 横屏 16:9 画布（TalkingHeadVideoLandscape）
const LANDSCAPE_WIDTH = 1920;
const LANDSCAPE_HEIGHT = 1080;

// 正方形 1:1 画布（TalkingHeadVideoSquare）
const SQUARE_SIZE = 1080;

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
  brand,
  hybridConfig: rawHybridConfig = {},
  chapters = [],
  heroMoments = [],
  talkingDurationFrames,
  aspect = '9:16',
}) => {
  const { fps } = useVideoConfig();
  const frame = useCurrentFrame();
  const currentTime = frame / fps;

  const preset = HYBRID_PRESETS[rawHybridConfig.preset ?? 'default'] ?? HYBRID_PRESETS.default;
  const hybridConfig = { ...preset, ...rawHybridConfig };

  // 正方形 1:1（1080×1080）复用竖屏上下结构，画布尺寸与默认占比/主播窗口收紧；
  // rawHybridConfig 显式给出的值始终优先（与竖屏行为一致）。
  const isSquare = aspect === '1:1';
  const canvasWidth = isSquare ? SQUARE_SIZE : CANVAS_WIDTH;
  const canvasHeight = isSquare ? SQUARE_SIZE : CANVAS_HEIGHT;

  const mainVisualRatio = rawHybridConfig.mainVisualRatio ?? (isSquare ? 0.5 : (hybridConfig.mainVisualRatio ?? 0.58));
  const mainVisualHeight = Math.round(canvasHeight * mainVisualRatio);
  const hostAreaTop = mainVisualHeight;
  const hostAreaHeight = canvasHeight - mainVisualHeight;

  const hostWidth = rawHybridConfig.hostWindowWidth ?? (isSquare ? 460 : (hybridConfig.hostWindowWidth ?? 560));
  const hostHeight = rawHybridConfig.hostWindowHeight ?? (isSquare ? 480 : (hybridConfig.hostWindowHeight ?? 640));
  const hostBorderRadius = hybridConfig.hostBorderRadius ?? 28;
  const hostLeft = Math.round((canvasWidth - hostWidth) / 2);
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

  // 横屏 16:9（1920×1080）：左侧场景画面列（含章节卡），右侧竖长主播窗口，底部全宽字幕条。
  // 区域常量按画布同比缩放，设计元素（章节卡/洞察卡/字幕/进度条/波形）全部复用竖屏同款组件。
  if (aspect === '16:9') {
    const margin = 40;
    const gap = 32;
    const captionsReserve = 240;
    const hostWidthL = 400;
    const zoneHeight = LANDSCAPE_HEIGHT - margin * 2 - captionsReserve;
    const sceneWidth = LANDSCAPE_WIDTH - margin * 2 - gap - hostWidthL;

    return (
      <AbsoluteFill style={{ background: '#0a0a12' }}>
        {/* 左侧：场景画面列 */}
        <div
          style={{
            position: 'absolute',
            left: margin,
            top: margin,
            width: sceneWidth,
            height: zoneHeight,
            overflow: 'hidden',
            borderRadius: 24,
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
          {/* 顶部章节观点卡片，讲一个落一个；横屏左栏高度有限，最多 3 张避免压到底部字幕 */}
          {hybridConfig.showChapterCards ?? true ? (
            <FallingChapterCards
              chapters={chapters}
              enabled={hybridConfig.showChapterCards ?? true}
              primaryColor={primaryColor}
              position="top-right"
              maxVisible={3}
              cardWidth={480}
              scale={hybridConfig.chapterCardScale ?? 1.3}
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

        {/* 右侧：竖长主播窗口 */}
        <div
          style={{
            position: 'absolute',
            left: margin + sceneWidth + gap,
            top: margin + hostY,
            width: hostWidthL,
            height: zoneHeight,
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

        {/* 底部全宽字幕条（卡片加宽到 1200，贴底预留进度条/波形区） */}
        {hybridConfig.showSubtitles !== false ? (
          <Subtitles
            srtPath={srtPath}
            subtitles={subtitles}
            config={{
              ...(contentOverlay.subtitles || {}),
              maxLines: 2,
              maxCharsPerLine: 30,
              fontSizeLarge: 58,
              fontSizeMedium: 50,
              fontSizeSmall: 44,
              headlineLabel: '',
            }}
            variant="hybrid-bottom"
            heroMoments={heroMoments}
            cardWidth={1200}
            cardMarginBottom={96}
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
  }

  return (
    <AbsoluteFill style={{ background: '#0a0a12' }}>
      {/* 上层：主视觉资料画面 */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: canvasWidth,
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
            scale={hybridConfig.chapterCardScale ?? 1.3}
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

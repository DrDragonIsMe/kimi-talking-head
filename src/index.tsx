import React from 'react';
import { Composition, AbsoluteFill, OffthreadVideo, Html5Audio, staticFile, useCurrentFrame, useVideoConfig, registerRoot, Sequence } from 'remotion';
import type { CalculateMetadataFunction } from 'remotion';
import { DynamicBackground } from './components/DynamicBackground';
import { TalkingPoints } from './components/TalkingPoints';
import { DataBars } from './components/DataBars';
import { QuoteHighlight } from './components/QuoteHighlight';
import { ProductEndcard } from './components/ProductEndcard';
import { LogoWatermark } from './components/LogoWatermark';
import { TitleCard } from './components/TitleCard';
import { PortraitHybridLayout } from './components/PortraitHybridLayout';
import { ProductLaunchLayout } from './components/ProductLaunchLayout';
import type { Chapter } from './components/ProgressBreadcrumb';
import { ContentInteractionPreview } from './components/ContentInteractionPreview';
import { SubtitleCue, HeroMoment } from './hooks/useSubtitles';
import { DEFAULT_OVERLAY_LAYOUT_CONFIG, getActiveCueIndex, getOverlayLayoutPreset } from './utils/overlayLayout';
import type { VideoTemplate } from './themes';
import { getTheme } from './themes';

export interface SceneVisual {
  start: number;
  end: number;
  path: string;
  provider: string;
  /** 素材类型：image（默认）或 video（B-roll 视频） */
  type?: 'image' | 'video';
  /** 视频片段时长（秒），用于 Loop 循环铺满场景 */
  duration?: number;
  prompt?: string;
  query?: string;
  text?: string;
  sourceUrl?: string;
  license?: string;
  author?: string;
  attributionRequired?: boolean;
}

export interface DataBarItem {
  label: string;
  value: string;
  percent: number;
}

export interface QuoteHighlightData {
  quote: string;
  author: string;
  context?: string;
}

export interface VideoLayoutConfig {
  mode: 'talking-head' | 'portrait-hybrid';
  template?: VideoTemplate;
  /** 画面比例：9:16 竖屏（默认，1080×1920）/ 16:9 横屏（1920×1080，TalkingHeadVideoLandscape）/ 1:1 正方形（1080×1080，TalkingHeadVideoSquare） */
  aspect?: '9:16' | '16:9' | '1:1';
  talking_head?: {
    hostPosition?: string;
    hostWindowWidth?: number;
    hostWindowHeight?: number;
    hostBorderRadius?: number;
    showSubtitles?: boolean;
    showTalkingPoints?: boolean;
    showDataBars?: boolean;
    showQuoteHighlight?: boolean;
  };
  hybrid?: {
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

export interface ContentOverlayConfig {
  subtitles: {
    maxLines: number;
    maxCharsPerLine: number;
    fontSizeLarge: number;
    fontSizeMedium: number;
    fontSizeSmall: number;
    headlineLabel: string;
    /** 字幕 DNA：classic（默认整句卡片）/ loud（逐词冲击）/ keynote（发布式揭示） */
    dna?: string;
    segmentation: {
      maxSegmentSeconds: number;
      minSegmentSeconds: number;
      maxVisualLength: number;
    };
  };
  talkingPoints: {
    enabled: boolean;
    maxItems: number;
    mainLabel: string;
    secondaryLabel: string;
  };
  dataBars: {
    enabled: boolean;
    maxItems: number;
    label: string;
    fallbackItems: DataBarItem[];
  };
  quoteHighlight: {
    enabled: boolean;
    label: string;
    fallbackQuote: string;
    fallbackAuthor: string;
  };
  layout: {
    sequence: string[];
    holdCues: number;
  };
}

export type { Chapter } from './components/ProgressBreadcrumb';

export interface CoverMeta {
  summary?: string;
  insight?: string;
  stats?: Array<{
    label: string;
    value: string;
  }>;
}

export const DEFAULT_CONTENT_OVERLAY: ContentOverlayConfig = {
  subtitles: {
    maxLines: 3,
    maxCharsPerLine: 24,
    fontSizeLarge: 56,
    fontSizeMedium: 48,
    fontSizeSmall: 40,
    headlineLabel: '零距离看懂财经',
    segmentation: {
      maxSegmentSeconds: 3.2,
      minSegmentSeconds: 0.9,
      maxVisualLength: 26,
    },
  },
  talkingPoints: {
    enabled: true,
    maxItems: 2,
    mainLabel: '观点拆解',
    secondaryLabel: 'SUPPORTING POINT',
  },
  dataBars: {
    enabled: true,
    maxItems: 5,
    label: '数据条',
    fallbackItems: [],
  },
  quoteHighlight: {
    enabled: true,
    label: '引用高亮',
    fallbackQuote: '',
    fallbackAuthor: '',
  },
  layout: DEFAULT_OVERLAY_LAYOUT_CONFIG,
};

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="TalkingHeadVideo"
        component={TalkingHeadVideo}
        calculateMetadata={talkingHeadMetadata}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={TALKING_HEAD_DEFAULT_PROPS}
      />
      {/* 横屏 16:9：同一根组件，videoLayout.aspect 驱动 PortraitHybridLayout/TitleCard 的横屏分支 */}
      <Composition
        id="TalkingHeadVideoLandscape"
        component={TalkingHeadVideo}
        calculateMetadata={talkingHeadMetadata}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{
          ...TALKING_HEAD_DEFAULT_PROPS,
          videoLayout: {
            ...TALKING_HEAD_DEFAULT_PROPS.videoLayout!,
            aspect: '16:9',
          },
        }}
      />
      {/* 正方形 1:1：同一根组件，videoLayout.aspect 驱动 PortraitHybridLayout/TitleCard 的正方形分支 */}
      <Composition
        id="TalkingHeadVideoSquare"
        component={TalkingHeadVideo}
        calculateMetadata={talkingHeadMetadata}
        fps={30}
        width={1080}
        height={1080}
        defaultProps={{
          ...TALKING_HEAD_DEFAULT_PROPS,
          videoLayout: {
            ...TALKING_HEAD_DEFAULT_PROPS.videoLayout!,
            aspect: '1:1',
          },
        }}
      />
      <Composition
        id="ContentInteractionPreview"
        component={ContentInteractionPreview}
        fps={30}
        width={1080}
        height={1920}
        durationInFrames={1}
        defaultProps={{
          hostVideoPath: 'host_video.mp4',
          sceneVisuals: [],
          subtitles: [],
        }}
      />
    </>
  );
};

const TalkingHeadVideo: React.FC<{
  audioPath: string;
  srtPath: string;
  subtitles: SubtitleCue[];
  hostVideoPath: string;
  title: string;
  subtitle: string;
  brand: string;
  tagline: string;
  slogan?: string | string[];
  cta?: string;
  pills: string[];
  features?: string[];
  coverMeta?: CoverMeta;
  sceneVisuals: SceneVisual[];
  dataBars: DataBarItem[];
  quoteHighlight: QuoteHighlightData | null;
  chapters?: Chapter[];
  heroMoments?: HeroMoment[];
  /** BGM 在 public/ 下的相对路径；null 表示不启用 */
  bgmPath?: string | null;
  bgmVolume?: number;
  /** hero 入场音效在 public/ 下的相对路径；null 表示不启用 */
  sfxHeroPath?: string | null;
  sfxVolume?: number;
  contentOverlay?: ContentOverlayConfig;
  videoLayout?: VideoLayoutConfig;
  template?: VideoTemplate;
  titleCardDurationFrames: number;
  talkingDurationFrames: number;
  endcardDurationFrames: number;
  totalDurationFrames: number;
  primaryColor: string;
  secondaryColor: string;
}> = ({
  audioPath,
  srtPath,
  subtitles,
  hostVideoPath,
  title,
  subtitle,
  brand,
  tagline,
  slogan,
  cta,
  pills,
  features = [],
  coverMeta,
  sceneVisuals,
  dataBars,
  quoteHighlight,
  chapters,
  heroMoments = [],
  bgmPath = null,
  bgmVolume = 0,
  sfxHeroPath = null,
  sfxVolume = 0.5,
  contentOverlay = DEFAULT_CONTENT_OVERLAY,
  videoLayout = { mode: 'talking-head' },
  template = 'editorial',
  titleCardDurationFrames,
  talkingDurationFrames,
  endcardDurationFrames,
  totalDurationFrames,
  primaryColor,
  secondaryColor,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const talkingStartFrame = titleCardDurationFrames;
  const endcardStartFrame = talkingStartFrame + talkingDurationFrames;

  const isTitleCard = frame < talkingStartFrame;
  const isEndcard = frame >= endcardStartFrame;
  const isHybrid = videoLayout.mode === 'portrait-hybrid';
  const aspect = videoLayout.aspect ?? '9:16';
  const isProductLaunch = template === 'product-launch' || videoLayout.template === 'product-launch';
  const theme = getTheme(isProductLaunch ? 'product-launch' : 'editorial');

  return (
    <AbsoluteFill style={{ background: '#FAFAF7' }}>
      {bgmPath ? (
        <Html5Audio
          src={staticFile(bgmPath)}
          loop
          volume={(f) => {
            const base = Math.max(0, Math.min(1, bgmVolume));
            const fadeIn = Math.min(1, f / 30);
            const fadeOut = Math.min(1, Math.max(0, (totalDurationFrames - f) / 60));
            return base * fadeIn * fadeOut;
          }}
        />
      ) : null}
      {isTitleCard ? (
        <TitleCard
          title={title}
          subtitle={subtitle}
          durationFrames={titleCardDurationFrames}
          primaryColor={primaryColor}
          secondaryColor={secondaryColor}
          brand={brand}
          tagline={tagline}
          pills={pills}
          coverMeta={coverMeta}
          hostVideoPath={hostVideoPath}
          template={isProductLaunch ? 'product-launch' : 'editorial'}
          theme={theme}
          sceneVisuals={sceneVisuals}
          features={features}
          aspect={aspect}
        />
      ) : !isEndcard ? (
        // Wrap audio and host video layouts in the same Sequence so they share
        // a relative timeline starting at media time 0.
        <Sequence from={talkingStartFrame}>
          <Html5Audio src={staticFile(audioPath)} />
          {sfxHeroPath
            ? heroMoments.map((moment, index) => (
                <Sequence
                  key={`hero-sfx-${index}`}
                  from={Math.max(0, Math.round(moment.start * fps))}
                >
                  <Html5Audio src={staticFile(sfxHeroPath)} volume={sfxVolume} />
                </Sequence>
              ))
            : null}
          {isProductLaunch ? (
            <ProductLaunchLayout
              audioPath={audioPath}
              srtPath={srtPath}
              subtitles={subtitles}
              hostVideoPath={hostVideoPath}
              sceneVisuals={sceneVisuals}
              features={features}
              theme={theme}
              primaryColor={primaryColor}
              secondaryColor={secondaryColor}
              contentOverlay={contentOverlay}
              heroMoments={heroMoments}
            />
          ) : isHybrid ? (
            <PortraitHybridLayout
              audioPath={audioPath}
              srtPath={srtPath}
              subtitles={subtitles}
              hostVideoPath={hostVideoPath}
              sceneVisuals={sceneVisuals}
              contentOverlay={contentOverlay}
              primaryColor={primaryColor}
              brand={brand}
              chapters={chapters}
              heroMoments={heroMoments}
              talkingDurationFrames={talkingDurationFrames}
              hybridConfig={videoLayout.hybrid}
              aspect={aspect}
            />
          ) : (
            <TalkingHeadClassicLayout
              srtPath={srtPath}
              subtitles={subtitles}
              hostVideoPath={hostVideoPath}
              sceneVisuals={sceneVisuals}
              dataBars={dataBars}
              quoteHighlight={quoteHighlight}
              contentOverlay={contentOverlay}
            />
          )}
        </Sequence>
      ) : (
        <ProductEndcard
          startFrame={endcardStartFrame}
          durationFrames={endcardDurationFrames}
          brand={brand}
          tagline={tagline}
          slogan={slogan || ['把人力数据', '变成组织决策']}
          cta={cta || '看薪灵如何重构你的人力系统'}
          pills={pills}
          primaryColor={primaryColor}
          secondaryColor={secondaryColor}
          theme={isProductLaunch ? theme : undefined}
        />
      )}

      {!isTitleCard && !isEndcard && !isHybrid ? <LogoWatermark /> : null}
    </AbsoluteFill>
  );
};

const TalkingHeadClassicLayout: React.FC<{
  srtPath: string;
  subtitles: SubtitleCue[];
  hostVideoPath: string;
  sceneVisuals: SceneVisual[];
  dataBars: DataBarItem[];
  quoteHighlight: QuoteHighlightData | null;
  contentOverlay?: ContentOverlayConfig;
}> = ({
  srtPath,
  subtitles,
  hostVideoPath,
  sceneVisuals,
  dataBars,
  quoteHighlight,
  contentOverlay = DEFAULT_CONTENT_OVERLAY,
}) => {
  const frame = useCurrentFrame();
  const currentTime = frame / 30;
  const currentCueIndex = getActiveCueIndex(subtitles, currentTime);
  const overlayLayout = getOverlayLayoutPreset(currentCueIndex, contentOverlay.layout);

  return (
    <>
      <DynamicBackground
        srtPath={srtPath}
        subtitles={subtitles}
        sceneVisuals={sceneVisuals}
        layout={contentOverlay.layout}
      />

      <div
        style={{
          position: 'absolute',
          left: overlayLayout.hostWindow.left,
          top: overlayLayout.hostWindow.top,
          width: overlayLayout.hostWindow.width,
          height: overlayLayout.hostWindow.height,
          borderRadius: 28,
          overflow: 'hidden',
          background: '#EDF1F0',
          border: '1px solid rgba(21,26,25,0.08)',
          boxShadow: '0 22px 40px rgba(21,26,25,0.08)',
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
            background: 'linear-gradient(180deg, rgba(250,250,247,0.02) 0%, rgba(21,26,25,0.04) 45%, rgba(21,26,25,0.18) 100%)',
          }}
        />
        <div
          style={{
            position: 'absolute',
            left: 18,
            top: 18,
            padding: '8px 12px',
            borderRadius: 999,
            background: 'rgba(250,250,247,0.9)',
            color: '#151A19',
            fontSize: 15,
            fontWeight: 700,
            letterSpacing: 1,
            border: '1px solid rgba(21,26,25,0.08)',
          }}
        >
          核心解读
        </div>
      </div>

      {/* 字幕与知识观点卡片内容有重叠，暂时不渲染字幕，保留 Subtitles 组件用法（重新启用时需恢复 import） */}
      {/* <Subtitles
        srtPath={srtPath}
        subtitles={subtitles}
        config={contentOverlay.subtitles}
        layout={contentOverlay.layout}
      /> */}

      <TalkingPoints
        srtPath={srtPath}
        subtitles={subtitles}
        config={contentOverlay.talkingPoints}
        layout={contentOverlay.layout}
      />

      <DataBars
        srtPath={srtPath}
        subtitles={subtitles}
        items={dataBars}
        config={contentOverlay.dataBars}
        layout={contentOverlay.layout}
      />

      <QuoteHighlight
        srtPath={srtPath}
        subtitles={subtitles}
        data={quoteHighlight}
        config={contentOverlay.quoteHighlight}
        layout={contentOverlay.layout}
      />
    </>
  );
};

type TalkingHeadProps = React.ComponentProps<typeof TalkingHeadVideo>;

// 竖屏/横屏/正方形三个 composition 共用同一份默认 props 与时长推导，仅 videoLayout.aspect 不同。
// 内容与历史上的 TalkingHeadVideo defaultProps 完全一致（视觉回归基线保持不变）。
const TALKING_HEAD_DEFAULT_PROPS: TalkingHeadProps = {
  audioPath: 'audio.wav',
  srtPath: 'subtitles.srt',
  subtitles: [],
  hostVideoPath: 'host_video.mp4',
  title: '视频标题',
  subtitle: '',
  brand: '薪灵AI',
  tagline: '薪人薪事的AI引擎',
  pills: ['文章转视频', '声音克隆', '唇形同步', '自动字幕'],
  features: [],
  slogan: '',
  cta: '',
  coverMeta: {
    summary: '',
    insight: '',
    stats: [],
  },
  sceneVisuals: [],
  dataBars: [],
  quoteHighlight: null,
  chapters: [],
  heroMoments: [],
  bgmPath: null,
  bgmVolume: 0,
  sfxHeroPath: null,
  sfxVolume: 0.5,
  contentOverlay: DEFAULT_CONTENT_OVERLAY,
  videoLayout: {
    mode: 'portrait-hybrid',
    template: 'editorial',
    hybrid: {
      mainVisualRatio: 0.58,
      hostWindowWidth: 560,
      hostWindowHeight: 640,
      showSubtitles: true,
      showTalkingPoints: true,
      topicTag: { enabled: true, label: '核心解读' },
      brandBadge: { enabled: true },
    },
  },
  titleCardDurationFrames: 60,
  talkingDurationFrames: 600,
  endcardDurationFrames: 180,
  totalDurationFrames: 840,
  primaryColor: '#00b498',
  secondaryColor: '#00d4c8',
};

const talkingHeadMetadata: CalculateMetadataFunction<TalkingHeadProps> = ({ props }) => {
  const typedProps = props as {
    totalDurationFrames?: number;
    titleCardDurationFrames?: number;
    talkingDurationFrames?: number;
    endcardDurationFrames?: number;
  };

  const fallbackDuration =
    (typedProps.titleCardDurationFrames ?? 60) +
    (typedProps.talkingDurationFrames ?? 600) +
    (typedProps.endcardDurationFrames ?? 180);

  return {
    durationInFrames: typedProps.totalDurationFrames ?? fallbackDuration,
  };
};

registerRoot(RemotionRoot);

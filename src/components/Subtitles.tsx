import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import { useSubtitles, SubtitleCue, HeroMoment } from '../hooks/useSubtitles';
import { matchSceneStyle, extractHighlightWords, formatSubtitleLines, normalizeDisplayText, getVisualLength } from '../utils/keywordMatcher';
import { getActiveCueIndex, getOverlayLayoutPreset, OverlayLayoutConfig } from '../utils/overlayLayout';
import { getCaptionDna } from '../themes/captions';
import { KaraokeSubtitles } from './KaraokeSubtitles';
import { HeroOverlay } from './HeroOverlay';
import { inkAlpha, Z } from '../themes/tokens';
import type { ContentOverlayConfig } from '../index';

const CREAM = '#FAFAF7';
const TILE_STRONG = '#E3E9E7';
const INK = '#151A19';

/**
 * hybrid-bottom 字幕卡片默认宽 960px（可用 cardWidth 覆盖，横屏 16:9 用 1200）、水平 padding 各 36px。
 * 换行预算与字号选择都按这个像素宽度推导：whiteSpace 为 nowrap 的行一旦超过
 * 可用宽度就不会居中，而是钉在左缘向右溢出（看起来整条字幕偏右、甚至被裁掉）。
 */
const HYBRID_CARD_HORIZONTAL_PADDING = 36;
/** 与文本容器 letterSpacing 一致，估算行像素宽度时计入 */
const LETTER_SPACING_PX = 0.5;

interface SubtitlesProps {
  srtPath: string;
  subtitles?: SubtitleCue[];
  config: ContentOverlayConfig['subtitles'];
  layout?: OverlayLayoutConfig;
  variant?: 'default' | 'hybrid-bottom';
  heroMoments?: HeroMoment[];
  /** hybrid-bottom 卡片像素宽（默认 960；横屏 16:9 传 1200） */
  cardWidth?: number;
  /** hybrid-bottom 卡片距画布底部的像素（默认 160） */
  cardMarginBottom?: number;
}

export const Subtitles: React.FC<SubtitlesProps> = ({ srtPath, subtitles, config, layout, variant = 'default', heroMoments, cardWidth, cardMarginBottom }) => {
  const { fps } = useVideoConfig();
  const frame = useCurrentFrame();
  const currentTime = frame / fps;
  const loadedSubtitles = subtitles || useSubtitles(srtPath);

  const currentCue = loadedSubtitles.find(
    cue => currentTime >= cue.start && currentTime <= cue.end
  );
  const currentCueIndex = getActiveCueIndex(loadedSubtitles, currentTime);
  const overlayLayout = getOverlayLayoutPreset(currentCueIndex, layout);
  const isHybridBottom = variant === 'hybrid-bottom';
  const hybridCardWidth = cardWidth ?? 960;
  const hybridContentWidth = hybridCardWidth - HYBRID_CARD_HORIZONTAL_PADDING * 2;

  // 词级 DNA：选了非 classic 且当前 cue 带词级时间戳（或有 hero 时刻）时走 karaoke 渲染
  const dna = getCaptionDna(config.dna);
  const activeHero =
    heroMoments?.find((h) => currentTime >= h.start - 0.2 && currentTime <= h.end + 1.8) ?? null;
  if (dna.wordReveal !== 'none') {
    if ((currentCue?.words?.length ?? 0) > 0 || activeHero) {
      return (
        <KaraokeSubtitles
          cue={currentCue ?? null}
          dna={dna}
          hero={activeHero}
          fontSize={config.fontSizeLarge}
        />
      );
    }
  }

  if (!currentCue && !activeHero) return null;

  // hero 时刻没有字幕 cue（台词间隙）时，仅渲染 hero 层
  if (!currentCue) {
    return <HeroOverlay hero={activeHero} dna={dna} />;
  }

  const style = matchSceneStyle(currentCue.text);
  const normalizedText = normalizeDisplayText(currentCue.text);
  const highlightWords = extractHighlightWords(normalizedText, style)
    .sort((a, b) => normalizedText.indexOf(a) - normalizedText.indexOf(b));
  // hybrid-bottom：按最小档字号推导每行最多容纳的视觉字数，保证任何一行都放得进卡片
  const wrapBudget = isHybridBottom
    ? Math.max(10, Math.floor(hybridContentWidth / (config.fontSizeSmall + LETTER_SPACING_PX)))
    : Math.max(10, config.maxCharsPerLine - 1);
  const subtitleLines = formatSubtitleLines(
    normalizedText,
    normalizedText.length > config.maxCharsPerLine ? config.maxLines : Math.min(2, config.maxLines),
    wrapBudget
  );

  let fontSize: number;
  if (isHybridBottom) {
    // 按最长行的像素宽度选字号：能放进卡片就用更大的档位
    const longestLine = subtitleLines.reduce(
      (longest, line) => (getVisualLength(line) > getVisualLength(longest) ? line : longest),
      ''
    );
    const fitsLine = (size: number) =>
      getVisualLength(longestLine) * (size + LETTER_SPACING_PX) <= hybridContentWidth;
    fontSize = fitsLine(config.fontSizeLarge)
      ? config.fontSizeLarge
      : fitsLine(config.fontSizeMedium)
        ? config.fontSizeMedium
        : config.fontSizeSmall;
  } else {
    const longestLineLength = Math.max(...subtitleLines.map((line) => line.length), normalizedText.length);
    fontSize = longestLineLength > config.maxCharsPerLine
      ? config.fontSizeSmall
      : longestLineLength > 18
        ? config.fontSizeMedium
        : config.fontSizeLarge;
  }

  const renderHighlightedLine = (text: string) => {
    let result: React.ReactNode[] = [];
    let remaining = text;
    let keyIndex = 0;

    for (const word of highlightWords) {
      const idx = remaining.indexOf(word);
      if (idx !== -1) {
        if (idx > 0) {
          result.push(
            <span key={`n-${keyIndex++}`} style={{ color: isHybridBottom ? '#ffffff' : INK }}>
              {remaining.slice(0, idx)}
            </span>
          );
        }

        result.push(
          <span
            key={`h-${keyIndex++}`}
            style={{
              color: style.accentColor,
              fontWeight: 800,
              textShadow: 'none',
            }}
          >
            {word}
          </span>
        );

        remaining = remaining.slice(idx + word.length);
      }
    }

    if (remaining.length > 0) {
      result.push(
        <span key={`n-${keyIndex++}`} style={{ color: isHybridBottom ? '#ffffff' : INK }}>
          {remaining}
        </span>
      );
    }

    return result;
  };

  return (
    <>
      <AbsoluteFill
        style={{
          justifyContent: isHybridBottom ? 'flex-end' : 'flex-start',
          alignItems: isHybridBottom ? 'center' : 'flex-start',
          paddingTop: isHybridBottom ? 0 : overlayLayout.subtitles.top,
          paddingLeft: isHybridBottom ? 0 : overlayLayout.subtitles.left,
          paddingBottom: isHybridBottom ? 0 : 0,
          pointerEvents: 'none',
          zIndex: Z.captions, // 高于 FallingChapterCards 的 cards 层，避免字幕被章节卡遮挡
        }}
      >
        <div style={{ width: isHybridBottom ? hybridCardWidth : overlayLayout.subtitles.width, marginBottom: isHybridBottom ? (cardMarginBottom ?? 160) : 0 }}>
          {!isHybridBottom ? (
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 12,
                padding: '10px 16px',
                background: `${CREAM}ee`,
                borderRadius: 999,
                border: '1px solid rgba(21,26,25,0.08)',
                boxShadow: '0 10px 28px rgba(21,26,25,0.08)',
                backdropFilter: 'blur(12px)',
              }}
            >
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  background: style.accentColor,
                  boxShadow: `0 0 12px ${style.accentColor}`,
                }}
              />
              <span
                style={{
                  color: INK,
                  fontSize: 18,
                  fontWeight: 700,
                  letterSpacing: 1.5,
                }}
              >
                {config.headlineLabel} · {style.label}
              </span>
            </div>
          ) : null}

          <div
            style={{
              marginTop: isHybridBottom ? 0 : 18,
              position: 'relative',
              padding: isHybridBottom ? '18px 36px 28px' : '26px 30px 28px',
              background: isHybridBottom ? 'rgba(10,10,18,0.88)' : CREAM,
              borderRadius: isHybridBottom ? 24 : 26,
              boxShadow: isHybridBottom ? `0 24px 60px ${inkAlpha(0.55)}` : '0 24px 50px rgba(21,26,25,0.08)',
              border: isHybridBottom ? '1px solid rgba(255,255,255,0.14)' : '1px solid rgba(21,26,25,0.08)',
              backdropFilter: 'blur(16px)',
              textAlign: isHybridBottom ? 'center' : 'left',
            }}
          >
            {!isHybridBottom ? (
              <div
                style={{
                  position: 'absolute',
                  left: 30,
                  top: 0,
                  width: 160,
                  height: 5,
                  borderRadius: 999,
                  background: style.accentColor,
                  boxShadow: `0 0 18px ${style.accentColor}60`,
                }}
              />
            ) : null}
            <div
              style={{
                fontFamily: '"Noto Sans SC", "PingFang SC", sans-serif',
                fontWeight: 900,
                lineHeight: 1.18,
                letterSpacing: 0.5,
                color: isHybridBottom ? '#ffffff' : INK,
                textAlign: isHybridBottom ? 'center' : 'left',
                textShadow: isHybridBottom ? `0 2px 24px ${inkAlpha(0.75)}` : 'none',
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
                width: '100%',
                overflow: 'visible',
              }}
            >
              {subtitleLines.map((line, index) => (
                <div
                  key={`${index}-${line}`}
                  style={{
                    fontSize,
                    lineHeight: 1.32,
                    minHeight: fontSize * 1.38,
                    maxWidth: '100%',
                    overflow: 'visible',
                    whiteSpace: 'nowrap',
                    paddingRight: '0.16em',
                    boxSizing: 'border-box',
                  }}
                >
                  {renderHighlightedLine(line)}
                </div>
              ))}
            </div>
            {!isHybridBottom ? (
              <div
                style={{
                  marginTop: 18,
                  height: 1,
                  background: `linear-gradient(90deg, ${style.accentColor}55 0%, ${TILE_STRONG} 100%)`,
                }}
              />
            ) : null}
          </div>
        </div>
      </AbsoluteFill>

      {/* hero 关键词 pop：classic 路径也必须渲染，与入场音效对应 */}
      <HeroOverlay hero={activeHero} dna={dna} />
    </>
  );
};

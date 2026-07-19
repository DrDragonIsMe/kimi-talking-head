import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, Easing } from 'remotion';
import type { SubtitleCue, HeroMoment } from '../hooks/useSubtitles';
import type { CaptionDna } from '../themes/captions';
import { inkAlpha, Z } from '../themes/tokens';
import { HeroOverlay, computeHeroState } from './HeroOverlay';

interface KaraokeSubtitlesProps {
  cue: SubtitleCue | null;
  dna: CaptionDna;
  hero: HeroMoment | null;
  fontSize: number;
}

/**
 * 词级卡拉 OK 字幕渲染器。
 * 全部动效由 frame + interpolate 驱动：确定性、可 seek、无 CSS transition。
 * hero 关键词层由 HeroOverlay 统一渲染（与 classic 字幕路径共享）。
 */
export const KaraokeSubtitles: React.FC<KaraokeSubtitlesProps> = ({ cue, dna, hero, fontSize }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const currentTime = frame / fps;

  const { colors, motion, hero: heroDna } = dna;

  // hero 时间轴与 HeroOverlay 共享，用于压暗字幕卡片
  const { progress: heroProgress, exit: heroExit } = computeHeroState(hero, currentTime, heroDna);

  // ---- 词序列 ----
  const words = cue?.words ?? [];
  let currentWordIndex = -1;
  for (let i = 0; i < words.length; i++) {
    if (currentTime >= words[i].start) currentWordIndex = i;
  }

  const wordInFrames = Math.max(1, motion.wordInSeconds * fps);
  const isPop = dna.wordReveal === 'pop';

  const captionOpacity = 1 - (1 - heroDna.dimOpacity) * heroProgress * (1 - heroExit);

  return (
    <>
      <AbsoluteFill
        style={{
          justifyContent: 'flex-end',
          alignItems: 'center',
          paddingBottom: 160,
          pointerEvents: 'none',
          zIndex: Z.captions, // 必须高于 FallingChapterCards 的 cards 层，否则 hero/字幕被章节卡遮挡
        }}
      >
        {words.length > 0 ? (
          <div
            style={{
              width: 920,
              padding: '24px 36px 32px',
              background: colors.cardBackground,
              borderRadius: 24,
              border: `1px solid ${colors.cardBorder}`,
              boxShadow: `0 24px 60px ${inkAlpha(0.55)}`,
              opacity: captionOpacity,
              display: 'flex',
              flexWrap: 'wrap',
              justifyContent: 'center',
              rowGap: 16,
            }}
          >
            {words.map((word, index) => {
              const appearFrame = word.start * fps;
              const progress = interpolate(frame, [appearFrame, appearFrame + wordInFrames], [0, 1], {
                extrapolateLeft: 'clamp',
                extrapolateRight: 'clamp',
                easing: isPop ? Easing.out(Easing.back(1.6)) : Easing.out(Easing.cubic),
              });
              if (progress <= 0) {
                // 未说出的词保持隐藏，但占位以稳定排版
                return (
                  <span
                    key={`${index}-${word.text}`}
                    style={{
                      fontFamily: dna.fontFamily,
                      fontWeight: dna.fontWeight,
                      fontSize,
                      lineHeight: 1.3,
                      margin: '0 0.14em',
                      opacity: 0,
                    }}
                  >
                    {word.text}
                  </span>
                );
              }

              const isCurrent = index === currentWordIndex;
              const entranceScale = motion.fromScale + (1 - motion.fromScale) * progress;
              const scale = entranceScale * (isCurrent ? motion.currentScale : 1);
              const translateY = (1 - progress) * motion.fromY;
              const translateX = (1 - progress) * motion.fromX;

              return (
                <span
                  key={`${index}-${word.text}`}
                  style={{
                    fontFamily: dna.fontFamily,
                    fontWeight: dna.fontWeight,
                    fontSize,
                    lineHeight: 1.3,
                    margin: '0 0.14em',
                    color: isCurrent ? colors.accent : colors.text,
                    opacity: progress,
                    transform: `translate(${translateX}px, ${translateY}px) scale(${scale})`,
                    transformOrigin: 'center bottom',
                    clipPath:
                      dna.wordReveal === 'wipe'
                        ? `inset(0 ${(1 - progress) * 100}% 0 0)`
                        : undefined,
                    textShadow:
                      isCurrent && motion.currentGlow > 0
                        ? `0 0 ${Math.round(28 * motion.currentGlow)}px ${colors.accent}`
                        : `0 2px 18px ${inkAlpha(0.6)}`,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {word.text}
                </span>
              );
            })}
          </div>
        ) : null}
      </AbsoluteFill>

      <HeroOverlay hero={hero} dna={dna} />
    </>
  );
};

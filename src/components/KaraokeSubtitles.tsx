import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, Easing } from 'remotion';
import type { SubtitleCue, HeroMoment } from '../hooks/useSubtitles';
import type { CaptionDna } from '../themes/captions';

interface KaraokeSubtitlesProps {
  cue: SubtitleCue | null;
  dna: CaptionDna;
  hero: HeroMoment | null;
  fontSize: number;
}

/** hero 提前压暗的秒数，让入场有铺垫 */
const HERO_PRE_ROLL_SECONDS = 0.12;

/**
 * 词级卡拉 OK 字幕渲染器。
 * 全部动效由 frame + interpolate 驱动：确定性、可 seek、无 CSS transition。
 */
export const KaraokeSubtitles: React.FC<KaraokeSubtitlesProps> = ({ cue, dna, hero, fontSize }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const currentTime = frame / fps;

  const { colors, motion, hero: heroDna } = dna;

  // ---- hero 时刻 ----
  let heroProgress = 0; // 0 = 无 hero，1 = hero 完整呈现
  let heroExit = 0; // 0 = 未退出，1 = 完全退出
  let heroVisible = false;
  if (hero) {
    const entranceStart = hero.start - HERO_PRE_ROLL_SECONDS;
    const entranceEnd = hero.start + heroDna.entranceSeconds;
    const exitStart = hero.end + heroDna.holdSeconds;
    const exitEnd = exitStart + heroDna.exitSeconds;
    heroVisible = currentTime >= entranceStart && currentTime <= exitEnd;
    if (heroVisible) {
      heroProgress = interpolate(currentTime, [entranceStart, entranceEnd], [0, 1], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
        easing: Easing.out(Easing.cubic),
      });
      heroExit = interpolate(currentTime, [exitStart, exitEnd], [0, 1], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
        easing: Easing.in(Easing.cubic),
      });
    }
  }

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
        }}
      >
        {words.length > 0 ? (
          <div
            style={{
              width: 920,
              padding: '20px 36px 30px',
              background: colors.cardBackground,
              borderRadius: 24,
              border: `1px solid ${colors.cardBorder}`,
              boxShadow: '0 24px 60px rgba(0,0,0,0.55)',
              opacity: captionOpacity,
              display: 'flex',
              flexWrap: 'wrap',
              justifyContent: 'center',
              rowGap: 14,
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
                    transform: `translateY(${translateY}px) scale(${scale})`,
                    transformOrigin: 'center bottom',
                    clipPath:
                      dna.wordReveal === 'wipe'
                        ? `inset(0 ${(1 - progress) * 100}% 0 0)`
                        : undefined,
                    textShadow:
                      isCurrent && motion.currentGlow > 0
                        ? `0 0 ${Math.round(28 * motion.currentGlow)}px ${colors.accent}`
                        : '0 2px 18px rgba(0,0,0,0.6)',
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

      {heroVisible && hero ? (
        <AbsoluteFill
          style={{
            justifyContent: 'center',
            alignItems: 'center',
            pointerEvents: 'none',
          }}
        >
          <AbsoluteFill
            style={{
              background: `rgba(0,0,0,${(heroDna.scrimOpacity * heroProgress * (1 - heroExit)).toFixed(3)})`,
            }}
          />
          <HeroText dna={dna} hero={hero} progress={heroProgress} exit={heroExit} currentTime={currentTime} />
        </AbsoluteFill>
      ) : null}
    </>
  );
};

const HeroText: React.FC<{
  dna: CaptionDna;
  hero: HeroMoment;
  progress: number;
  exit: number;
  currentTime: number;
}> = ({ dna, hero, progress, exit, currentTime }) => {
  const heroDna = dna.hero;
  const holdTime = Math.max(0, currentTime - hero.start);

  let transform = '';
  let clipPath: string | undefined;

  if (heroDna.entrance === 'pop') {
    const scale = 1.6 + (1 - 1.6) * progress;
    transform = `scale(${scale})`;
  } else {
    // wipe-up：clip-path 揭示 + 轻微上移，缩放通道留给呼吸
    clipPath = `inset(${(1 - progress) * 100}% 0 0 0)`;
    transform = `translateY(${(1 - progress) * 48}px)`;
  }

  if (heroDna.breathe > 0 && progress >= 1 && exit <= 0) {
    const breatheScale = 1 + heroDna.breathe * Math.sin(holdTime * Math.PI * 2 * 1.1);
    transform += ` scale(${breatheScale})`;
  }
  if (exit > 0) {
    transform += ` scale(${1 - 0.12 * exit}) translateY(${-24 * exit}px)`;
  }

  return (
    <div
      style={{
        fontFamily: dna.fontFamily,
        fontWeight: dna.heroFontWeight,
        fontSize: heroDna.fontSize,
        lineHeight: 1.2,
        letterSpacing: 2,
        color: dna.colors.heroText,
        textAlign: 'center',
        maxWidth: 940,
        padding: '0 40px',
        opacity: progress * (1 - exit),
        transform,
        clipPath,
        textShadow:
          heroDna.glow > 0
            ? `0 0 ${Math.round(60 * heroDna.glow)}px ${dna.colors.accent}, 0 4px 30px rgba(0,0,0,0.8)`
            : '0 4px 30px rgba(0,0,0,0.8)',
      }}
    >
      {hero.text}
    </div>
  );
};

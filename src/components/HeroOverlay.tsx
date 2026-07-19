import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, Easing } from 'remotion';
import type { HeroMoment } from '../hooks/useSubtitles';
import type { CaptionDna } from '../themes/captions';
import { inkAlpha, Z } from '../themes/tokens';

/** hero 提前压暗的秒数，让入场有铺垫 */
const HERO_PRE_ROLL_SECONDS = 0.12;

export interface HeroState {
  /** 0 = 无 hero，1 = hero 完整呈现 */
  progress: number;
  /** 0 = 未退出，1 = 完全退出 */
  exit: number;
  visible: boolean;
}

/**
 * hero 入场/驻留/退场的统一时间轴。
 * hero 本体（HeroOverlay）与字幕压暗（KaraokeSubtitles 的 dimOpacity）共用同一份计算，
 * 避免两处各算一遍导致节拍漂移。
 */
export function computeHeroState(
  hero: HeroMoment | null,
  currentTime: number,
  heroDna: CaptionDna['hero']
): HeroState {
  if (!hero) {
    return { progress: 0, exit: 0, visible: false };
  }
  const entranceStart = hero.start - HERO_PRE_ROLL_SECONDS;
  const entranceEnd = hero.start + heroDna.entranceSeconds;
  const exitStart = hero.end + heroDna.holdSeconds;
  const exitEnd = exitStart + heroDna.exitSeconds;
  const visible = currentTime >= entranceStart && currentTime <= exitEnd;
  if (!visible) {
    return { progress: 0, exit: 0, visible: false };
  }
  return {
    visible: true,
    progress: interpolate(currentTime, [entranceStart, entranceEnd], [0, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
      easing: Easing.out(Easing.cubic),
    }),
    exit: interpolate(currentTime, [exitStart, exitEnd], [0, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
      easing: Easing.in(Easing.cubic),
    }),
  };
}

/**
 * hero 关键词pop层：全屏压暗 scrim + 居中大字。
 * 独立于具体字幕 DNA 渲染——只要 storyboard 产出了 hero_moments 且配置了入场音效，
 * 任何字幕路径（karaoke / classic）都必须能看到它，否则会出现"只听其声不见其字"。
 */
export const HeroOverlay: React.FC<{ hero: HeroMoment | null; dna: CaptionDna }> = ({ hero, dna }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const currentTime = frame / fps;
  const { visible, progress, exit } = computeHeroState(hero, currentTime, dna.hero);

  if (!visible || !hero) return null;

  return (
    <AbsoluteFill
      style={{
        justifyContent: 'center',
        alignItems: 'center',
        pointerEvents: 'none',
        zIndex: Z.hero,
      }}
    >
      <AbsoluteFill
        style={{
          background: inkAlpha(Number((dna.hero.scrimOpacity * progress * (1 - exit)).toFixed(3))),
        }}
      />
      <HeroText dna={dna} hero={hero} progress={progress} exit={exit} currentTime={currentTime} />
    </AbsoluteFill>
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
    const scale = heroDna.fromScale + (1 - heroDna.fromScale) * progress;
    const riseY = (1 - progress) * heroDna.fromY;
    transform = `scale(${scale}) translateY(${riseY}px)`;
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
        fontStyle: dna.heroFontStyle ?? 'normal',
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
            ? `0 0 ${Math.round(60 * heroDna.glow)}px ${dna.colors.accent}, 0 4px 30px ${inkAlpha(0.8)}`
            : `0 4px 30px ${inkAlpha(0.8)}`,
      }}
    >
      {hero.text}
    </div>
  );
};

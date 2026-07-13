import React from 'react';
import { interpolate, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { useSubtitles, SubtitleCue } from '../hooks/useSubtitles';
import { matchSceneStyle, extractTalkingPoints } from '../utils/keywordMatcher';
import { getActiveCueIndex, getOverlayLayoutPreset, OverlayLayoutConfig } from '../utils/overlayLayout';
import { ChartLines } from './effects/ChartLines';
import { PulseWarning } from './effects/PulseWarning';
import { GridFlow } from './effects/GridFlow';
import { WarmGlow } from './effects/WarmGlow';
import { CyberParticles } from './effects/CyberParticles';

const CREAM = '#FAFAF7';
const TILE = '#EDF1F0';
const TILE_STRONG = '#E3E9E7';

const EFFECT_COMPONENTS = {
  'chart-lines': ChartLines,
  'pulse-warning': PulseWarning,
  'grid-flow': GridFlow,
  'warm-glow': WarmGlow,
  'cyber-particles': CyberParticles,
};

interface DynamicBackgroundProps {
  srtPath: string;
  subtitles?: SubtitleCue[];
  layout?: OverlayLayoutConfig;
  sceneVisuals?: Array<{
    start: number;
    end: number;
    path: string;
    provider: string;
    query?: string;
    license?: string;
  }>;
  variant?: 'default' | 'hero';
}

export const DynamicBackground: React.FC<DynamicBackgroundProps> = ({ srtPath, subtitles, layout, sceneVisuals = [], variant = 'default' }) => {
  const { fps } = useVideoConfig();
  const frame = useCurrentFrame();
  const currentTime = frame / fps;
  const loadedSubtitles = subtitles || useSubtitles(srtPath);

  const currentCue = loadedSubtitles.find(
    cue => currentTime >= cue.start && currentTime <= cue.end
  );
  const currentCueIndex = getActiveCueIndex(loadedSubtitles, currentTime);
  const overlayLayout = getOverlayLayoutPreset(currentCueIndex, layout);
  const isHero = variant === 'hero';

  const style = currentCue ? matchSceneStyle(currentCue.text) : null;
  const EffectComponent = style && style.effect ? EFFECT_COMPONENTS[style.effect] : null;

  const heroPoint = currentCue && style
    ? extractTalkingPoints(currentCue.text, style, 1)[0] || style.label
    : '趋势';
  const baseColor = style ? style.bgColor : '#FAFAF7';
  const activeVisual = sceneVisuals.find(
    (item) => currentTime >= item.start && currentTime < item.end
  ) || sceneVisuals[sceneVisuals.length - 1] || null;
  const sceneProgress = activeVisual
    ? (currentTime - activeVisual.start) / Math.max(0.1, activeVisual.end - activeVisual.start)
    : 0;
  const visualOpacity = activeVisual
    ? interpolate(sceneProgress, [0, 0.08, 0.92, 1], [0.58, 0.92, 0.92, 0.64], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
      })
    : 0;
  const visualScale = activeVisual
    ? interpolate(sceneProgress, [0, 1], [1.04, 1.0], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
      })
    : 1;

  return (
    <div style={{
      position: 'absolute',
      inset: 0,
      background: isHero
        ? '#0a0a12'
        : `
        radial-gradient(circle at 18% 22%, ${style ? style.accentColor : '#00b498'}16 0%, transparent 26%),
        radial-gradient(circle at 82% 78%, ${style ? style.accentColor : '#00b498'}10 0%, transparent 30%),
        linear-gradient(180deg, ${baseColor} 0%, ${CREAM} 100%)
      `,
    }}>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: `
            linear-gradient(rgba(21,26,25,0.04) 1px, transparent 1px),
            linear-gradient(90deg, rgba(21,26,25,0.03) 1px, transparent 1px)
          `,
          backgroundSize: '120px 120px',
          opacity: 0.18,
        }}
      />

      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: 'repeating-linear-gradient(180deg, rgba(21,26,25,0.03) 0px, rgba(21,26,25,0.03) 1px, transparent 1px, transparent 5px)',
          opacity: 0.1,
        }}
      />

      <div
        style={{
          position: 'absolute',
          left: 56,
          top: 84,
          bottom: 84,
          width: 2,
          background: `linear-gradient(180deg, ${style ? style.accentColor : '#ffffff'} 0%, transparent 100%)`,
          opacity: 0.7,
        }}
      />

      <div
        style={{
          position: 'absolute',
          left: isHero ? 0 : overlayLayout.heroVisual.left,
          top: isHero ? 0 : overlayLayout.heroVisual.top,
          width: isHero ? '100%' : overlayLayout.heroVisual.width,
          height: isHero ? '100%' : overlayLayout.heroVisual.height,
          borderRadius: isHero ? 0 : 28,
          background: isHero ? 'transparent' : TILE,
          border: isHero ? 'none' : '1px solid rgba(21,26,25,0.05)',
          boxShadow: isHero ? 'none' : 'inset 0 1px 0 rgba(255,255,255,0.45)',
          opacity: isHero ? 1 : 0.66,
        }}
      >
        {activeVisual ? (
          <>
            <img
              src={staticFile(activeVisual.path)}
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                opacity: visualOpacity,
                transform: `scale(${visualScale})`,
                transformOrigin: 'center center',
                filter: 'contrast(1.02) saturate(0.95)',
              }}
            />
            <div
              style={{
                position: 'absolute',
                inset: 0,
                background: `linear-gradient(180deg, rgba(250,250,247,0.08) 0%, rgba(250,250,247,0.02) 34%, ${style ? `${style.accentColor}14` : 'rgba(0,180,152,0.08)'} 100%)`,
              }}
            />
            <div
              style={{
                position: 'absolute',
                left: 22,
                right: 22,
                bottom: 22,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 12,
              }}
            >
              {!isHero ? (
                <>
                  <div
                    style={{
                      maxWidth: 360,
                      padding: '10px 14px',
                      borderRadius: 16,
                      background: 'rgba(250,250,247,0.78)',
                      backdropFilter: 'blur(14px)',
                      color: '#151A19',
                      fontSize: 18,
                      fontWeight: 700,
                      lineHeight: 1.35,
                      boxShadow: '0 10px 30px rgba(21,26,25,0.08)',
                    }}
                  >
                    {activeVisual.query || heroPoint}
                  </div>
                  <div
                    style={{
                      flexShrink: 0,
                      padding: '8px 12px',
                      borderRadius: 999,
                      background: 'rgba(21,26,25,0.8)',
                      color: '#FAFAF7',
                      fontSize: 14,
                      fontWeight: 700,
                      letterSpacing: 1,
                    }}
                  >
                    {activeVisual.provider === 'wanx'
                      ? 'AI VISUAL'
                      : activeVisual.provider === 'placeholder'
                        ? 'PLACEHOLDER'
                        : activeVisual.provider === 'pexels'
                          ? 'PEXELS'
                          : 'COMMONS'}
                  </div>
                </>
              ) : null}
            </div>
          </>
        ) : null}
      </div>

      {!isHero ? (
      <div
        style={{
          position: 'absolute',
          left: overlayLayout.detailVisual.left,
          top: overlayLayout.detailVisual.top,
          width: overlayLayout.detailVisual.width,
          height: overlayLayout.detailVisual.height,
          borderRadius: 28,
          background: TILE_STRONG,
          border: '1px solid rgba(21,26,25,0.05)',
          opacity: 0.5,
        }}
      >
        {activeVisual ? (
          <img
            src={staticFile(activeVisual.path)}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              opacity: 0.3,
              filter: 'grayscale(0.1)',
            }}
          />
        ) : null}
      </div>
      ) : null}

      {!isHero && EffectComponent ? (
        <div style={{ opacity: 0.18, mixBlendMode: 'multiply' }}>
          <EffectComponent />
        </div>
      ) : null}
      {!isHero && style && (
        <div style={{
          position: 'absolute',
          top: 240,
          left: 88,
          width: 640,
          fontSize: heroPoint.length > 8 ? 132 : 168,
          lineHeight: 1,
          fontWeight: 900,
          color: 'rgba(21,26,25,0.06)',
          letterSpacing: 2,
          textTransform: 'uppercase',
          wordBreak: 'break-word',
        }}>
          {heroPoint}
        </div>
      )}

      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: isHero
            ? 'radial-gradient(circle at 50% 50%, transparent 0%, rgba(10,10,18,0) 50%, rgba(10,10,18,0.55) 100%)'
            : 'radial-gradient(circle at 50% 45%, transparent 0%, rgba(250,250,247,0) 55%, rgba(227,233,231,0.55) 100%)',
        }}
      />

      {!isHero ? (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            boxShadow: 'inset 0 0 120px rgba(21,26,25,0.04)',
          }}
        />
      ) : null}
    </div>
  );
};

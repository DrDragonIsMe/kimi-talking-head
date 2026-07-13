import React from 'react';
import { useCurrentFrame, useVideoConfig } from 'remotion';
import { useSubtitles, SubtitleCue } from '../hooks/useSubtitles';
import { matchSceneStyle } from '../utils/keywordMatcher';

interface SceneIndicatorProps {
  srtPath: string;
  subtitles?: SubtitleCue[];
}

export const SceneIndicator: React.FC<SceneIndicatorProps> = ({ srtPath, subtitles }) => {
  const { fps } = useVideoConfig();
  const frame = useCurrentFrame();
  const currentTime = frame / fps;
  const loadedSubtitles = subtitles || useSubtitles(srtPath);

  const currentCue = loadedSubtitles.find(
    cue => currentTime >= cue.start && currentTime <= cue.end
  );

  if (!currentCue) return null;

  const style = matchSceneStyle(currentCue.text);

  return (
    <div style={{
      position: 'absolute',
      top: 40,
      left: 40,
      padding: '8px 16px',
      borderRadius: 100,
      background: `${style.accentColor}20`,
      border: `1px solid ${style.accentColor}40`,
      color: style.accentColor,
      fontSize: 14,
      fontWeight: 600,
      letterSpacing: 1,
      backdropFilter: 'blur(10px)',
      transition: 'all 0.5s ease',
    }}>
      {style.label}
    </div>
  );
};

import React from 'react';
import { AbsoluteFill } from 'remotion';
import { matchSceneStyle } from '../utils/keywordMatcher';
import { SubtitleCue } from '../hooks/useSubtitles';

interface TopicTagProps {
  label: string;
  currentTime: number;
  subtitles: SubtitleCue[];
}

const FONT_FAMILY = '"Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif';

export const TopicTag: React.FC<TopicTagProps> = ({ label, currentTime, subtitles }) => {
  const currentCue = subtitles.find(
    (cue) => currentTime >= cue.start && currentTime <= cue.end
  );

  const style = currentCue ? matchSceneStyle(currentCue.text) : null;
  const accentColor = style ? style.accentColor : '#00b498';
  const sceneLabel = style ? style.label : label;

  return (
    <AbsoluteFill
      style={{
        justifyContent: 'flex-start',
        alignItems: 'flex-start',
        paddingLeft: 40,
        paddingTop: 56,
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 12,
          padding: '14px 22px',
          borderRadius: 16,
          background: 'rgba(10,10,18,0.72)',
          border: `1.5px solid ${accentColor}60`,
          backdropFilter: 'blur(12px)',
          boxShadow: `0 12px 32px rgba(10,10,18,0.25), 0 0 20px ${accentColor}18`,
        }}
      >
        <div
          style={{
            width: 10,
            height: 10,
            borderRadius: '50%',
            background: accentColor,
            boxShadow: `0 0 10px ${accentColor}`,
          }}
        />
        <span
          style={{
            fontFamily: FONT_FAMILY,
            color: '#fff',
            fontSize: 22,
            fontWeight: 800,
            letterSpacing: 1.2,
          }}
        >
          {sceneLabel}
        </span>
      </div>
    </AbsoluteFill>
  );
};

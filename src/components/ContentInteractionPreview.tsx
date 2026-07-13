import React from 'react';
import { AbsoluteFill, OffthreadVideo, staticFile } from 'remotion';
import { SubtitleCue } from '../hooks/useSubtitles';

interface ContentInteractionPreviewProps {
  hostVideoPath?: string;
  sceneVisuals?: Array<{
    start: number;
    end: number;
    path: string;
    provider?: string;
    query?: string;
  }>;
  subtitles?: SubtitleCue[];
}

export const ContentInteractionPreview: React.FC<ContentInteractionPreviewProps> = ({
  hostVideoPath = 'host_video.mp4',
  sceneVisuals = [],
  subtitles = [],
}) => {
  const activeVisual = sceneVisuals.length > 0 ? sceneVisuals[0] : null;
  const activeSubtitle = subtitles && subtitles.length > 0 ? subtitles[0] : null;

  return (
    <AbsoluteFill
      style={{
        background: '#FAFAF7',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 24,
        padding: 64,
      }}
    >
      {activeVisual ? (
        <div
          style={{
            width: '100%',
            height: 520,
            borderRadius: 28,
            overflow: 'hidden',
            background: '#EDF1F0',
            border: '1px solid rgba(21,26,25,0.08)',
          }}
        >
          <img
            src={staticFile(activeVisual.path)}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
            }}
          />
        </div>
      ) : null}

      <div
        style={{
          width: 420,
          height: 560,
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
      </div>

      {activeSubtitle ? (
        <div
          style={{
            maxWidth: 720,
            padding: '18px 24px',
            borderRadius: 18,
            background: '#fff',
            border: '1px solid rgba(21,26,25,0.08)',
            boxShadow: '0 12px 28px rgba(21,26,25,0.06)',
            color: '#151A19',
            fontSize: 24,
            fontWeight: 700,
            textAlign: 'center',
          }}
        >
          {activeSubtitle.text}
        </div>
      ) : null}
    </AbsoluteFill>
  );
};

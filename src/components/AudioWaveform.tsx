import React, { useEffect, useState } from 'react';
import { continueRender, delayRender, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { getAudioData, visualizeAudio } from '@remotion/media-utils';

interface AudioWaveformProps {
  /** public/ 下的音频相对路径（如 audio.wav） */
  audioPath: string;
  color?: string;
  /** 采样条数（必须是 2 的幂：visualizeAudio 的 FFT 要求） */
  barCount?: number;
  /** 波形区高度 px */
  height?: number;
  opacity?: number;
}

/**
 * 音频波形条：visualizeAudio 按当前帧取振幅，数据加载用 delayRender 挂起，
 * 同一音频 + 同一帧渲染结果完全一致（确定性）。
 */
export const AudioWaveform: React.FC<AudioWaveformProps> = ({
  audioPath,
  color = '#00e6c3',
  barCount = 64,
  height = 40,
  opacity = 0.75,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const [handle] = useState(() => delayRender(`Loading audio data for ${audioPath}`));
  const [audioData, setAudioData] = useState<Awaited<ReturnType<typeof getAudioData>> | null>(null);

  useEffect(() => {
    let cancelled = false;
    getAudioData(staticFile(audioPath))
      .then((data) => {
        if (cancelled) return;
        setAudioData(data);
        continueRender(handle);
      })
      .catch((err) => {
        console.warn(`AudioWaveform: failed to load ${audioPath}:`, err);
        continueRender(handle); // 失败也不阻塞渲染（波形静默缺失）
      });
    return () => {
      cancelled = true;
    };
  }, [audioPath, handle]);

  if (!audioData) return null;

  const values = visualizeAudio({
    audioData,
    frame,
    fps,
    numberOfSamples: barCount,
  });

  return (
    <div
      style={{
        position: 'absolute',
        left: 32,
        right: 32,
        bottom: 14,
        height,
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'space-between',
        gap: 3,
        opacity,
        pointerEvents: 'none',
      }}
    >
      {values.map((value, index) => (
        <div
          key={index}
          style={{
            flex: 1,
            height: Math.max(3, Math.round(value * height)),
            borderRadius: 2,
            background: `linear-gradient(180deg, ${color} 0%, ${color}55 100%)`,
            boxShadow: value > 0.55 ? `0 0 8px ${color}66` : 'none',
          }}
        />
      ))}
    </div>
  );
};

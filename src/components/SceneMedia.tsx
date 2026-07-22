import React from 'react';
import {Loop, OffthreadVideo, staticFile, useVideoConfig} from 'remotion';

export type SceneVisualLike = {
  path: string;
  type?: 'image' | 'video';
  duration?: number;
};

/** 场景素材：image 用 <img>；video（B-roll）用 OffthreadVideo，按片段时长 Loop 循环 */
export const SceneMedia: React.FC<{
  visual: SceneVisualLike;
  style: React.CSSProperties;
}> = ({visual, style}) => {
  const {fps} = useVideoConfig();
  if (visual.type === 'video') {
    const video = <OffthreadVideo src={staticFile(visual.path)} muted style={style} />;
    if (visual.duration && visual.duration > 0) {
      return <Loop durationInFrames={Math.max(1, Math.round(visual.duration * fps))}>{video}</Loop>;
    }
    return video;
  }
  return <img src={staticFile(visual.path)} style={style} />;
};

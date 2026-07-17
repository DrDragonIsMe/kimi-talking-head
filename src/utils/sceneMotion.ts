/**
 * 场景画面运动与切换的纯函数工具。
 * 全部由场景序号与进度驱动：确定性、无随机数、可 seek。
 */

export interface SceneWindow<T> {
  /** 当前场景在 scenes 中的下标；-1 表示没有任何场景命中 */
  index: number;
  current: T | null;
  /** 交叉淡化窗口内的上一张；不在窗口内为 null */
  previous: T | null;
  /** 0 = 淡化开始（只显示 previous），1 = 淡化完成（只显示 current） */
  crossfadeProgress: number;
  /** 当前场景内的归一化进度 0-1，用于 Ken Burns */
  sceneProgress: number;
}

export interface KenBurnsTransform {
  scale: number;
  /** 相对画面宽度的百分比位移，如 -1.5 表示 -1.5% */
  translateX: number;
  translateY: number;
}

export const CROSSFADE_SECONDS = 0.45;

interface SceneLike {
  start: number;
  end: number;
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/**
 * 定位 currentTime 所属场景，并计算交叉淡化状态。
 * 场景 [start, end) 首尾相接；进入新场景的前 CROSSFADE_SECONDS 秒内
 * 返回 previous 以做交叉淡化，底层始终有图，避免闪黑。
 */
export const getSceneWindow = <T extends SceneLike>(
  scenes: T[],
  currentTime: number,
): SceneWindow<T> => {
  if (!scenes || scenes.length === 0) {
    return { index: -1, current: null, previous: null, crossfadeProgress: 1, sceneProgress: 0 };
  }

  let index = scenes.findIndex((scene) => currentTime >= scene.start && currentTime < scene.end);
  if (index === -1) {
    // 超出最后一张的 end 后停留在最后一张（与原行为一致）
    index = scenes.length - 1;
  }

  const current = scenes[index];
  const duration = Math.max(0.1, current.end - current.start);
  const sceneProgress = clamp01((currentTime - current.start) / duration);

  const inCrossfade = index > 0 && currentTime - current.start < CROSSFADE_SECONDS;
  if (inCrossfade) {
    const crossfadeProgress = clamp01((currentTime - current.start) / CROSSFADE_SECONDS);
    return { index, current, previous: scenes[index - 1], crossfadeProgress, sceneProgress };
  }

  return { index, current, previous: null, crossfadeProgress: 1, sceneProgress };
};

/**
 * Ken Burns 运动：按场景序号轮换四种模式，progress 为场景内 0-1 进度。
 * 位移模式下保持 scale > 1，确保边缘不露底。
 */
export const getKenBurnsTransform = (sceneIndex: number, progress: number): KenBurnsTransform => {
  const p = clamp01(progress);
  const mode = ((sceneIndex % 4) + 4) % 4;

  switch (mode) {
    case 0:
      // 缓推
      return { scale: 1.0 + 0.09 * p, translateX: 0, translateY: 0 };
    case 1:
      // 缓拉
      return { scale: 1.09 - 0.09 * p, translateX: 0, translateY: 0 };
    case 2:
      // 左→右平移
      return { scale: 1.06, translateX: -1.5 + 3 * p, translateY: 0 };
    default:
      // 右→左平移
      return { scale: 1.06, translateX: 1.5 - 3 * p, translateY: 0 };
  }
};

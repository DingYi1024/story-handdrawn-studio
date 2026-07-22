export type SceneRevealTiming = {
  bwVisibleFromFrame: number;
  textStartFrame: number;
  textDurationFrames: number;
  detailStartFrame: number;
  detailDurationFrames: number;
  colorStartFrame: number;
  colorDurationFrames: number;
};

export function sceneRevealTiming(
  totalFrames: number,
  speedMode: boolean,
): SceneRevealTiming;

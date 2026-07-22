export const sceneRevealTiming = (totalFrames, speedMode) => {
  const at = (ratio) => Math.round(totalFrames * ratio);

  return {
    bwVisibleFromFrame: 0,
    textStartFrame: at(speedMode ? 0.08 : 0.07),
    textDurationFrames: at(speedMode ? 0.22 : 0.16),
    detailStartFrame: at(0.48),
    detailDurationFrames: at(0.17),
    colorStartFrame: at(speedMode ? 0.52 : 0.65),
    colorDurationFrames: at(speedMode ? 0.36 : 0.23),
  };
};

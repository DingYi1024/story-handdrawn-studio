export const sceneRevealTiming = (totalFrames, speedMode) => {
  const at = (ratio) => Math.round(totalFrames * ratio);
  const textStartFrame = at(speedMode ? 0.08 : 0.07);
  const textDurationFrames = at(speedMode ? 0.22 : 0.16);
  const colorStartFrame = textStartFrame + textDurationFrames;

  return {
    bwVisibleFromFrame: 0,
    textStartFrame,
    textDurationFrames,
    detailStartFrame: colorStartFrame,
    detailDurationFrames: at(0.17),
    colorStartFrame,
    colorDurationFrames: at(speedMode ? 0.36 : 0.23),
  };
};

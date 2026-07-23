export const SUPPORTED_CAMERA_MOVES = [
  'static', 'push_in', 'pull_out', 'pan_left', 'pan_right', 'tilt_up', 'tilt_down', 'parallax',
];

const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const smooth = (value) => {
  const p = clamp(value);
  return p * p * (3 - 2 * p);
};

export const resolveShotTimeline = (scene, totalFrames) => {
  const source = Array.isArray(scene?.shots) && scene.shots.length
    ? scene.shots
    : [{id: 'a', duration_ratio: 1, camera_move: 'static', focus: {x: 0.5, y: 0.5, scale: 1}, element_motion: []}];
  const weights = source.map((shot) => Math.max(0.01, Number(shot.duration_ratio || shot.duration_sec || 1)));
  const sum = weights.reduce((total, value) => total + value, 0);
  let start = 0;
  return source.map((shot, index) => {
    const remaining = totalFrames - start;
    const frames = index === source.length - 1
      ? remaining
      : Math.max(1, Math.round(totalFrames * weights[index] / sum));
    const item = {...shot, start_frame: start, duration_frames: frames, end_frame: start + frames};
    start += frames;
    return item;
  });
};

export const shotStateAtFrame = (scene, frame, totalFrames) => {
  const timeline = resolveShotTimeline(scene, totalFrames);
  const safeFrame = Math.max(0, Math.min(totalFrames - 1, frame));
  const shotIndex = Math.max(0, timeline.findIndex((shot) => safeFrame < shot.end_frame));
  const shot = timeline[shotIndex] || timeline[timeline.length - 1];
  const progress = smooth((safeFrame - shot.start_frame) / Math.max(1, shot.duration_frames - 1));
  const focus = shot.focus || {};
  const baseScale = Number(focus.scale || 1);
  let scale = baseScale;
  let xPercent = (0.5 - Number(focus.x ?? 0.5)) * 10;
  let yPercent = (0.5 - Number(focus.y ?? 0.5)) * 10;
  let rotateDeg = 0;
  const move = SUPPORTED_CAMERA_MOVES.includes(shot.camera_move) ? shot.camera_move : 'static';
  if (move === 'push_in') scale += 0.055 * progress;
  if (move === 'pull_out') scale += 0.055 * (1 - progress);
  if (move === 'pan_left') xPercent += 2.8 - 5.6 * progress;
  if (move === 'pan_right') xPercent += -2.8 + 5.6 * progress;
  if (move === 'tilt_up') yPercent += 2.2 - 4.4 * progress;
  if (move === 'tilt_down') yPercent += -2.2 + 4.4 * progress;
  if (move === 'parallax') {
    scale += 0.025 * progress;
    xPercent += Math.sin(progress * Math.PI) * 1.4;
    yPercent -= progress * 0.8;
  }
  if (move === 'static') {
    xPercent += Math.sin(progress * Math.PI * 2) * 0.12;
    rotateDeg = Math.sin(progress * Math.PI * 2) * 0.08;
  }
  return {
    shot,
    shotIndex,
    progress,
    transform: {scale, xPercent, yPercent, rotateDeg},
    cutFrames: timeline.slice(1).map((item) => item.start_frame),
  };
};

export const motionCutFrames = (scene, totalFrames) =>
  resolveShotTimeline(scene, totalFrames).slice(1).map((shot) => shot.start_frame);

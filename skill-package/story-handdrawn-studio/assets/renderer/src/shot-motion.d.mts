import type {SceneData, ShotData} from './types';

export type ResolvedShot = ShotData & {start_frame: number; duration_frames: number; end_frame: number};
export type ShotMotionState = {
  shot: ResolvedShot;
  shotIndex: number;
  progress: number;
  transform: {scale: number; xPercent: number; yPercent: number; rotateDeg: number};
  cutFrames: number[];
};

export const SUPPORTED_CAMERA_MOVES: string[];
export const resolveShotTimeline: (scene: SceneData, totalFrames: number) => ResolvedShot[];
export const shotStateAtFrame: (scene: SceneData, frame: number, totalFrames: number) => ShotMotionState;
export const motionCutFrames: (scene: SceneData, totalFrames: number) => number[];

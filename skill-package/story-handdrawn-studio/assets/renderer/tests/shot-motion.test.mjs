import test from 'node:test';
import assert from 'node:assert/strict';
import {motionCutFrames, resolveShotTimeline, shotStateAtFrame} from '../src/shot-motion.mjs';

const scene = {shots: [
  {id: 'a', duration_ratio: 0.6, camera_move: 'push_in', focus: {x: 0.5, y: 0.5, scale: 1}},
  {id: 'b', duration_ratio: 0.4, camera_move: 'pan_left', focus: {x: 0.6, y: 0.5, scale: 1.1}},
]};

test('shot timeline fills the scene without gaps', () => {
  const timeline = resolveShotTimeline(scene, 100);
  assert.deepEqual(timeline.map((shot) => shot.duration_frames), [60, 40]);
  assert.equal(timeline[1].end_frame, 100);
  assert.deepEqual(motionCutFrames(scene, 100), [60]);
});

test('camera state changes deterministically inside each shot', () => {
  const start = shotStateAtFrame(scene, 0, 100);
  const endFirst = shotStateAtFrame(scene, 59, 100);
  const second = shotStateAtFrame(scene, 80, 100);
  assert.ok(endFirst.transform.scale > start.transform.scale);
  assert.equal(second.shot.id, 'b');
  assert.notEqual(second.transform.xPercent, 0);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {sceneRevealTiming} from '../src/scene-timing.mjs';

test('direct-cut scenes begin with BW, then reveal text, then color', () => {
  const timing = sceneRevealTiming(180, true);
  assert.equal(timing.bwVisibleFromFrame, 0);
  assert.ok(timing.textStartFrame > timing.bwVisibleFromFrame);
  assert.equal(
    timing.colorStartFrame,
    timing.textStartFrame + timing.textDurationFrames,
  );
});

test('color reveal has no post-caption hold in speed and detail modes', () => {
  for (const speedMode of [true, false]) {
    for (const totalFrames of [90, 181, 360]) {
      const timing = sceneRevealTiming(totalFrames, speedMode);
      assert.equal(
        timing.colorStartFrame - (timing.textStartFrame + timing.textDurationFrames),
        0,
      );
    }
  }
});

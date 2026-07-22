import test from 'node:test';
import assert from 'node:assert/strict';
import {sceneRevealTiming} from '../src/scene-timing.mjs';

test('direct-cut scenes begin with BW, then reveal text, then color', () => {
  const timing = sceneRevealTiming(180, true);
  assert.equal(timing.bwVisibleFromFrame, 0);
  assert.ok(timing.textStartFrame > timing.bwVisibleFromFrame);
  assert.ok(
    timing.colorStartFrame >= timing.textStartFrame + timing.textDurationFrames,
  );
});

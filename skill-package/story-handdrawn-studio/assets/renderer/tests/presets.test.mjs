import test from 'node:test';
import assert from 'node:assert/strict';
import {calculatePreviewCanvas, createSettings, mergeSettings, parseRatio, PRESETS} from '../scripts/lib/presets.mjs';

test('all built-in presets have matching even dimensions', () => {
  for (const name of Object.keys(PRESETS)) {
    const settings = createSettings(name);
    assert.ok(Math.abs(settings.canvas.width / settings.canvas.height - parseRatio(settings.canvas.ratio)) < 0.002);
    assert.equal(settings.canvas.width % 2, 0);
    assert.equal(settings.canvas.height % 2, 0);
  }
});

test('preset aliases and safe overrides are supported', () => {
  const settings = createSettings('9:16', {render: {concurrency: 2}});
  assert.equal(settings.preset, 'vertical');
  assert.equal(settings.canvas.height, 1920);
  assert.equal(settings.render.concurrency, 2);
});

test('invalid dimensions and transitions are rejected', () => {
  assert.throws(
    () => mergeSettings(createSettings(), {canvas: {width: 1081}}),
    /positive even integer/,
  );
  assert.throws(
    () => mergeSettings(createSettings(), {transition: {type: 'explode'}}),
    /cut or page-flip/,
  );
});

test('preview canvases preserve exact ratios with even H.264 dimensions', () => {
  assert.deepEqual(calculatePreviewCanvas(PRESETS.portrait, 720), {width: 720, height: 960, scale: 2 / 3});
  assert.deepEqual(calculatePreviewCanvas(PRESETS.vertical, 720), {width: 720, height: 1280, scale: 2 / 3});
  assert.deepEqual(calculatePreviewCanvas(PRESETS.square, 720), {width: 720, height: 720, scale: 2 / 3});
  assert.deepEqual(calculatePreviewCanvas(PRESETS.landscape, 720), {width: 704, height: 396, scale: 11 / 30});
});

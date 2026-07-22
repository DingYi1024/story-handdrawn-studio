import test from 'node:test';
import assert from 'node:assert/strict';
import {createSettings, mergeSettings, parseRatio, PRESETS} from '../scripts/lib/presets.mjs';

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


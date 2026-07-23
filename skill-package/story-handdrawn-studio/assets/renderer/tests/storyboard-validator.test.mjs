import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {validateStoryboardObject} from '../scripts/lib/storyboard-validator.mjs';

const validStoryboard = () => ({
  project: {
    title: 'Test',
    mode: 'speed',
    images_per_scene: 1,
    derive_bw: 'local',
    enable_detail: false,
    ratio: '9:16',
    width: 1080,
    height: 1920,
    fps: 30,
    transition: 'cut',
    style_lock: 'style',
    character_lock: 'characters',
    caption: {max_chars_per_line: 13, max_lines: 3},
    audio: {voiceover: 'post', bgm: 'optional_bed_only', bgm_follows_text: false},
  },
  scenes: [{
    id: '01',
    duration_sec: 4.4,
    text: '一句话。',
    visual: 'scene',
    shot: 'story_beat',
    layers: ['bw_full', 'text', 'color'],
    color_hint: null,
    detail_hint: null,
    assets: {text_image: null, bw: 'assets/bw.svg', detail: null, color: 'assets/color.svg'},
  }],
});

test('validator accepts generic aspect ratios and existing assets', () => {
  const publicDir = mkdtempSync(resolve(tmpdir(), 'story-studio-public-'));
  try {
    mkdirSync(resolve(publicDir, 'assets'), {recursive: true});
    writeFileSync(resolve(publicDir, 'assets/bw.svg'), '<svg/>');
    writeFileSync(resolve(publicDir, 'assets/color.svg'), '<svg/>');
    const result = validateStoryboardObject(validStoryboard(), {publicDir});
    assert.deepEqual(result.errors, []);
    assert.equal(result.summary.ratio, '9:16');
  } finally {
    rmSync(publicDir, {recursive: true, force: true});
  }
});

test('validator rejects mismatched ratios and asset traversal', () => {
  const storyboard = validStoryboard();
  storyboard.project.width = 1000;
  storyboard.scenes[0].assets.color = '../secret.png';
  const result = validateStoryboardObject(storyboard, {publicDir: 'C:/public'});
  assert.ok(result.errors.some((error) => error.includes('match project.ratio')));
  assert.ok(result.errors.some((error) => error.includes('escapes the public directory')));
});

test('validator rejects text-first scenes that can open on a blank page', () => {
  const storyboard = validStoryboard();
  storyboard.scenes[0].layers = ['text', 'bw_full', 'color'];
  const result = validateStoryboardObject(storyboard);
  assert.ok(result.errors.some((error) => error.includes('bw_full must appear before text')));
});

test('validator accepts supported multi-shot motion and rejects unsafe tokens', () => {
  const storyboard = validStoryboard();
  storyboard.scenes[0].shots = [
    {id: 'a', duration_ratio: 0.6, camera_move: 'push_in', focus: {x: 0.5, y: 0.6, scale: 1}, element_motion: ['rain']},
    {id: 'b', duration_ratio: 0.4, camera_move: 'static', focus: {x: 0.5, y: 0.6, scale: 1.14}, element_motion: ['ink-breathe']},
  ];
  assert.deepEqual(validateStoryboardObject(storyboard).errors, []);
  storyboard.scenes[0].shots[1].camera_move = 'orbit';
  assert.ok(validateStoryboardObject(storyboard).errors.some((error) => error.includes('unsupported camera_move')));
});

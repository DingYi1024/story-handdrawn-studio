import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  analyzeRgbFrame,
  createVisualQaPlan,
  createVisualQaReport,
  normalizeProbe,
  parseFrameRate,
  runVisualQa,
} from '../scripts/lib/visual-qa.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fill = (width, height, pixel) => {
  const buffer = new Uint8Array(width * height * 3);
  for (let offset = 0; offset < buffer.length; offset += 3) buffer.set(pixel, offset);
  return buffer;
};

const patternedMono = (width, height) => {
  const buffer = fill(width, height, [255, 255, 255]);
  for (let y = 2; y < height - 2; y += 1) {
    for (let x = 2; x < width / 2; x += 1) {
      if ((x + y) % 2 === 0) buffer.set([0, 0, 0], (y * width + x) * 3);
    }
  }
  return buffer;
};

const patternedColor = (width, height, phase = 0) => {
  const buffer = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      buffer.set((x + phase) % 3 ? [230, 40, 30] : [20, 90, 230], (y * width + x) * 3);
    }
  }
  return buffer;
};

test('normalizes ffprobe metadata and rational frame rates', () => {
  assert.equal(parseFrameRate('30000/1001').toFixed(3), '29.970');
  assert.equal(parseFrameRate('0/0'), null);
  assert.deepEqual(normalizeProbe({streams: [{
    codec_type: 'video', width: 1080, height: 1440, avg_frame_rate: '30/1', duration: '4.5', nb_frames: '135',
  }]}), {
    width: 1080, height: 1440, fps: 30, durationSec: 4.5, frameCount: 135, codec: null, pixelFormat: null,
  });
});

test('builds a deterministic first/title/timeline sampling plan', () => {
  const plan = createVisualQaPlan({durationSec: 10, fps: 25}, {timelineSamples: 5, colorAfterSec: 2});
  assert.equal(plan.kind, 'visual-qa-plan');
  assert.equal(plan.colorAfterSec, 2);
  assert.equal(plan.samples[0].timeSec, 0);
  assert.ok(plan.samples[0].roles.includes('first'));
  assert.ok(plan.samples.some((sample) => sample.timeSec === 2 && sample.roles.includes('after_title')));
  assert.ok(plan.samples.every((sample, index) => index === 0 || sample.timeSec > plan.samples[index - 1].timeSec));
});

test('classifies black, white, monochrome artwork, and colour frames', () => {
  const black = analyzeRgbFrame(fill(8, 8, [0, 0, 0]), 8, 8).metrics;
  const white = analyzeRgbFrame(fill(8, 8, [255, 255, 255]), 8, 8).metrics;
  const mono = analyzeRgbFrame(patternedMono(8, 8), 8, 8).metrics;
  const color = analyzeRgbFrame(patternedColor(8, 8), 8, 8).metrics;
  assert.equal(black.isBlack, true);
  assert.equal(white.isWhite, true);
  assert.equal(mono.isBlank, false);
  assert.equal(mono.isMonochrome, true);
  assert.equal(color.hasColor, true);
});

test('report fails hard visual defects and emits duplicate-frame warnings', () => {
  const metadata = {width: 320, height: 240, fps: 10, durationSec: 3};
  const plan = createVisualQaPlan(metadata, {timelineSamples: 3, colorAfterSec: 1.5});
  const samples = plan.samples.map((sample) => {
    const frame = sample.roles.includes('first')
      ? fill(8, 8, [255, 255, 255])
      : patternedColor(8, 8);
    return {...sample, ...analyzeRgbFrame(frame, 8, 8)};
  });
  const report = createVisualQaReport({
    metadata,
    plan,
    samples,
    expected: {width: 320, height: 240, fps: 10, durationSec: 3},
  });
  assert.equal(report.passed, false);
  assert.equal(report.checks.find(({id}) => id === 'first_non_blank').status, 'fail');
  assert.equal(report.checks.find(({id}) => id === 'timeline_extreme_frames').status, 'fail');
  assert.equal(report.checks.find(({id}) => id === 'duplicate_frame_hint').status, 'warn');
  assert.equal('fingerprint' in report.samples[0], false);
});

test('uploaded-page QA can opt out of generated-art colour sequencing', () => {
  const metadata = {width: 320, height: 240, fps: 10, durationSec: 2};
  const plan = createVisualQaPlan(metadata, {timelineSamples: 3});
  const samples = plan.samples.map((sample) => ({
    ...sample,
    ...analyzeRgbFrame(patternedColor(8, 8, sample.id.length), 8, 8),
  }));
  const report = createVisualQaReport({
    metadata,
    plan,
    samples,
    expected: {
      width: 320,
      height: 240,
      fps: 10,
      durationSec: 2,
      firstMonochrome: false,
      colorAfterTitle: false,
    },
  });
  assert.equal(report.checks.some(({id}) => id === 'first_monochrome'), false);
  assert.equal(report.checks.some(({id}) => id === 'color_after_title'), false);
  assert.equal(report.passed, true);
});

test('ffprobe/ffmpeg integration produces a machine-readable passing report', {timeout: 30000}, (context) => {
  const hasFfmpeg = spawnSync('ffmpeg', ['-version'], {stdio: 'ignore'}).status === 0;
  const hasFfprobe = spawnSync('ffprobe', ['-version'], {stdio: 'ignore'}).status === 0;
  if (!hasFfmpeg || !hasFfprobe) return context.skip('ffmpeg and ffprobe are required');

  const sandbox = mkdtempSync(resolve(tmpdir(), 'story-visual-qa-'));
  const video = resolve(sandbox, 'sample.mp4');
  const reportPath = resolve(sandbox, 'report.json');
  const framesDir = resolve(sandbox, 'frames');
  try {
    execFileSync('ffmpeg', [
      '-v', 'error', '-y',
      '-f', 'lavfi', '-i', 'color=white:s=320x240:r=10:d=1',
      '-f', 'lavfi', '-i', 'color=blue:s=320x240:r=10:d=2',
      '-filter_complex',
      "[0:v]drawbox=x=45:y=70:w=230:h=100:color=black:t=8[first];[1:v]drawbox=x=120:y=80:w=80:h=80:color=red:t=fill[second];[first][second]concat=n=2:v=1:a=0,format=yuv420p[out]",
      '-map', '[out]', '-c:v', 'libx264', video,
    ], {stdio: 'pipe'});

    const report = runVisualQa(video, {
      colorAfterSec: 1.5,
      timelineSamples: 5,
      framesDir,
      expected: {width: 320, height: 240, fps: 10, durationSec: 3},
      generatedAt: '2026-01-01T00:00:00.000Z',
    });
    assert.equal(report.passed, true);
    assert.equal(report.metadata.width, 320);
    assert.equal(report.checks.find(({id}) => id === 'first_monochrome').status, 'pass');
    assert.equal(report.checks.find(({id}) => id === 'color_after_title').status, 'pass');
    assert.ok(report.artifacts.frames.length >= 5);

    const stdout = execFileSync(process.execPath, [
      resolve(root, 'scripts', 'qa-video.mjs'), video,
      '--output', reportPath, '--width', '320', '--height', '240', '--fps', '10',
      '--duration', '3', '--color-after', '1.5', '--samples', '5', '--compact',
    ], {encoding: 'utf8'});
    const cliReport = JSON.parse(stdout);
    const savedReport = JSON.parse(readFileSync(reportPath, 'utf8'));
    assert.equal(cliReport.kind, 'visual-qa-report');
    assert.equal(savedReport.passed, true);
  } finally {
    rmSync(sandbox, {recursive: true, force: true});
  }
});

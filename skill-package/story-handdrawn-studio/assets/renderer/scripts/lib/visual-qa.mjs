import {spawnSync} from 'node:child_process';
import {mkdirSync} from 'node:fs';
import {basename, relative, resolve} from 'node:path';

export const VISUAL_QA_SCHEMA_VERSION = '1.0';

export const DEFAULT_VISUAL_QA_THRESHOLDS = Object.freeze({
  blankStdDevMax: 3,
  blackLumaMax: 16,
  whiteLumaMin: 239,
  extremePixelRatioMin: 0.98,
  monochromeColorPixelRatioMax: 0.035,
  colorPixelRatioMin: 0.045,
  colorMeanChromaMin: 0.012,
  duplicateDistanceMax: 0.008,
});

const round = (value, digits = 4) => Number(Number(value).toFixed(digits));
const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));

export const parseFrameRate = (value) => {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : null;
  const match = String(value ?? '').trim().match(/^(\d+(?:\.\d+)?)(?:\/(\d+(?:\.\d+)?))?$/);
  if (!match) return null;
  const numerator = Number(match[1]);
  const denominator = match[2] ? Number(match[2]) : 1;
  return denominator > 0 && numerator > 0 ? numerator / denominator : null;
};

export const normalizeProbe = (probe) => {
  const stream = (probe?.streams || []).find((candidate) => candidate.codec_type === 'video')
    || probe?.streams?.[0]
    || {};
  const audioStreams = (probe?.streams || [])
    .filter((candidate) => candidate.codec_type === 'audio')
    .map((candidate) => ({
      codec: candidate.codec_name || null,
      sampleRate: Number(candidate.sample_rate) || null,
      channels: Number(candidate.channels) || null,
    }));
  const duration = Number(stream.duration ?? probe?.format?.duration);
  return {
    width: Number(stream.width) || null,
    height: Number(stream.height) || null,
    fps: parseFrameRate(stream.avg_frame_rate) || parseFrameRate(stream.r_frame_rate),
    durationSec: Number.isFinite(duration) && duration > 0 ? duration : null,
    frameCount: Number(stream.nb_frames) || null,
    codec: stream.codec_name || null,
    pixelFormat: stream.pix_fmt || null,
    audioStreams,
  };
};

/**
 * Pure sampling-plan builder. The first frame checks opening artwork, the
 * after-title sample checks the intended colour reveal, and uniform timeline
 * samples catch accidental blank or frozen sections.
 */
export const createVisualQaPlan = (metadata, options = {}) => {
  const durationSec = Number(metadata?.durationSec);
  const fps = Number(metadata?.fps) || 25;
  if (!(durationSec > 0)) throw new Error('A positive video duration is required to build a QA plan');

  const lastFrameTime = Math.max(0, durationSec - 1 / fps);
  const timelineCount = Math.max(3, Math.min(25, Math.round(options.timelineSamples ?? 9)));
  const requestedColorTime = Number(options.colorAfterSec);
  const colorAfterSec = clamp(
    Number.isFinite(requestedColorTime) ? requestedColorTime : Math.max(0.5, durationSec * 0.25),
    0,
    lastFrameTime,
  );
  const candidates = [
    {timeSec: 0, roles: ['first'], checks: ['first_non_blank', 'first_monochrome']},
    {timeSec: colorAfterSec, roles: ['after_title'], checks: ['color_after_title']},
    ...Array.from({length: timelineCount}, (_, index) => ({
      timeSec: lastFrameTime * (index / (timelineCount - 1)),
      roles: ['timeline'],
      checks: ['black_or_white_frame'],
    })),
    ...(options.transitionTimes || []).flatMap((time, index) => [-0.08, 0, 0.08].map((offset) => ({
      timeSec: Number(time) + offset,
      roles: ['transition', `transition-${index + 1}`],
      checks: ['transition_non_blank'],
    }))),
  ];

  const merged = [];
  for (const candidate of candidates.sort((left, right) => left.timeSec - right.timeSec)) {
    const timeSec = round(clamp(candidate.timeSec, 0, lastFrameTime), 6);
    const existing = merged.find((sample) => Math.abs(sample.timeSec - timeSec) < 1e-5);
    if (existing) {
      existing.roles = [...new Set([...existing.roles, ...candidate.roles])];
      existing.checks = [...new Set([...existing.checks, ...candidate.checks])];
    } else {
      merged.push({timeSec, roles: [...candidate.roles], checks: [...candidate.checks]});
    }
  }

  return {
    kind: 'visual-qa-plan',
    schemaVersion: VISUAL_QA_SCHEMA_VERSION,
    durationSec: round(durationSec, 6),
    colorAfterSec: round(colorAfterSec, 6),
    timelineSamples: timelineCount,
    samples: merged.map((sample, index) => ({id: `frame-${String(index + 1).padStart(2, '0')}`, ...sample})),
  };
};

const standardDeviation = (values, mean) => {
  if (!values.length) return 0;
  return Math.sqrt(values.reduce((total, value) => total + (value - mean) ** 2, 0) / values.length);
};

const fingerprintRgb = (rgb, width, height, gridSize = 8) => {
  const fingerprint = [];
  for (let gridY = 0; gridY < gridSize; gridY += 1) {
    for (let gridX = 0; gridX < gridSize; gridX += 1) {
      const x = Math.min(width - 1, Math.floor((gridX + 0.5) * width / gridSize));
      const y = Math.min(height - 1, Math.floor((gridY + 0.5) * height / gridSize));
      const offset = (y * width + x) * 3;
      fingerprint.push(rgb[offset] / 255, rgb[offset + 1] / 255, rgb[offset + 2] / 255);
    }
  }
  return fingerprint.map((value) => round(value, 4));
};

/** Pure RGB metric extraction; accepts an ffmpeg rgb24 frame buffer. */
export const analyzeRgbFrame = (rgb, width, height, thresholds = {}) => {
  const expectedBytes = width * height * 3;
  if (!(rgb instanceof Uint8Array) || rgb.length !== expectedBytes) {
    throw new Error(`Expected ${expectedBytes} bytes of rgb24 data, received ${rgb?.length ?? 0}`);
  }
  const limits = {...DEFAULT_VISUAL_QA_THRESHOLDS, ...thresholds};
  const lumas = [];
  const chromas = [];
  let darkPixels = 0;
  let whitePixels = 0;
  let colorPixels = 0;
  for (let offset = 0; offset < rgb.length; offset += 3) {
    const red = rgb[offset];
    const green = rgb[offset + 1];
    const blue = rgb[offset + 2];
    const luma = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    const chroma = (Math.max(red, green, blue) - Math.min(red, green, blue)) / 255;
    lumas.push(luma);
    chromas.push(chroma);
    if (luma <= limits.blackLumaMax) darkPixels += 1;
    if (luma >= limits.whiteLumaMin) whitePixels += 1;
    if (chroma >= 0.1) colorPixels += 1;
  }
  const pixels = width * height;
  const meanLuma = lumas.reduce((total, value) => total + value, 0) / pixels;
  const meanChroma = chromas.reduce((total, value) => total + value, 0) / pixels;
  const lumaStdDev = standardDeviation(lumas, meanLuma);
  const chromaStdDev = standardDeviation(chromas, meanChroma);
  const darkPixelRatio = darkPixels / pixels;
  const whitePixelRatio = whitePixels / pixels;
  const colorPixelRatio = colorPixels / pixels;
  const isBlack = meanLuma <= limits.blackLumaMax && darkPixelRatio >= limits.extremePixelRatioMin;
  const isWhite = meanLuma >= limits.whiteLumaMin && whitePixelRatio >= limits.extremePixelRatioMin;
  const isBlank = isBlack || isWhite
    || (lumaStdDev <= limits.blankStdDevMax && chromaStdDev <= 0.01);
  return {
    metrics: {
      meanLuma: round(meanLuma, 2),
      lumaStdDev: round(lumaStdDev, 2),
      meanChroma: round(meanChroma, 4),
      chromaStdDev: round(chromaStdDev, 4),
      darkPixelRatio: round(darkPixelRatio, 4),
      whitePixelRatio: round(whitePixelRatio, 4),
      colorPixelRatio: round(colorPixelRatio, 4),
      isBlack,
      isWhite,
      isBlank,
      isMonochrome: colorPixelRatio <= limits.monochromeColorPixelRatioMax,
      hasColor: colorPixelRatio >= limits.colorPixelRatioMin && meanChroma >= limits.colorMeanChromaMin,
    },
    fingerprint: fingerprintRgb(rgb, width, height),
  };
};

export const fingerprintDistance = (left, right) => {
  if (!Array.isArray(left) || left.length === 0 || left.length !== right?.length) return null;
  return left.reduce((total, value, index) => total + Math.abs(value - right[index]), 0) / left.length;
};

const check = (id, status, severity, message, observed, expected, sampleIds = []) => ({
  id,
  status,
  severity,
  message,
  observed,
  expected,
  sampleIds,
});

const compareExpected = (id, actual, expected, tolerance, label) => {
  if (expected === undefined || expected === null) {
    return check(id, actual > 0 ? 'pass' : 'fail', 'error', `${label} is readable`, actual, '> 0');
  }
  const delta = Math.abs(actual - expected);
  return check(
    id,
    delta <= tolerance ? 'pass' : 'fail',
    'error',
    `${label} ${delta <= tolerance ? 'matches' : 'does not match'} the expected value`,
    actual,
    tolerance === 0 ? expected : `${expected} ± ${tolerance}`,
  );
};

/** Pure verdict builder. Input samples are the output of analyzeRgbFrame(). */
export const createVisualQaReport = ({
  source = null,
  metadata,
  plan,
  samples,
  expected = {},
  thresholds = {},
  generatedAt = null,
}) => {
  const limits = {...DEFAULT_VISUAL_QA_THRESHOLDS, ...thresholds};
  const byId = new Map(samples.map((sample) => [sample.id, sample]));
  const first = samples.find((sample) => sample.roles?.includes('first'));
  const afterTitle = samples.find((sample) => sample.roles?.includes('after_title'));
  const checks = [
    compareExpected('video_width', metadata.width, expected.width, 0, 'Video width'),
    compareExpected('video_height', metadata.height, expected.height, 0, 'Video height'),
    compareExpected('video_fps', metadata.fps, expected.fps, Number(expected.fpsTolerance ?? 0.02), 'Frame rate'),
    compareExpected(
      'video_duration',
      metadata.durationSec,
      expected.durationSec,
      Number(expected.durationToleranceSec ?? 0.15),
      'Duration',
    ),
  ];

  if (expected.hasAudio !== undefined) {
    const audioStreams = Array.isArray(metadata.audioStreams) ? metadata.audioStreams : [];
    const hasAudio = audioStreams.length > 0;
    const matches = hasAudio === expected.hasAudio;
    checks.push(check(
      'audio_stream',
      matches ? 'pass' : 'fail',
      'error',
      matches
        ? expected.hasAudio ? 'An audio stream is present' : 'No audio stream is present'
        : expected.hasAudio ? 'The video is missing its required audio stream' : 'The video unexpectedly contains audio',
      audioStreams,
      expected.hasAudio ? {minimumStreams: 1} : {maximumStreams: 0},
    ));
  }

  checks.push(check(
    'first_non_blank',
    first && !first.metrics.isBlank ? 'pass' : 'fail',
    'error',
    first && !first.metrics.isBlank ? 'First frame contains visible content' : 'First frame is blank or uniform',
    first?.metrics ?? null,
    {isBlank: false},
    first ? [first.id] : [],
  ));
  if (expected.firstMonochrome !== false) {
    checks.push(check(
      'first_monochrome',
      first?.metrics.isMonochrome ? 'pass' : 'fail',
      'error',
      first?.metrics.isMonochrome ? 'First frame is black and white' : 'First frame contains too much colour',
      {colorPixelRatio: first?.metrics.colorPixelRatio ?? null},
      {maximum: limits.monochromeColorPixelRatioMax},
      first ? [first.id] : [],
    ));
  }
  if (expected.colorAfterTitle !== false) {
    checks.push(check(
      'color_after_title',
      afterTitle?.metrics.hasColor ? 'pass' : 'fail',
      'error',
      afterTitle?.metrics.hasColor ? 'Colour is visible after the title section' : 'No meaningful colour found after the title section',
      afterTitle ? {timeSec: afterTitle.timeSec, colorPixelRatio: afterTitle.metrics.colorPixelRatio, meanChroma: afterTitle.metrics.meanChroma} : null,
      {timeSec: plan.colorAfterSec, minimumColorPixelRatio: limits.colorPixelRatioMin, minimumMeanChroma: limits.colorMeanChromaMin},
      afterTitle ? [afterTitle.id] : [],
    ));
  }

  const extremeFrames = samples.filter((sample) =>
    sample.roles?.includes('timeline') && (sample.metrics.isBlack || sample.metrics.isWhite),
  );
  checks.push(check(
    'timeline_extreme_frames',
    extremeFrames.length ? 'fail' : 'pass',
    'error',
    extremeFrames.length ? 'Black or white frames were found on the timeline' : 'No black or white timeline samples found',
    extremeFrames.map((sample) => ({id: sample.id, timeSec: sample.timeSec, black: sample.metrics.isBlack, white: sample.metrics.isWhite})),
    [],
    extremeFrames.map((sample) => sample.id),
  ));

  const extremeTransitions = samples.filter((sample) =>
    sample.roles?.includes('transition') && (sample.metrics.isBlack || sample.metrics.isWhite || sample.metrics.isBlank),
  );
  checks.push(check(
    'transition_extreme_frames',
    extremeTransitions.length ? 'fail' : 'pass',
    'error',
    extremeTransitions.length ? 'Blank transition samples were found' : 'All sampled transitions retain visible artwork',
    extremeTransitions.map((sample) => ({id: sample.id, timeSec: sample.timeSec, metrics: sample.metrics})),
    [],
    extremeTransitions.map((sample) => sample.id),
  ));

  const timeline = plan.samples
    .filter((sample) => sample.roles.includes('timeline'))
    .map((sample) => byId.get(sample.id))
    .filter(Boolean);
  const duplicatePairs = [];
  for (let index = 1; index < timeline.length; index += 1) {
    const distance = fingerprintDistance(timeline[index - 1].fingerprint, timeline[index].fingerprint);
    if (distance !== null && distance <= limits.duplicateDistanceMax) {
      duplicatePairs.push({
        from: timeline[index - 1].id,
        to: timeline[index].id,
        fromSec: timeline[index - 1].timeSec,
        toSec: timeline[index].timeSec,
        distance: round(distance, 5),
      });
    }
  }
  checks.push(check(
    'duplicate_frame_hint',
    duplicatePairs.length ? 'warn' : 'pass',
    'warning',
    duplicatePairs.length ? 'Similar consecutive timeline samples may indicate a frozen or repeated section' : 'No repeated-frame hints found',
    duplicatePairs,
    {distanceGreaterThan: limits.duplicateDistanceMax},
    [...new Set(duplicatePairs.flatMap((pair) => [pair.from, pair.to]))],
  ));

  const summary = checks.reduce((result, item) => {
    result[item.status] += 1;
    result.total += 1;
    return result;
  }, {pass: 0, warn: 0, fail: 0, total: 0});
  const publicSamples = samples.map(({fingerprint, ...sample}) => sample);
  return {
    kind: 'visual-qa-report',
    schemaVersion: VISUAL_QA_SCHEMA_VERSION,
    ...(generatedAt ? {generatedAt} : {}),
    source,
    status: summary.fail > 0 ? 'fail' : summary.warn > 0 ? 'pass_with_warnings' : 'pass',
    passed: summary.fail === 0,
    summary,
    metadata,
    plan,
    samples: publicSamples,
    checks,
    issues: checks.filter((item) => item.status !== 'pass'),
  };
};

const execute = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    encoding: options.encoding ?? null,
    maxBuffer: options.maxBuffer ?? 32 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    const detail = result.error?.message || String(result.stderr || '').trim() || `exit status ${result.status}`;
    throw new Error(`${command} failed: ${detail}`);
  }
  return result.stdout;
};

export const probeVideo = (input, {ffprobe = 'ffprobe'} = {}) => {
  const raw = execute(ffprobe, [
    '-v', 'error',
    '-show_entries', 'stream=codec_type,codec_name,pix_fmt,width,height,r_frame_rate,avg_frame_rate,nb_frames,duration,sample_rate,channels:format=duration',
    '-of', 'json', input,
  ], {encoding: 'utf8'});
  const probe = JSON.parse(raw);
  const metadata = normalizeProbe(probe);
  if (!metadata.width || !metadata.height || !metadata.durationSec || !metadata.fps) {
    throw new Error('ffprobe did not return complete video metadata');
  }
  return metadata;
};

export const extractFrameRgb = (input, timeSec, {ffmpeg = 'ffmpeg', width = 64, height = 64} = {}) => {
  const seek = timeSec > 0 ? ['-ss', String(timeSec)] : [];
  const raw = execute(ffmpeg, [
    '-v', 'error', '-i', input, ...seek,
    '-frames:v', '1', '-vf', `scale=${width}:${height}:flags=area`,
    '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1',
  ]);
  const expectedBytes = width * height * 3;
  if (raw.length !== expectedBytes) {
    throw new Error(`ffmpeg returned ${raw.length} frame bytes at ${timeSec}s; expected ${expectedBytes}`);
  }
  return new Uint8Array(raw);
};

export const writeSampleFrames = (input, plan, directory, {ffmpeg = 'ffmpeg'} = {}) => {
  mkdirSync(directory, {recursive: true});
  const files = [];
  for (const sample of plan.samples) {
    const output = resolve(directory, `${sample.id}-${sample.timeSec.toFixed(3)}s.jpg`);
    const seek = sample.timeSec > 0 ? ['-ss', String(sample.timeSec)] : [];
    execute(ffmpeg, ['-v', 'error', '-y', '-i', input, ...seek, '-frames:v', '1', '-q:v', '2', output]);
    files.push(output);
  }
  return files;
};

export const runVisualQa = (input, options = {}) => {
  const metadata = probeVideo(input, options);
  const plan = createVisualQaPlan(metadata, options);
  const samples = plan.samples.map((sample) => {
    const analyzed = analyzeRgbFrame(extractFrameRgb(input, sample.timeSec, options), 64, 64, options.thresholds);
    return {...sample, ...analyzed};
  });
  const frameFiles = options.framesDir
    ? writeSampleFrames(input, plan, options.framesDir, options)
    : [];
  const portableBase = options.artifactsRelativeTo ? resolve(options.artifactsRelativeTo) : null;
  const report = createVisualQaReport({
    source: options.sourceLabel || (portableBase ? relative(portableBase, resolve(input)).replaceAll('\\', '/') : resolve(input)),
    metadata,
    plan,
    samples,
    expected: options.expected,
    thresholds: options.thresholds,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
  });
  return {
    ...report,
    artifacts: {
      frames: portableBase
        ? frameFiles.map((path) => relative(portableBase, path).replaceAll('\\', '/'))
        : frameFiles,
    },
    inputName: basename(input),
  };
};

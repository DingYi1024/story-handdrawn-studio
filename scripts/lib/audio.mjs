import {spawnSync} from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import {basename, dirname, extname, isAbsolute, relative, resolve} from 'node:path';

export const AUDIO_MANIFEST_SCHEMA_VERSION = 1;

export const DEFAULT_AUDIO_OPTIONS = Object.freeze({
  enabled: false,
  tts: Object.freeze({
    enabled: true,
    provider: 'openai',
    model: 'tts-1-hd',
    voice: 'alloy',
    response_format: 'mp3',
  }),
  mix: Object.freeze({
    voiceover_volume: 1,
    bgm_volume: 0.16,
    sfx_volume: 0.85,
    target_lufs: -16,
    true_peak_db: -1.5,
    loudness_range: 11,
    limiter: 0.95,
    audio_bitrate: '192k',
  }),
});

const finiteNumber = (value, fallback, label, {minimum = -Infinity, maximum = Infinity} = {}) => {
  const number = value === undefined ? fallback : Number(value);
  if (!Number.isFinite(number) || number < minimum || number > maximum) {
    throw new Error(`${label} must be a finite number between ${minimum} and ${maximum}`);
  }
  return number;
};

const safePart = (value, fallback) => {
  const safe = String(value ?? '')
    .normalize('NFKC')
    .replace(/[^\p{Letter}\p{Number}._-]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return safe || fallback;
};

const normalizedExtension = (path, fallback = '.bin') => {
  const extension = extname(String(path || '')).toLowerCase();
  return /^\.[a-z0-9]{1,8}$/.test(extension) ? extension : fallback;
};

const sourcePath = (value, baseDir) => {
  const path = typeof value === 'string' ? value : value?.path;
  if (!path) return null;
  return isAbsolute(path) ? resolve(path) : resolve(baseDir, path);
};

const fileOption = (value, baseDir, defaultVolume = 1) => {
  const inputPath = sourcePath(value, baseDir);
  if (!inputPath) return null;
  return {
    input_path: inputPath,
    volume: finiteNumber(
      typeof value === 'object' ? value.volume : undefined,
      defaultVolume,
      'track volume',
      {minimum: 0, maximum: 8},
    ),
  };
};

const voiceoverFor = (voiceover, scene, index, baseDir) => {
  const selected = Array.isArray(voiceover)
    ? voiceover[index]
    : voiceover && typeof voiceover === 'object'
      ? voiceover[scene.id]
      : null;
  return fileOption(selected, baseDir);
};

const transitionFrames = (storyboard, sceneFrames) => {
  if (storyboard.project?.transition !== 'page-flip' || sceneFrames.length < 2) return 0;
  const fps = finiteNumber(storyboard.project.fps, undefined, 'project.fps', {minimum: 1});
  const requested = Math.max(
    1,
    Math.round(finiteNumber(storyboard.project.transition_sec, 0.7, 'transition_sec', {minimum: 0}) * fps),
  );
  const shortest = Math.min(...sceneFrames);
  return Math.min(requested, Math.max(1, Math.floor(shortest * 0.45)));
};

/** Build the exact frame-based scene timeline used by the Remotion composition. */
export const planSceneTimeline = (storyboard) => {
  if (!storyboard?.project || !Array.isArray(storyboard.scenes) || storyboard.scenes.length === 0) {
    throw new Error('Storyboard must contain project settings and at least one scene');
  }
  const fps = finiteNumber(storyboard.project.fps, undefined, 'project.fps', {minimum: 1});
  const sceneFrames = storyboard.scenes.map((scene, index) => Math.max(
    1,
    Math.round(finiteNumber(scene.duration_sec, undefined, `scenes[${index}].duration_sec`, {minimum: 0.001}) * fps),
  ));
  const overlapFrames = transitionFrames(storyboard, sceneFrames);
  let startFrame = 0;
  const scenes = storyboard.scenes.map((scene, index) => {
    const durationFrames = sceneFrames[index];
    const result = {
      id: String(scene.id ?? index + 1),
      start_frame: startFrame,
      duration_frames: durationFrames,
      start_sec: startFrame / fps,
      duration_sec: durationFrames / fps,
    };
    startFrame += durationFrames - (index < storyboard.scenes.length - 1 ? overlapFrames : 0);
    return result;
  });
  return {
    fps,
    transition_frames: overlapFrames,
    duration_frames: startFrame,
    duration_sec: startFrame / fps,
    scenes,
  };
};

const normalizedTts = (options = {}) => ({
  enabled: options.enabled !== false,
  provider: options.provider || DEFAULT_AUDIO_OPTIONS.tts.provider,
  model: options.model || DEFAULT_AUDIO_OPTIONS.tts.model,
  voice: options.voice || DEFAULT_AUDIO_OPTIONS.tts.voice,
  response_format: options.response_format || DEFAULT_AUDIO_OPTIONS.tts.response_format,
});

const normalizedMix = (options = {}) => ({
  voiceover_volume: finiteNumber(options.voiceover_volume, 1, 'voiceover_volume', {minimum: 0, maximum: 8}),
  bgm_volume: finiteNumber(options.bgm_volume, 0.16, 'bgm_volume', {minimum: 0, maximum: 8}),
  sfx_volume: finiteNumber(options.sfx_volume, 0.85, 'sfx_volume', {minimum: 0, maximum: 8}),
  target_lufs: options.target_lufs === false || options.target_lufs === null
    ? null
    : finiteNumber(options.target_lufs, -16, 'target_lufs', {minimum: -70, maximum: -5}),
  true_peak_db: finiteNumber(options.true_peak_db, -1.5, 'true_peak_db', {minimum: -9, maximum: 0}),
  loudness_range: finiteNumber(options.loudness_range, 11, 'loudness_range', {minimum: 1, maximum: 50}),
  limiter: options.limiter === false || options.limiter === null
    ? null
    : finiteNumber(options.limiter, 0.95, 'limiter', {minimum: 0.1, maximum: 1}),
  audio_bitrate: String(options.audio_bitrate || '192k'),
});

/**
 * Create a portable sidecar plan. Nothing is copied, synthesized, or executed here.
 * `voiceover` accepts an object keyed by scene id, or an array matching scene order.
 */
export const planAudioManifest = (storyboard, options = {}) => {
  const timeline = planSceneTimeline(storyboard);
  const enabled = options.enabled === true;
  const baseDir = resolve(options.base_dir || process.cwd());
  const tts = normalizedTts(options.tts);
  if (tts.provider !== 'openai') throw new Error(`Unsupported TTS provider: ${tts.provider}`);
  const mix = normalizedMix(options.mix);

  const scenes = storyboard.scenes.map((scene, index) => {
    const timing = timeline.scenes[index];
    const idPart = safePart(timing.id, `scene-${index + 1}`);
    const narration = String(scene.narration || '').trim();
    const supplied = voiceoverFor(options.voiceover, scene, index, baseDir);
    let voiceover = null;
    if (supplied) {
      voiceover = {
        type: 'file',
        ...supplied,
        asset_path: `audio/voiceover/${String(index + 1).padStart(2, '0')}-${idPart}${normalizedExtension(supplied.input_path)}`,
      };
    } else if (narration && tts.enabled) {
      voiceover = {
        type: 'tts',
        text: narration,
        model: tts.model,
        voice: tts.voice,
        response_format: tts.response_format,
        volume: 1,
        asset_path: `audio/voiceover/${String(index + 1).padStart(2, '0')}-${idPart}.${safePart(tts.response_format, 'mp3')}`,
      };
    }
    return {...timing, narration, voiceover};
  });

  const bgmSource = fileOption(options.bgm, baseDir);
  const bgm = bgmSource ? {
    type: 'file',
    ...bgmSource,
    loop: typeof options.bgm === 'object' ? options.bgm.loop !== false : true,
    asset_path: `audio/bgm/bed${normalizedExtension(bgmSource.input_path)}`,
  } : null;

  const sceneById = new Map(scenes.map((scene) => [scene.id, scene]));
  const sfx = (options.sfx || []).map((item, index) => {
    const sceneId = String(item.scene_id ?? item.scene ?? '');
    const scene = sceneById.get(sceneId);
    if (!scene) throw new Error(`SFX ${index + 1} refers to unknown scene: ${sceneId}`);
    const supplied = fileOption(item, baseDir);
    if (!supplied) throw new Error(`SFX ${index + 1} is missing path`);
    const offsetSec = finiteNumber(item.offset_sec, 0, `sfx[${index}].offset_sec`, {minimum: 0});
    if (offsetSec >= scene.duration_sec) {
      throw new Error(`SFX ${index + 1} offset is outside scene ${sceneId}`);
    }
    const name = safePart(item.id, `sfx-${index + 1}`);
    return {
      id: name,
      type: 'file',
      scene_id: sceneId,
      offset_sec: offsetSec,
      start_sec: scene.start_sec + offsetSec,
      ...supplied,
      asset_path: `audio/sfx/${String(index + 1).padStart(2, '0')}-${name}${normalizedExtension(supplied.input_path)}`,
    };
  });

  return {
    schema_version: AUDIO_MANIFEST_SCHEMA_VERSION,
    enabled,
    project: {
      title: String(storyboard.project.title || ''),
      fps: timeline.fps,
      duration_frames: timeline.duration_frames,
      duration_sec: timeline.duration_sec,
      transition_frames: timeline.transition_frames,
    },
    tts,
    mix,
    scenes,
    bgm,
    sfx,
  };
};

const assertInside = (base, path) => {
  const absoluteBase = resolve(base);
  const target = resolve(absoluteBase, path);
  const rel = relative(absoluteBase, target);
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error(`Audio asset path escapes project: ${path}`);
  return target;
};

const atomicWriteJson = (path, value) => {
  mkdirSync(dirname(path), {recursive: true});
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(temporary, path);
};

export const writeAudioManifest = (path, manifest) => atomicWriteJson(resolve(path), manifest);

export const synthesizeOpenAiSpeech = async ({
  text,
  outputPath,
  apiKey = process.env.OPENAI_API_KEY,
  fetchImpl = globalThis.fetch,
  endpoint = 'https://api.openai.com/v1/audio/speech',
  model = 'tts-1-hd',
  voice = 'alloy',
  responseFormat = 'mp3',
}) => {
  if (!String(text || '').trim()) throw new Error('TTS text is empty');
  if (!apiKey) throw new Error('OPENAI_API_KEY is required for OpenAI speech synthesis');
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required for OpenAI speech synthesis');
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({model, voice, input: String(text).trim(), response_format: responseFormat}),
  });
  if (!response?.ok) {
    const detail = typeof response?.text === 'function' ? (await response.text()).slice(0, 400) : '';
    throw new Error(`OpenAI speech request failed (${response?.status ?? 'unknown'}): ${detail}`.trim());
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0) throw new Error('OpenAI speech response was empty');
  mkdirSync(dirname(resolve(outputPath)), {recursive: true});
  writeFileSync(resolve(outputPath), bytes);
  return {path: resolve(outputPath), bytes: bytes.length};
};

export const probeAudioDuration = (
  path,
  {ffprobe = 'ffprobe', spawnSyncImpl = spawnSync} = {},
) => {
  const result = spawnSyncImpl(ffprobe, [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    resolve(path),
  ], {encoding: 'utf8', stdio: 'pipe'});
  if (result.error || result.status !== 0) {
    throw new Error(`ffprobe failed for ${path}: ${result.error?.message || result.stderr || `status ${result.status}`}`);
  }
  const duration = Number(String(result.stdout || '').trim());
  if (!Number.isFinite(duration) || duration <= 0) throw new Error(`ffprobe returned an invalid duration for ${path}`);
  return duration;
};

export const probeAudioStream = (
  path,
  {ffprobe = 'ffprobe', spawnSyncImpl = spawnSync} = {},
) => {
  const result = spawnSyncImpl(ffprobe, [
    '-v', 'error', '-select_streams', 'a:0',
    '-show_entries', 'stream=codec_type,codec_name,sample_rate,channels,duration',
    '-of', 'json', resolve(path),
  ], {encoding: 'utf8', stdio: 'pipe'});
  if (result.error || result.status !== 0) {
    throw new Error(`ffprobe audio-stream check failed for ${path}: ${result.error?.message || result.stderr || `status ${result.status}`}`);
  }
  const stream = JSON.parse(result.stdout || '{}').streams?.[0];
  if (!stream || stream.codec_type !== 'audio') throw new Error(`Output has no readable audio stream: ${path}`);
  return {
    codec: stream.codec_name || null,
    sample_rate: Number(stream.sample_rate) || null,
    channels: Number(stream.channels) || null,
    duration_sec: Number(stream.duration) || null,
  };
};

const ensureSource = (inputPath) => {
  if (!existsSync(inputPath)) throw new Error(`Audio input does not exist: ${inputPath}`);
};

/** Copy user tracks / synthesize TTS and record ffprobe-measured durations. */
export const materializeAudioManifest = async (
  manifest,
  projectDir,
  {
    apiKey = process.env.OPENAI_API_KEY,
    fetchImpl = globalThis.fetch,
    ffprobe = 'ffprobe',
    spawnSyncImpl = spawnSync,
  } = {},
) => {
  const result = JSON.parse(JSON.stringify(manifest));
  if (!result.enabled) return result;
  const root = resolve(projectDir);
  const materialize = async (track) => {
    if (!track) return;
    const outputPath = assertInside(root, track.asset_path);
    mkdirSync(dirname(outputPath), {recursive: true});
    if (track.type === 'file') {
      ensureSource(track.input_path);
      if (resolve(track.input_path) !== outputPath) copyFileSync(track.input_path, outputPath);
    } else if (track.type === 'tts') {
      await synthesizeOpenAiSpeech({
        text: track.text,
        outputPath,
        apiKey,
        fetchImpl,
        model: track.model,
        voice: track.voice,
        responseFormat: track.response_format,
      });
    } else {
      throw new Error(`Unsupported audio track type: ${track.type}`);
    }
    track.materialized_path = track.asset_path;
    track.duration_sec = probeAudioDuration(outputPath, {ffprobe, spawnSyncImpl});
  };

  for (const scene of result.scenes) await materialize(scene.voiceover);
  await materialize(result.bgm);
  for (const effect of result.sfx) await materialize(effect);
  result.materialized_at = new Date().toISOString();
  return result;
};

/** Extend scene durations when narration is longer than the visual scene. */
export const applyNarrationDurations = (storyboard, manifest, tailSeconds = 0.45) => {
  const tail = finiteNumber(tailSeconds, 0.45, 'narration tail seconds', {minimum: 0, maximum: 5});
  const next = JSON.parse(JSON.stringify(storyboard));
  const audioScenes = new Map((manifest?.scenes || []).map((scene) => [String(scene.id), scene]));
  const changedSceneIds = [];
  for (const scene of next.scenes || []) {
    const voiceover = audioScenes.get(String(scene.id))?.voiceover;
    if (!(voiceover?.duration_sec > 0)) continue;
    const required = Number((voiceover.duration_sec + tail).toFixed(2));
    if (required > scene.duration_sec) {
      scene.duration_sec = required;
      changedSceneIds.push(scene.id);
    }
  }
  return {storyboard: next, changedSceneIds};
};

const decimal = (value) => Number(value.toFixed(6)).toString();

/** Return an ffmpeg filter graph and its deterministic ordered track list. */
export const buildAudioMixGraph = (manifest, projectDir) => {
  if (!manifest.enabled) return {filter: '', tracks: []};
  const root = resolve(projectDir);
  const tracks = [];
  for (const scene of manifest.scenes) {
    if (scene.voiceover?.materialized_path) tracks.push({
      kind: 'voiceover',
      path: assertInside(root, scene.voiceover.materialized_path),
      delay_sec: scene.start_sec,
      trim_sec: scene.duration_sec,
      volume: manifest.mix.voiceover_volume * scene.voiceover.volume,
      loop: false,
    });
  }
  if (manifest.bgm?.materialized_path) tracks.push({
    kind: 'bgm',
    path: assertInside(root, manifest.bgm.materialized_path),
    delay_sec: 0,
    trim_sec: manifest.project.duration_sec,
    volume: manifest.mix.bgm_volume * manifest.bgm.volume,
    loop: manifest.bgm.loop !== false,
  });
  for (const effect of manifest.sfx) {
    if (!effect.materialized_path) continue;
    tracks.push({
      kind: 'sfx',
      path: assertInside(root, effect.materialized_path),
      delay_sec: effect.start_sec,
      trim_sec: Math.max(0.001, manifest.project.duration_sec - effect.start_sec),
      volume: manifest.mix.sfx_volume * effect.volume,
      loop: false,
    });
  }
  const chains = tracks.map((track, index) => {
    const delayMs = Math.max(0, Math.round(track.delay_sec * 1000));
    return `[${index + 1}:a]aformat=sample_rates=48000:channel_layouts=stereo,` +
      `atrim=start=0:end=${decimal(track.trim_sec)},asetpts=PTS-STARTPTS,` +
      `volume=${decimal(track.volume)},adelay=${delayMs}:all=1[a${index}]`;
  });
  if (tracks.length === 0) return {filter: '', tracks};
  let tail = `${tracks.map((_, index) => `[a${index}]`).join('')}amix=inputs=${tracks.length}:duration=longest:dropout_transition=0:normalize=0`;
  if (manifest.mix.target_lufs !== null) {
    tail += `,loudnorm=I=${decimal(manifest.mix.target_lufs)}:TP=${decimal(manifest.mix.true_peak_db)}:LRA=${decimal(manifest.mix.loudness_range)}`;
  }
  if (manifest.mix.limiter !== null) tail += `,alimiter=limit=${decimal(manifest.mix.limiter)}`;
  tail += `,apad=pad_dur=${decimal(manifest.project.duration_sec)}`;
  tail += '[mixed]';
  return {filter: [...chains, tail].join(';'), tracks};
};

export const buildFfmpegMuxArgs = ({manifest, projectDir, inputVideo, outputVideo}) => {
  const {filter, tracks} = buildAudioMixGraph(manifest, projectDir);
  if (tracks.length === 0) throw new Error('Audio is enabled, but there are no materialized tracks to mix');
  const args = ['-y', '-i', resolve(inputVideo)];
  for (const track of tracks) {
    if (track.loop) args.push('-stream_loop', '-1');
    args.push('-i', track.path);
  }
  args.push(
    '-filter_complex', filter,
    '-map', '0:v:0', '-map', '[mixed]',
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', manifest.mix.audio_bitrate,
    '-t', decimal(manifest.project.duration_sec),
    '-movflags', '+faststart', resolve(outputVideo),
  );
  return args;
};

export const muxAudioIntoVideo = ({
  manifest,
  projectDir,
  inputVideo,
  outputVideo,
  ffmpeg = 'ffmpeg',
  ffprobe = 'ffprobe',
  spawnSyncImpl = spawnSync,
}) => {
  if (!manifest.enabled) return {enabled: false, output_video: resolve(inputVideo)};
  if (!existsSync(inputVideo)) throw new Error(`Input video does not exist: ${inputVideo}`);
  mkdirSync(dirname(resolve(outputVideo)), {recursive: true});
  const args = buildFfmpegMuxArgs({manifest, projectDir, inputVideo, outputVideo});
  const result = spawnSyncImpl(ffmpeg, args, {encoding: 'utf8', stdio: 'pipe'});
  if (result.error || result.status !== 0) {
    throw new Error(`ffmpeg audio mux failed: ${result.error?.message || result.stderr || `status ${result.status}`}`);
  }
  const audio = probeAudioStream(outputVideo, {ffprobe, spawnSyncImpl});
  return {enabled: true, output_video: resolve(outputVideo), command: ffmpeg, args, audio};
};

/** Single integration point for studio.mjs; disabled audio is a sidecar-only no-op. */
export const processAudioProject = async ({
  storyboard,
  options = {},
  projectDir,
  inputVideo,
  outputVideo,
  manifestPath = resolve(projectDir, 'audio-manifest.json'),
  apiKey = process.env.OPENAI_API_KEY,
  fetchImpl = globalThis.fetch,
  ffmpeg = 'ffmpeg',
  ffprobe = 'ffprobe',
  spawnSyncImpl = spawnSync,
}) => {
  let manifest = planAudioManifest(storyboard, options);
  writeAudioManifest(manifestPath, manifest);
  if (!manifest.enabled) {
    return {
      enabled: false,
      manifest,
      manifest_path: resolve(manifestPath),
      output_video: inputVideo ? resolve(inputVideo) : null,
    };
  }
  if (!inputVideo || !outputVideo) throw new Error('inputVideo and outputVideo are required when audio is enabled');
  manifest = await materializeAudioManifest(manifest, projectDir, {
    apiKey,
    fetchImpl,
    ffprobe,
    spawnSyncImpl,
  });
  const mux = muxAudioIntoVideo({
    manifest,
    projectDir,
    inputVideo,
    outputVideo,
    ffmpeg,
    ffprobe,
    spawnSyncImpl,
  });
  manifest.output = {source_video: resolve(inputVideo), video: mux.output_video};
  writeAudioManifest(manifestPath, manifest);
  return {enabled: true, manifest, manifest_path: resolve(manifestPath), output_video: mux.output_video};
};

export const readAudioOptions = (path) => JSON.parse(readFileSync(resolve(path), 'utf8'));

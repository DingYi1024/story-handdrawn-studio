import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync, statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {
  applyNarrationDurations,
  buildAudioMixGraph,
  buildFfmpegMuxArgs,
  materializeAudioManifest,
  muxAudioIntoVideo,
  planAudioManifest,
  planSceneTimeline,
  probeAudioDuration,
  synthesizeOpenAiSpeech,
} from '../scripts/lib/audio.mjs';

test('voiceover duration can extend only the scenes that need more reading time', () => {
  const manifest = planAudioManifest(storyboard, {enabled: true});
  manifest.scenes[0].voiceover.duration_sec = 2.4;
  manifest.scenes[1].voiceover.duration_sec = 1.2;
  const adjusted = applyNarrationDurations(storyboard, manifest, 0.5);
  assert.deepEqual(adjusted.changedSceneIds, ['one']);
  assert.equal(adjusted.storyboard.scenes[0].duration_sec, 2.9);
  assert.equal(adjusted.storyboard.scenes[1].duration_sec, 2);
  assert.equal(storyboard.scenes[0].duration_sec, 2);
});

const storyboard = {
  project: {
    title: 'Audio test',
    fps: 10,
    transition: 'page-flip',
    transition_sec: 0.5,
  },
  scenes: [
    {id: 'one', duration_sec: 2, narration: '第一句。'},
    {id: 'two', duration_sec: 2, narration: '第二句。'},
  ],
};

test('audio planning follows the frame-accurate scene timeline and is disabled by default', () => {
  const timeline = planSceneTimeline(storyboard);
  assert.equal(timeline.transition_frames, 5);
  assert.equal(timeline.scenes[1].start_sec, 1.5);
  assert.equal(timeline.duration_sec, 3.5);

  const disabled = planAudioManifest(storyboard);
  assert.equal(disabled.enabled, false);
  assert.equal(disabled.scenes[0].voiceover.model, 'tts-1-hd');
  assert.equal(disabled.scenes[0].voiceover.voice, 'alloy');
  assert.equal(disabled.scenes[0].voiceover.response_format, 'mp3');

  const enabled = planAudioManifest(storyboard, {
    enabled: true,
    base_dir: 'D:/media',
    voiceover: {one: 'narration.wav'},
    bgm: {path: 'music.mp3', volume: 0.5},
    sfx: [{id: 'pop', scene_id: 'two', offset_sec: 0.25, path: 'pop.wav'}],
    mix: {bgm_volume: 0.2, target_lufs: -18},
  });
  assert.equal(enabled.scenes[0].voiceover.type, 'file');
  assert.equal(enabled.scenes[1].voiceover.type, 'tts');
  assert.equal(enabled.bgm.loop, true);
  assert.equal(enabled.sfx[0].start_sec, 1.75);
  assert.equal(enabled.mix.target_lufs, -18);
});

test('OpenAI speech uses injected fetch, requested defaults, and requires an API key', async () => {
  const root = mkdtempSync(resolve(tmpdir(), 'story-audio-api-'));
  try {
    const outputPath = resolve(root, 'voice.mp3');
    let request;
    const fetchImpl = async (url, options) => {
      request = {url, options};
      return {
        ok: true,
        arrayBuffer: async () => Uint8Array.from([1, 2, 3, 4]).buffer,
      };
    };
    await synthesizeOpenAiSpeech({text: '  hello  ', outputPath, apiKey: 'test-key', fetchImpl});
    const body = JSON.parse(request.options.body);
    assert.equal(request.url, 'https://api.openai.com/v1/audio/speech');
    assert.equal(request.options.method, 'POST');
    assert.equal(request.options.headers.Authorization, 'Bearer test-key');
    assert.deepEqual(body, {
      model: 'tts-1-hd',
      voice: 'alloy',
      input: 'hello',
      response_format: 'mp3',
    });
    assert.equal(statSync(outputPath).size, 4);

    let called = false;
    await assert.rejects(
      synthesizeOpenAiSpeech({
        text: 'hello',
        outputPath,
        apiKey: '',
        fetchImpl: async () => {
          called = true;
        },
      }),
      /OPENAI_API_KEY/,
    );
    assert.equal(called, false);
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
});

test('ffmpeg plan delays scene tracks, loops BGM, and keeps video stream untouched', () => {
  const root = resolve('D:/audio-project');
  const manifest = planAudioManifest(storyboard, {
    enabled: true,
    tts: {enabled: false},
    voiceover: {two: 'D:/source/voice.wav'},
    bgm: 'D:/source/bed.mp3',
    sfx: [{scene_id: 'two', offset_sec: 0.25, path: 'D:/source/pop.wav'}],
  });
  manifest.scenes[1].voiceover.materialized_path = manifest.scenes[1].voiceover.asset_path;
  manifest.bgm.materialized_path = manifest.bgm.asset_path;
  manifest.sfx[0].materialized_path = manifest.sfx[0].asset_path;
  const {filter, tracks} = buildAudioMixGraph(manifest, root);
  assert.equal(tracks.length, 3);
  assert.match(filter, /adelay=1500:all=1/);
  assert.match(filter, /adelay=1750:all=1/);
  assert.match(filter, /loudnorm=I=-16:TP=-1.5:LRA=11/);
  assert.match(filter, /apad=pad_dur=3.5/);

  const args = buildFfmpegMuxArgs({
    manifest,
    projectDir: root,
    inputVideo: 'D:/video/silent.mp4',
    outputVideo: 'D:/video/with-audio.mp4',
  });
  assert.ok(args.includes('-stream_loop'));
  assert.equal(args[args.indexOf('-c:v') + 1], 'copy');
  assert.equal(args[args.indexOf('-map') + 1], '0:v:0');
  assert.equal(args.includes('-shortest'), false);
});

const commandAvailable = (command) => {
  const result = spawnSync(command, ['-version'], {encoding: 'utf8', stdio: 'pipe'});
  return !result.error && result.status === 0;
};

test('small ffmpeg integration copies, probes, mixes, and muxes audio', {
  skip: !(commandAvailable('ffmpeg') && commandAvailable('ffprobe')),
}, async () => {
  const root = mkdtempSync(resolve(tmpdir(), 'story-audio-ffmpeg-'));
  try {
    const video = resolve(root, 'silent.mp4');
    const tone = resolve(root, 'tone.wav');
    const output = resolve(root, 'with-audio.mp4');
    const videoResult = spawnSync('ffmpeg', [
      '-y', '-f', 'lavfi', '-i', 'color=c=black:s=160x120:d=1:r=10',
      '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', video,
    ], {encoding: 'utf8', stdio: 'pipe'});
    assert.equal(videoResult.status, 0, videoResult.stderr);
    const toneResult = spawnSync('ffmpeg', [
      '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.35',
      '-c:a', 'pcm_s16le', tone,
    ], {encoding: 'utf8', stdio: 'pipe'});
    assert.equal(toneResult.status, 0, toneResult.stderr);

    const simpleStoryboard = {
      project: {title: 'Mux', fps: 10, transition: 'cut'},
      scenes: [{id: 'only', duration_sec: 1, narration: 'provided'}],
    };
    let manifest = planAudioManifest(simpleStoryboard, {
      enabled: true,
      tts: {enabled: false},
      voiceover: {only: tone},
      bgm: {path: tone, volume: 0.25},
      sfx: [{scene_id: 'only', offset_sec: 0.4, path: tone}],
      mix: {target_lufs: false, limiter: false},
    });
    manifest = await materializeAudioManifest(manifest, root);
    assert.ok(manifest.scenes[0].voiceover.duration_sec > 0.3);
    assert.ok(readFileSync(resolve(root, manifest.bgm.materialized_path)).length > 0);

    const muxed = muxAudioIntoVideo({manifest, projectDir: root, inputVideo: video, outputVideo: output});
    assert.equal(muxed.audio.codec, 'aac');
    assert.equal(muxed.audio.channels, 2);
    assert.ok(probeAudioDuration(output) > 0.9);
    const streams = spawnSync('ffprobe', [
      '-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'json', output,
    ], {encoding: 'utf8', stdio: 'pipe'});
    assert.equal(streams.status, 0, streams.stderr);
    const types = JSON.parse(streams.stdout).streams.map((stream) => stream.codec_type);
    assert.deepEqual(types.sort(), ['audio', 'video']);
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
});

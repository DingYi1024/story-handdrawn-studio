import {spawnSync} from 'node:child_process';
import {existsSync, mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {planSceneTimeline} from './audio.mjs';

export const AUDIO_DIRECTOR_SCHEMA_VERSION = 1;

const EVENT_RULES = [
  {type: 'rain', words: ['雨', '雨伞', '雨滴', '暴雨', '淋湿'], offset: 0.35, gain: 0.42},
  {type: 'water', words: ['河', '海', '湖', '水', '溪', '浪'], offset: 0.6, gain: 0.3},
  {type: 'bird', words: ['鸟', '清晨', '树林', '森林', '春天'], offset: 0.55, gain: 0.32},
  {type: 'steps', words: ['走', '跑', '回家', '脚步', '路上'], offset: 0.65, gain: 0.38},
  {type: 'chime', words: ['发现', '终于', '希望', '发芽', '礼物', '亮'], offset: 0.8, gain: 0.34},
];

const moodFor = (text) => {
  if (/[悲伤难过失去离开哭泪]/u.test(text)) return 'tender';
  if (/[快乐开心惊喜希望温暖回家发芽阳光]/u.test(text)) return 'warm';
  if (/[紧张害怕危险追赶暴雨黑夜]/u.test(text)) return 'suspense';
  return 'calm';
};

export const createAutomaticAudioPlan = (storyboard, options = {}) => {
  const timeline = planSceneTimeline(storyboard);
  const fullText = storyboard.scenes.map((scene) => `${scene.text || ''}${scene.narration || ''}`).join('');
  const events = [];
  for (const [index, scene] of storyboard.scenes.entries()) {
    const text = `${scene.text || ''}${scene.narration || ''}`;
    for (const rule of EVENT_RULES) {
      if (!rule.words.some((word) => text.includes(word))) continue;
      events.push({
        id: `${rule.type}-${String(index + 1).padStart(2, '0')}`,
        type: rule.type,
        scene_id: String(scene.id),
        offset_sec: Math.min(rule.offset, Math.max(0, timeline.scenes[index].duration_sec - 0.15)),
        volume: rule.gain,
        reason: `scene contains ${rule.words.find((word) => text.includes(word))}`,
      });
      break;
    }
  }
  if (timeline.transition_frames > 0) {
    for (let index = 0; index < storyboard.scenes.length - 1; index += 1) {
      const scene = timeline.scenes[index];
      events.push({
        id: `page-turn-${String(index + 1).padStart(2, '0')}`,
        type: 'page-turn',
        scene_id: scene.id,
        offset_sec: Math.max(0, scene.duration_sec - timeline.transition_frames / timeline.fps),
        volume: 0.42,
        reason: 'page-flip transition',
      });
    }
  }
  return {
    schema_version: AUDIO_DIRECTOR_SCHEMA_VERSION,
    mode: 'automatic-procedural',
    mood: options.mood || moodFor(fullText),
    duration_sec: timeline.duration_sec,
    events,
    narration: {mode: options.narration || 'none', note: 'Use OpenAI TTS or supplied recordings when narration is requested.'},
  };
};

const run = (ffmpeg, args) => {
  const result = spawnSync(ffmpeg, args, {encoding: 'utf8', windowsHide: true});
  if (result.error || result.status !== 0) {
    throw new Error(`ffmpeg audio synthesis failed: ${result.error?.message || result.stderr || result.status}`);
  }
};

const moodFrequencies = {
  calm: [174.61, 220],
  warm: [196, 246.94],
  tender: [164.81, 207.65],
  suspense: [146.83, 155.56],
};

const synthesizeBed = (path, duration, mood, ffmpeg) => {
  const [first, second] = moodFrequencies[mood] || moodFrequencies.calm;
  run(ffmpeg, [
    '-v', 'error', '-y',
    '-f', 'lavfi', '-i', `sine=frequency=${first}:duration=${duration}:sample_rate=48000`,
    '-f', 'lavfi', '-i', `sine=frequency=${second}:duration=${duration}:sample_rate=48000`,
    '-filter_complex', `[0:a]volume=0.055[a0];[1:a]volume=0.035,tremolo=f=0.12:d=0.25[a1];[a0][a1]amix=inputs=2:normalize=0,lowpass=f=1100,afade=t=in:st=0:d=1.2,afade=t=out:st=${Math.max(0, duration - 1.4)}:d=1.4`,
    '-c:a', 'pcm_s16le', path,
  ]);
};

const effectSource = {
  'page-turn': ['anoisesrc=color=pink:duration=0.42:sample_rate=48000', 'highpass=f=650,lowpass=f=6200,afade=t=in:st=0:d=0.03,afade=t=out:st=0.12:d=0.3,volume=0.35'],
  rain: ['anoisesrc=color=white:duration=1.8:sample_rate=48000', 'highpass=f=1800,lowpass=f=7600,tremolo=f=7:d=0.35,afade=t=out:st=1.2:d=0.6,volume=0.16'],
  water: ['sine=frequency=330:duration=1.3:sample_rate=48000', 'tremolo=f=4:d=0.8,lowpass=f=900,afade=t=out:st=0.7:d=0.6,volume=0.18'],
  bird: ['sine=frequency=1850:duration=0.7:sample_rate=48000', 'tremolo=f=9:d=0.75,afade=t=out:st=0.35:d=0.35,volume=0.16'],
  steps: ['sine=frequency=95:duration=0.65:sample_rate=48000', 'tremolo=f=4:d=1,lowpass=f=260,afade=t=out:st=0.35:d=0.3,volume=0.32'],
  chime: ['sine=frequency=880:duration=1.15:sample_rate=48000', 'aecho=0.65:0.45:90|180:0.28|0.16,afade=t=out:st=0.55:d=0.6,volume=0.13'],
};

const synthesizeEffect = (path, type, ffmpeg) => {
  const [source, filter] = effectSource[type] || effectSource.chime;
  run(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', source, '-af', filter, '-c:a', 'pcm_s16le', path]);
};

export const materializeAutomaticAudioPlan = (plan, projectDir, options = {}) => {
  const ffmpeg = options.ffmpeg || 'ffmpeg';
  const directory = resolve(projectDir, 'audio', 'automatic');
  mkdirSync(directory, {recursive: true});
  const bedPath = resolve(directory, `bed-${plan.mood}.wav`);
  if (!existsSync(bedPath)) synthesizeBed(bedPath, Math.max(1, plan.duration_sec), plan.mood, ffmpeg);
  const paths = new Map();
  const sfx = plan.events.map((event) => {
    if (!paths.has(event.type)) {
      const path = resolve(directory, `${event.type}.wav`);
      if (!existsSync(path)) synthesizeEffect(path, event.type, ffmpeg);
      paths.set(event.type, path);
    }
    return {
      id: event.id,
      scene_id: event.scene_id,
      offset_sec: event.offset_sec,
      path: paths.get(event.type),
      volume: event.volume,
    };
  });
  return {
    enabled: true,
    base_dir: projectDir,
    tts: {enabled: false, provider: 'openai'},
    bgm: {path: bedPath, volume: 1, loop: true},
    sfx,
    mix: {voiceover_volume: 1, bgm_volume: 0.14, sfx_volume: 0.75},
    automatic_plan: plan,
  };
};

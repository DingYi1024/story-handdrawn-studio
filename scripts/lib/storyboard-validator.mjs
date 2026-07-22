import {existsSync, readFileSync} from 'node:fs';
import {isAbsolute, relative, resolve} from 'node:path';
import {parseRatio} from './presets.mjs';

const allowedLayers = new Set(['text', 'bw_full', 'detail', 'color']);

const pngDimensions = (path) => {
  if (!path.toLowerCase().endsWith('.png')) return null;
  const bytes = readFileSync(path);
  if (bytes.length < 24 || bytes.toString('ascii', 1, 4) !== 'PNG') return null;
  return {width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20)};
};

const containedAssetPath = (publicDir, assetPath) => {
  const absolute = resolve(publicDir, assetPath);
  const rel = relative(publicDir, absolute);
  if (rel.startsWith('..') || isAbsolute(rel)) return null;
  return absolute;
};

export const validateStoryboardObject = (
  storyboard,
  {publicDir, skipAssets = false} = {},
) => {
  const errors = [];
  const ids = new Set();
  const project = storyboard?.project;
  if (!project || !Array.isArray(storyboard?.scenes) || storyboard.scenes.length === 0) {
    return {errors: ['storyboard must contain project and at least one scene'], summary: null};
  }

  const expectedRatio = parseRatio(project.ratio);
  if (!expectedRatio) errors.push('project.ratio must use W:H');
  if (!Number.isInteger(project.width) || project.width <= 0 || project.width % 2 !== 0) {
    errors.push('project.width must be a positive even integer');
  }
  if (!Number.isInteger(project.height) || project.height <= 0 || project.height % 2 !== 0) {
    errors.push('project.height must be a positive even integer');
  }
  if (
    expectedRatio &&
    project.width &&
    project.height &&
    Math.abs(project.width / project.height - expectedRatio) > 0.002
  ) {
    errors.push('project width/height must match project.ratio');
  }
  if (!Number.isFinite(project.fps) || project.fps <= 0 || project.fps > 120) {
    errors.push('project.fps must be between 1 and 120');
  }
  if (!['cut', 'page-flip'].includes(project.transition || 'cut')) {
    errors.push('project.transition must be cut or page-flip');
  }
  if (
    project.transition === 'page-flip' &&
    (!(project.transition_sec > 0) || project.transition_sec > 2)
  ) {
    errors.push('page-flip transition_sec must be greater than 0 and at most 2');
  }
  if (project.audio?.voiceover !== 'post') errors.push('audio.voiceover must be post');
  if (project.audio?.bgm_follows_text !== false) {
    errors.push('audio.bgm_follows_text must be false');
  }
  if (project.mode === 'speed') {
    if (project.images_per_scene !== 1) errors.push('speed mode requires images_per_scene=1');
    if (project.derive_bw !== 'local') errors.push('speed mode requires derive_bw=local');
    if (project.enable_detail !== false) errors.push('speed mode requires enable_detail=false');
  }

  const layout = project.layout;
  if (layout) {
    for (const key of [
      'caption_top_ratio',
      'caption_height_ratio',
      'illustration_top_ratio',
      'side_margin_ratio',
      'bottom_margin_ratio',
    ]) {
      if (!Number.isFinite(layout[key]) || layout[key] < 0 || layout[key] >= 0.8) {
        errors.push(`project.layout.${key} must be between 0 and 0.8`);
      }
    }
  }

  const captionLimit =
    (project.caption?.max_chars_per_line || 15) * (project.caption?.max_lines || 3);
  for (const scene of storyboard.scenes) {
    const label = scene?.id || '(unknown scene)';
    if (!scene || !Array.isArray(scene.layers) || !scene.assets) {
      errors.push(`${label}: layers and assets are required`);
      continue;
    }
    if (typeof scene.id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(scene.id)) {
      errors.push(`${label}: id must contain only letters, numbers, underscore, or hyphen`);
    }
    if (ids.has(scene.id)) errors.push(`duplicate scene id: ${scene.id}`);
    ids.add(scene.id);
    if (!Number.isFinite(scene.duration_sec) || scene.duration_sec <= 0) {
      errors.push(`${label}: duration must be positive`);
    }
    if (typeof scene.text !== 'string') errors.push(`${label}: text must be a string`);
    else if ([...scene.text.replace(/\n/g, '')].length > captionLimit) {
      errors.push(`${label}: text exceeds configured caption capacity (${captionLimit})`);
    }
    if (scene.narration !== undefined && typeof scene.narration !== 'string') {
      errors.push(`${label}: narration must be a string when provided`);
    }
    for (const layer of scene.layers) {
      if (!allowedLayers.has(layer)) errors.push(`${label}: unsupported layer ${layer}`);
    }
    if (new Set(scene.layers).size !== scene.layers.length) {
      errors.push(`${label}: layers must not contain duplicates`);
    }

    const hasText = scene.layers.includes('text');
    const illustrated = scene.layers.includes('bw_full');
    const bwIndex = scene.layers.indexOf('bw_full');
    const textIndex = scene.layers.indexOf('text');
    const colorIndex = scene.layers.indexOf('color');
    if ((scene.text || scene.assets.text_image) && !hasText) {
      errors.push(`${label}: text content requires a text layer`);
    }
    if (illustrated && (!scene.assets.bw || !scene.assets.color)) {
      errors.push(`${label}: illustrated scenes require bw and color assets`);
    }
    if (illustrated && bwIndex > colorIndex) {
      errors.push(`${label}: bw_full must appear before color`);
    }
    if (illustrated && hasText && bwIndex > textIndex) {
      errors.push(`${label}: bw_full must appear before text to prevent blank opening frames`);
    }
    if (hasText && textIndex > colorIndex) {
      errors.push(`${label}: text must appear before color`);
    }
    if (!scene.assets.color || colorIndex < 0) {
      errors.push(`${label}: a color layer and asset are required`);
    }
    if (project.mode === 'speed' && scene.assets.detail) {
      errors.push(`${label}: detail asset must be null in speed mode`);
    }

    const plateSizes = [];
    for (const [key, assetPath] of Object.entries(scene.assets)) {
      if (assetPath !== null && assetPath !== undefined && typeof assetPath !== 'string') {
        errors.push(`${label}: ${key} asset must be a path or null`);
        continue;
      }
      if (!assetPath) continue;
      if (!publicDir) continue;
      const absolute = containedAssetPath(publicDir, assetPath);
      if (!absolute) {
        errors.push(`${label}: ${key} asset escapes the public directory`);
        continue;
      }
      if (!existsSync(absolute) && !skipAssets) {
        errors.push(`${label}: missing ${key} asset at public/${assetPath}`);
        continue;
      }
      if (!existsSync(absolute)) continue;
      const dimensions = pngDimensions(absolute);
      if (
        key === 'text_image' &&
        dimensions &&
        Math.abs(dimensions.width / dimensions.height - 3) > 0.08
      ) {
        errors.push(`${label}: generated text plate must use a 3:1 canvas`);
      }
      if (dimensions && ['bw', 'detail', 'color'].includes(key)) {
        plateSizes.push(`${dimensions.width}x${dimensions.height}`);
      }
    }
    if (illustrated && new Set(plateSizes).size > 1) {
      errors.push(`${label}: bw/detail/color plate dimensions must match exactly`);
    }
  }

  const duration = storyboard.scenes.reduce((sum, scene) => sum + scene.duration_sec, 0);
  return {
    errors,
    summary: {
      scenes: storyboard.scenes.length,
      duration_seconds: Number(duration.toFixed(1)),
      ratio: project.ratio,
      width: project.width,
      height: project.height,
      fps: project.fps,
    },
  };
};

export const validateStoryboardFile = (path, options = {}) => {
  if (!existsSync(path)) return {errors: [`missing storyboard: ${path}`], summary: null};
  try {
    const storyboard = JSON.parse(readFileSync(path, 'utf8'));
    return {...validateStoryboardObject(storyboard, options), storyboard};
  } catch (error) {
    return {errors: [`invalid JSON: ${error.message}`], summary: null};
  }
};

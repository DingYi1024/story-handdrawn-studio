export const DEFAULT_STYLE_LOCK =
  'minimalist Chinese diary comic, pure white background, uneven black felt-tip pen outlines, naive wobbly proportions, rough dense black crayon scribbles for dark areas, sparse props, abundant negative space, selective muted wax-crayon color only, no realistic shading, no paper texture, no watermark';

export const DEFAULT_CHARACTER_LOCK =
  '重复出现的主角须保持同一张脸、发型、年龄、服装配色和身体比例；具体人物身份以故事原文为准；不得添加原文未提及的配角、道具或文字';

export const PRESETS = {
  portrait: {ratio: '3:4', width: 1080, height: 1440, fps: 30},
  vertical: {ratio: '9:16', width: 1080, height: 1920, fps: 30},
  square: {ratio: '1:1', width: 1080, height: 1080, fps: 30},
  landscape: {ratio: '16:9', width: 1920, height: 1080, fps: 30},
};

const aliases = {
  '3:4': 'portrait',
  '9:16': 'vertical',
  '1:1': 'square',
  '16:9': 'landscape',
};

const clone = (value) => JSON.parse(JSON.stringify(value));

const deepMerge = (left, right) => {
  const output = clone(left);
  for (const [key, value] of Object.entries(right || {})) {
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      output[key] &&
      typeof output[key] === 'object' &&
      !Array.isArray(output[key])
    ) {
      output[key] = deepMerge(output[key], value);
    } else {
      output[key] = clone(value);
    }
  }
  return output;
};

export const parseRatio = (ratio) => {
  const match = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(String(ratio));
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!(width > 0) || !(height > 0)) return null;
  return width / height;
};

/** Largest exact-ratio, even-pixel preview canvas at or below maxWidth. */
export const calculatePreviewCanvas = (canvas, maxWidth) => {
  const limit = Math.min(Number(maxWidth), Number(canvas?.width));
  if (!Number.isInteger(limit) || limit < 2 || !Number.isInteger(canvas?.width) || !Number.isInteger(canvas?.height)) {
    throw new Error('Preview canvas requires integer source dimensions and maxWidth');
  }
  for (let width = limit - (limit % 2); width >= 2; width -= 2) {
    const height = width * canvas.height / canvas.width;
    if (Number.isInteger(height) && height > 0 && height % 2 === 0) {
      return {width, height, scale: width / canvas.width};
    }
  }
  throw new Error(`Could not derive an even preview canvas for ${canvas.width}x${canvas.height}`);
};

export const createSettings = (presetName = 'portrait', overrides = {}) => {
  const resolvedName = aliases[presetName] || presetName;
  const canvas = PRESETS[resolvedName];
  if (!canvas) {
    throw new Error(
      `Unknown preset "${presetName}". Choose ${Object.keys(PRESETS).join(', ')}`,
    );
  }
  const base = {
    preset: resolvedName,
    canvas,
    caption: {
      max_chars_per_line: 13,
      max_lines: 3,
    },
    timing: {
      soft_sentence_limit: 36,
      minimum_scene_seconds: 4.4,
      maximum_scene_seconds: 12,
      base_seconds: 3.8,
      seconds_per_line: 0.48,
      seconds_per_character: 0.035,
      reading_characters_per_second: 4.2,
      reading_tail_seconds: 0.8,
      uploaded_page_seconds: 4.4,
    },
    layout: {
      caption_top_ratio: 0.06,
      caption_height_ratio: 0.2,
      illustration_top_ratio: 0.265,
      side_margin_ratio: 0.0685,
      bottom_margin_ratio: 0.03,
    },
    transition: {type: 'cut', seconds: 0.7},
    visual: {
      style_lock: DEFAULT_STYLE_LOCK,
      character_lock: DEFAULT_CHARACTER_LOCK,
      palette: ['sage green', 'dusty blue', 'warm tan', 'brick red', 'warm yellow'],
    },
    render: {
      preview_width: 720,
      final_crf: 18,
      preview_crf: 23,
      concurrency: 1,
    },
    audio: {
      enabled: false,
      provider: 'none',
      model: 'tts-1-hd',
      voice: 'alloy',
      format: 'mp3',
      voiceover_volume: 1,
      bgm_volume: 0.14,
      sfx_volume: 0.35,
      narration_tail_seconds: 0.45,
    },
    provider: {id: 'auto', max_attempts: 3},
    review: {semantic_strict: false},
  };
  const settings = deepMerge(base, overrides);
  validateSettings(settings);
  return settings;
};

export const validateSettings = (settings) => {
  const errors = [];
  const canvas = settings?.canvas;
  const expectedRatio = parseRatio(canvas?.ratio);
  if (!canvas || !expectedRatio) errors.push('canvas.ratio must use W:H');
  if (!Number.isInteger(canvas?.width) || canvas.width <= 0 || canvas.width % 2 !== 0) {
    errors.push('canvas.width must be a positive even integer');
  }
  if (!Number.isInteger(canvas?.height) || canvas.height <= 0 || canvas.height % 2 !== 0) {
    errors.push('canvas.height must be a positive even integer');
  }
  if (
    expectedRatio &&
    canvas?.width &&
    canvas?.height &&
    Math.abs(canvas.width / canvas.height - expectedRatio) > 0.002
  ) {
    errors.push('canvas dimensions must match canvas.ratio');
  }
  if (!Number.isFinite(canvas?.fps) || canvas.fps < 1 || canvas.fps > 120) {
    errors.push('canvas.fps must be between 1 and 120');
  }

  const caption = settings?.caption;
  if (!Number.isInteger(caption?.max_chars_per_line) || caption.max_chars_per_line < 4) {
    errors.push('caption.max_chars_per_line must be an integer of at least 4');
  }
  if (!Number.isInteger(caption?.max_lines) || caption.max_lines < 1 || caption.max_lines > 8) {
    errors.push('caption.max_lines must be between 1 and 8');
  }

  const timing = settings?.timing;
  if (!(timing?.minimum_scene_seconds > 0)) errors.push('timing minimum must be positive');
  if (!(timing?.maximum_scene_seconds >= timing?.minimum_scene_seconds)) {
    errors.push('timing maximum must be at least the minimum');
  }
  if (!(timing?.reading_characters_per_second > 0)) {
    errors.push('timing.reading_characters_per_second must be positive');
  }

  const layout = settings?.layout;
  for (const key of [
    'caption_top_ratio',
    'caption_height_ratio',
    'illustration_top_ratio',
    'side_margin_ratio',
    'bottom_margin_ratio',
  ]) {
    if (!Number.isFinite(layout?.[key]) || layout[key] < 0 || layout[key] >= 0.8) {
      errors.push(`layout.${key} must be between 0 and 0.8`);
    }
  }
  if ((layout?.caption_top_ratio || 0) + (layout?.caption_height_ratio || 0) > 0.6) {
    errors.push('caption region must fit in the upper 60% of the canvas');
  }
  if ((layout?.illustration_top_ratio || 0) + (layout?.bottom_margin_ratio || 0) >= 0.95) {
    errors.push('illustration region is too small');
  }

  if (!['cut', 'page-flip'].includes(settings?.transition?.type)) {
    errors.push('transition.type must be cut or page-flip');
  }
  if (!(settings?.transition?.seconds > 0) || settings.transition.seconds > 2) {
    errors.push('transition.seconds must be greater than 0 and at most 2');
  }
  const render = settings?.render;
  if (!Number.isInteger(render?.preview_width) || render.preview_width < 160) {
    errors.push('render.preview_width must be an integer of at least 160');
  }
  if (!Number.isInteger(render?.concurrency) || render.concurrency < 1 || render.concurrency > 16) {
    errors.push('render.concurrency must be between 1 and 16');
  }

  const audio = settings?.audio;
  if (audio !== undefined) {
    if (typeof audio.enabled !== 'boolean') errors.push('audio.enabled must be boolean');
    if (!['none', 'auto', 'openai', 'files'].includes(audio.provider)) {
      errors.push('audio.provider must be none, auto, openai, or files');
    }
    if (!['mp3', 'wav', 'aac', 'flac', 'opus'].includes(audio.format)) {
      errors.push('audio.format must be mp3, wav, aac, flac, or opus');
    }
    for (const key of ['voiceover_volume', 'bgm_volume', 'sfx_volume']) {
      if (!Number.isFinite(audio[key]) || audio[key] < 0 || audio[key] > 2) {
        errors.push(`audio.${key} must be between 0 and 2`);
      }
    }
    if (!Number.isFinite(audio.narration_tail_seconds) || audio.narration_tail_seconds < 0 || audio.narration_tail_seconds > 5) {
      errors.push('audio.narration_tail_seconds must be between 0 and 5');
    }
  }

  if (!['auto', 'codex', 'openai', 'files'].includes(settings?.provider?.id)) {
    errors.push('provider.id must be auto, codex, openai, or files');
  }
  if (!Number.isInteger(settings?.provider?.max_attempts) || settings.provider.max_attempts < 1 || settings.provider.max_attempts > 10) {
    errors.push('provider.max_attempts must be between 1 and 10');
  }
  if (typeof settings?.review?.semantic_strict !== 'boolean') {
    errors.push('review.semantic_strict must be boolean');
  }

  if (errors.length) throw new Error(`Invalid project settings:\n- ${errors.join('\n- ')}`);
  return settings;
};

export const mergeSettings = (settings, overrides) => {
  const merged = deepMerge(settings, overrides);
  validateSettings(merged);
  return merged;
};

import {createSettings, mergeSettings} from './presets.mjs';

export const PROJECT_TEMPLATES = Object.freeze({
  'gentle-diary': {
    label: '温柔日记', preset: 'vertical',
    settings: {transition: {type: 'page-flip', seconds: 0.7}, audio: {enabled: true, provider: 'auto'}},
  },
  'warm-memory': {
    label: '温暖回忆', preset: 'portrait',
    settings: {transition: {type: 'page-flip', seconds: 0.8}, visual: {palette: ['warm tan', 'dusty rose', 'sage green']}},
  },
  children: {
    label: '儿童故事', preset: 'vertical',
    settings: {caption: {max_chars_per_line: 11, max_lines: 3}, timing: {reading_characters_per_second: 3.5}},
  },
  science: {
    label: '科普解释', preset: 'landscape',
    settings: {caption: {max_chars_per_line: 18, max_lines: 3}, transition: {type: 'cut', seconds: 0.45}},
  },
  'uploaded-comic': {
    label: '上传漫画', preset: 'vertical',
    settings: {transition: {type: 'page-flip', seconds: 0.65}, audio: {enabled: true, provider: 'auto'}},
  },
});

export const listTemplates = () => Object.entries(PROJECT_TEMPLATES).map(([id, value]) => ({id, ...value}));

export const createSettingsFromTemplate = (templateId, presetOverride, overrides = {}) => {
  const template = PROJECT_TEMPLATES[templateId];
  if (!template) throw new Error(`Unknown template "${templateId}"`);
  const base = createSettings(presetOverride || template.preset, template.settings);
  return mergeSettings(base, overrides);
};

import {createHash} from 'node:crypto';

export const CREATIVE_DIRECTOR_SCHEMA_VERSION = 1;

export const NARRATIVE_ARCS = Object.freeze({
  warm_story: {
    label: '温暖故事',
    use: '日记、回忆、治愈、人与城市',
    rhythm: ['push_in', 'pan_left', 'parallax', 'static', 'pull_out'],
  },
  suspense_reveal: {
    label: '悬念揭晓',
    use: '谜题、反转、发现、秘密',
    rhythm: ['push_in', 'static', 'pan_right', 'push_in', 'pull_out'],
  },
  growth_arc: {
    label: '成长弧',
    use: '困境、行动、变化、收获',
    rhythm: ['static', 'push_in', 'parallax', 'pan_left', 'pull_out'],
  },
  knowledge_explainer: {
    label: '知识解释',
    use: '科普、原理、步骤、概念',
    rhythm: ['pan_left', 'push_in', 'static', 'pan_right', 'pull_out'],
  },
  brand_story: {
    label: '品牌故事',
    use: '创始人、产品价值、服务与行动号召',
    rhythm: ['push_in', 'parallax', 'static', 'pan_left', 'pull_out'],
  },
  loop_short: {
    label: '循环短片',
    use: '15–30 秒短视频、首尾呼应',
    rhythm: ['push_in', 'pan_right', 'parallax', 'pull_out', 'push_in'],
  },
});

export const HANDDRAWN_THEMES = Object.freeze({
  'warm-diary': {
    label: '温暖日记',
    palette: ['warm tan', 'dusty rose', 'sage green', 'warm yellow'],
    line: 'uneven black felt-tip outlines with selective wax-crayon colour',
    texture: 'clean white diary paper with sparse hand-drawn marks',
    motionStyle: 'calm',
  },
  'rainy-ink': {
    label: '雨夜墨线',
    palette: ['ink black', 'rain blue', 'cool grey', 'one warm window yellow'],
    line: 'loose wet ink and dry-brush linework',
    texture: 'subtle water bloom and paper tooth',
    motionStyle: 'calm',
  },
  'child-crayon': {
    label: '儿童蜡笔',
    palette: ['sunflower yellow', 'grass green', 'sky blue', 'brick red'],
    line: 'naive thick crayon outlines and playful proportions',
    texture: 'visible wax grain on warm white paper',
    motionStyle: 'playful',
  },
  'woodcut-story': {
    label: '木刻故事',
    palette: ['charcoal black', 'paper cream', 'muted vermilion'],
    line: 'bold carved marks and high-contrast hand-print shapes',
    texture: 'rough fibre, ink gaps and imperfect registration',
    motionStyle: 'punchy',
  },
  'science-notebook': {
    label: '科学手账',
    palette: ['graphite', 'dusty blue', 'signal orange', 'mint green'],
    line: 'precise hand-drawn diagrams mixed with friendly sketch lines',
    texture: 'notebook paper, arrows, labels and restrained marker fills',
    motionStyle: 'precise',
  },
});

export const themeStyleLock = (themeId) => {
  const theme = HANDDRAWN_THEMES[themeId];
  if (!theme) throw new Error(`Unknown hand-drawn theme: ${themeId}`);
  return `${theme.line}; ${theme.texture}; palette: ${theme.palette.join(', ')}; hand-drawn illustration, stable character identity, no photorealism, no generated text, no logo, no watermark`;
};

export const rewritePromptStyle = (prompt, themeId) => {
  const styleLine = `Style: ${themeStyleLock(themeId)}`;
  let rewritten = String(prompt || '')
    .replace(/\n*Creative Director theme:[^\n]*\.?\n?/gi, '\n')
    .trim();
  rewritten = /^Style:\s*.*$/m.test(rewritten)
    ? rewritten.replace(/^Style:\s*.*$/m, styleLine)
    : `${rewritten}\n${styleLine}`;
  return `${rewritten.trim()}\n`;
};

export const applyThemeToSettings = (settingsInput, themeId, arc = null) => {
  const settings = clone(settingsInput);
  const theme = HANDDRAWN_THEMES[themeId];
  if (!theme) throw new Error(`Unknown hand-drawn theme: ${themeId}`);
  settings.director = {...settings.director, ...(arc ? {arc} : {}), theme: themeId};
  settings.visual = {...settings.visual, style_lock: themeStyleLock(themeId), palette: [...theme.palette]};
  return settings;
};

export const CAMERA_MOVES = Object.freeze([
  'static', 'push_in', 'pull_out', 'pan_left', 'pan_right', 'tilt_up', 'tilt_down', 'parallax',
]);

const textOf = (value) => String(value || '').toLowerCase();
const includesAny = (value, terms) => terms.some((term) => value.includes(term));
const clone = (value) => JSON.parse(JSON.stringify(value));

export const recommendNarrativeArc = ({title = '', sourceText = '', sceneCount = 0} = {}) => {
  const text = `${textOf(title)} ${textOf(sourceText)}`;
  if (includesAny(text, ['为什么', '原理', '如何', '步骤', '科普', 'science', 'how ', 'what '])) return 'knowledge_explainer';
  if (includesAny(text, ['品牌', '产品', '客户', '创始', '服务', 'brand', 'product'])) return 'brand_story';
  if (includesAny(text, ['秘密', '突然', '没想到', '真相', '谜', '反转'])) return 'suspense_reveal';
  if (includesAny(text, ['成长', '终于', '坚持', '改变', '学会', '走出'])) return 'growth_arc';
  if (sceneCount <= 4 && [...text].length <= 160) return 'loop_short';
  return 'warm_story';
};

export const recommendTheme = ({title = '', sourceText = '', arc = ''} = {}) => {
  const text = `${textOf(title)} ${textOf(sourceText)}`;
  if (arc === 'knowledge_explainer') return 'science-notebook';
  if (includesAny(text, ['雨', '夜', '孤独', '墨', '黑白'])) return 'rainy-ink';
  if (includesAny(text, ['儿童', '孩子', '童年', '幼儿', '小朋友'])) return 'child-crayon';
  if (includesAny(text, ['历史', '战争', '革命', '古老', '史诗'])) return 'woodcut-story';
  return 'warm-diary';
};

const effectFor = (scene) => {
  const text = `${textOf(scene.text)} ${textOf(scene.visual)}`;
  if (includesAny(text, ['雨', '水滴', '雨伞'])) return 'rain';
  if (includesAny(text, ['花', '种子', '发芽', '树叶', '植物'])) return 'petals';
  if (includesAny(text, ['星', '光', '太阳', '灯', '希望'])) return 'sparkle';
  if (includesAny(text, ['纸', '信', '纸条', '书'])) return 'paper-float';
  return 'handheld-drift';
};

const alternateMove = (move) => ({
  push_in: 'static', pull_out: 'push_in', pan_left: 'push_in', pan_right: 'push_in',
  parallax: 'static', static: 'parallax', tilt_up: 'push_in', tilt_down: 'pull_out',
}[move] || 'static');

export const createSceneShots = (scene, index, sceneCount, arc = 'warm_story', options = {}) => {
  if (scene.shot === 'full_uploaded_page') return scene.shots || [];
  const rhythm = NARRATIVE_ARCS[arc]?.rhythm || NARRATIVE_ARCS.warm_story.rhythm;
  const move = rhythm[index % rhythm.length];
  const allowTwo = options.multiShot !== false && Number(scene.duration_sec) >= Number(options.twoShotMinimumSeconds || 5.8);
  const effect = effectFor(scene);
  const first = {
    id: 'a',
    duration_ratio: allowTwo ? 0.58 : 1,
    shot_size: index === 0 ? 'WIDE' : index === sceneCount - 1 ? 'MEDIUM' : 'WIDE',
    camera_move: move,
    focus: {x: 0.5, y: 0.56, scale: move === 'pull_out' ? 1.06 : 1},
    element_motion: [effect],
  };
  if (!allowTwo) return [first];
  return [
    first,
    {
      id: 'b',
      duration_ratio: 0.42,
      shot_size: index === sceneCount - 1 ? 'WIDE' : 'CLOSE',
      camera_move: alternateMove(move),
      focus: {x: 0.52, y: 0.58, scale: index === sceneCount - 1 ? 1.02 : 1.14},
      element_motion: effect === 'handheld-drift' ? ['ink-breathe'] : [effect, 'ink-breathe'],
    },
  ];
};

export const applyCreativeDirectionToStoryboard = (storyboardInput, {
  title = storyboardInput?.project?.title || '',
  sourceText = '',
  arc = null,
  theme = null,
  forceShots = false,
  multiShot = true,
} = {}) => {
  const storyboard = clone(storyboardInput);
  const selectedArc = arc || storyboard.project?.director?.arc || recommendNarrativeArc({title, sourceText, sceneCount: storyboard.scenes.length});
  if (!NARRATIVE_ARCS[selectedArc]) throw new Error(`Unknown narrative arc: ${selectedArc}`);
  const selectedTheme = theme || storyboard.project?.director?.theme || recommendTheme({title, sourceText, arc: selectedArc});
  if (!HANDDRAWN_THEMES[selectedTheme]) throw new Error(`Unknown hand-drawn theme: ${selectedTheme}`);
  storyboard.schema_version = Math.max(4, Number(storyboard.schema_version) || 0);
  storyboard.project.director = {
    schema_version: CREATIVE_DIRECTOR_SCHEMA_VERSION,
    arc: selectedArc,
    theme: selectedTheme,
    motion_style: HANDDRAWN_THEMES[selectedTheme].motionStyle,
    constraints: 'strict',
    style_approved: Boolean(storyboard.project?.director?.style_approved),
  };
  storyboard.scenes = storyboard.scenes.map((scene, index) => ({
    ...scene,
    shots: !forceShots && Array.isArray(scene.shots) && scene.shots.length
      ? scene.shots
      : createSceneShots(scene, index, storyboard.scenes.length, selectedArc, {multiShot}),
  }));
  return storyboard;
};

export const createStyleBakeoffPlan = ({projectId, title, sourceText = '', scene, outputDirectory, candidates = null}) => {
  if (!scene) throw new Error('A representative scene is required for a style bake-off');
  const recommended = recommendTheme({title, sourceText});
  const selected = candidates?.length
    ? candidates
    : [recommended, ...Object.keys(HANDDRAWN_THEMES).filter((id) => id !== recommended)].slice(0, 4);
  for (const id of selected) if (!HANDDRAWN_THEMES[id]) throw new Error(`Unknown hand-drawn theme: ${id}`);
  const jobs = selected.map((id) => {
    const theme = HANDDRAWN_THEMES[id];
    const prompt = [
      `Create one representative hand-drawn storyboard frame for "${title}".`,
      `Scene: ${scene.visual || scene.text}.`,
      `Look: ${theme.line}; ${theme.texture}.`,
      `Palette: ${theme.palette.join(', ')}.`,
      'Keep the composition identical in meaning across candidates. No text, logo, watermark, frame, or photorealism.',
    ].join('\n');
    return {id, label: theme.label, prompt, output: `${outputDirectory}/${id}.png`, status: 'pending'};
  });
  const fingerprint = createHash('sha256').update(JSON.stringify(jobs)).digest('hex').slice(0, 16);
  return {
    kind: 'style-bakeoff', schema_version: 1, project_id: projectId, representative_scene: scene.id,
    recommended, selected: null, approved: false, fingerprint, jobs,
  };
};

export const creativeDirectorCatalog = () => ({
  arcs: Object.entries(NARRATIVE_ARCS).map(([id, value]) => ({id, ...value})),
  themes: Object.entries(HANDDRAWN_THEMES).map(([id, value]) => ({id, ...value})),
  camera_moves: [...CAMERA_MOVES],
});

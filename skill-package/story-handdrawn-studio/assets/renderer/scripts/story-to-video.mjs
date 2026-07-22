import {execFileSync, spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  DEFAULT_CHARACTER_LOCK,
  DEFAULT_STYLE_LOCK,
  validateSettings,
} from './lib/presets.mjs';
import {durationFor, formatCaption, safeSlug, splitStory} from './lib/story-text.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const parseArgs = (tokens) => {
  const parsed = {};
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = tokens[index + 1];
    if (next && !next.startsWith('--')) {
      parsed[key] = next;
      index += 1;
    } else {
      parsed[key] = true;
    }
  }
  return parsed;
};

const args = parseArgs(process.argv.slice(2));
const publicDir = args['public-dir']
  ? resolve(root, String(args['public-dir']))
  : resolve(root, 'public');
if (!args.input && !args.text) {
  console.error(
    'Usage: npm run story -- --input examples/story.txt [--generate --apply --render]\n' +
      '       npm run story -- --text "第一句。第二句。"',
  );
  process.exit(1);
}

const workspacePath = args.workspace ? resolve(root, String(args.workspace)) : null;
const configPath = args.config ? resolve(root, String(args.config)) : null;
const studioProject = configPath
  ? JSON.parse(readFileSync(configPath, 'utf8'))
  : null;
const settings = studioProject?.settings || null;
if (settings) validateSettings(settings);
const canvas = settings?.canvas || {ratio: '3:4', width: 1080, height: 1440, fps: 30};
const captionSettings = settings?.caption || {
  max_chars_per_line: 13,
  max_lines: 3,
};
const timingSettings = settings?.timing || null;
const durationSettings = timingSettings
  ? {
      minimumSceneSeconds: timingSettings.minimum_scene_seconds,
      maximumSceneSeconds: timingSettings.maximum_scene_seconds,
      baseSeconds: timingSettings.base_seconds,
      secondsPerLine: timingSettings.seconds_per_line,
      secondsPerCharacter: timingSettings.seconds_per_character,
      readingCharactersPerSecond: timingSettings.reading_characters_per_second,
      readingTailSeconds: timingSettings.reading_tail_seconds,
    }
  : {};

const sourceText = args.input
  ? readFileSync(resolve(root, String(args.input)), 'utf8')
  : String(args.text);
const title = String(args.title || studioProject?.title || '手绘故事');
const textMode = String(args['text-mode'] || 'font');
const visualPlanPath = args['visual-plan']
  ? resolve(root, String(args['visual-plan']))
  : null;
const visualPlan = visualPlanPath
  ? JSON.parse(readFileSync(visualPlanPath, 'utf8'))
  : {};
const generator = String(args.generator || 'codex');
const transition = String(args.transition || settings?.transition?.type || 'cut');
const transitionSec = Number(args['transition-sec'] || settings?.transition?.seconds || 0.7);
const shouldGenerate = args.generate === true;
const shouldGenerateWithApi = shouldGenerate && generator === 'api';
const shouldPrepareCodex = shouldGenerate && generator === 'codex';
const shouldApply = args.apply === true;
const shouldRender = args.render === true;
const shouldForce = args.force === true;

if (!['image2', 'font'].includes(textMode)) {
  throw new Error('--text-mode must be image2 or font');
}
if (!['codex', 'api'].includes(generator)) {
  throw new Error('--generator must be codex or api');
}
if (!['cut', 'page-flip'].includes(transition)) {
  throw new Error('--transition must be cut or page-flip');
}
if (!Number.isFinite(transitionSec) || transitionSec <= 0 || transitionSec > 2) {
  throw new Error('--transition-sec must be greater than 0 and at most 2');
}
if (shouldApply && !shouldGenerateWithApi) {
  if (shouldPrepareCodex) {
    throw new Error(
      '--apply cannot run before Codex has generated the masters. Generate from codex-image-jobs.json, then run npm run import:codex -- --apply.',
    );
  }
  throw new Error('--apply requires --generate so storyboard.json never points at missing files');
}
if (shouldRender && !shouldApply) {
  throw new Error('--render requires --apply');
}
if (shouldGenerateWithApi && !process.env.OPENAI_API_KEY) {
  throw new Error(
    'OPENAI_API_KEY is missing. The plan and prompts can be created without it; real Image 2 generation requires the key.',
  );
}

const styleLock = String(
  args['style-lock'] || settings?.visual?.style_lock || DEFAULT_STYLE_LOCK,
);
const characterLock = String(
  args['character-lock'] || settings?.visual?.character_lock || DEFAULT_CHARACTER_LOCK,
);

const storyParts = splitStory(sourceText, {
  softLimit: timingSettings?.soft_sentence_limit || 36,
});
if (storyParts.length === 0) throw new Error('No usable story sentences found');

const safeTitle = safeSlug(title, 'story').slice(0, 32);
const hashInput = [
  generator === 'codex' ? 'codex-character-sheet-v3' : 'api-v1',
  title,
  textMode,
  transition,
  transitionSec,
  characterLock,
  JSON.stringify(settings || {}),
  JSON.stringify(visualPlan),
  sourceText,
].join('\n');
const storyHash = createHash('sha256').update(hashInput).digest('hex').slice(0, 8);
const assetSet = `${safeTitle}-${storyHash}`;

const referenceBw = resolve(root, 'references/style-bw.png');
const referenceColor = resolve(root, 'references/style-color.png');
if (!existsSync(referenceBw) || !existsSync(referenceColor)) {
  throw new Error('Missing references/style-bw.png or references/style-color.png');
}

const scope = args.scope ? safeSlug(String(args.scope), '') : null;
if (args.scope && scope !== String(args.scope)) {
  throw new Error('--scope must already be a safe project identifier');
}
const legacyGeneratedRoot =
  generator === 'codex' ? `generated/codex/${assetSet}` : `generated/auto/${assetSet}`;
const publicAssetRoot = scope
  ? `projects/${scope}/assets/generated/${generator}/${assetSet}`
  : `assets/${legacyGeneratedRoot}`;
const promptDir = workspacePath
  ? resolve(workspacePath, 'prompts', generator, assetSet)
  : resolve(root, 'prompts', legacyGeneratedRoot);
const assetDir = resolve(publicDir, publicAssetRoot);
mkdirSync(promptDir, {recursive: true});
mkdirSync(assetDir, {recursive: true});

const projectAsset = (name) => `${publicAssetRoot}/${name}`;
const absoluteAsset = (name) => resolve(assetDir, name);
const writePrompt = (name, value) => {
  const path = resolve(promptDir, name);
  writeFileSync(path, `${value.trim()}\n`);
  return path;
};

const imageCli = resolve(
  process.env.CODEX_HOME || resolve(homedir(), '.codex'),
  'skills/.system/imagegen/scripts/image_gen.py',
);

const runImage2Edit = ({images, promptFile, size, out}) => {
  if (!existsSync(imageCli)) throw new Error(`Image 2 CLI not found: ${imageCli}`);
  const commandArgs = [
    imageCli,
    'edit',
    '--model',
    'gpt-image-2',
    ...images.flatMap((image) => ['--image', image]),
    '--prompt-file',
    promptFile,
    '--size',
    size,
    '--quality',
    'high',
    '--out',
    out,
    ...(shouldForce ? ['--force'] : []),
  ];
  execFileSync(process.env.PYTHON || 'python3', commandArgs, {
    cwd: root,
    stdio: 'inherit',
  });
};

const captionCropHeight = 342;
const captionScanHeight = 400;

const detectCaptionCropY = (masterPath) => {
  const detection = spawnSync(
    'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'verbose',
      '-loop',
      '1',
      '-i',
      masterPath,
      '-vf',
      `crop=1024:${captionScanHeight}:0:0,negate,format=gray,lut=y='if(gt(val,80),255,0)',cropdetect=limit=0.1:round=2:reset=0`,
      '-frames:v',
      '3',
      '-f',
      'null',
      '-',
    ],
    {cwd: root, encoding: 'utf8'},
  );
  const log = `${detection.stdout || ''}\n${detection.stderr || ''}`;
  const matches = [...log.matchAll(/crop=(\d+):(\d+):(\d+):(\d+)/g)];
  const last = matches.at(-1);
  if (detection.status !== 0 || !last) {
    console.warn(`Could not detect caption bounds for ${masterPath}; using top-aligned crop`);
    return 0;
  }

  const contentHeight = Number(last[2]);
  const contentY = Number(last[4]);
  const centeredY = Math.round(contentY + contentHeight / 2 - captionCropHeight / 2);
  return Math.max(0, Math.min(captionScanHeight - captionCropHeight, centeredY));
};

let previousColor = null;
const scenes = [];
const codexJobs = [];

let codexCharacterReference = null;
if (generator === 'codex') {
  codexCharacterReference = absoluteAsset('00_character_reference.png');
  const characterPrompt = writePrompt(
    '00_character_reference.txt',
    `Use case: illustration-story
Asset type: fixed protagonist character reference sheet for a hand-drawn Chinese diary-comic video
Input images: the supplied black-and-white and color frames are style references only. Ignore their people, composition and Chinese text.
Primary request: draw ONLY the recurring protagonists described below. Show each protagonist in two simple full-body poses, front view and three-quarter view, arranged side by side.
Character lock: ${characterLock}
Style: ${styleLock}
Composition: pure white square canvas, all uncropped full-body poses centered with generous spacing and a clean 10% safe border. No scenery, furniture, extra people, props or decorative marks.
Color: selective muted wax-crayon color only. Follow the clothing colors in the character lock, use black scribbles for hair and dark trousers, and leave skin and most of the canvas white.
Constraints: this is an identity reference only; no text, letters, numbers, labels, captions, speech bubbles, logo, signature or watermark; no realistic shading, gradients or vector cleanliness.`,
  );
  codexJobs.push({
    id: 'character_reference',
    role: 'reference',
    prompt_file: characterPrompt,
    prompt: readFileSync(characterPrompt, 'utf8').trim(),
    output_master: codexCharacterReference,
    references: [referenceBw, referenceColor],
  });
}

for (let index = 0; index < storyParts.length; index += 1) {
  const text = storyParts[index];
  const id = String(index + 1).padStart(2, '0');
  const textName = `${id}_text.png`;
  const bwName = `${id}_bw.png`;
  const colorName = `${id}_color.png`;
  const masterName = `${id}_master.png`;
  const caption = formatCaption(text, {
    maxCharsPerLine: captionSettings.max_chars_per_line,
    maxLines: captionSettings.max_lines,
  });
  const visualDirection = String(
    visualPlan[id] || 'Stage one simple visual beat that expresses only the current sentence.',
  );
  const usesImage2Text = textMode === 'image2';
  const masterSize = usesImage2Text ? '1024x1536' : '1024x1024';
  const captionPanel = usesImage2Text
    ? `Top copy panel (pixels y=0–342): pure white background. Write ONLY this Simplified Chinese caption verbatim, preserving the explicit line breaks:
"${caption}"
Use thick casual black felt-tip handwriting, at most ${captionSettings.max_lines} lines, generous 48-pixel left/right margins, and a large readable letter size. Do not put any illustration or decorative mark in this panel. Do not place text below y=342.`
    : 'Use the entire canvas only for the illustration; do not add any text.';
  const textConstraint = usesImage2Text
    ? 'no extra text outside the exact top caption, no letters or numbers in the illustration, no labels, captions, speech bubbles, logo, signature or watermark'
    : 'no text, letters, numbers, labels, captions, speech bubbles, logo, signature or watermark';
  const illustrationPanel = usesImage2Text
    ? 'Illustration panel (pixels y=512–1536): use this exact lower 1024×1024 square for the scene. Leave the 342–512 transition band completely white.'
    : 'Use the entire 1024×1024 square for the scene.';

  const hasContinuityReference = Boolean(previousColor) || Boolean(codexCharacterReference);
  const masterPrompt = writePrompt(
    `${id}_master.txt`,
    `Use case: illustration-story
Asset type: one vertical production master for a hand-drawn Chinese diary-comic video. This single output will be locally split into a handwritten caption plate and a color illustration plate.
Input images: the supplied frames are style references${hasContinuityReference ? '; the fixed protagonist character sheet is the identity reference' : ''}. Ignore all text in references.
Narrative sentence to illustrate: "${text}"
Scene direction: ${visualDirection}
Create one concrete, immediately readable tableau for that sentence. Use the locked recurring protagonists whenever the current sentence requires them.
Character lock: ${characterLock}
Style: ${styleLock}
${captionPanel}
${illustrationPanel}
Composition: use a comfortably wide camera view. Keep the entire sparse scene in the lower-middle of its illustration square with generous white negative space. Reserve a clean white safe border of at least 10% on the left and right and 8% on the top and bottom. Every figure, limb, prop, building edge, roof, tree branch, rain stroke and motion mark must stay completely inside that safe border. Scale the scene down when necessary; never let any visible mark touch or cross a canvas edge.
Color: selective muted wax-crayon color only: sage green, dusty blue, warm tan, brick red and warm yellow. Keep hair, trousers and other dark areas as black scribbles. Leave skin and most of the canvas pure white.
Continuity: preserve the locked character design. Use the fixed character sheet only for the protagonist's identity, never copy its pose or composition. Include only people required by the current narrative sentence.
Narrative isolation: the character lock defines identities, not an automatic cast list. Show only characters explicitly named in the current sentence or strictly required for its immediate action. Never add family bystanders. Never show a future daughter, rescued child, grandmother, father or any other supporting character before that person is introduced by the narration. Do not carry any person, prop or setting forward merely because it appeared in another scene.
Constraints: non-graphic, emotionally restrained family storytelling; no visible impact, blood, wounds, bruises or injury; no cropped or partially visible subject, prop or background structure; no close-up framing; ${textConstraint}; no graphite realism, gradients, detailed scenery or vector cleanliness.`,
  );

  if (shouldGenerateWithApi) {
    runImage2Edit({
      images: [referenceBw, referenceColor, ...(previousColor ? [previousColor] : [])],
      promptFile: masterPrompt,
      size: masterSize,
      out: absoluteAsset(masterName),
    });
    if (usesImage2Text) {
      const captionCropY = detectCaptionCropY(absoluteAsset(masterName));
      execFileSync(
        'ffmpeg',
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-i',
          absoluteAsset(masterName),
          '-vf',
          `crop=1024:${captionCropHeight}:0:${captionCropY},scale=1536:512:flags=lanczos`,
          '-frames:v',
          '1',
          '-y',
          absoluteAsset(textName),
        ],
        {cwd: root, stdio: 'inherit'},
      );
    }
    execFileSync(
      'ffmpeg',
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        absoluteAsset(masterName),
        '-vf',
        usesImage2Text
          ? 'crop=1024:1024:0:512,format=gray,eq=contrast=1.18:brightness=0.035,unsharp=5:5:0.55:5:5:0'
          : 'format=gray,eq=contrast=1.18:brightness=0.035,unsharp=5:5:0.55:5:5:0',
        '-frames:v',
        '1',
        '-y',
        absoluteAsset(bwName),
      ],
      {cwd: root, stdio: 'inherit'},
    );
    execFileSync(
      'ffmpeg',
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        absoluteAsset(masterName),
        '-vf',
        usesImage2Text ? 'crop=1024:1024:0:512' : 'null',
        '-frames:v',
        '1',
        '-y',
        absoluteAsset(colorName),
      ],
      {cwd: root, stdio: 'inherit'},
    );
    previousColor = absoluteAsset(colorName);
  }

  if (generator === 'codex') {
    codexJobs.push({
      id,
      role: 'scene',
      prompt_file: masterPrompt,
      prompt: readFileSync(masterPrompt, 'utf8').trim(),
      output_master: absoluteAsset(masterName),
      references: [
        referenceBw,
        referenceColor,
        codexCharacterReference,
      ],
    });
  }

  scenes.push({
    id,
    duration_sec: durationFor(caption, durationSettings),
    text: caption,
    narration: text,
    visual: `根据文案绘制一个单一、清楚、可画的白底日记漫画场景：${text}`,
    shot: 'story_beat',
    layers: ['text', 'bw_full', 'color'],
    color_hint: `仅使用低饱和蜡笔色（${(settings?.visual?.palette || ['鼠尾草绿', '灰蓝', '浅棕', '砖红', '暖黄']).join('、')}），保留大量纯白`,
    detail_hint: null,
    assets: {
      text_image: usesImage2Text ? projectAsset(textName) : null,
      bw: projectAsset(bwName),
      detail: null,
      color: projectAsset(colorName),
    },
  });
}

const storyboard = {
  schema_version: 2,
  project: {
    id: scope || undefined,
    title,
    mode: 'speed',
    images_per_scene: 1,
    derive_bw: 'local',
    enable_detail: false,
    gen_size: 1024,
    export_size: [canvas.width, canvas.height],
    ratio: canvas.ratio,
    width: canvas.width,
    height: canvas.height,
    fps: canvas.fps,
    transition,
    transition_sec: transitionSec,
    style_lock: styleLock,
    character_lock: characterLock,
    caption: captionSettings,
    layout: settings?.layout,
    audio: {
      voiceover: 'post',
      bgm: 'optional_bed_only',
      bgm_follows_text: false,
    },
  },
  scenes,
};

const outputPath = shouldApply
  ? resolve(root, String(args['apply-to'] || 'storyboard.json'))
  : resolve(
      root,
      String(
        args.output ||
          (workspacePath ? resolve(workspacePath, 'storyboard.generated.json') : 'storyboard.generated.json'),
      ),
    );
mkdirSync(dirname(outputPath), {recursive: true});
writeFileSync(outputPath, `${JSON.stringify(storyboard, null, 2)}\n`);

if (generator === 'codex') {
  const manifestPath = resolve(
    root,
    String(
      args.manifest ||
        (workspacePath ? resolve(workspacePath, 'codex-image-jobs.json') : 'codex-image-jobs.json'),
    ),
  );
  mkdirSync(dirname(manifestPath), {recursive: true});
  writeFileSync(
    manifestPath,
    `${JSON.stringify(
      {
        version: 2,
        generator: 'codex-image2',
        project_id: scope || null,
        asset_set: assetSet,
        storyboard: outputPath,
        text_mode: textMode,
        jobs: codexJobs,
      },
      null,
      2,
    )}\n`,
  );
  console.log(`Codex Image2 jobs → ${manifestPath}`);
}

console.log(
  `Prepared ${scenes.length} scenes → ${outputPath}\n` +
    `Prompts → ${promptDir}\n` +
    (shouldGenerateWithApi
      ? `Image 2 API assets → ${assetDir}`
      : shouldPrepareCodex
        ? `Codex built-in Image2 queue prepared. Generate each manifest job, then import it with npm run import:codex -- --apply.`
        : `Plan-only mode. Codex Image2 jobs are ready in the manifest; generate each listed master, then import them.`),
);

if (shouldRender) {
  if (!process.env.npm_execpath) {
    throw new Error('--render must be invoked through npm so npm_execpath is available');
  }
  execFileSync(process.execPath, [process.env.npm_execpath, 'run', 'render'], {
    cwd: root,
    stdio: 'inherit',
  });
}

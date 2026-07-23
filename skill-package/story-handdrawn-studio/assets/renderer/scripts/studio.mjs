import {existsSync, mkdirSync, readFileSync, statSync, writeFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs, numberArg, stringArg} from './lib/args.mjs';
import {
  applyNarrationDurations,
  materializeAudioManifest,
  muxAudioIntoVideo,
  planAudioManifest,
  planSceneTimeline,
  writeAudioManifest,
} from './lib/audio.mjs';
import {createAutomaticAudioPlan, materializeAutomaticAudioPlan} from './lib/audio-director.mjs';
import {
  applyCreativeDirectionToStoryboard,
  applyThemeToSettings,
  creativeDirectorCatalog,
  createStyleBakeoffPlan,
  HANDDRAWN_THEMES,
  recommendNarrativeArc,
  recommendTheme,
  rewritePromptStyle,
  themeStyleLock,
} from './lib/creative-director.mjs';
import {
  computeContinuityImpact,
  createContinuityLedger,
  stableHash,
  validateContinuity,
} from './lib/continuity.mjs';
import {
  createAutomaticContinuitySpec,
  createDirectorArtifacts,
  prepareSceneRevision,
} from './lib/director.mjs';
import {calculatePreviewCanvas, createSettings, validateSettings} from './lib/presets.mjs';
import {createSettingsFromTemplate, listTemplates} from './lib/templates.mjs';
import {createProviderPlan, listProviders, readProviderState, resolveProvider} from './lib/providers.mjs';
import {createSemanticQaReport} from './lib/semantic-qa.mjs';
import {createReviewData, validateReviewDecisions, writeReviewWorkspace} from './lib/review.mjs';
import {
  archiveProjectRevision,
  atomicWriteJson,
  createProject,
  createProjectSnapshot,
  listProjects,
  loadProject,
  persistProjectMigration,
  readJson,
  resolveInside,
  restoreProjectSnapshot,
  updateProjectState,
  withProjectLock,
} from './lib/projects.mjs';
import {probeCommand, remotionCli, runNode} from './lib/process.mjs';
import {durationFor, formatCaption, safeSlug} from './lib/story-text.mjs';
import {validateStoryboardFile} from './lib/storyboard-validator.mjs';
import {runVisualQa} from './lib/visual-qa.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const command = process.argv[2] || 'help';
const args = parseArgs(process.argv.slice(3), {
  repeatable: ['image', 'scene', 'voiceover', 'sfx'],
});
const dataRoot = stringArg(args, 'data-root')
  ? resolve(process.cwd(), stringArg(args, 'data-root'))
  : null;
const projectsRoot = stringArg(args, 'projects-root')
  ? resolve(process.cwd(), stringArg(args, 'projects-root'))
  : dataRoot
    ? resolve(dataRoot, 'projects')
    : null;
const publicDir = dataRoot ? resolve(dataRoot, 'public') : resolve(repoRoot, 'public');
const jsonOutput = args.json === true;

const print = (value) => {
  if (jsonOutput || typeof value !== 'string') console.log(JSON.stringify(value, null, 2));
  else console.log(value);
};

const usage = () => console.log(`Story Handdrawn Studio

Usage:
  node scripts/studio.mjs produce --title "标题" --input story.txt [--to final]
  node scripts/studio.mjs produce --project PROJECT [--to plan|assets|preview|final]
  node scripts/studio.mjs create --title "标题" --input story.txt [--preset portrait]
  node scripts/studio.mjs create --title "标题" --image page1.png [--image page2.png]
  node scripts/studio.mjs plan --project PROJECT [--generator auto|codex|openai|api]
  node scripts/studio.mjs director --project PROJECT --action plan|styles|choose|status|list [OPTIONS]
  node scripts/studio.mjs revise --project PROJECT --scene 01 --note "人物表情更克制"
  node scripts/studio.mjs continuity --project PROJECT [--apply continuity.json]
  node scripts/studio.mjs audio --project PROJECT --action auto|plan|prepare|mix|disable [OPTIONS]
  node scripts/studio.mjs render --project PROJECT [--quality preview|final]
  node scripts/studio.mjs qa --project PROJECT [--quality preview|final]
  node scripts/studio.mjs semantic-qa --project PROJECT [--observations FILE] [--strict]
  node scripts/studio.mjs review --project PROJECT
  node scripts/studio.mjs apply-review --project PROJECT --input review.json
  node scripts/studio.mjs providers|templates
  node scripts/studio.mjs assets --project PROJECT --action plan|run|status|retry [--provider auto|codex|openai]
  node scripts/studio.mjs migrate|snapshot|rollback --project PROJECT [OPTIONS]
  node scripts/studio.mjs resume --project PROJECT
  node scripts/studio.mjs regress [--json]
  node scripts/studio.mjs list|status|validate|doctor [OPTIONS]

Audio options:
  --audio auto (local procedural BGM and scene-aware sound effects)
  --enable --provider openai --voice alloy --model tts-1-hd
  --voiceover SCENE=FILE --bgm FILE --sfx SCENE=FILE [--audio-config FILE]

Presets: portrait (3:4), vertical (9:16), square (1:1), landscape (16:9)
Storage: add --data-root PATH to keep projects, assets, and outputs outside the renderer`);

const loadById = (id) => {
  const loaded = loadProject(repoRoot, id, projectsRoot, publicDir);
  if (loaded.project.id !== loaded.paths.id) throw new Error('Project config id does not match its directory');
  if (!['story', 'images'].includes(loaded.project.source?.type)) {
    throw new Error('Project source type must be story or images');
  }
  validateSettings(loaded.project.settings);
  return loaded;
};

const requiredProject = () => {
  const id = stringArg(args, 'project');
  if (!id) throw new Error('--project is required');
  return loadById(id);
};

const runProjectAction = async (loaded, workingStatus, callback, beforeStart = null) =>
  withProjectLock(loaded.paths, async () => {
    const resumeFrom = loaded.state?.status === 'failed'
      ? loaded.state.resume_from || 'created'
      : loaded.state?.status || 'created';
    if (beforeStart) await beforeStart();
    updateProjectState(loaded.paths, workingStatus, `${workingStatus} started`);
    try {
      return await callback();
    } catch (error) {
      updateProjectState(
        loaded.paths,
        'failed',
        `${workingStatus} failed`,
        error.message,
        {resume_from: resumeFrom},
      );
      throw error;
    }
  });

const validateActive = (loaded, skipAssets) => {
  const result = validateStoryboardFile(loaded.paths.storyboard, {publicDir, skipAssets});
  if (result.errors.length) throw new Error(result.errors.join('\n'));
  return result;
};

const durationSettings = (settings) => ({
  minimumSceneSeconds: settings.timing.minimum_scene_seconds,
  maximumSceneSeconds: settings.timing.maximum_scene_seconds,
  baseSeconds: settings.timing.base_seconds,
  secondsPerLine: settings.timing.seconds_per_line,
  secondsPerCharacter: settings.timing.seconds_per_character,
  readingCharactersPerSecond: settings.timing.reading_characters_per_second,
  readingTailSeconds: settings.timing.reading_tail_seconds,
});

const createFromArgs = ({announce = true} = {}) => {
  const title = stringArg(args, 'title') || '未命名手绘故事';
  const template = stringArg(args, 'template');
  const preset = stringArg(args, 'preset', template ? undefined : 'portrait');
  const canvasOverrides = {};
  for (const key of ['width', 'height', 'fps']) {
    const value = numberArg(args, key);
    if (value !== undefined) canvasOverrides[key] = value;
  }
  const transition = stringArg(args, 'transition');
  const transitionSeconds = numberArg(args, 'transition-sec');
  const overrides = {};
  if (Object.keys(canvasOverrides).length) overrides.canvas = canvasOverrides;
  if (transition || transitionSeconds !== undefined) {
    overrides.transition = {
      ...(transition ? {type: transition} : {}),
      ...(transitionSeconds !== undefined ? {seconds: transitionSeconds} : {}),
    };
  }
  const settings = template
    ? createSettingsFromTemplate(template, preset, overrides)
    : createSettings(preset, overrides);
  const inputPath = stringArg(args, 'input');
  const inlineText = stringArg(args, 'text');
  const images = (args.image || []).map((path) => resolve(process.cwd(), String(path)));
  const hasStory = Boolean(inputPath || inlineText);
  if (hasStory === (images.length > 0)) {
    throw new Error('Choose exactly one source: --input/--text or one or more --image values');
  }
  if (inputPath && inlineText) throw new Error('Use --input or --text, not both');
  const storyText = inputPath
    ? readFileSync(resolve(process.cwd(), inputPath), 'utf8')
    : inlineText ?? null;
  if (storyText !== null && !storyText.trim()) throw new Error('Story text is empty');
  const id = stringArg(args, 'id') || safeSlug(title, `project-${Date.now()}`);
  const result = createProject({
    repoRoot,
    projectsRoot,
    publicDir,
    id,
    title,
    settings,
    storyText,
    images,
  });
  if (template) {
    result.project.template = template;
    atomicWriteJson(result.paths.config, result.project);
  }
  if (announce) print({project: result.project, directory: result.paths.project});
  return {...result, state: readJson(result.paths.state)};
};

const create = () => createFromArgs();

const list = () => {
  const projects = listProjects(repoRoot, projectsRoot, publicDir).map(({project, state, paths}) => ({
    id: project.id,
    title: project.title,
    source: project.source.type,
    preset: project.settings.preset,
    status: state?.status || 'unknown',
    revision: state?.current_revision || 0,
    updated_at: state?.updated_at || project.updated_at,
    directory: paths.project,
  }));
  if (jsonOutput) return print(projects);
  if (!projects.length) return console.log('No Studio projects yet.');
  console.table(projects.map(({directory, ...row}) => row));
};

const statusFor = (id) => {
  const loaded = loadById(id);
  print({id, title: loaded.project.title, status: loaded.state?.status, state: loaded.state, paths: loaded.paths});
  return loaded;
};

const status = () => statusFor(requiredProject().project.id);

const styleApprovalPending = (loaded) =>
  loaded.project.settings.director?.require_style_approval === true &&
  loaded.project.settings.director?.style_approved !== true;

const styleApprovalAction = (loaded) => ({
  project: loaded.project.id,
  status: 'awaiting_style_choice',
  action_required: 'approve_style',
  next_steps: [
    `director --project ${loaded.project.id} --action styles`,
    `director --project ${loaded.project.id} --action choose --theme THEME_ID`,
  ],
});

const manifestNeedsReplan = (loaded) => {
  if (!existsSync(loaded.paths.codexManifest)) return true;
  return readJson(loaded.paths.codexManifest).requires_replan === true;
};

const plan = async (loaded = requiredProject(), {announce = true, generatorOverride = null} = {}) => {
  if (loaded.project.source.type !== 'story') throw new Error('plan requires a story project');
  const sourceText = readFileSync(resolveInside(loaded.paths.project, loaded.project.source.path), 'utf8');
  const configuredDirector = loaded.project.settings.director || {};
  const selectedArc = configuredDirector.arc && configuredDirector.arc !== 'auto'
    ? configuredDirector.arc
    : recommendNarrativeArc({title: loaded.project.title, sourceText});
  const selectedTheme = configuredDirector.theme && configuredDirector.theme !== 'auto'
    ? configuredDirector.theme
    : recommendTheme({title: loaded.project.title, sourceText, arc: selectedArc});
  const approvalPending = styleApprovalPending(loaded);
  if (approvalPending) {
    loaded.project.settings.director = {
      ...loaded.project.settings.director,
      arc: selectedArc,
      recommended_theme: selectedTheme,
    };
  } else {
    loaded.project.settings = applyThemeToSettings(loaded.project.settings, selectedTheme, selectedArc);
  }
  loaded.project.updated_at = new Date().toISOString();
  atomicWriteJson(loaded.paths.config, loaded.project);
  const requestedGenerator = generatorOverride || stringArg(args, 'generator', loaded.state?.production?.generator || loaded.project.settings.provider?.id || 'auto');
  const provider = requestedGenerator === 'api' ? 'openai' : resolveProvider(requestedGenerator);
  const generator = provider === 'openai' ? 'api' : 'codex';
  const planningGenerator = approvalPending ? 'api' : generator;
  const textMode = stringArg(args, 'text-mode', loaded.state?.production?.text_mode || 'font');
  if (!['codex', 'api'].includes(generator)) throw new Error('--generator must be auto, codex, openai, or api');
  await runProjectAction(loaded, 'planning', async () => {
    const commandArgs = [
      '--input', resolveInside(loaded.paths.project, loaded.project.source.path),
      '--title', loaded.project.title,
      '--config', loaded.paths.config,
      '--workspace', loaded.paths.project,
      '--scope', loaded.project.id,
      '--output', loaded.paths.storyboardPlan,
      '--manifest', loaded.paths.codexManifest,
      '--generator', planningGenerator,
      '--text-mode', textMode,
      '--public-dir', publicDir,
    ];
    if (generator === 'api' && !approvalPending) {
      commandArgs.push('--generate', '--apply', '--apply-to', loaded.paths.storyboard);
    }
    runNode(resolve(repoRoot, 'scripts', 'story-to-video.mjs'), commandArgs, {cwd: repoRoot});
    const storyboard = readJson(generator === 'api' && !approvalPending ? loaded.paths.storyboard : loaded.paths.storyboardPlan);
    if (generator === 'api' && !approvalPending) atomicWriteJson(loaded.paths.storyboardPlan, storyboard);
    const suppliedContinuity = stringArg(args, 'continuity');
    const continuitySpec = suppliedContinuity
      ? readJson(resolve(process.cwd(), suppliedContinuity))
      : existsSync(loaded.paths.continuitySpec)
        ? readJson(loaded.paths.continuitySpec)
        : null;
    const manifest = generator === 'codex' && !approvalPending ? readJson(loaded.paths.codexManifest) : null;
    const artifacts = createDirectorArtifacts({
      project: loaded.project,
      storyboard,
      manifest,
      sourceText,
      generator,
      textMode,
      continuitySpec,
    });
    atomicWriteJson(loaded.paths.storyboardPlan, artifacts.storyboard);
    if (generator === 'api') atomicWriteJson(loaded.paths.storyboard, artifacts.storyboard);
    atomicWriteJson(loaded.paths.director, artifacts.director);
    atomicWriteJson(loaded.paths.continuitySpec, artifacts.continuitySpec);
    atomicWriteJson(loaded.paths.continuityLedger, artifacts.continuityLedger);
    if (artifacts.manifest) {
      atomicWriteJson(loaded.paths.codexManifest, artifacts.manifest);
      for (const job of artifacts.manifest.jobs) {
        mkdirSync(dirname(job.prompt_file), {recursive: true});
        writeFileSync(job.prompt_file, `${job.prompt.trim()}\n`, 'utf8');
      }
    }
    if (approvalPending) {
      atomicWriteJson(loaded.paths.codexManifest, {
        version: 2,
        generator: 'blocked',
        project_id: loaded.project.id,
        storyboard: loaded.paths.storyboardPlan,
        text_mode: textMode,
        blocked_by: 'style_approval',
        requires_replan: true,
        jobs: [],
      });
    }
    const pending = (artifacts.manifest?.jobs || []).filter((job) => !existsSync(job.output_master));
    const nextStatus = approvalPending ? 'awaiting_style_choice' : generator === 'api' ? 'assets_ready' : 'awaiting_assets';
    updateProjectState(
      loaded.paths,
      nextStatus,
      approvalPending
        ? 'Director plan is ready and production is held for style approval'
        : generator === 'api' ? 'Director plan, images, and continuity ledger are ready' : 'Director image jobs are ready',
      null,
      {
        current_revision: 1,
        pending_jobs: pending.map((job) => job.id),
        pending_scenes: pending.filter((job) => job.role !== 'reference').map((job) => job.scene_id || job.id),
        continuity_version: artifacts.continuityLedger.version,
        production: {
          ...(loaded.state?.production || {}),
          generator,
          provider,
          text_mode: textMode,
          status: nextStatus,
        },
        director: approvalPending
          ? {status: 'awaiting_style_choice', recommended_theme: selectedTheme}
          : {status: 'approved', theme: selectedTheme},
      },
    );
  });
  return announce ? statusFor(loaded.project.id) : loadById(loaded.project.id);
};

const creativeDirector = () => {
  const action = stringArg(args, 'action', 'status');
  if (action === 'list') return print(creativeDirectorCatalog());
  if (!['plan', 'styles', 'choose', 'status'].includes(action)) {
    throw new Error('--action must be plan, styles, choose, status, or list');
  }
  const loaded = requiredProject();
  const storyboardPath = existsSync(loaded.paths.storyboard)
    ? loaded.paths.storyboard
    : loaded.paths.storyboardPlan;
  if (action === 'status') {
    return print({
      project: loaded.project.id,
      director: existsSync(loaded.paths.director) ? readJson(loaded.paths.director) : null,
      style_bakeoff: existsSync(loaded.paths.styleBakeoff) ? readJson(loaded.paths.styleBakeoff) : null,
    });
  }
  if (!existsSync(storyboardPath)) throw new Error('Plan the project before running the creative director');
  const storyboard = readJson(storyboardPath);
  const sourceText = loaded.project.source.type === 'story'
    ? readFileSync(resolveInside(loaded.paths.project, loaded.project.source.path), 'utf8')
    : storyboard.scenes.map((scene) => scene.text || scene.visual || '').join('\n');
  if (action === 'styles') {
    const candidates = stringArg(args, 'candidates')
      ?.split(',').map((value) => value.trim()).filter(Boolean);
    mkdirSync(loaded.paths.styleBakeoffDir, {recursive: true});
    const bakeoff = createStyleBakeoffPlan({
      projectId: loaded.project.id,
      title: loaded.project.title,
      sourceText,
      scene: storyboard.scenes[Math.min(1, storyboard.scenes.length - 1)],
      outputDirectory: loaded.paths.styleBakeoffDir.replaceAll('\\', '/'),
      candidates,
    });
    for (const job of bakeoff.jobs) {
      const promptFile = resolveInside(loaded.paths.styleBakeoffDir, `${job.id}.txt`);
      writeFileSync(promptFile, `${job.prompt}\n`, 'utf8');
      job.prompt_file = promptFile;
    }
    atomicWriteJson(loaded.paths.styleBakeoff, bakeoff);
    updateProjectState(loaded.paths, loaded.state.status, 'Style bake-off jobs prepared', null, {
      director: {status: 'awaiting_style_choice', style_bakeoff: loaded.paths.styleBakeoff},
    });
    return print({ok: true, manifest: loaded.paths.styleBakeoff, recommended: bakeoff.recommended, jobs: bakeoff.jobs});
  }
  if (action === 'choose') {
    const theme = stringArg(args, 'theme');
    if (!theme || !HANDDRAWN_THEMES[theme]) throw new Error(`--theme must be one of: ${Object.keys(HANDDRAWN_THEMES).join(', ')}`);
    const pendingManifest = existsSync(loaded.paths.codexManifest) ? readJson(loaded.paths.codexManifest) : null;
    const generated = (pendingManifest?.jobs || []).filter((job) => existsSync(job.output_master));
    if (generated.length && args.force !== true) {
      throw new Error(`Style choice would invalidate ${generated.length} generated master(s); rerun with --force to accept regeneration`);
    }
    const project = readJson(loaded.paths.config);
    project.settings = applyThemeToSettings(project.settings, theme);
    project.settings.director.style_approved = true;
    project.updated_at = new Date().toISOString();
    atomicWriteJson(loaded.paths.config, project);
    const directed = applyCreativeDirectionToStoryboard(storyboard, {
      title: project.title, sourceText, theme,
      arc: project.settings.director.arc === 'auto' ? null : project.settings.director.arc,
      forceShots: false, multiShot: project.settings.director.multi_shot,
    });
    directed.project.director.style_approved = true;
    directed.project.style_lock = themeStyleLock(theme);
    atomicWriteJson(loaded.paths.storyboardPlan, directed);
    if (existsSync(loaded.paths.storyboard)) atomicWriteJson(loaded.paths.storyboard, directed);
    if (existsSync(loaded.paths.styleBakeoff)) {
      const bakeoff = readJson(loaded.paths.styleBakeoff);
      bakeoff.selected = theme;
      bakeoff.approved = true;
      atomicWriteJson(loaded.paths.styleBakeoff, bakeoff);
    }
    if (existsSync(loaded.paths.director)) {
      const director = readJson(loaded.paths.director);
      director.creativeDirection = {...director.creativeDirection, ...directed.project.director, theme_label: HANDDRAWN_THEMES[theme].label};
      director.scenes = director.scenes.map((scene) => ({...scene, shots: directed.scenes.find((item) => item.id === scene.id)?.shots || scene.shots}));
      atomicWriteJson(loaded.paths.director, director);
    }
    if (pendingManifest) {
      const manifest = pendingManifest;
      manifest.jobs = (manifest.jobs || []).map((job) => {
        const next = {...job, prompt: rewritePromptStyle(job.prompt, theme), status: 'pending'};
        if (next.prompt_file) {
          mkdirSync(dirname(next.prompt_file), {recursive: true});
          writeFileSync(next.prompt_file, next.prompt, 'utf8');
        }
        return next;
      });
      manifest.creative_theme = theme;
      manifest.blocked_by = null;
      manifest.requires_replan = true;
      atomicWriteJson(loaded.paths.codexManifest, manifest);
    }
    updateProjectState(loaded.paths, 'planning', `Creative theme approved: ${theme}; production plan must be refreshed`, null, {
      director: {status: 'approved', theme},
      production: {...(loaded.state.production || {}), status: 'planning'},
    });
    return print({ok: true, project: loaded.project.id, theme, storyboard: storyboardPath});
  }
  const arcArg = stringArg(args, 'arc');
  const themeArg = stringArg(args, 'theme');
  const directed = applyCreativeDirectionToStoryboard(storyboard, {
    title: loaded.project.title, sourceText,
    arc: arcArg || (loaded.project.settings.director.arc === 'auto' ? null : loaded.project.settings.director.arc),
    theme: themeArg || (loaded.project.settings.director.theme === 'auto' ? null : loaded.project.settings.director.theme),
    forceShots: args.force === true,
    multiShot: loaded.project.settings.director.multi_shot,
  });
  atomicWriteJson(storyboardPath, directed);
  if (existsSync(loaded.paths.director)) {
    const director = readJson(loaded.paths.director);
    director.creativeDirection = {...director.creativeDirection, ...directed.project.director};
    director.scenes = director.scenes.map((scene) => ({...scene, shots: directed.scenes.find((item) => item.id === scene.id)?.shots || []}));
    atomicWriteJson(loaded.paths.director, director);
  }
  updateProjectState(loaded.paths, loaded.state.status, 'Creative director shot plan updated', null, {
    director: {status: 'planned', arc: directed.project.director.arc, theme: directed.project.director.theme},
  });
  print({ok: true, project: loaded.project.id, creative_direction: directed.project.director, storyboard: storyboardPath});
};

const ingest = async (loaded = requiredProject(), {announce = true} = {}) => {
  if (loaded.project.source.type !== 'images') throw new Error('ingest requires an image project');
  await runProjectAction(loaded, 'ingesting', async () => {
    const commandArgs = loaded.project.source.images.flatMap((image) => [
      '--image', resolveInside(loaded.paths.project, image.path),
    ]);
    commandArgs.push(
      '--title', loaded.project.title,
      '--config', loaded.paths.config,
      '--workspace', loaded.paths.project,
      '--scope', loaded.project.id,
      '--storyboard', loaded.paths.storyboard,
      '--manifest', loaded.paths.uploadedManifest,
      '--public-dir', publicDir,
    );
    runNode(resolve(repoRoot, 'scripts', 'import-uploaded-pages.mjs'), commandArgs, {cwd: repoRoot});
    validateActive(loaded, false);
    const storyboard = readJson(loaded.paths.storyboard);
    atomicWriteJson(loaded.paths.storyboardPlan, storyboard);
    const continuitySpec = createAutomaticContinuitySpec(storyboard, loaded.project);
    const continuityLedger = createContinuityLedger(continuitySpec);
    atomicWriteJson(loaded.paths.continuitySpec, continuitySpec);
    atomicWriteJson(loaded.paths.continuityLedger, continuityLedger);
    updateProjectState(loaded.paths, 'assets_ready', 'Uploaded pages ingested and validated', null, {
      current_revision: 1,
      continuity_version: continuityLedger.version,
      pending_jobs: [],
      pending_scenes: [],
      production: {...(loaded.state?.production || {}), status: 'assets_ready'},
    });
  });
  return announce ? statusFor(loaded.project.id) : loadById(loaded.project.id);
};

const importCodex = async (loaded = requiredProject(), {announce = true} = {}) => {
  if (loaded.project.source.type !== 'story') throw new Error('import requires a story project');
  if (styleApprovalPending(loaded)) return print(styleApprovalAction(loaded));
  await runProjectAction(loaded, 'importing', async () => {
    runNode(
      resolve(repoRoot, 'scripts', 'import-codex-images.mjs'),
      [
        '--manifest', loaded.paths.codexManifest,
        '--workspace', loaded.paths.project,
        '--public-dir', publicDir,
        '--apply',
        '--apply-to', loaded.paths.storyboard,
      ],
      {cwd: repoRoot},
    );
    validateActive(loaded, false);
    updateProjectState(loaded.paths, 'assets_ready', 'Generated images imported and validated', null, {
      pending_jobs: [],
      pending_scenes: [],
      production: {...(loaded.state?.production || {}), status: 'assets_ready'},
    });
  });
  return announce ? statusFor(loaded.project.id) : loadById(loaded.project.id);
};

const validate = () => {
  const loaded = requiredProject();
  const selected = existsSync(loaded.paths.storyboard) ? loaded.paths.storyboard : loaded.paths.storyboardPlan;
  const result = validateStoryboardFile(selected, {publicDir, skipAssets: args.assets !== true});
  if (result.errors.length) throw new Error(result.errors.join('\n'));
  print({ok: true, storyboard: selected, summary: result.summary});
};

const parseAssignment = (value, label) => {
  const at = String(value).indexOf('=');
  if (at <= 0 || at === String(value).length - 1) throw new Error(`${label} must use SCENE=FILE`);
  return [String(value).slice(0, at), resolve(process.cwd(), String(value).slice(at + 1))];
};

const buildAudioOptions = (loaded) => {
  const settings = loaded.project.settings.audio || {};
  const saved = existsSync(loaded.paths.audioOptions) ? readJson(loaded.paths.audioOptions) : {};
  const configPath = stringArg(args, 'audio-config') || stringArg(args, 'config');
  const absoluteConfigPath = configPath ? resolve(process.cwd(), configPath) : null;
  const configured = absoluteConfigPath ? readJson(absoluteConfigPath) : {};
  const configuredBaseDir = absoluteConfigPath
    ? resolve(dirname(absoluteConfigPath), configured.base_dir || '.')
    : null;
  const options = {
    ...saved,
    ...configured,
    base_dir: configuredBaseDir || saved.base_dir || loaded.paths.project,
    enabled: configured.enabled ?? saved.enabled ?? settings.enabled ?? false,
    tts: {
      enabled: (configured.tts?.enabled ?? saved.tts?.enabled ?? settings.provider === 'openai'),
      provider: 'openai',
      model: configured.tts?.model || saved.tts?.model || settings.model || 'tts-1-hd',
      voice: configured.tts?.voice || saved.tts?.voice || settings.voice || 'alloy',
      response_format: configured.tts?.response_format || saved.tts?.response_format || settings.format || 'mp3',
    },
    mix: {
      ...saved.mix,
      ...configured.mix,
      voiceover_volume: configured.mix?.voiceover_volume ?? saved.mix?.voiceover_volume ?? settings.voiceover_volume ?? 1,
      bgm_volume: configured.mix?.bgm_volume ?? saved.mix?.bgm_volume ?? settings.bgm_volume ?? 0.14,
      sfx_volume: configured.mix?.sfx_volume ?? saved.mix?.sfx_volume ?? settings.sfx_volume ?? 0.35,
    },
  };
  const audioMode = stringArg(args, 'audio');
  if (args.enable === true || args.audio === true || audioMode === 'auto') options.enabled = true;
  if (args.enable === false || args.audio === false) options.enabled = false;
  const provider = stringArg(args, 'provider');
  if (provider) options.tts.enabled = provider === 'openai';
  options.automatic = audioMode === 'auto' || configured.automatic === true || saved.automatic === true || settings.provider === 'auto';
  const model = stringArg(args, 'model');
  const voice = stringArg(args, 'voice');
  if (model) options.tts.model = model;
  if (voice) options.tts.voice = voice;
  if (args.voiceover?.length) {
    options.voiceover = {...(options.voiceover || {})};
    for (const value of args.voiceover) {
      const [scene, path] = parseAssignment(value, '--voiceover');
      options.voiceover[scene] = path;
    }
  }
  const bgm = stringArg(args, 'bgm');
  if (bgm) options.bgm = resolve(process.cwd(), bgm);
  if (args.sfx?.length) {
    options.sfx = [...(options.sfx || [])];
    for (const value of args.sfx) {
      const [scene, path] = parseAssignment(value, '--sfx');
      options.sfx.push({scene_id: scene, path, offset_sec: 0});
    }
  }
  return options;
};

const mergeMaterializedAudio = (planned, materialized) => {
  const priorScenes = new Map(materialized.scenes.map((scene) => [String(scene.id), scene]));
  for (const scene of planned.scenes) {
    const prior = priorScenes.get(String(scene.id));
    if (prior?.voiceover?.materialized_path && scene.voiceover) scene.voiceover = prior.voiceover;
  }
  if (materialized.bgm?.materialized_path && planned.bgm) planned.bgm = materialized.bgm;
  const priorSfx = new Map(materialized.sfx.map((item) => [item.id, item]));
  planned.sfx = planned.sfx.map((item) => {
    const prior = priorSfx.get(item.id);
    return prior?.materialized_path
      ? {...item, materialized_path: prior.materialized_path, duration_sec: prior.duration_sec}
      : item;
  });
  planned.materialized_at = materialized.materialized_at;
  return planned;
};

const audioPlanHash = (storyboard, options) => {
  const baseDir = resolve(options.base_dir || process.cwd());
  const fileValues = [
    ...(Array.isArray(options.voiceover) ? options.voiceover : Object.values(options.voiceover || {})),
    options.bgm,
    ...(options.sfx || []),
  ].filter(Boolean);
  const sources = fileValues.map((value) => {
    const rawPath = typeof value === 'string' ? value : value.path;
    if (!rawPath) return null;
    const path = resolve(baseDir, rawPath);
    if (!existsSync(path)) return {path, missing: true};
    const stats = statSync(path);
    return {path, size: stats.size, mtime_ms: stats.mtimeMs};
  }).filter(Boolean);
  return stableHash({
    options,
    sources,
    project: {
      fps: storyboard.project.fps,
      transition: storyboard.project.transition,
      transition_sec: storyboard.project.transition_sec,
    },
    scenes: storyboard.scenes.map(({id, narration, duration_sec}) => ({id, narration, duration_sec})),
  });
};

const audioManifestReady = (manifest, planHash, projectDir) => {
  if (!manifest?.enabled || manifest.plan_hash !== planHash) return false;
  const tracks = [
    ...(manifest.scenes || []).map((scene) => scene.voiceover).filter(Boolean),
    manifest.bgm,
    ...(manifest.sfx || []),
  ].filter(Boolean);
  return tracks.length > 0 && tracks.every((track) =>
    track.materialized_path && existsSync(resolveInside(projectDir, track.materialized_path)),
  );
};

const prepareAudio = async (loaded, storyboard, options = buildAudioOptions(loaded)) => {
  if (!options.enabled) {
    const manifest = planAudioManifest(storyboard, options);
    writeAudioManifest(loaded.paths.audioManifest, manifest);
    return {storyboard, manifest, options, changedSceneIds: []};
  }
  let effectiveOptions = options;
  if (options.automatic) {
    const directorPlan = createAutomaticAudioPlan(storyboard, {mood: options.mood});
    atomicWriteJson(loaded.paths.audioDirector, directorPlan);
    const automatic = materializeAutomaticAudioPlan(directorPlan, loaded.paths.project);
    effectiveOptions = {
      ...options,
      ...automatic,
      automatic: true,
      tts: options.tts?.enabled ? options.tts : automatic.tts,
      mix: {...automatic.mix, ...options.mix},
    };
  }
  const optionsHash = stableHash(effectiveOptions);
  let planHash = audioPlanHash(storyboard, effectiveOptions);
  const planned = planAudioManifest(storyboard, effectiveOptions);
  const plannedTracks = [
    ...planned.scenes.map((scene) => scene.voiceover).filter(Boolean),
    planned.bgm,
    ...planned.sfx,
  ].filter(Boolean);
  if (!plannedTracks.length) {
    throw new Error('Audio is enabled but no voiceover, BGM, SFX, or enabled OpenAI narration track is configured');
  }
  let manifest;
  if (existsSync(loaded.paths.audioManifest)) {
    const existing = readJson(loaded.paths.audioManifest);
    manifest = audioManifestReady(existing, planHash, loaded.paths.project)
      ? existing
      : await materializeAudioManifest(planned, loaded.paths.project);
  } else {
    manifest = await materializeAudioManifest(planned, loaded.paths.project);
  }
  manifest.options_hash = optionsHash;
  manifest.plan_hash = planHash;
  const adjusted = applyNarrationDurations(
    storyboard,
    manifest,
    loaded.project.settings.audio?.narration_tail_seconds ?? 0.45,
  );
  if (adjusted.changedSceneIds.length) {
    manifest = mergeMaterializedAudio(planAudioManifest(adjusted.storyboard, effectiveOptions), manifest);
    planHash = audioPlanHash(adjusted.storyboard, effectiveOptions);
    manifest.options_hash = optionsHash;
    manifest.plan_hash = planHash;
    atomicWriteJson(loaded.paths.storyboard, adjusted.storyboard);
    atomicWriteJson(loaded.paths.storyboardPlan, adjusted.storyboard);
  }
  writeAudioManifest(loaded.paths.audioManifest, manifest);
  atomicWriteJson(loaded.paths.audioOptions, effectiveOptions);
  return {...adjusted, manifest, options: effectiveOptions};
};

const runQaFor = (loaded, quality, videoPath, storyboard) => {
  const canvas = storyboard.project;
  const renderSettings = loaded.project.settings.render;
  const previewCanvas = quality === 'preview'
    ? calculatePreviewCanvas(canvas, renderSettings.preview_width)
    : {width: canvas.width, height: canvas.height, scale: 1};
  const timeline = planSceneTimeline(storyboard);
  const directory = resolveInside(loaded.paths.qa, quality);
  const reportPath = resolveInside(directory, 'report.json');
  const framesDir = resolveInside(directory, 'frames');
  const generatedStory = loaded.project.source.type === 'story';
  const motionCutTimes = timeline.scenes.flatMap((timelineScene, index) => {
    const scene = storyboard.scenes[index];
    const shots = Array.isArray(scene?.shots) ? scene.shots : [];
    if (shots.length < 2) return [];
    const weights = shots.map((shot) => Math.max(0.01, Number(shot.duration_ratio || shot.duration_sec || 1)));
    const totalWeight = weights.reduce((sum, value) => sum + value, 0);
    const incomingFrames = index === 0 ? 0 : timeline.transition_frames;
    const outgoingFrames = index === storyboard.scenes.length - 1 ? 0 : timeline.transition_frames;
    const activeFrames = Math.max(1, timelineScene.duration_frames - incomingFrames - outgoingFrames);
    let elapsed = 0;
    return weights.slice(0, -1).map((weight) => {
      elapsed += weight;
      const localCutFrame = incomingFrames + Math.round(activeFrames * elapsed / totalWeight);
      return (timelineScene.start_frame + localCutFrame) / timeline.fps;
    });
  });
  const report = runVisualQa(videoPath, {
    colorAfterSec: generatedStory ? storyboard.scenes[0].duration_sec * 0.9 : Math.min(1, timeline.duration_sec * 0.25),
    timelineSamples: quality === 'preview' ? 7 : 11,
    transitionTimes: storyboard.project.transition === 'page-flip'
      ? timeline.scenes.slice(1).map((scene) => scene.start_sec)
      : [],
    motionCutTimes,
    framesDir,
    expected: {
      width: previewCanvas.width,
      height: previewCanvas.height,
      fps: canvas.fps,
      durationSec: timeline.duration_sec,
      durationToleranceSec: Math.max(0.16, 2 / canvas.fps),
      firstMonochrome: generatedStory,
      colorAfterTitle: generatedStory,
      hasAudio: existsSync(loaded.paths.audioManifest) && readJson(loaded.paths.audioManifest).enabled === true,
    },
  });
  atomicWriteJson(reportPath, report);
  if (!report.passed) {
    throw new Error(`Visual QA failed (${report.summary.fail} errors). Report: ${reportPath}`);
  }
  const semantic = createSemanticQaReport({
    storyboard,
    continuityLedger: existsSync(loaded.paths.continuityLedger) ? readJson(loaded.paths.continuityLedger) : null,
    manifest: existsSync(loaded.paths.codexManifest) ? readJson(loaded.paths.codexManifest) : null,
    observations: existsSync(loaded.paths.semanticObservations) ? readJson(loaded.paths.semanticObservations) : null,
    publicDir,
    strict: loaded.project.settings.review?.semantic_strict === true,
  });
  atomicWriteJson(loaded.paths.semanticReport, semantic);
  atomicWriteJson(loaded.paths.visionJobs, {schema_version: 1, jobs: semantic.vision_jobs});
  if (!semantic.passed) throw new Error(`Semantic QA failed for scenes: ${semantic.failed_scenes.join(', ')}`);
  return {report, reportPath, framesDir, semantic};
};

const render = async (loaded = requiredProject(), forcedQuality = null, {announce = true} = {}) => {
  if (styleApprovalPending(loaded)) return print(styleApprovalAction(loaded));
  const quality = forcedQuality || stringArg(args, 'quality', 'preview');
  if (!['preview', 'final'].includes(quality)) throw new Error('--quality must be preview or final');
  await runProjectAction(loaded, `rendering_${quality}`, async () => {
    let validated = validateActive(loaded, false);
    const options = buildAudioOptions(loaded);
    let audioPrepared = {storyboard: validated.storyboard, manifest: null};
    if (options.enabled) {
      audioPrepared = await prepareAudio(loaded, validated.storyboard, options);
      validated = validateStoryboardFile(loaded.paths.storyboard, {publicDir, skipAssets: false});
      if (validated.errors.length) throw new Error(validated.errors.join('\n'));
    }
    atomicWriteJson(loaded.paths.renderProps, {storyboard: validated.storyboard});
    const canvas = validated.storyboard.project;
    const renderSettings = loaded.project.settings.render;
    const scale = quality === 'preview'
      ? calculatePreviewCanvas(canvas, renderSettings.preview_width).scale
      : 1;
    const finalOutput = resolveInside(loaded.paths.output, `${quality}.mp4`);
    const silentOutput = options.enabled
      ? resolveInside(loaded.paths.output, `${quality}-silent.mp4`)
      : finalOutput;
    const crf = quality === 'preview' ? renderSettings.preview_crf : renderSettings.final_crf;
    runNode(
      remotionCli(repoRoot),
      [
        'render', 'src/index.ts', 'ProjectVideo', silentOutput,
        `--props=${loaded.paths.renderProps}`,
        '--codec=h264', '--pixel-format=yuv420p', `--crf=${crf}`,
        `--concurrency=${renderSettings.concurrency}`, `--scale=${scale}`,
        `--public-dir=${publicDir}`, '--muted',
      ],
      {cwd: repoRoot},
    );
    if (options.enabled) {
      muxAudioIntoVideo({
        manifest: audioPrepared.manifest,
        projectDir: loaded.paths.project,
        inputVideo: silentOutput,
        outputVideo: finalOutput,
      });
      audioPrepared.manifest.output = {source_video: silentOutput, video: finalOutput};
      writeAudioManifest(loaded.paths.audioManifest, audioPrepared.manifest);
    }
    const qa = runQaFor(loaded, quality, finalOutput, validated.storyboard);
    updateProjectState(
      loaded.paths,
      quality === 'preview' ? 'preview_ready' : 'completed',
      `${quality} render and machine QA passed: ${finalOutput}`,
      null,
      {
        qa: {
          ...(loaded.state?.qa || {}),
          [quality]: {status: qa.report.status, report: qa.reportPath, video: finalOutput},
        },
        review: {
          ...(loaded.state?.review || {}),
          semantic_status: qa.semantic.status,
          semantic_report: loaded.paths.semanticReport,
        },
        audio: options.enabled
          ? {status: 'mixed', manifest: loaded.paths.audioManifest, video: finalOutput}
          : {status: 'disabled'},
        production: {...(loaded.state?.production || {}), status: quality === 'preview' ? 'preview_ready' : 'completed'},
      },
    );
  });
  return announce ? statusFor(loaded.project.id) : loadById(loaded.project.id);
};

const qa = async (loaded = requiredProject(), {announce = true} = {}) => {
  const quality = stringArg(args, 'quality', existsSync(resolveInside(loaded.paths.output, 'final.mp4')) ? 'final' : 'preview');
  if (!['preview', 'final'].includes(quality)) throw new Error('--quality must be preview or final');
  const video = resolveInside(loaded.paths.output, `${quality}.mp4`);
  if (!existsSync(video)) throw new Error(`Missing ${quality} video: ${video}`);
  const validated = validateActive(loaded, false);
  const result = runQaFor(loaded, quality, video, validated.storyboard);
  updateProjectState(loaded.paths, loaded.state.status, `${quality} machine QA passed`, null, {
    qa: {...(loaded.state?.qa || {}), [quality]: {status: result.report.status, report: result.reportPath, video}},
    review: {...(loaded.state?.review || {}), semantic_status: result.semantic.status, semantic_report: loaded.paths.semanticReport},
  });
  const output = {ok: true, quality, video, report: result.reportPath, summary: result.report.summary};
  if (announce) print(output);
  return output;
};

const pendingCodexJobs = (loaded) => {
  if (manifestNeedsReplan(loaded)) return null;
  const manifest = readJson(loaded.paths.codexManifest);
  return (manifest.jobs || []).filter((job) => !existsSync(resolve(job.output_master)));
};

const produce = async () => {
  const target = stringArg(args, 'to', 'final');
  if (!['plan', 'assets', 'preview', 'final'].includes(target)) {
    throw new Error('--to must be plan, assets, preview, or final');
  }
  let loaded = stringArg(args, 'project') ? requiredProject() : createFromArgs({announce: false});
  const generator = stringArg(args, 'generator', loaded.state?.production?.generator || 'codex');
  const textMode = stringArg(args, 'text-mode', loaded.state?.production?.text_mode || 'font');
  updateProjectState(loaded.paths, loaded.state?.status || 'created', 'Automatic producer engaged', null, {
    production: {target, generator, text_mode: textMode, status: loaded.state?.status || 'created'},
  });

  for (let step = 0; step < 12; step += 1) {
    loaded = loadById(loaded.project.id);
    const current = loaded.state?.status === 'failed'
      ? loaded.state.resume_from || 'created'
      : loaded.state?.status || 'created';
    if (target === 'plan' && existsSync(loaded.paths.storyboardPlan)) return statusFor(loaded.project.id);
    if (current === 'created') {
      if (loaded.project.source.type === 'story') await plan(loaded, {announce: false});
      else await ingest(loaded, {announce: false});
      continue;
    }
    if (current === 'awaiting_style_choice') {
      print({...styleApprovalAction(loaded), target});
      return loaded;
    }
    if (['planning', 'awaiting_assets', 'importing'].includes(current)) {
      const pending = pendingCodexJobs(loaded);
      if (pending === null) {
        await plan(loaded, {announce: false});
        continue;
      }
      if (pending.length) {
        updateProjectState(loaded.paths, 'awaiting_assets', 'Waiting for image generation', null, {
          pending_jobs: pending.map((job) => job.id),
          pending_scenes: pending.filter((job) => job.role !== 'reference').map((job) => job.scene_id || job.id),
          production: {...loaded.state.production, status: 'awaiting_assets'},
        });
        print({
          project: loaded.project.id,
          status: 'awaiting_assets',
          target,
          action_required: 'generate_images',
          jobs: pending.map(({id, scene_id, prompt, prompt_file, references, output_master}) => ({
            id, scene_id: scene_id || null, prompt, prompt_file, references, output_master,
          })),
          resume: `produce --project ${loaded.project.id} --to ${target}`,
        });
        return loaded;
      }
      await importCodex(loaded, {announce: false});
      continue;
    }
    if (current === 'assets_ready' || current === 'ingesting') {
      if (target === 'assets') return statusFor(loaded.project.id);
      await render(loaded, 'preview', {announce: false});
      continue;
    }
    if (current === 'preview_ready' || current === 'rendering_final') {
      if (target === 'preview') return statusFor(loaded.project.id);
      await render(loaded, 'final', {announce: false});
      continue;
    }
    if (current === 'completed') return statusFor(loaded.project.id);
    if (current === 'rendering_preview') {
      await render(loaded, 'preview', {announce: false});
      continue;
    }
    throw new Error(`Automatic producer cannot continue from status: ${current}`);
  }
  throw new Error('Automatic producer exceeded its safe step limit');
};

const revise = async (loaded = requiredProject(), options = {}) => {
  if (loaded.project.source.type !== 'story') throw new Error('revise currently requires a generated story project');
  const sceneIds = (options.sceneIds || args.scene || []).map(String);
  if (!sceneIds.length) throw new Error('Add at least one --scene SCENE_ID');
  const note = options.note || stringArg(args, 'note');
  if (!note) throw new Error('--note is required');
  const target = options.target || stringArg(args, 'to', 'preview');
  if (!['assets', 'preview', 'final'].includes(target)) throw new Error('--to must be assets, preview, or final');
  for (const path of [loaded.paths.director, loaded.paths.storyboardPlan, loaded.paths.codexManifest, loaded.paths.continuitySpec, loaded.paths.continuityLedger]) {
    if (!existsSync(path)) throw new Error(`Revision metadata is missing: ${path}`);
  }
  const revision = Number(loaded.state?.current_revision || readJson(loaded.paths.director).revision || 1);
  await runProjectAction(loaded, 'revising', async () => {
    const nextRevision = revision + 1;
    const promptDirectory = resolveInside(loaded.paths.prompts, 'revisions', `r${nextRevision}`);
    mkdirSync(promptDirectory, {recursive: true});
    const activeStoryboard = existsSync(loaded.paths.storyboard) ? readJson(loaded.paths.storyboard) : null;
    const currentAssetReferences = {};
    for (const scene of activeStoryboard?.scenes || []) {
      if (scene.assets?.color) currentAssetReferences[scene.id] = resolve(publicDir, scene.assets.color);
    }
    const replacementTextRaw = options.text ?? stringArg(args, 'text');
    const replacementText = replacementTextRaw === undefined
      ? null
      : formatCaption(replacementTextRaw, {
          maxCharsPerLine: loaded.project.settings.caption.max_chars_per_line,
          maxLines: loaded.project.settings.caption.max_lines,
        });
    const result = prepareSceneRevision({
      director: readJson(loaded.paths.director),
      storyboardPlan: readJson(loaded.paths.storyboardPlan),
      activeStoryboard,
      manifest: readJson(loaded.paths.codexManifest),
      continuitySpec: readJson(loaded.paths.continuitySpec),
      continuityLedger: readJson(loaded.paths.continuityLedger),
      sceneIds,
      note,
      replacementText,
      replacementNarration: options.narration ?? stringArg(args, 'narration') ?? null,
      promptDirectory,
      currentAssetReferences,
    });
    if (replacementText !== null) {
      const scene = result.storyboardPlan.scenes.find((candidate) => candidate.id === sceneIds[0]);
      scene.duration_sec = durationFor(replacementText, durationSettings(loaded.project.settings));
    }
    atomicWriteJson(loaded.paths.director, result.director);
    atomicWriteJson(loaded.paths.storyboardPlan, result.storyboardPlan);
    atomicWriteJson(loaded.paths.codexManifest, result.manifest);
    atomicWriteJson(loaded.paths.continuitySpec, result.continuitySpec);
    atomicWriteJson(loaded.paths.continuityLedger, result.continuityLedger);
    for (const job of result.jobs) writeFileSync(job.prompt_file, `${job.prompt.trim()}\n`, 'utf8');
    updateProjectState(loaded.paths, 'awaiting_assets', `Revision ${result.revision} image jobs prepared`, null, {
      current_revision: result.revision,
      continuity_version: result.continuityLedger.version,
      pending_jobs: result.jobs.map((job) => job.id),
      pending_scenes: result.impact.impactedSceneIds,
      production: {
        target,
        generator: 'codex',
        text_mode: result.manifest.text_mode,
        status: 'awaiting_assets',
        revision: result.revision,
      },
      revision_impact: result.impact,
    });
  }, () => {
    const archiveDirectory = resolveInside(loaded.paths.revisions, `r${revision}`);
    if (!existsSync(archiveDirectory)) archiveProjectRevision(loaded.paths, revision, note);
  });
  const refreshed = loadById(loaded.project.id);
  const pending = pendingCodexJobs(refreshed) || [];
  const output = {
    project: loaded.project.id,
    status: refreshed.state.status,
    revision: refreshed.state.current_revision,
    impacted_scenes: refreshed.state.revision_impact?.impactedSceneIds || sceneIds,
    action_required: 'generate_images',
    jobs: pending.map(({id, scene_id, prompt, prompt_file, references, output_master}) => ({
      id, scene_id, prompt, prompt_file, references, output_master,
    })),
    resume: `produce --project ${loaded.project.id} --to ${refreshed.state.production?.target || 'preview'}`,
  };
  if (options.announce !== false) print(output);
  return output;
};

const semanticQa = () => {
  const loaded = requiredProject();
  const storyboard = validateActive(loaded, false).storyboard;
  const observationPath = stringArg(args, 'observations');
  const observations = observationPath
    ? readJson(resolve(process.cwd(), observationPath))
    : existsSync(loaded.paths.semanticObservations)
      ? readJson(loaded.paths.semanticObservations)
      : null;
  if (observationPath) atomicWriteJson(loaded.paths.semanticObservations, observations);
  const report = createSemanticQaReport({
    storyboard,
    continuityLedger: existsSync(loaded.paths.continuityLedger) ? readJson(loaded.paths.continuityLedger) : null,
    manifest: existsSync(loaded.paths.codexManifest) ? readJson(loaded.paths.codexManifest) : null,
    observations,
    publicDir,
    strict: args.strict === true || loaded.project.settings.review?.semantic_strict === true,
  });
  atomicWriteJson(loaded.paths.semanticReport, report);
  atomicWriteJson(loaded.paths.visionJobs, {schema_version: 1, jobs: report.vision_jobs});
  updateProjectState(loaded.paths, loaded.state.status, `Semantic QA ${report.status}`, null, {
    review: {...(loaded.state.review || {}), semantic_status: report.status, semantic_report: loaded.paths.semanticReport},
  });
  print({ok: report.passed, status: report.status, report: loaded.paths.semanticReport, vision_jobs: loaded.paths.visionJobs, summary: report.summary});
  if (!report.passed) process.exitCode = 1;
};

const review = () => {
  const loaded = requiredProject();
  const storyboard = validateActive(loaded, false).storyboard;
  const semantic = existsSync(loaded.paths.semanticReport)
    ? readJson(loaded.paths.semanticReport)
    : createSemanticQaReport({
        storyboard,
        continuityLedger: existsSync(loaded.paths.continuityLedger) ? readJson(loaded.paths.continuityLedger) : null,
        manifest: existsSync(loaded.paths.codexManifest) ? readJson(loaded.paths.codexManifest) : null,
        publicDir,
      });
  const quality = existsSync(resolveInside(loaded.paths.qa, 'final', 'report.json')) ? 'final' : 'preview';
  const qaPath = resolveInside(loaded.paths.qa, quality, 'report.json');
  const data = createReviewData({
    project: loaded.project,
    storyboard,
    qa: existsSync(qaPath) ? readJson(qaPath) : null,
    semantic,
    audio: existsSync(loaded.paths.audioOptions) ? readJson(loaded.paths.audioOptions) : null,
    publicDir,
  });
  const result = writeReviewWorkspace({data, htmlPath: loaded.paths.reviewHtml, dataPath: loaded.paths.reviewData});
  updateProjectState(loaded.paths, loaded.state.status, 'Local review workspace generated', null, {
    review: {...(loaded.state.review || {}), status: 'awaiting_review', html: result.html},
  });
  print({ok: true, ...result, instruction: 'Open index.html in a browser, review every scene, then export the decision JSON.'});
};

const applyReview = async () => {
  let loaded = requiredProject();
  const inputPath = stringArg(args, 'input');
  if (!inputPath) throw new Error('--input review.json is required');
  const storyboard = validateActive(loaded, false).storyboard;
  const decisions = validateReviewDecisions(
    readJson(resolve(process.cwd(), inputPath)),
    loaded.project.id,
    storyboard.scenes.map((scene) => scene.id),
  );
  atomicWriteJson(loaded.paths.reviewDecisions, decisions);
  const revisions = decisions.decisions.filter((item) => item.decision === 'revise');
  if (!revisions.length) {
    updateProjectState(loaded.paths, loaded.state.status, 'All scenes approved in local review', null, {
      review: {status: 'approved', decisions: loaded.paths.reviewDecisions},
    });
    return print({ok: true, status: 'approved', decisions: loaded.paths.reviewDecisions});
  }
  const outputs = [];
  for (const decision of revisions) {
    loaded = loadById(loaded.project.id);
    outputs.push(await revise(loaded, {
      sceneIds: [String(decision.scene_id)],
      note: String(decision.note),
      target: stringArg(args, 'to', 'preview'),
      announce: false,
    }));
  }
  loaded = loadById(loaded.project.id);
  updateProjectState(loaded.paths, loaded.state.status, `${revisions.length} review revisions prepared`, null, {
    review: {status: 'revision_prepared', decisions: loaded.paths.reviewDecisions, scenes: revisions.map((item) => item.scene_id)},
  });
  print({ok: true, status: 'revision_prepared', revisions: outputs, next_action: `produce --project ${loaded.project.id} --to preview`});
};

const providerCatalog = () => print({selected: resolveProvider('auto'), providers: listProviders()});
const templateCatalog = () => print({templates: listTemplates()});

const providerManifestFor = (loaded) => {
  if (existsSync(loaded.paths.codexManifest)) return readJson(loaded.paths.codexManifest);
  const storyboardPath = existsSync(loaded.paths.storyboard) ? loaded.paths.storyboard : loaded.paths.storyboardPlan;
  if (!existsSync(storyboardPath)) return {jobs: []};
  const storyboard = readJson(storyboardPath);
  return {
    jobs: storyboard.scenes.map((scene) => ({
      id: String(scene.id),
      scene_id: String(scene.id),
      prompt: scene.visual || '',
      output_master: scene.assets?.color ? resolve(publicDir, scene.assets.color) : resolveInside(loaded.paths.publicAssets, `${scene.id}_master.png`),
    })),
  };
};

const assets = async () => {
  let loaded = requiredProject();
  const action = stringArg(args, 'action', 'status');
  if (!['plan', 'run', 'status', 'retry'].includes(action)) throw new Error('--action must be plan, run, status, or retry');
  if (action === 'status') return print({project: loaded.project.id, provider: readProviderState(loaded.paths.providerState)});
  if (styleApprovalPending(loaded)) {
    updateProjectState(loaded.paths, 'awaiting_style_choice', 'Asset production is held for style approval', null, {
      director: {status: 'awaiting_style_choice'},
    });
    return print(styleApprovalAction(loaded));
  }
  const requested = stringArg(args, 'provider', loaded.project.settings.provider?.id || 'auto');
  const provider = resolveProvider(requested);
  if (manifestNeedsReplan(loaded)) {
    if (loaded.project.source.type === 'images') await ingest(loaded, {announce: false});
    else await plan(loaded, {announce: false, generatorOverride: provider === 'openai' ? 'api' : 'codex'});
    loaded = loadById(loaded.project.id);
  }
  let providerPlan = createProviderPlan(providerManifestFor(loaded), requested, {
    maxAttempts: loaded.project.settings.provider?.max_attempts || 3,
  });
  atomicWriteJson(loaded.paths.providerState, providerPlan);
  if (action === 'plan') return print(providerPlan);
  if (providerPlan.status === 'completed') {
    updateProjectState(loaded.paths, 'assets_ready', `${provider} assets are already complete`, null, {
      provider: {status: 'completed', id: provider, state: loaded.paths.providerState},
    });
    return print(providerPlan);
  }
  if (provider === 'codex' || provider === 'files') {
    updateProjectState(loaded.paths, 'awaiting_assets', `${provider} asset jobs prepared`, null, {
      provider: {status: 'awaiting_external_execution', id: provider, state: loaded.paths.providerState},
    });
    return print({...providerPlan, action_required: provider === 'codex' ? 'Run the emitted image jobs with the host image tool, then resume.' : 'Place uploaded images in the declared outputs, then resume.'});
  }
  const attempts = Number(loaded.project.settings.provider?.max_attempts || 3);
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await plan(loaded, {announce: false, generatorOverride: 'api'});
      loaded = loadById(loaded.project.id);
      providerPlan = createProviderPlan(providerManifestFor(loaded), 'openai', {maxAttempts: attempts});
      providerPlan.status = 'completed';
      providerPlan.attempt = attempt;
      atomicWriteJson(loaded.paths.providerState, providerPlan);
      updateProjectState(loaded.paths, 'assets_ready', `OpenAI assets completed on attempt ${attempt}`, null, {provider: {status: 'completed', id: 'openai', state: loaded.paths.providerState}});
      return print(providerPlan);
    } catch (error) {
      lastError = error;
      providerPlan.status = attempt === attempts ? 'failed' : 'retrying';
      providerPlan.attempt = attempt;
      providerPlan.last_error = error.message;
      atomicWriteJson(loaded.paths.providerState, providerPlan);
    }
  }
  throw lastError;
};

const migrate = () => {
  const loaded = requiredProject();
  const result = persistProjectMigration(loaded.paths);
  print({ok: true, from: result.from, to: result.to, changed: result.changed, changes: result.changes, backup_snapshot: result.snapshot || null});
};

const snapshot = () => {
  const loaded = requiredProject();
  const result = createProjectSnapshot(loaded.paths, stringArg(args, 'label', 'manual snapshot'));
  updateProjectState(loaded.paths, loaded.state.status, `Snapshot ${result.id} created`, null, {
    snapshots: [...(loaded.state.snapshots || []), {id: result.id, label: result.label, created_at: result.created_at}],
  });
  print({ok: true, ...result});
};

const rollback = () => {
  const loaded = requiredProject();
  const id = stringArg(args, 'snapshot');
  if (!id) throw new Error('--snapshot s0001 is required');
  const result = restoreProjectSnapshot(loaded.paths, id);
  print({ok: true, ...result});
};

const continuity = () => {
  const loaded = requiredProject();
  const applyPath = stringArg(args, 'apply');
  if (!applyPath) {
    const spec = existsSync(loaded.paths.continuitySpec) ? readJson(loaded.paths.continuitySpec) : null;
    const ledger = existsSync(loaded.paths.continuityLedger) ? readJson(loaded.paths.continuityLedger) : null;
    return print({project: loaded.project.id, spec: loaded.paths.continuitySpec, ledger: loaded.paths.continuityLedger, continuity: spec, compiled: ledger});
  }
  const nextSpec = readJson(resolve(process.cwd(), applyPath));
  const validation = validateContinuity(nextSpec);
  if (!validation.valid) throw new Error(validation.issues.map((issue) => `${issue.path}: ${issue.message}`).join('\n'));
  const nextLedger = createContinuityLedger(nextSpec);
  const previous = existsSync(loaded.paths.continuityLedger) ? readJson(loaded.paths.continuityLedger) : null;
  const impact = previous ? computeContinuityImpact(previous, nextLedger) : null;
  atomicWriteJson(loaded.paths.continuitySpec, nextSpec);
  atomicWriteJson(loaded.paths.continuityLedger, nextLedger);
  updateProjectState(loaded.paths, loaded.state.status, 'Continuity specification updated', null, {
    continuity_version: nextLedger.version,
    continuity_impact: impact,
  });
  print({ok: true, project: loaded.project.id, version: nextLedger.version, impact, next_action: impact?.impactedSceneIds?.length ? 'Revise the impacted scenes before the next final render' : null});
};

const audio = async () => {
  const loaded = requiredProject();
  const action = stringArg(args, 'action', 'plan');
  if (!['auto', 'plan', 'prepare', 'mix', 'disable'].includes(action)) throw new Error('--action must be auto, plan, prepare, mix, or disable');
  if (action === 'disable') {
    const options = {...buildAudioOptions(loaded), enabled: false};
    atomicWriteJson(loaded.paths.audioOptions, options);
    const storyboard = validateActive(loaded, false).storyboard;
    writeAudioManifest(loaded.paths.audioManifest, planAudioManifest(storyboard, options));
    updateProjectState(loaded.paths, 'assets_ready', 'Optional audio disabled; existing renders invalidated', null, {
      audio: {status: 'disabled'},
      production: {...(loaded.state.production || {}), target: 'final', status: 'assets_ready'},
    });
    return print({ok: true, enabled: false, options: loaded.paths.audioOptions, next_action: 'produce final'});
  }
  const storyboard = validateActive(loaded, false).storyboard;
  const options = buildAudioOptions(loaded);
  if (action === 'auto') {
    options.enabled = true;
    options.automatic = true;
    const prepared = await prepareAudio(loaded, storyboard, options);
    updateProjectState(loaded.paths, 'assets_ready', 'Automatic sound direction and procedural tracks prepared', null, {
      audio: {status: 'prepared', mode: 'automatic', manifest: loaded.paths.audioManifest, director: loaded.paths.audioDirector},
      production: {...(loaded.state.production || {}), target: 'final', status: 'assets_ready'},
    });
    return print({ok: true, mode: 'automatic', director: loaded.paths.audioDirector, manifest: loaded.paths.audioManifest, next_action: 'produce final'});
  }
  if (action !== 'plan') options.enabled = true;
  atomicWriteJson(loaded.paths.audioOptions, options);
  if (action === 'plan') {
    const manifest = planAudioManifest(storyboard, options);
    writeAudioManifest(loaded.paths.audioManifest, manifest);
    updateProjectState(loaded.paths, loaded.state.status, 'Audio sidecar planned', null, {audio: {status: 'planned', manifest: loaded.paths.audioManifest}});
    return print({ok: true, enabled: manifest.enabled, manifest: loaded.paths.audioManifest, scenes: manifest.scenes.length});
  }
  if (action === 'prepare') {
    const prepared = await prepareAudio(loaded, storyboard, options);
    const nextStatus = prepared.changedSceneIds.length
      ? 'assets_ready'
      : existsSync(resolveInside(loaded.paths.output, 'preview.mp4'))
        ? 'preview_ready'
        : 'assets_ready';
    updateProjectState(loaded.paths, nextStatus, 'Audio tracks prepared and narration timing synchronized', null, {
      audio: {status: 'prepared', manifest: loaded.paths.audioManifest},
      audio_timing_changed_scenes: prepared.changedSceneIds,
      production: {...(loaded.state.production || {}), target: 'final', status: nextStatus},
    });
    return print({ok: true, manifest: loaded.paths.audioManifest, timing_changed_scenes: prepared.changedSceneIds, next_action: 'render final'});
  }
  const manifest = readJson(loaded.paths.audioManifest);
  const input = resolveInside(loaded.paths.output, stringArg(args, 'video', 'final-silent.mp4'));
  const output = resolveInside(loaded.paths.output, stringArg(args, 'output', 'final.mp4'));
  const result = muxAudioIntoVideo({manifest, projectDir: loaded.paths.project, inputVideo: input, outputVideo: output});
  const qaResult = runQaFor(loaded, 'final', output, storyboard);
  updateProjectState(loaded.paths, 'completed', 'Audio mixed and final QA passed', null, {
    audio: {status: 'mixed', manifest: loaded.paths.audioManifest, video: output},
    qa: {...(loaded.state.qa || {}), final: {status: qaResult.report.status, report: qaResult.reportPath, video: output}},
  });
  print({ok: true, video: result.output_video, manifest: loaded.paths.audioManifest, qa: qaResult.reportPath});
};

const resume = async () => {
  const loaded = requiredProject();
  if (loaded.state?.production?.target) return produce();
  const current = loaded.state?.status === 'failed' ? loaded.state.resume_from || 'created' : loaded.state?.status || 'created';
  if (current === 'created') return loaded.project.source.type === 'story' ? plan(loaded) : ingest(loaded);
  if (current === 'awaiting_style_choice') return print(styleApprovalAction(loaded));
  if (['planning', 'awaiting_assets', 'importing'].includes(current)) {
    const pending = pendingCodexJobs(loaded);
    if (pending === null) return plan(loaded);
    if (pending.length) return print({status: 'awaiting_assets', missing: pending.map(({id, output_master}) => ({id, output_master}))});
    return importCodex(loaded);
  }
  if (['ingesting', 'assets_ready', 'rendering_preview'].includes(current)) return render(loaded, 'preview');
  if (['preview_ready', 'rendering_final'].includes(current)) return render(loaded, 'final');
  if (current === 'completed') return statusFor(loaded.project.id);
  throw new Error(`Cannot resume from status: ${current}`);
};

const regress = () => {
  const fixtureRoot = resolve(repoRoot, 'tests', 'fixtures', 'regression-cases');
  const names = [
    'single-character', 'dialogue', 'long-story', 'children', 'emotional',
    'science', 'landscape', 'uploaded-image', 'page-flip', 'mid-story-recovery',
  ];
  const cases = names.map((name) => {
    const path = resolve(fixtureRoot, `${name}.json`);
    const fixture = readJson(path);
    const validation = validateContinuity(fixture.input);
    const ledger = validation.valid ? createContinuityLedger(fixture.input) : null;
    return {name, ok: validation.valid, scenes: fixture.input.scenes.length, version: ledger?.version || null, issues: validation.issues};
  });
  const ok = cases.every((item) => item.ok);
  print({ok, total: cases.length, passed: cases.filter((item) => item.ok).length, cases});
  if (!ok) process.exitCode = 1;
};

const doctor = () => {
  const checks = {
    node: probeCommand(process.execPath, ['--version'], repoRoot),
    ffmpeg: probeCommand('ffmpeg', ['-version'], repoRoot),
    ffprobe: probeCommand('ffprobe', ['-version'], repoRoot),
    dependencies: {ok: existsSync(resolve(repoRoot, 'node_modules', '@remotion', 'cli')), detail: 'node_modules/@remotion/cli'},
    references: {
      ok: ['style-bw.png', 'style-color.png'].every((name) => existsSync(resolve(repoRoot, 'references', name))),
      detail: resolve(repoRoot, 'references'),
    },
  };
  const ok = Object.values(checks).every((check) => check.ok);
  print({ok, data_root: dataRoot, projects_root: projectsRoot || resolve(repoRoot, 'projects'), public_dir: publicDir, checks});
  if (!ok) process.exitCode = 1;
};

try {
  if (['help', '--help', '-h'].includes(command)) usage();
  else if (command === 'produce') await produce();
  else if (command === 'create') create();
  else if (command === 'list') list();
  else if (command === 'status') status();
  else if (command === 'plan') await plan();
  else if (command === 'director') creativeDirector();
  else if (command === 'ingest') await ingest();
  else if (command === 'import') await importCodex();
  else if (command === 'validate') validate();
  else if (command === 'render') await render();
  else if (command === 'qa') await qa();
  else if (command === 'semantic-qa') semanticQa();
  else if (command === 'review') review();
  else if (command === 'apply-review') await applyReview();
  else if (command === 'revise') await revise();
  else if (command === 'continuity') continuity();
  else if (command === 'audio') await audio();
  else if (command === 'providers') providerCatalog();
  else if (command === 'templates') templateCatalog();
  else if (command === 'assets') await assets();
  else if (command === 'migrate') migrate();
  else if (command === 'snapshot') snapshot();
  else if (command === 'rollback') rollback();
  else if (command === 'resume') await resume();
  else if (command === 'regress') regress();
  else if (command === 'doctor') doctor();
  else throw new Error(`Unknown command: ${command}`);
} catch (error) {
  console.error(`Studio error: ${error.message}`);
  process.exitCode = 1;
}

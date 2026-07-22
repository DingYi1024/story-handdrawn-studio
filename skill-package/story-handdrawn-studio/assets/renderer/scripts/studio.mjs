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
import {
  archiveProjectRevision,
  atomicWriteJson,
  createProject,
  listProjects,
  loadProject,
  readJson,
  resolveInside,
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
  node scripts/studio.mjs plan --project PROJECT [--generator codex|api]
  node scripts/studio.mjs revise --project PROJECT --scene 01 --note "人物表情更克制"
  node scripts/studio.mjs continuity --project PROJECT [--apply continuity.json]
  node scripts/studio.mjs audio --project PROJECT --action plan|prepare|mix|disable [OPTIONS]
  node scripts/studio.mjs render --project PROJECT [--quality preview|final]
  node scripts/studio.mjs qa --project PROJECT [--quality preview|final]
  node scripts/studio.mjs resume --project PROJECT
  node scripts/studio.mjs regress [--json]
  node scripts/studio.mjs list|status|validate|doctor [OPTIONS]

Audio options:
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
  const preset = stringArg(args, 'preset', 'portrait');
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
  const settings = createSettings(preset, overrides);
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

const plan = async (loaded = requiredProject(), {announce = true} = {}) => {
  if (loaded.project.source.type !== 'story') throw new Error('plan requires a story project');
  const generator = stringArg(args, 'generator', loaded.state?.production?.generator || 'codex');
  const textMode = stringArg(args, 'text-mode', loaded.state?.production?.text_mode || 'font');
  if (!['codex', 'api'].includes(generator)) throw new Error('--generator must be codex or api');
  await runProjectAction(loaded, 'planning', async () => {
    const commandArgs = [
      '--input', resolveInside(loaded.paths.project, loaded.project.source.path),
      '--title', loaded.project.title,
      '--config', loaded.paths.config,
      '--workspace', loaded.paths.project,
      '--scope', loaded.project.id,
      '--output', loaded.paths.storyboardPlan,
      '--manifest', loaded.paths.codexManifest,
      '--generator', generator,
      '--text-mode', textMode,
      '--public-dir', publicDir,
    ];
    if (generator === 'api') {
      commandArgs.push('--generate', '--apply', '--apply-to', loaded.paths.storyboard);
    }
    runNode(resolve(repoRoot, 'scripts', 'story-to-video.mjs'), commandArgs, {cwd: repoRoot});
    const storyboard = readJson(generator === 'api' ? loaded.paths.storyboard : loaded.paths.storyboardPlan);
    if (generator === 'api') atomicWriteJson(loaded.paths.storyboardPlan, storyboard);
    const suppliedContinuity = stringArg(args, 'continuity');
    const continuitySpec = suppliedContinuity
      ? readJson(resolve(process.cwd(), suppliedContinuity))
      : existsSync(loaded.paths.continuitySpec)
        ? readJson(loaded.paths.continuitySpec)
        : null;
    const manifest = generator === 'codex' ? readJson(loaded.paths.codexManifest) : null;
    const sourceText = readFileSync(resolveInside(loaded.paths.project, loaded.project.source.path), 'utf8');
    const artifacts = createDirectorArtifacts({
      project: loaded.project,
      storyboard,
      manifest,
      sourceText,
      generator,
      textMode,
      continuitySpec,
    });
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
    const pending = (artifacts.manifest?.jobs || []).filter((job) => !existsSync(job.output_master));
    const nextStatus = generator === 'api' ? 'assets_ready' : 'awaiting_assets';
    updateProjectState(
      loaded.paths,
      nextStatus,
      generator === 'api' ? 'Director plan, images, and continuity ledger are ready' : 'Director image jobs are ready',
      null,
      {
        current_revision: 1,
        pending_jobs: pending.map((job) => job.id),
        pending_scenes: pending.filter((job) => job.role !== 'reference').map((job) => job.scene_id || job.id),
        continuity_version: artifacts.continuityLedger.version,
        production: {
          ...(loaded.state?.production || {}),
          generator,
          text_mode: textMode,
          status: nextStatus,
        },
      },
    );
  });
  return announce ? statusFor(loaded.project.id) : loadById(loaded.project.id);
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
  if (args.enable === true || args.audio === true) options.enabled = true;
  if (args.enable === false || args.audio === false) options.enabled = false;
  const provider = stringArg(args, 'provider');
  if (provider) options.tts.enabled = provider === 'openai';
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
  const optionsHash = stableHash(options);
  let planHash = audioPlanHash(storyboard, options);
  const planned = planAudioManifest(storyboard, options);
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
    manifest = mergeMaterializedAudio(planAudioManifest(adjusted.storyboard, options), manifest);
    planHash = audioPlanHash(adjusted.storyboard, options);
    manifest.options_hash = optionsHash;
    manifest.plan_hash = planHash;
    atomicWriteJson(loaded.paths.storyboard, adjusted.storyboard);
    atomicWriteJson(loaded.paths.storyboardPlan, adjusted.storyboard);
  }
  writeAudioManifest(loaded.paths.audioManifest, manifest);
  atomicWriteJson(loaded.paths.audioOptions, options);
  return {...adjusted, manifest, options};
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
  const report = runVisualQa(videoPath, {
    colorAfterSec: generatedStory ? storyboard.scenes[0].duration_sec * 0.9 : Math.min(1, timeline.duration_sec * 0.25),
    timelineSamples: quality === 'preview' ? 7 : 11,
    framesDir,
    expected: {
      width: previewCanvas.width,
      height: previewCanvas.height,
      fps: canvas.fps,
      durationSec: timeline.duration_sec,
      durationToleranceSec: Math.max(0.16, 2 / canvas.fps),
      firstMonochrome: generatedStory,
      colorAfterTitle: generatedStory,
    },
  });
  atomicWriteJson(reportPath, report);
  if (!report.passed) {
    throw new Error(`Visual QA failed (${report.summary.fail} errors). Report: ${reportPath}`);
  }
  return {report, reportPath, framesDir};
};

const render = async (loaded = requiredProject(), forcedQuality = null, {announce = true} = {}) => {
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
  });
  const output = {ok: true, quality, video, report: result.reportPath, summary: result.report.summary};
  if (announce) print(output);
  return output;
};

const pendingCodexJobs = (loaded) => {
  if (!existsSync(loaded.paths.codexManifest)) return null;
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

const revise = async (loaded = requiredProject()) => {
  if (loaded.project.source.type !== 'story') throw new Error('revise currently requires a generated story project');
  const sceneIds = (args.scene || []).map(String);
  if (!sceneIds.length) throw new Error('Add at least one --scene SCENE_ID');
  const note = stringArg(args, 'note');
  if (!note) throw new Error('--note is required');
  const target = stringArg(args, 'to', 'preview');
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
    const replacementTextRaw = stringArg(args, 'text');
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
      replacementNarration: stringArg(args, 'narration') ?? null,
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
  print({
    project: loaded.project.id,
    status: refreshed.state.status,
    revision: refreshed.state.current_revision,
    impacted_scenes: refreshed.state.revision_impact?.impactedSceneIds || sceneIds,
    action_required: 'generate_images',
    jobs: pending.map(({id, scene_id, prompt, prompt_file, references, output_master}) => ({
      id, scene_id, prompt, prompt_file, references, output_master,
    })),
    resume: `produce --project ${loaded.project.id} --to ${refreshed.state.production?.target || 'preview'}`,
  });
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
  if (!['plan', 'prepare', 'mix', 'disable'].includes(action)) throw new Error('--action must be plan, prepare, mix, or disable');
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
  else if (command === 'ingest') await ingest();
  else if (command === 'import') await importCodex();
  else if (command === 'validate') validate();
  else if (command === 'render') await render();
  else if (command === 'qa') await qa();
  else if (command === 'revise') await revise();
  else if (command === 'continuity') continuity();
  else if (command === 'audio') await audio();
  else if (command === 'resume') await resume();
  else if (command === 'regress') regress();
  else if (command === 'doctor') doctor();
  else throw new Error(`Unknown command: ${command}`);
} catch (error) {
  console.error(`Studio error: ${error.message}`);
  process.exitCode = 1;
}

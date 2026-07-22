import {existsSync, readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs, numberArg, stringArg} from './lib/args.mjs';
import {createSettings, validateSettings} from './lib/presets.mjs';
import {
  atomicWriteJson,
  createProject,
  listProjects,
  loadProject,
  resolveInside,
  updateProjectState,
  withProjectLock,
} from './lib/projects.mjs';
import {probeCommand, remotionCli, runNode} from './lib/process.mjs';
import {safeSlug} from './lib/story-text.mjs';
import {validateStoryboardFile} from './lib/storyboard-validator.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const command = process.argv[2] || 'help';
const args = parseArgs(process.argv.slice(3), {repeatable: ['image']});
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
  node scripts/studio.mjs create --title "标题" --input story.txt [--preset portrait]
  node scripts/studio.mjs create --title "标题" --image page1.png [--image page2.png]
  node scripts/studio.mjs list [--json]
  node scripts/studio.mjs status --project PROJECT [--json]
  node scripts/studio.mjs plan --project PROJECT [--generator codex|api]
  node scripts/studio.mjs ingest --project PROJECT
  node scripts/studio.mjs import --project PROJECT
  node scripts/studio.mjs validate --project PROJECT [--assets]
  node scripts/studio.mjs render --project PROJECT [--quality preview|final]
  node scripts/studio.mjs resume --project PROJECT
  node scripts/studio.mjs doctor [--json]

Presets: portrait (3:4), vertical (9:16), square (1:1), landscape (16:9)
Storage: add --data-root PATH to keep projects, assets, and outputs outside the renderer`);

const requiredProject = () => {
  const id = stringArg(args, 'project');
  if (!id) throw new Error('--project is required');
  const loaded = loadProject(repoRoot, id, projectsRoot, publicDir);
  if (loaded.project.id !== loaded.paths.id) throw new Error('Project config id does not match its directory');
  if (!['story', 'images'].includes(loaded.project.source?.type)) {
    throw new Error('Project source type must be story or images');
  }
  validateSettings(loaded.project.settings);
  return loaded;
};

const runProjectAction = async (loaded, workingStatus, callback) =>
  withProjectLock(loaded.paths, async () => {
    const resumeFrom = loaded.state?.status === 'failed'
      ? loaded.state.resume_from || 'created'
      : loaded.state?.status || 'created';
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
  const result = validateStoryboardFile(loaded.paths.storyboard, {
    publicDir,
    skipAssets,
  });
  if (result.errors.length) throw new Error(result.errors.join('\n'));
  return result;
};

const create = () => {
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
  print({project: result.project, directory: result.paths.project});
};

const list = () => {
  const projects = listProjects(repoRoot, projectsRoot, publicDir).map(({project, state, paths}) => ({
    id: project.id,
    title: project.title,
    source: project.source.type,
    preset: project.settings.preset,
    status: state?.status || 'unknown',
    updated_at: state?.updated_at || project.updated_at,
    directory: paths.project,
  }));
  if (jsonOutput) return print(projects);
  if (!projects.length) return console.log('No Studio projects yet.');
  console.table(projects.map(({directory, ...row}) => row));
};

const status = () => {
  const loaded = requiredProject();
  print({project: loaded.project, state: loaded.state, paths: loaded.paths});
};

const plan = async (loaded = requiredProject()) => {
  if (loaded.project.source.type !== 'story') throw new Error('plan requires a story project');
  const generator = stringArg(args, 'generator', 'codex');
  const textMode = stringArg(args, 'text-mode', 'font');
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
    const nextStatus = generator === 'api' ? 'assets_ready' : 'awaiting_assets';
    updateProjectState(
      loaded.paths,
      nextStatus,
      generator === 'api' ? 'Images generated and storyboard activated' : 'Image jobs prepared',
    );
  });
  statusFor(loaded.project.id);
};

const ingest = async (loaded = requiredProject()) => {
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
    updateProjectState(loaded.paths, 'assets_ready', 'Uploaded pages ingested and validated');
  });
  statusFor(loaded.project.id);
};

const importCodex = async (loaded = requiredProject()) => {
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
    updateProjectState(loaded.paths, 'assets_ready', 'Generated images imported and validated');
  });
  statusFor(loaded.project.id);
};

const validate = () => {
  const loaded = requiredProject();
  const selected = existsSync(loaded.paths.storyboard)
    ? loaded.paths.storyboard
    : loaded.paths.storyboardPlan;
  const result = validateStoryboardFile(selected, {
    publicDir,
    skipAssets: args.assets !== true,
  });
  if (result.errors.length) throw new Error(result.errors.join('\n'));
  print({ok: true, storyboard: selected, summary: result.summary});
};

const render = async (loaded = requiredProject(), forcedQuality = null) => {
  const quality = forcedQuality || stringArg(args, 'quality', 'preview');
  if (!['preview', 'final'].includes(quality)) throw new Error('--quality must be preview or final');
  await runProjectAction(loaded, `rendering_${quality}`, async () => {
    const validated = validateActive(loaded, false);
    atomicWriteJson(loaded.paths.renderProps, {storyboard: validated.storyboard});
    const canvas = validated.storyboard.project;
    const renderSettings = loaded.project.settings.render;
    const scale = quality === 'preview'
      ? Math.min(1, renderSettings.preview_width / canvas.width)
      : 1;
    const output = resolveInside(loaded.paths.output, `${quality}.mp4`);
    const crf = quality === 'preview' ? renderSettings.preview_crf : renderSettings.final_crf;
    runNode(
      remotionCli(repoRoot),
      [
        'render', 'src/index.ts', 'ProjectVideo', output,
        `--props=${loaded.paths.renderProps}`,
        '--codec=h264', '--pixel-format=yuv420p', `--crf=${crf}`,
        `--concurrency=${renderSettings.concurrency}`, `--scale=${scale}`,
        `--public-dir=${publicDir}`,
        '--muted',
      ],
      {cwd: repoRoot},
    );
    updateProjectState(
      loaded.paths,
      quality === 'preview' ? 'preview_ready' : 'completed',
      `${quality} render completed: ${output}`,
    );
  });
  statusFor(loaded.project.id);
};

const pendingCodexJobs = (loaded) => {
  if (!existsSync(loaded.paths.codexManifest)) return null;
  const manifest = JSON.parse(readFileSync(loaded.paths.codexManifest, 'utf8'));
  return (manifest.jobs || []).filter((job) =>
    !existsSync(resolve(job.output_master)),
  );
};

const resume = async () => {
  const loaded = requiredProject();
  const current = loaded.state?.status === 'failed'
    ? loaded.state.resume_from || 'created'
    : loaded.state?.status || 'created';
  if (current === 'created') {
    return loaded.project.source.type === 'story' ? plan(loaded) : ingest(loaded);
  }
  if (['planning', 'awaiting_assets', 'importing'].includes(current)) {
    const pending = pendingCodexJobs(loaded);
    if (pending === null) return plan(loaded);
    if (pending.length) {
      print({status: 'awaiting_assets', missing: pending.map(({id, output_master}) => ({id, output_master}))});
      return;
    }
    return importCodex(loaded);
  }
  if (['ingesting', 'assets_ready', 'rendering_preview'].includes(current)) {
    return render(loaded, 'preview');
  }
  if (['preview_ready', 'rendering_final'].includes(current)) return render(loaded, 'final');
  if (current === 'completed') return statusFor(loaded.project.id);
  throw new Error(`Cannot resume from status: ${current}`);
};

const statusFor = (id) => {
  const loaded = loadProject(repoRoot, id, projectsRoot, publicDir);
  print({id, title: loaded.project.title, status: loaded.state?.status, state: loaded.state});
};

const doctor = () => {
  const checks = {
    node: probeCommand(process.execPath, ['--version'], repoRoot),
    ffmpeg: probeCommand('ffmpeg', ['-version'], repoRoot),
    ffprobe: probeCommand('ffprobe', ['-version'], repoRoot),
    dependencies: {
      ok: existsSync(resolve(repoRoot, 'node_modules', '@remotion', 'cli')),
      detail: 'node_modules/@remotion/cli',
    },
    references: {
      ok: ['style-bw.png', 'style-color.png'].every((name) =>
        existsSync(resolve(repoRoot, 'references', name)),
      ),
      detail: resolve(repoRoot, 'references'),
    },
  };
  const ok = Object.values(checks).every((check) => check.ok);
  print({ok, data_root: dataRoot, projects_root: projectsRoot || resolve(repoRoot, 'projects'), public_dir: publicDir, checks});
  if (!ok) process.exitCode = 1;
};

try {
  if (['help', '--help', '-h'].includes(command)) usage();
  else if (command === 'create') create();
  else if (command === 'list') list();
  else if (command === 'status') status();
  else if (command === 'plan') await plan();
  else if (command === 'ingest') await ingest();
  else if (command === 'import') await importCodex();
  else if (command === 'validate') validate();
  else if (command === 'render') await render();
  else if (command === 'resume') await resume();
  else if (command === 'doctor') doctor();
  else throw new Error(`Unknown command: ${command}`);
} catch (error) {
  console.error(`Studio error: ${error.message}`);
  process.exitCode = 1;
}

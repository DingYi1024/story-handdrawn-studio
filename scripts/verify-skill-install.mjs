import {spawnSync} from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const version = readFileSync(resolve(root, 'VERSION'), 'utf8').trim();
const sourceSkill = resolve(root, 'skill-package', 'story-handdrawn-studio');
const pythonCandidates = [
  'python',
  'python3',
  'py',
  process.env.USERPROFILE
    ? resolve(process.env.USERPROFILE, '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'python', 'python.exe')
    : null,
].filter(Boolean);
const python = pythonCandidates.find((candidate) =>
  spawnSync(candidate, ['--version'], {stdio: 'ignore'}).status === 0);
if (!python) throw new Error('Python 3 is required for the packaged Skill acceptance test');

const sandbox = mkdtempSync(resolve(tmpdir(), 'story-skill-acceptance-'));
const skill = resolve(sandbox, 'story-handdrawn-studio');
const home = resolve(sandbox, 'data');
const launcher = resolve(skill, 'scripts', 'run_story_video.py');
const env = {
  ...process.env,
  STORY_HANDDRAWN_STUDIO_HOME: home,
  STORY_HANDDRAWN_STUDIO_PROJECT: '',
};

const run = (args, label, timeout = 10 * 60 * 1000) => {
  console.log(`\n[acceptance] ${label}`);
  const result = spawnSync(python, [launcher, ...args], {
    cwd: sandbox,
    env,
    encoding: 'utf8',
    timeout,
    maxBuffer: 50 * 1024 * 1024,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${label} failed with status ${result.status}`);
  }
  return result.stdout;
};

try {
  cpSync(sourceSkill, skill, {recursive: true});
  const before = JSON.parse(run(['version'], 'read-only version probe'));
  if (before.skill_version !== version || before.runtime_ready !== false || existsSync(home)) {
    throw new Error('Cold install probe mutated data or reported an unexpected version');
  }

  run(['setup'], 'cold dependency setup and strict doctor');

  const after = JSON.parse(run(['version'], 'warm runtime probe'));
  if (after.skill_version !== version || after.runtime_ready !== true) {
    throw new Error('Prepared runtime did not pass the launcher health check');
  }

  const renderer = resolve(home, 'runtimes', version);
  const imageOne = resolve(renderer, 'public', 'examples', 'case-sprouting-note', '01_color.png');
  const imageTwo = resolve(renderer, 'public', 'examples', 'case-sprouting-note', '02_color.png');
  for (const image of [imageOne, imageTwo]) {
    if (!existsSync(image)) throw new Error(`Bundled acceptance image is missing: ${image}`);
  }

  run([
    'produce',
    '--id', 'cold-start-acceptance',
    '--title', '冷启动验收',
    '--image', imageOne,
    '--image', imageTwo,
    '--template', 'gentle-diary',
    '--preset', 'square',
    '--to', 'final',
    '--json',
  ], 'isolated image-to-video final render');

  const project = resolve(home, 'projects', 'cold-start-acceptance');
  const finalVideo = resolve(project, 'output', 'final.mp4');
  const qaReport = resolve(project, 'qa', 'final', 'report.json');
  const statePath = resolve(project, 'state.json');
  for (const path of [finalVideo, qaReport, statePath]) {
    if (!existsSync(path)) throw new Error(`Acceptance artifact is missing: ${path}`);
  }
  const state = JSON.parse(readFileSync(statePath, 'utf8'));
  const qa = JSON.parse(readFileSync(qaReport, 'utf8'));
  if (
    state.status !== 'completed'
    || !qa.passed
    || Number(qa.summary?.fail || 0) !== 0
  ) {
    throw new Error(`Acceptance final is not complete: state=${state.status}; qa=${qa.status}`);
  }
  const portfolio = JSON.parse(run(
    ['audit', '--json', '--strict'],
    'read-only portfolio integrity audit',
  ));
  if (!portfolio.ok || portfolio.summary?.healthy !== 1 || portfolio.summary?.failed !== 0) {
    throw new Error(`Acceptance portfolio audit failed: ${portfolio.status}`);
  }

  console.log(JSON.stringify({
    ok: true,
    version,
    cold_setup: 'pass',
    runtime_ready: true,
    production_state: state.status,
    qa: qa.summary,
    final_bytes: statSync(finalVideo).size,
    audio: state.audio?.status || 'unknown',
    portfolio_audit: portfolio.status,
  }, null, 2));
} finally {
  rmSync(sandbox, {recursive: true, force: true});
}

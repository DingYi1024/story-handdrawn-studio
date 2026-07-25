import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync, mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const launcher = resolve(
  root,
  'skill-package',
  'story-handdrawn-studio',
  'scripts',
  'run_story_video.py',
);
const expectedVersion = readFileSync(resolve(root, 'VERSION'), 'utf8').trim();
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

test('launcher version is read-only and reports cold-runtime readiness', {skip: !python}, () => {
  const sandbox = mkdtempSync(resolve(tmpdir(), 'story-launcher-'));
  const home = resolve(sandbox, 'data-home');
  try {
    const result = spawnSync(python, [launcher, 'version'], {
      cwd: sandbox,
      encoding: 'utf8',
      env: {
        ...process.env,
        STORY_HANDDRAWN_STUDIO_HOME: home,
        STORY_HANDDRAWN_STUDIO_PROJECT: '',
      },
    });
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.skill_version, expectedVersion);
    assert.equal(output.runtime_ready, false);
    assert.equal(output.data_root, home);
    assert.equal(existsSync(home), false);
  } finally {
    rmSync(sandbox, {recursive: true, force: true});
  }
});

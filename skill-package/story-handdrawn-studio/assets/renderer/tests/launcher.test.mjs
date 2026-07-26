import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {basename, dirname, resolve} from 'node:path';
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
    assert.equal(basename(output.data_root), 'data-home');
    assert.equal(basename(dirname(output.data_root)), basename(sandbox));
    assert.equal(existsSync(home), false);
  } finally {
    rmSync(sandbox, {recursive: true, force: true});
  }
});

test('launcher accepts a system browser recorded by Remotion setup', {skip: !python}, () => {
  const sandbox = mkdtempSync(resolve(tmpdir(), 'story-launcher-browser-'));
  const renderer = resolve(sandbox, 'renderer');
  const nodeModules = resolve(renderer, 'node_modules');
  const lock = `${JSON.stringify({lockfileVersion: 3})}\n`;
  const browser = resolve(sandbox, 'system-browser');
  mkdirSync(resolve(renderer, 'scripts'), {recursive: true});
  mkdirSync(resolve(nodeModules, '@remotion', 'cli'), {recursive: true});
  writeFileSync(resolve(renderer, 'package.json'), `${JSON.stringify({version: expectedVersion})}\n`);
  writeFileSync(resolve(renderer, 'package-lock.json'), lock);
  writeFileSync(resolve(renderer, 'scripts', 'studio.mjs'), '');
  writeFileSync(browser, 'browser');
  writeFileSync(
    resolve(nodeModules, '.story-handdrawn-dependencies.json'),
    `${JSON.stringify({
      lock_sha256: createHash('sha256').update(lock).digest('hex'),
      browser_path: browser,
    })}\n`,
  );
  try {
    const result = spawnSync(python, [launcher, 'version'], {
      cwd: sandbox,
      encoding: 'utf8',
      env: {
        ...process.env,
        STORY_HANDDRAWN_STUDIO_HOME: resolve(sandbox, 'data-home'),
        STORY_HANDDRAWN_STUDIO_PROJECT: renderer,
      },
    });
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.runtime_ready, true);
    assert.equal(output.runtime_checks.browser, true);
  } finally {
    rmSync(sandbox, {recursive: true, force: true});
  }
});

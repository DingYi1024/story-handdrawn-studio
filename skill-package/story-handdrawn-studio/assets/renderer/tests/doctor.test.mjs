import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {buildDoctorReport} from '../scripts/lib/doctor.mjs';

const writeJson = (path, value) =>
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');

const makeHealthyRenderer = () => {
  const root = mkdtempSync(resolve(tmpdir(), 'story-doctor-'));
  mkdirSync(resolve(root, 'node_modules', '@remotion', 'cli'), {recursive: true});
  mkdirSync(resolve(root, 'node_modules', '.remotion', 'chrome-headless-shell'), {recursive: true});
  mkdirSync(resolve(root, 'references'), {recursive: true});
  mkdirSync(resolve(root, 'data', 'projects'), {recursive: true});
  writeFileSync(resolve(root, 'references', 'style-bw.png'), 'bw');
  writeFileSync(resolve(root, 'references', 'style-color.png'), 'color');
  writeJson(resolve(root, 'package.json'), {version: '2.0.0'});
  writeJson(resolve(root, 'package-lock.json'), {
    version: '2.0.0',
    lockfileVersion: 3,
    packages: {'': {version: '2.0.0'}},
  });
  return root;
};

const reportFor = (root) => buildDoctorReport({
  repoRoot: root,
  dataRoot: resolve(root, 'data'),
  projectsRoot: resolve(root, 'data', 'projects'),
  publicDir: resolve(root, 'data', 'public'),
  minimumFreeBytes: 0,
  probe: () => ({ok: true, detail: 'available'}),
});
test('doctor reports a release-ready renderer and writable persistent data root', () => {
  const root = makeHealthyRenderer();
  try {
    const report = reportFor(root);
    assert.equal(report.ok, true);
    assert.equal(report.status, 'ready');
    assert.equal(report.failures.length, 0);
    assert.match(report.next_action, /produce/);
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
});

test('doctor accepts a system browser recorded by Remotion setup', () => {
  const root = makeHealthyRenderer();
  try {
    rmSync(resolve(root, 'node_modules', '.remotion'), {recursive: true, force: true});
    const browser = resolve(root, 'system-browser');
    writeFileSync(browser, 'browser');
    writeJson(
      resolve(root, 'node_modules', '.story-handdrawn-dependencies.json'),
      {browser_path: browser},
    );

    const report = reportFor(root);
    assert.equal(report.ok, true);
    assert.equal(report.checks.browser.ok, true);
    assert.equal(report.checks.browser.detail, browser);
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
});

test('doctor emits exact recovery actions for broken packages and future projects', () => {
  const root = makeHealthyRenderer();
  try {
    writeJson(resolve(root, 'package-lock.json'), {
      version: '1.0.0',
      lockfileVersion: 3,
      packages: {'': {version: '1.0.0'}},
    });
    const future = resolve(root, 'data', 'projects', 'future');
    mkdirSync(future, {recursive: true});
    writeJson(resolve(future, 'project.json'), {schema_version: 999});

    const report = reportFor(root);
    assert.equal(report.ok, false);
    assert.deepEqual(
      report.failures.map((item) => item.name),
      ['package', 'project_schema'],
    );
    assert.ok(report.actions.some((action) => /Reinstall or upgrade/.test(action)));
    assert.ok(report.actions.some((action) => /Upgrade Story Handdrawn Studio/.test(action)));
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
});

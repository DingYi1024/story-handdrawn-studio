import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {createSettings} from '../scripts/lib/presets.mjs';
import {
  assertProjectId,
  createProject,
  loadProject,
  resolveInside,
  updateProjectState,
} from '../scripts/lib/projects.mjs';

test('project lifecycle is isolated and stateful', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'story-studio-test-'));
  try {
    const projectsRoot = resolve(root, 'user-data', 'projects');
    const publicDir = resolve(root, 'user-data', 'public');
    const {paths} = createProject({
      repoRoot: root,
      projectsRoot,
      publicDir,
      id: 'paper-summer',
      title: '纸上的夏天',
      settings: createSettings('vertical'),
      storyText: '第一句话。第二句话。',
    });
    const loaded = loadProject(root, 'paper-summer', projectsRoot, publicDir);
    assert.equal(paths.publicAssets, resolve(publicDir, 'projects', 'paper-summer', 'assets'));
    assert.equal(loaded.project.source.type, 'story');
    assert.equal(loaded.state.status, 'created');
    const state = updateProjectState(paths, 'planned', 'Plan ready');
    assert.equal(state.status, 'planned');
    assert.equal(state.history.length, 2);
    const failed = updateProjectState(paths, 'failed', 'Render failed', 'browser missing', {
      resume_from: 'planned',
    });
    assert.equal(failed.resume_from, 'planned');
    assert.equal(failed.last_error, 'browser missing');
    assert.throws(
      () => createProject({
        repoRoot: root,
        projectsRoot,
        publicDir,
        id: 'paper-summer',
        title: 'duplicate',
        settings: createSettings(),
        storyText: 'duplicate',
      }),
      /already exists/,
    );
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
});

test('unsafe project identifiers and path escapes are rejected', () => {
  assert.throws(() => assertProjectId('../escape'), /Project id/);
  assert.throws(() => resolveInside('C:/safe', '..', 'escape'), /escapes/);
});

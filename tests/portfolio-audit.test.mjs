import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {createSettings} from '../scripts/lib/presets.mjs';
import {
  atomicWriteJson,
  createProject,
  updateProjectState,
} from '../scripts/lib/projects.mjs';
import {auditPortfolio, auditProject} from '../scripts/lib/portfolio-audit.mjs';
import {loadProject} from '../scripts/lib/projects.mjs';

test('portfolio audit verifies completed artifacts and final QA evidence', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'story-audit-'));
  const projectsRoot = resolve(root, 'data', 'projects');
  const publicDir = resolve(root, 'data', 'public');
  try {
    const {paths} = createProject({
      repoRoot: root,
      projectsRoot,
      publicDir,
      id: 'healthy-final',
      title: '完整作品',
      settings: createSettings('vertical'),
      storyText: '完整故事。',
    });
    writeFileSync(resolve(paths.output, 'preview.mp4'), 'preview');
    writeFileSync(resolve(paths.output, 'final.mp4'), 'final');
    const report = resolve(paths.qa, 'final', 'report.json');
    atomicWriteJson(report, {status: 'passed', passed: true});
    updateProjectState(paths, 'completed', 'done', null, {
      qa: {final: {status: 'passed', report}},
    });
    const audit = auditPortfolio({repoRoot: root, projectsRoot, publicDir});
    assert.equal(audit.ok, true);
    assert.deepEqual(audit.summary, {
      projects: 1,
      healthy: 1,
      action_required: 0,
      failed: 0,
      bytes: audit.summary.bytes,
    });
    assert.ok(audit.summary.bytes > 0);
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
});

test('portfolio audit reports missing finals, pending assets, stale locks, and unreadable projects', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'story-audit-failures-'));
  const projectsRoot = resolve(root, 'projects');
  const publicDir = resolve(root, 'public');
  try {
    const completed = createProject({
      repoRoot: root,
      projectsRoot,
      publicDir,
      id: 'missing-final',
      title: '丢失成片',
      settings: createSettings(),
      storyText: '故事。',
    });
    writeFileSync(resolve(completed.paths.output, 'preview.mp4'), 'preview');
    updateProjectState(completed.paths, 'completed', 'incorrectly completed');

    const waiting = createProject({
      repoRoot: root,
      projectsRoot,
      publicDir,
      id: 'waiting-assets',
      title: '等待素材',
      settings: createSettings(),
      storyText: '故事。',
    });
    updateProjectState(waiting.paths, 'awaiting_assets', 'waiting', null, {pending_jobs: ['01', '02']});
    writeFileSync(waiting.paths.lock, '123\n2020-01-01T00:00:00Z\n');
    const loadedWaiting = loadProject(root, 'waiting-assets', projectsRoot, publicDir);
    const projectAudit = auditProject(loadedWaiting, {nowMs: Date.now(), staleLockMs: 0});
    assert.ok(projectAudit.issues.some((issue) => issue.code === 'stale_lock'));
    assert.ok(projectAudit.issues.some((issue) => issue.code === 'assets_required'));

    const broken = resolve(projectsRoot, 'broken-project');
    mkdirSync(broken, {recursive: true});
    writeFileSync(resolve(broken, 'project.json'), '{broken');

    const audit = auditPortfolio({repoRoot: root, projectsRoot, publicDir, staleLockMs: 0});
    assert.equal(audit.ok, false);
    assert.equal(audit.summary.projects, 3);
    assert.equal(audit.summary.failed, 3);
    assert.ok(audit.projects.some((project) => project.status === 'unreadable'));
    const missing = audit.projects.find((project) => project.id === 'missing-final');
    assert.ok(missing.issues.some((issue) => issue.code === 'final_missing'));
    assert.ok(missing.issues.some((issue) => issue.code === 'final_qa_missing_or_failed'));
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
});

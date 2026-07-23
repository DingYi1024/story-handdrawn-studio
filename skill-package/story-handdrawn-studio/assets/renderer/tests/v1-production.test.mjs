import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {createAutomaticAudioPlan, materializeAutomaticAudioPlan} from '../scripts/lib/audio-director.mjs';
import {createProviderPlan, resolveProvider, runProviderPlan} from '../scripts/lib/providers.mjs';
import {createSemanticQaReport} from '../scripts/lib/semantic-qa.mjs';
import {createReviewData, renderReviewHtml, validateReviewDecisions} from '../scripts/lib/review.mjs';
import {createSettingsFromTemplate, listTemplates} from '../scripts/lib/templates.mjs';
import {migrateProjectDocuments} from '../scripts/lib/migrations.mjs';
import {createProject, createProjectSnapshot, restoreProjectSnapshot, atomicWriteJson, readJson} from '../scripts/lib/projects.mjs';
import {createVisualQaPlan} from '../scripts/lib/visual-qa.mjs';

const storyboard = {
  project: {title: '纸条', fps: 30, width: 1080, height: 1920, transition: 'page-flip', transition_sec: 0.7},
  scenes: [
    {id: '01', duration_sec: 4, text: '雨夜回家', narration: '雨夜回家', visual: '雨中人物', assets: {bw: '01-bw.png', color: '01-color.png'}},
    {id: '02', duration_sec: 4, text: '种子终于发芽', narration: '种子终于发芽', visual: '阳台嫩芽', assets: {bw: '02-bw.png', color: '02-color.png'}},
  ],
};

test('automatic sound director detects story events and page transitions', () => {
  const plan = createAutomaticAudioPlan(storyboard);
  assert.equal(plan.mood, 'warm');
  assert.ok(plan.events.some((event) => event.type === 'rain'));
  assert.ok(plan.events.some((event) => event.type === 'chime'));
  assert.ok(plan.events.some((event) => event.type === 'page-turn'));
});

const hasFfmpeg = spawnSync('ffmpeg', ['-version'], {stdio: 'ignore'}).status === 0;
test('automatic sound director materializes reusable local tracks', {skip: !hasFfmpeg}, () => {
  const root = mkdtempSync(resolve(tmpdir(), 'audio-director-'));
  try {
    const options = materializeAutomaticAudioPlan(createAutomaticAudioPlan(storyboard), root);
    assert.equal(options.enabled, true);
    assert.equal(existsSync(options.bgm.path), true);
    assert.ok(options.sfx.every((item) => existsSync(item.path)));
  } finally { rmSync(root, {recursive: true, force: true}); }
});

test('provider auto-selection, estimates, and retries are explicit and resumable', async () => {
  assert.equal(resolveProvider('auto', {}), 'codex');
  assert.equal(resolveProvider('auto', {OPENAI_API_KEY: 'x'}), 'openai');
  const root = mkdtempSync(resolve(tmpdir(), 'provider-plan-'));
  try {
    const output = resolve(root, 'scene.png');
    const state = resolve(root, 'provider-state.json');
    const plan = createProviderPlan({jobs: [{id: '01', scene_id: '01', prompt: 'draw', output_master: output}]}, 'codex');
    let calls = 0;
    const result = await runProviderPlan(plan, async (job) => {
      calls += 1;
      if (calls === 1) throw new Error('temporary');
      writeFileSync(job.output, 'image');
    }, {statePath: state, now: () => '2026-01-01T00:00:00.000Z'});
    assert.equal(result.status, 'completed');
    assert.equal(result.jobs[0].attempts, 2);
    assert.equal(readJson(state).status, 'completed');
  } finally { rmSync(root, {recursive: true, force: true}); }
});

test('semantic QA distinguishes policy checks from unobserved visual claims', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'semantic-qa-'));
  try {
    for (const name of ['01-bw.png', '01-color.png', '02-bw.png', '02-color.png']) writeFileSync(resolve(root, name), 'x');
    const report = createSemanticQaReport({storyboard, publicDir: root});
    assert.equal(report.status, 'needs_review');
    assert.equal(report.passed, true);
    const strict = createSemanticQaReport({storyboard, publicDir: root, strict: true});
    assert.equal(strict.passed, false);
  } finally { rmSync(root, {recursive: true, force: true}); }
});

test('review workspace is self-contained and validates exported decisions', () => {
  const data = createReviewData({project: {id: 'note', title: '纸条'}, storyboard, publicDir: 'D:/public'});
  const html = renderReviewHtml(data);
  assert.match(html, /本地审片台/);
  assert.match(html, /导出审片决定/);
  assert.doesNotThrow(() => validateReviewDecisions({schema_version: 1, project_id: 'note', decisions: [{scene_id: '01', decision: 'revise', note: '减少人物'}]}, 'note', ['01', '02']));
  assert.throws(() => validateReviewDecisions({schema_version: 1, project_id: 'note', decisions: [{scene_id: '01', decision: 'revise', note: ''}]}, 'note', ['01']), /revision note/);
});

test('templates, migration, snapshots, and rollback preserve recoverability', () => {
  assert.equal(listTemplates().length, 5);
  assert.equal(createSettingsFromTemplate('gentle-diary').audio.provider, 'auto');
  const migrated = migrateProjectDocuments({schema_version: 2, settings: {}}, {schema_version: 2});
    assert.equal(migrated.to, 4);
    assert.equal(migrated.project.settings.provider.id, 'auto');
    assert.equal(migrated.project.settings.director.multi_shot, true);
  const root = mkdtempSync(resolve(tmpdir(), 'snapshot-'));
  try {
    const created = createProject({repoRoot: root, id: 'recover', title: '恢复', settings: createSettingsFromTemplate('warm-memory'), storyText: '故事。'});
    atomicWriteJson(created.paths.storyboard, {version: 1});
    const snapshot = createProjectSnapshot(created.paths, 'before edit');
    atomicWriteJson(created.paths.storyboard, {version: 2});
    const restored = restoreProjectSnapshot(created.paths, snapshot.id);
    assert.equal(readJson(created.paths.storyboard).version, 1);
    assert.match(restored.safety_snapshot, /^s\d{4}$/);
  } finally { rmSync(root, {recursive: true, force: true}); }
});

test('transition QA samples both sides of every page flip', () => {
  const plan = createVisualQaPlan({durationSec: 8, fps: 30}, {transitionTimes: [3.3], motionCutTimes: [2.2], revealTimes: [1.9]});
  const samples = plan.samples.filter((sample) => sample.roles.includes('transition'));
  assert.equal(samples.length, 3);
  assert.deepEqual(samples.map((sample) => sample.timeSec), [3.22, 3.3, 3.38]);
  assert.equal(plan.samples.filter((sample) => sample.roles.includes('motion-cut')).length, 2);
  const handoff = plan.samples.filter((sample) => sample.roles.includes('caption-color-handoff'));
  assert.equal(handoff.length, 3);
  assert.deepEqual(handoff.map((sample) => sample.timeSec), [1.866667, 1.9, 1.933333]);
});

test('style approval is a real production gate and chosen storyboards stay synchronized', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'style-approval-'));
  try {
    const settings = createSettingsFromTemplate('gentle-diary');
    settings.director.theme = 'auto';
    settings.director.require_style_approval = true;
    const created = createProject({
      repoRoot: root,
      id: 'style-gate',
      title: '雨夜纸条',
      settings,
      storyText: '雨夜，她捡到一张纸条。\n第二天，纸条旁的种子发芽了。',
    });
    const studio = resolve(process.cwd(), 'scripts', 'studio.mjs');
    const common = ['--project', 'style-gate', '--data-root', root, '--json'];
    const planResult = spawnSync(process.execPath, [studio, 'plan', ...common, '--generator', 'codex'], {encoding: 'utf8'});
    assert.equal(planResult.status, 0, planResult.stderr);
    assert.equal(readJson(created.paths.state).status, 'awaiting_style_choice');
    const heldManifest = readJson(created.paths.codexManifest);
    assert.equal(heldManifest.requires_replan, true);
    assert.equal(heldManifest.jobs.length, 0);
    assert.equal(readJson(created.paths.config).settings.director.theme, 'auto');

    const assetsResult = spawnSync(process.execPath, [studio, 'assets', ...common, '--action', 'run', '--provider', 'codex'], {encoding: 'utf8'});
    assert.equal(assetsResult.status, 0, assetsResult.stderr);
    assert.match(assetsResult.stdout, /awaiting_style_choice/);
    copyFileSync(created.paths.storyboardPlan, created.paths.storyboard);

    const chooseResult = spawnSync(process.execPath, [studio, 'director', ...common, '--action', 'choose', '--theme', 'child-crayon'], {encoding: 'utf8'});
    assert.equal(chooseResult.status, 0, chooseResult.stderr);
    assert.deepEqual(readJson(created.paths.storyboard), readJson(created.paths.storyboardPlan));
    assert.equal(readJson(created.paths.config).settings.director.style_approved, true);
    assert.equal(readJson(created.paths.state).status, 'planning');
  } finally { rmSync(root, {recursive: true, force: true}); }
});

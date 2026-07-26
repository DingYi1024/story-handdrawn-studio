import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  buildBatchProduceArgs,
  createBatchState,
  runBatch,
  validateBatchManifest,
} from '../scripts/lib/batch.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const studio = resolve(root, 'scripts', 'studio.mjs');

test('batch manifests normalize defaults, paths, and safe production arguments', () => {
  const sandbox = mkdtempSync(resolve(tmpdir(), 'story-batch-manifest-'));
  try {
    const story = resolve(sandbox, 'story.txt');
    writeFileSync(story, '第一幕。第二幕。');
    const manifestPath = resolve(sandbox, 'batch.json');
    const manifest = validateBatchManifest({
      schema_version: 1,
      id: 'weekly-stories',
      defaults: {to: 'preview', preset: 'vertical', generator: 'codex'},
      jobs: [
        {id: 'rain-note', title: '雨夜纸条', input: 'story.txt'},
        {id: 'sun-note', title: '晴天纸条', text: '阳光落在纸条上。', to: 'final'},
      ],
    }, manifestPath);
    assert.equal(manifest.jobs[0].input, story);
    assert.equal(manifest.jobs[0].preset, 'vertical');
    assert.equal(manifest.jobs[1].to, 'final');
    assert.equal(manifest.fingerprint.length, 64);
    assert.deepEqual(
      buildBatchProduceArgs(manifest.jobs[0], {projectExists: true, dataRoot: resolve(sandbox, 'data')}),
      [
        'produce', '--project', 'rain-note', '--to', 'preview',
        '--generator', 'codex', '--text-mode', 'font',
        '--data-root', resolve(sandbox, 'data'),
      ],
    );
    assert.throws(
      () => validateBatchManifest({
        schema_version: 1,
        jobs: [{id: 'duplicate', text: 'a'}, {id: 'duplicate', text: 'b'}],
      }, manifestPath),
      /Duplicate/,
    );
  } finally {
    rmSync(sandbox, {recursive: true, force: true});
  }
});

test('batch execution persists completion, action boundaries, and retryable failures', async () => {
  const manifest = validateBatchManifest({
    schema_version: 1,
    id: 'recoverable-batch',
    jobs: [
      {id: 'done-project', text: '完成。', to: 'final'},
      {id: 'asset-project', text: '等待图片。', to: 'preview'},
      {id: 'failed-project', text: '第一次失败。', to: 'preview'},
    ],
  }, resolve('recoverable-batch.json'));
  let state = createBatchState(manifest, () => '2026-01-01T00:00:00.000Z');
  let failedOnce = false;
  const snapshots = new Map([
    ['done-project', {status: 'completed', final_exists: true, qa_passed: true}],
    ['asset-project', {status: 'awaiting_assets', pending_jobs: [{id: '01'}]}],
    ['failed-project', {status: 'preview_ready', preview_exists: true}],
  ]);
  const execute = async (job) => {
    if (job.id === 'failed-project' && !failedOnce) {
      failedOnce = true;
      throw new Error('temporary provider outage');
    }
  };
  const persist = async (next) => {
    state = structuredClone(next);
  };
  state = await runBatch({
    manifest,
    state,
    execute,
    inspect: async (job) => snapshots.get(job.id),
    persist,
  });
  assert.equal(state.status, 'partial_failure');
  assert.equal(state.jobs[0].status, 'completed');
  assert.equal(state.jobs[1].status, 'action_required');
  assert.equal(state.jobs[1].action_required, 'generate_images');
  assert.match(state.jobs[2].last_error, /provider outage/);

  snapshots.set('asset-project', {status: 'preview_ready', preview_exists: true});
  state = await runBatch({
    manifest,
    state,
    execute,
    inspect: async (job) => snapshots.get(job.id),
    persist,
    retryFailed: true,
  });
  assert.equal(state.status, 'completed');
  assert.equal(state.totals.completed, 3);
});

test('batch CLI plans multiple story projects and resumes from a persisted state', () => {
  const sandbox = mkdtempSync(resolve(tmpdir(), 'story-batch-cli-'));
  const dataRoot = resolve(sandbox, 'data');
  const manifestPath = resolve(sandbox, 'batch.json');
  try {
    writeFileSync(manifestPath, `${JSON.stringify({
      schema_version: 1,
      id: 'two-story-plan',
      defaults: {to: 'plan', preset: 'square'},
      jobs: [
        {id: 'batch-story-one', title: '故事一', text: '风吹过窗台。纸片轻轻动了一下。'},
        {id: 'batch-story-two', title: '故事二', text: '雨停之后，小鸟落在屋檐上。'},
      ],
    }, null, 2)}\n`);
    const output = execFileSync(
      process.execPath,
      [studio, 'batch', '--input', manifestPath, '--data-root', dataRoot, '--json'],
      {cwd: sandbox, encoding: 'utf8'},
    );
    const result = JSON.parse(output);
    assert.equal(result.status, 'completed');
    assert.equal(result.totals.completed, 2);
    assert.equal(JSON.parse(readFileSync(result.state_path, 'utf8')).status, 'completed');
    assert.equal(
      existsSync(resolve(dataRoot, 'batches', 'two-story-plan', 'sources', 'batch-story-one.txt')),
      true,
    );

    rmSync(manifestPath);
    const status = JSON.parse(execFileSync(
      process.execPath,
      [studio, 'batch', '--id', 'two-story-plan', '--action', 'status', '--data-root', dataRoot, '--json'],
      {cwd: sandbox, encoding: 'utf8'},
    ));
    assert.equal(status.manifest_fingerprint, result.manifest_fingerprint);
  } finally {
    rmSync(sandbox, {recursive: true, force: true});
  }
});

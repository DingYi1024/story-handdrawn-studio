import {createHash} from 'node:crypto';
import {existsSync} from 'node:fs';
import {dirname, isAbsolute, resolve} from 'node:path';
import {assertProjectId} from './projects.mjs';

export const BATCH_SCHEMA_VERSION = 1;
export const BATCH_TARGETS = Object.freeze(['plan', 'assets', 'preview', 'final']);

const stableValue = (value) => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, stableValue(value[key])]),
    );
  }
  return value;
};

export const batchFingerprint = (manifest) => createHash('sha256')
  .update(JSON.stringify(stableValue(manifest)))
  .digest('hex');

const sourceCount = (job) => [
  typeof job.input === 'string' && job.input.trim() !== '',
  typeof job.text === 'string' && job.text.trim() !== '',
  Array.isArray(job.images) && job.images.length > 0,
].filter(Boolean).length;

const normalizedPath = (value, baseDir) =>
  isAbsolute(String(value)) ? resolve(String(value)) : resolve(baseDir, String(value));

export const validateBatchManifest = (
  raw,
  manifestPath = resolve('batch.json'),
  {checkSources = true} = {},
) => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Batch manifest must be a JSON object');
  }
  if (Number(raw.schema_version) !== BATCH_SCHEMA_VERSION) {
    throw new Error(`Batch schema_version must be ${BATCH_SCHEMA_VERSION}`);
  }
  const jobs = raw.jobs;
  if (!Array.isArray(jobs) || jobs.length === 0) {
    throw new Error('Batch manifest must contain at least one job');
  }
  if (jobs.length > 100) throw new Error('Batch manifest supports at most 100 jobs');
  const defaults = raw.defaults && typeof raw.defaults === 'object' ? raw.defaults : {};
  const defaultTarget = String(defaults.to || 'preview');
  if (!BATCH_TARGETS.includes(defaultTarget)) {
    throw new Error(`Batch defaults.to must be one of: ${BATCH_TARGETS.join(', ')}`);
  }
  const baseDir = dirname(resolve(manifestPath));
  const seen = new Set();
  const normalizedJobs = jobs.map((rawJob, index) => {
    if (!rawJob || typeof rawJob !== 'object' || Array.isArray(rawJob)) {
      throw new Error(`Batch job ${index + 1} must be an object`);
    }
    const id = assertProjectId(rawJob.id);
    if (seen.has(id)) throw new Error(`Duplicate batch job id: ${id}`);
    seen.add(id);
    if (sourceCount(rawJob) !== 1) {
      throw new Error(`Batch job ${id} must use exactly one source: input, text, or images`);
    }
    const target = String(rawJob.to || defaultTarget);
    if (!BATCH_TARGETS.includes(target)) {
      throw new Error(`Batch job ${id} target must be one of: ${BATCH_TARGETS.join(', ')}`);
    }
    const job = {
      id,
      title: String(rawJob.title || id),
      to: target,
      preset: String(rawJob.preset || defaults.preset || 'portrait'),
      generator: String(rawJob.generator || defaults.generator || 'codex'),
      text_mode: String(rawJob.text_mode || defaults.text_mode || 'font'),
      audio: rawJob.audio ?? defaults.audio ?? null,
      transition: rawJob.transition || defaults.transition || null,
      template: rawJob.template || defaults.template || null,
    };
    if (!['auto', 'codex', 'openai', 'api'].includes(job.generator)) {
      throw new Error(`Batch job ${id} generator must be auto, codex, openai, or api`);
    }
    if (!['font', 'image2'].includes(job.text_mode)) {
      throw new Error(`Batch job ${id} text_mode must be font or image2`);
    }
    if (job.audio !== null && job.audio !== 'auto') {
      throw new Error(`Batch job ${id} audio must be "auto" or null`);
    }
    if (job.transition !== null && !['cut', 'page-flip'].includes(job.transition)) {
      throw new Error(`Batch job ${id} transition must be cut or page-flip`);
    }
    if (typeof rawJob.input === 'string' && rawJob.input.trim()) {
      job.input = normalizedPath(rawJob.input, baseDir);
      if (checkSources && !existsSync(job.input)) {
        throw new Error(`Batch job ${id} input does not exist: ${job.input}`);
      }
    } else if (typeof rawJob.text === 'string' && rawJob.text.trim()) {
      job.text = rawJob.text.trim();
    } else {
      job.images = rawJob.images.map((path) => normalizedPath(path, baseDir));
      for (const path of job.images) {
        if (checkSources && !existsSync(path)) {
          throw new Error(`Batch job ${id} image does not exist: ${path}`);
        }
      }
    }
    return job;
  });
  const id = assertProjectId(raw.id || `batch-${batchFingerprint({jobs: normalizedJobs}).slice(0, 12)}`);
  const manifest = {
    schema_version: BATCH_SCHEMA_VERSION,
    id,
    title: String(raw.title || id),
    defaults: {
      to: defaultTarget,
      preset: String(defaults.preset || 'portrait'),
      generator: String(defaults.generator || 'codex'),
      text_mode: String(defaults.text_mode || 'font'),
      audio: defaults.audio ?? null,
    },
    jobs: normalizedJobs,
  };
  return {...manifest, fingerprint: batchFingerprint(manifest), manifest_path: resolve(manifestPath)};
};

export const createBatchState = (manifest, now = () => new Date().toISOString()) => {
  const at = now();
  return {
    schema_version: BATCH_SCHEMA_VERSION,
    id: manifest.id,
    title: manifest.title,
    manifest_path: manifest.manifest_path,
    manifest_fingerprint: manifest.fingerprint,
    status: 'pending',
    totals: {jobs: manifest.jobs.length, pending: manifest.jobs.length, running: 0, action_required: 0, completed: 0, failed: 0},
    jobs: manifest.jobs.map((job) => ({
      id: job.id,
      title: job.title,
      target: job.to,
      status: 'pending',
      project_status: null,
      attempts: 0,
      action_required: null,
      pending_jobs: [],
      last_error: null,
      updated_at: at,
    })),
    created_at: at,
    updated_at: at,
  };
};

export const buildBatchProduceArgs = (job, {projectExists = false, dataRoot = null} = {}) => {
  const output = ['produce'];
  if (projectExists) {
    output.push('--project', job.id);
  } else {
    output.push('--id', job.id, '--title', job.title, '--preset', job.preset);
    if (job.template) output.push('--template', String(job.template));
    if (job.transition) output.push('--transition', String(job.transition));
    if (job.input) output.push('--input', job.input);
    else if (job.text) output.push('--text', job.text);
    else for (const image of job.images || []) output.push('--image', image);
  }
  output.push('--to', job.to, '--generator', job.generator, '--text-mode', job.text_mode);
  if (job.audio) output.push('--audio', String(job.audio));
  if (dataRoot) output.push('--data-root', resolve(dataRoot));
  return output;
};

const reachedTarget = (job, snapshot) => {
  if (job.to === 'plan') return snapshot.has_plan === true;
  if (job.to === 'assets') return ['assets_ready', 'preview_ready', 'completed'].includes(snapshot.status);
  if (job.to === 'preview') {
    return ['preview_ready', 'completed'].includes(snapshot.status) && snapshot.preview_exists === true;
  }
  return snapshot.status === 'completed' && snapshot.final_exists === true && snapshot.qa_passed === true;
};

export const summarizeBatchState = (state, now = () => new Date().toISOString()) => {
  const totals = {
    jobs: state.jobs.length,
    pending: state.jobs.filter((job) => job.status === 'pending').length,
    running: state.jobs.filter((job) => job.status === 'running').length,
    action_required: state.jobs.filter((job) => job.status === 'action_required').length,
    completed: state.jobs.filter((job) => job.status === 'completed').length,
    failed: state.jobs.filter((job) => job.status === 'failed').length,
  };
  const status = totals.failed
    ? 'partial_failure'
    : totals.completed === totals.jobs
      ? 'completed'
      : totals.running
        ? 'running'
        : totals.action_required
          ? 'action_required'
          : 'pending';
  return {...state, status, totals, updated_at: now()};
};

export const runBatch = async ({
  manifest,
  state,
  execute,
  inspect,
  persist = () => {},
  retryFailed = false,
  now = () => new Date().toISOString(),
}) => {
  if (state.manifest_fingerprint !== manifest.fingerprint) {
    throw new Error(`Batch ${manifest.id} manifest changed; use a new batch id to protect recovery state`);
  }
  let next = structuredClone(state);
  for (const jobDefinition of manifest.jobs) {
    const index = next.jobs.findIndex((job) => job.id === jobDefinition.id);
    const jobState = next.jobs[index];
    if (jobState.status === 'completed') continue;
    if (jobState.status === 'failed' && !retryFailed) continue;
    jobState.status = 'running';
    jobState.attempts += 1;
    jobState.updated_at = now();
    jobState.last_error = null;
    next = summarizeBatchState(next, now);
    await persist(next);
    try {
      await execute(jobDefinition, jobState);
      const snapshot = await inspect(jobDefinition);
      jobState.project_status = snapshot.status || null;
      jobState.pending_jobs = snapshot.pending_jobs || [];
      if (reachedTarget(jobDefinition, snapshot)) {
        jobState.status = 'completed';
        jobState.action_required = null;
      } else if (['awaiting_assets', 'awaiting_style_choice'].includes(snapshot.status)) {
        jobState.status = 'action_required';
        jobState.action_required = snapshot.status === 'awaiting_style_choice'
          ? 'approve_style'
          : 'generate_images';
      } else if (snapshot.status === 'failed') {
        jobState.status = 'failed';
        jobState.last_error = snapshot.last_error || 'Project entered failed state';
      } else {
        jobState.status = 'pending';
      }
    } catch (error) {
      jobState.status = 'failed';
      jobState.last_error = String(error.message || error);
    }
    jobState.updated_at = now();
    next.jobs[index] = jobState;
    next = summarizeBatchState(next, now);
    await persist(next);
  }
  return summarizeBatchState(next, now);
};

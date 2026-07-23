import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {atomicWriteJson, readJson} from './projects.mjs';

export const PROVIDER_SCHEMA_VERSION = 1;

export const PROVIDERS = Object.freeze({
  auto: {id: 'auto', label: 'Automatic selection', execution: 'local-or-agent', requires: []},
  codex: {id: 'codex', label: 'Codex image jobs', execution: 'agent', requires: [], cost: null},
  openai: {id: 'openai', label: 'OpenAI Images API', execution: 'api', requires: ['OPENAI_API_KEY'], cost: {currency: 'USD', per_image_estimate: 0.08}},
  files: {id: 'files', label: 'Uploaded files', execution: 'manual', requires: [], cost: {currency: 'USD', per_image_estimate: 0}},
});

export const resolveProvider = (requested = 'auto', env = process.env) => {
  if (!PROVIDERS[requested]) throw new Error(`Unknown image provider: ${requested}`);
  if (requested !== 'auto') return requested;
  return env.OPENAI_API_KEY ? 'openai' : 'codex';
};

export const listProviders = (env = process.env) => Object.values(PROVIDERS)
  .filter((provider) => provider.id !== 'auto')
  .map((provider) => ({
    ...provider,
    available: provider.requires.every((name) => Boolean(env[name])),
    missing: provider.requires.filter((name) => !env[name]),
  }));

export const createProviderPlan = (manifest, requested = 'auto', options = {}) => {
  const provider = resolveProvider(requested, options.env || process.env);
  const definition = PROVIDERS[provider];
  const jobs = (manifest?.jobs || []).map((job) => ({
    id: String(job.id),
    scene_id: job.scene_id || null,
    prompt: job.prompt,
    output: job.output_master,
    status: existsSync(resolve(job.output_master)) ? 'completed' : 'pending',
    attempts: 0,
    max_attempts: Number(options.maxAttempts || 3),
    last_error: null,
  }));
  const missing = jobs.filter((job) => job.status !== 'completed').length;
  return {
    schema_version: PROVIDER_SCHEMA_VERSION,
    requested_provider: requested,
    provider,
    execution: definition.execution,
    status: missing ? 'pending' : 'completed',
    totals: {jobs: jobs.length, pending: missing, completed: jobs.length - missing},
    estimate: definition.cost
      ? {...definition.cost, images: missing, total: Number((missing * definition.cost.per_image_estimate).toFixed(2))}
      : {currency: 'USD', images: missing, total: null, note: 'Agent-provider cost depends on the host plan.'},
    retry: {max_attempts: Number(options.maxAttempts || 3), backoff_seconds: [1, 3, 8]},
    jobs,
  };
};

export const runProviderPlan = async (plan, execute, {statePath = null, now = () => new Date().toISOString()} = {}) => {
  if (typeof execute !== 'function') throw new Error('A provider job executor is required');
  const next = structuredClone(plan);
  for (const job of next.jobs) {
    if (job.status === 'completed') continue;
    while (job.attempts < job.max_attempts && job.status !== 'completed') {
      job.attempts += 1;
      job.updated_at = now();
      try {
        await execute(job, next.provider);
        if (!existsSync(resolve(job.output))) throw new Error(`Provider did not create ${job.output}`);
        job.status = 'completed';
        job.last_error = null;
      } catch (error) {
        job.status = job.attempts >= job.max_attempts ? 'failed' : 'retrying';
        job.last_error = String(error.message || error);
      }
      if (statePath) atomicWriteJson(statePath, next);
    }
  }
  next.totals = {
    jobs: next.jobs.length,
    pending: next.jobs.filter((job) => !['completed', 'failed'].includes(job.status)).length,
    completed: next.jobs.filter((job) => job.status === 'completed').length,
    failed: next.jobs.filter((job) => job.status === 'failed').length,
  };
  next.status = next.totals.failed ? 'failed' : next.totals.completed === next.totals.jobs ? 'completed' : 'pending';
  next.updated_at = now();
  if (statePath) atomicWriteJson(statePath, next);
  return next;
};

export const readProviderState = (path) => existsSync(path) ? readJson(path) : null;

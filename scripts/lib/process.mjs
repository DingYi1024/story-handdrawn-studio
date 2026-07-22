import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';

export const run = (file, args, {cwd, capture = false, env = process.env} = {}) => {
  const result = spawnSync(file, args, {
    cwd,
    env,
    encoding: 'utf8',
    stdio: capture ? 'pipe' : 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = capture ? `\n${result.stdout || ''}${result.stderr || ''}` : '';
    throw new Error(`${file} exited with status ${result.status}${detail}`);
  }
  return capture ? String(result.stdout || '').trim() : '';
};

export const runNode = (script, args, options = {}) =>
  run(process.execPath, [script, ...args], options);

export const remotionCli = (repoRoot) => {
  const path = resolve(repoRoot, 'node_modules/@remotion/cli/remotion-cli.js');
  if (!existsSync(path)) throw new Error('Remotion CLI is not installed; run npm ci');
  return path;
};

export const probeCommand = (command, args = ['--version'], cwd = undefined) => {
  const result = spawnSync(command, args, {cwd, encoding: 'utf8'});
  if (result.error || result.status !== 0) {
    return {ok: false, detail: result.error?.message || result.stderr || `status ${result.status}`};
  }
  return {ok: true, detail: String(result.stdout || result.stderr || '').split(/\r?\n/)[0]};
};


import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {existsSync, mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const studio = resolve(root, 'scripts', 'studio.mjs');

test('Studio data root keeps projects and public assets outside the renderer', () => {
  const sandbox = mkdtempSync(resolve(tmpdir(), 'story-studio-data-root-'));
  const dataRoot = resolve(sandbox, 'persistent-data');
  try {
    execFileSync(
      process.execPath,
      [
        studio,
        'create',
        '--id', 'isolated-cli-project',
        '--title', '隔离项目',
        '--text', '第一幕。第二幕。',
        '--data-root', dataRoot,
      ],
      {cwd: sandbox, stdio: 'pipe'},
    );

    const projectPath = resolve(dataRoot, 'projects', 'isolated-cli-project', 'project.json');
    const assetPath = resolve(dataRoot, 'public', 'projects', 'isolated-cli-project', 'assets');
    assert.equal(existsSync(projectPath), true);
    assert.equal(existsSync(assetPath), true);
    assert.equal(existsSync(resolve(root, 'projects', 'isolated-cli-project')), false);
    assert.equal(JSON.parse(readFileSync(projectPath, 'utf8')).id, 'isolated-cli-project');
  } finally {
    rmSync(sandbox, {recursive: true, force: true});
  }
});

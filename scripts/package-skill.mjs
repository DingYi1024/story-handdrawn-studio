import {cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {basename, dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const skillName = 'story-handdrawn-studio';
const source = resolve(root, 'skill-package', skillName);
const stagingRoot = mkdtempSync(resolve(tmpdir(), 'story-handdrawn-skill-'));
const stagingSkill = resolve(stagingRoot, skillName);
const releaseDir = resolve(root, 'release');
const archive = resolve(releaseDir, `${skillName}-skill-${pkg.version}.zip`);
const excluded = new Set([
  '.DS_Store',
  '__pycache__',
  'node_modules',
  'projects',
  'build',
  'out',
  'release',
]);

try {
  cpSync(source, stagingSkill, {
    recursive: true,
    filter: (path) => !excluded.has(basename(path)),
  });
  mkdirSync(releaseDir, {recursive: true});
  rmSync(archive, {force: true});
  if (process.platform === 'win32') {
    execFileSync('tar.exe', ['-a', '-c', '-f', archive, skillName], {cwd: stagingRoot});
  } else {
    execFileSync('zip', ['-qr', archive, skillName], {cwd: stagingRoot});
  }
  console.log(`✓ Skill package → ${archive}`);
} finally {
  rmSync(stagingRoot, {recursive: true, force: true});
}

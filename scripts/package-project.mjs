import {execFileSync} from 'node:child_process';
import {cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {basename, dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const folderName = `${pkg.name}-${pkg.version}`;
const releaseDir = resolve(root, 'release');
const archive = resolve(releaseDir, `${folderName}-share.zip`);
const stagingRoot = mkdtempSync(resolve(tmpdir(), 'story-video-share-'));
const stagingProject = resolve(stagingRoot, folderName);

const entries = [
  '.claude-plugin',
  '.gitignore',
  'CHANGELOG.md',
  'CONTRIBUTING.md',
  'CUSTOMIZATION.md',
  'DESIGN.md',
  'LICENSE',
  'README.md',
  'THIRD_PARTY_NOTICES.md',
  'VERSION',
  'examples',
  'package-lock.json',
  'package.json',
  'public/assets/02_bw.svg',
  'public/assets/02_color.svg',
  'public/assets/03_bw.svg',
  'public/assets/03_color.svg',
  'public/fonts',
  'references',
  'remotion.config.ts',
  'scripts',
  'skill-package',
  'src',
  'storyboard.json',
  'storyboard.uploaded.json',
  'tests',
  'tsconfig.json',
];

try {
  mkdirSync(stagingProject, {recursive: true});
  for (const entry of entries) {
    const source = resolve(root, entry);
    if (!existsSync(source)) throw new Error(`Missing package entry: ${entry}`);
    const target = resolve(stagingProject, entry);
    mkdirSync(dirname(target), {recursive: true});
    cpSync(source, target, {
      recursive: true,
      filter: (path) =>
        !['.DS_Store', 'node_modules', '__pycache__', 'projects'].includes(basename(path)),
    });
  }

  mkdirSync(releaseDir, {recursive: true});
  rmSync(archive, {force: true});
  if (process.platform === 'win32') {
    execFileSync('tar.exe', ['-a', '-c', '-f', archive, folderName], {cwd: stagingRoot});
  } else {
    execFileSync('zip', ['-qr', archive, folderName], {cwd: stagingRoot});
  }
  console.log(`✓ share package → ${archive}`);
} finally {
  rmSync(stagingRoot, {recursive: true, force: true});
}

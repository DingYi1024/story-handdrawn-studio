import {cpSync, existsSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync} from 'node:fs';
import {basename, dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = resolve(
  root,
  'skill-package',
  'story-handdrawn-studio',
  'assets',
  'renderer',
);
const entries = [
  '.gitignore',
  'CHANGELOG.md',
  'CONTRIBUTING.md',
  'CUSTOMIZATION.md',
  'DESIGN.md',
  'LICENSE',
  'README.md',
  'THIRD_PARTY_NOTICES.md',
  'examples',
  'package-lock.json',
  'package.json',
  'public/assets/02_bw.svg',
  'public/assets/02_color.svg',
  'public/assets/03_bw.svg',
  'public/assets/03_color.svg',
  'public/examples/case-sprouting-note',
  'public/fonts',
  'references',
  'remotion.config.ts',
  'scripts',
  'src',
  'storyboard.json',
  'storyboard.uploaded.json',
  'tests',
  'tsconfig.json',
];

rmSync(target, {recursive: true, force: true});
mkdirSync(target, {recursive: true});
for (const entry of entries) {
  const source = resolve(root, entry);
  if (!existsSync(source)) throw new Error(`Missing runtime entry: ${entry}`);
  const destination = resolve(target, entry);
  mkdirSync(dirname(destination), {recursive: true});
  cpSync(source, destination, {
    recursive: true,
    filter: (path) => !['node_modules', '__pycache__', '.DS_Store'].includes(basename(path)),
  });
}

for (const generatedOnly of [
  'scripts/package-project.mjs',
  'scripts/package-skill.mjs',
  'scripts/run_story_video.py',
  'scripts/sync-skill-runtime.mjs',
  'scripts/validate-skill-package.mjs',
]) {
  const path = resolve(target, generatedOnly);
  if (existsSync(path)) unlinkSync(path);
}

const packagePath = resolve(target, 'package.json');
const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));
delete packageJson.scripts['package:share'];
delete packageJson.scripts['package:skill'];
delete packageJson.scripts['validate:skill'];
writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8');

console.log(`✓ synchronized Skill renderer → ${target}`);

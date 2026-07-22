import {existsSync, readFileSync, readdirSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const skill = resolve(root, 'skill-package', 'story-handdrawn-studio');
const renderer = resolve(skill, 'assets', 'renderer');
const failures = [];

const read = (path) => readFileSync(path, 'utf8');
const required = [
  'SKILL.md',
  'VERSION',
  'agents/openai.yaml',
  'scripts/run_story_video.py',
  'references/routing.md',
  'references/workflows.md',
  'references/quality.md',
  'references/storage-and-updates.md',
  'assets/renderer/package.json',
  'assets/renderer/package-lock.json',
  'assets/renderer/scripts/studio.mjs',
];

for (const entry of required) {
  if (!existsSync(resolve(skill, entry))) failures.push(`missing ${entry}`);
}

const projectPackage = JSON.parse(read(resolve(root, 'package.json')));
const rendererPackage = JSON.parse(read(resolve(renderer, 'package.json')));
const rootVersion = read(resolve(root, 'VERSION')).trim();
const skillVersion = read(resolve(skill, 'VERSION')).trim();
const versions = new Set([
  projectPackage.version,
  rendererPackage.version,
  rootVersion,
  skillVersion,
]);
if (versions.size !== 1) failures.push(`version mismatch: ${[...versions].join(', ')}`);

for (const scriptName of ['package:share', 'package:skill', 'validate:skill']) {
  if (rendererPackage.scripts?.[scriptName]) {
    failures.push(`repository-only script leaked into runtime: ${scriptName}`);
  }
}
for (const entry of [
  'scripts/package-project.mjs',
  'scripts/package-skill.mjs',
  'scripts/run_story_video.py',
  'scripts/sync-skill-runtime.mjs',
  'scripts/validate-skill-package.mjs',
]) {
  if (existsSync(resolve(renderer, entry))) failures.push(`repository-only file leaked: ${entry}`);
}

const skillText = read(resolve(skill, 'SKILL.md'));
const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(skillText)?.[1] || '';
const frontmatterKeys = [...frontmatter.matchAll(/^([a-z_]+):/gm)].map((match) => match[1]);
if (!frontmatter.includes('name: story-handdrawn-studio')) failures.push('invalid Skill name');
if (!frontmatter.includes('description:')) failures.push('missing Skill description');
if (frontmatterKeys.some((key) => !['name', 'description'].includes(key))) {
  failures.push(`unsupported Skill frontmatter key: ${frontmatterKeys.join(', ')}`);
}

for (const match of skillText.matchAll(/\(references\/([^\s)]+)\)/g)) {
  if (!existsSync(resolve(skill, 'references', match[1]))) {
    failures.push(`broken reference link: references/${match[1]}`);
  }
}

const forbiddenNames = new Set(['node_modules', 'projects', 'build', 'out', 'release', '__pycache__']);
const walk = (directory) => {
  for (const entry of readdirSync(directory, {withFileTypes: true})) {
    if (forbiddenNames.has(entry.name)) failures.push(`forbidden runtime entry: ${entry.name}`);
    if (entry.isDirectory()) walk(resolve(directory, entry.name));
  }
};
walk(renderer);

const marketplace = JSON.parse(read(resolve(root, '.claude-plugin', 'marketplace.json')));
const plugin = marketplace.plugins?.find((item) => item.name === 'story-handdrawn-studio');
if (!plugin) failures.push('Claude marketplace entry is missing');
if (plugin?.version !== projectPackage.version) failures.push('Claude marketplace version mismatch');
if (plugin?.strict !== false) failures.push('Claude marketplace must use explicit non-strict skill paths');
if (!plugin?.skills?.includes('./skill-package/story-handdrawn-studio')) {
  failures.push('Claude marketplace skill path mismatch');
}

if (failures.length) {
  console.error(`Skill validation failed:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}

console.log(`✓ mature Skill contract validated (v${projectPackage.version})`);

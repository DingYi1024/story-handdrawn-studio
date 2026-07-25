import {
  accessSync,
  constants,
  existsSync,
  readFileSync,
  readdirSync,
  statfsSync,
  statSync,
} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {CURRENT_PROJECT_SCHEMA_VERSION} from './migrations.mjs';
import {probeCommand} from './process.mjs';

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

const existingAncestor = (input) => {
  let current = resolve(input);
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
  return current;
};

const checkWritable = (path) => {
  const ancestor = existingAncestor(path);
  if (!ancestor) return {ok: false, detail: `No existing ancestor for ${path}`};
  try {
    accessSync(ancestor, constants.W_OK);
    return {ok: true, detail: `${ancestor} is writable`};
  } catch (error) {
    return {ok: false, detail: `${ancestor}: ${error.message}`};
  }
};

const packageCheck = (repoRoot) => {
  try {
    const packageJson = readJson(resolve(repoRoot, 'package.json'));
    const lock = readJson(resolve(repoRoot, 'package-lock.json'));
    const lockVersion = lock.packages?.['']?.version || lock.version;
    const ok = Boolean(packageJson.version) && packageJson.version === lockVersion;
    return {
      ok,
      detail: ok
        ? `renderer ${packageJson.version}; lockfile ${lock.lockfileVersion}`
        : `package ${packageJson.version || 'unknown'} does not match lockfile ${lockVersion || 'unknown'}`,
    };
  } catch (error) {
    return {ok: false, detail: error.message};
  }
};

const projectCompatibilityCheck = (projectsRoot) => {
  if (!existsSync(projectsRoot)) {
    return {ok: true, detail: `No projects yet; supports schema ${CURRENT_PROJECT_SCHEMA_VERSION}`, projects: 0};
  }
  const projects = [];
  const issues = [];
  for (const entry of readdirSync(projectsRoot, {withFileTypes: true})) {
    if (!entry.isDirectory()) continue;
    const config = resolve(projectsRoot, entry.name, 'project.json');
    if (!existsSync(config)) continue;
    try {
      const project = readJson(config);
      const schema = Number(project.schema_version || 1);
      projects.push({id: entry.name, schema});
      if (schema > CURRENT_PROJECT_SCHEMA_VERSION) {
        issues.push(`${entry.name}: schema ${schema} is newer than supported ${CURRENT_PROJECT_SCHEMA_VERSION}`);
      }
    } catch (error) {
      issues.push(`${entry.name}: unreadable project.json (${error.message})`);
    }
  }
  return {
    ok: issues.length === 0,
    detail: issues.length ? issues.join('; ') : `${projects.length} project(s); schemas are compatible`,
    projects: projects.length,
    supported_schema: CURRENT_PROJECT_SCHEMA_VERSION,
  };
};

const diskCheck = (path, minimumFreeBytes) => {
  const ancestor = existingAncestor(path);
  if (!ancestor) return {ok: false, detail: `Cannot inspect disk for ${path}`};
  try {
    const stats = statfsSync(ancestor);
    const freeBytes = Number(stats.bavail) * Number(stats.bsize);
    return {
      ok: freeBytes >= minimumFreeBytes,
      detail: `${(freeBytes / 1024 ** 3).toFixed(1)} GiB free at ${ancestor}`,
      free_bytes: freeBytes,
      minimum_free_bytes: minimumFreeBytes,
    };
  } catch (error) {
    return {ok: false, detail: error.message};
  }
};

const actionFor = {
  node: 'Install Node.js 20 or newer, then run setup again.',
  npm: 'Install npm with Node.js and ensure it is available on PATH.',
  ffmpeg: 'Install FFmpeg and ensure ffmpeg is available on PATH.',
  ffprobe: 'Install FFmpeg and ensure ffprobe is available on PATH.',
  dependencies: 'Run the Skill launcher with setup --force to reinstall locked dependencies.',
  browser: 'Run npx remotion browser ensure in the renderer, then run doctor again.',
  references: 'Reinstall the Skill; the bundled style references are incomplete.',
  package: 'Reinstall or upgrade the Skill; renderer and lockfile versions do not match.',
  data_root: 'Set STORY_HANDDRAWN_STUDIO_HOME to a writable absolute directory.',
  project_schema: 'Upgrade Story Handdrawn Studio before opening projects created by a newer version.',
  disk: 'Free at least 2 GiB on the data volume before rendering a final video.',
};

export const buildDoctorReport = ({
  repoRoot,
  dataRoot,
  projectsRoot,
  publicDir,
  probe = probeCommand,
  minimumFreeBytes = 2 * 1024 ** 3,
} = {}) => {
  const nodeProbe = probe(process.execPath, ['--version'], repoRoot);
  const nodeMajor = Number(/^v?(\d+)/.exec(process.version)?.[1] || 0);
  const npmProbe = process.platform === 'win32'
    ? probe(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm --version'], repoRoot)
    : probe('npm', ['--version'], repoRoot);
  const checks = {
    node: {
      ok: nodeProbe.ok && nodeMajor >= 20,
      detail: nodeProbe.ok
        ? `${nodeProbe.detail}; requires >=20`
        : nodeProbe.detail,
    },
    npm: npmProbe,
    ffmpeg: probe('ffmpeg', ['-version'], repoRoot),
    ffprobe: probe('ffprobe', ['-version'], repoRoot),
    dependencies: {
      ok: existsSync(resolve(repoRoot, 'node_modules', '@remotion', 'cli')),
      detail: resolve(repoRoot, 'node_modules', '@remotion', 'cli'),
    },
    browser: {
      ok: existsSync(resolve(repoRoot, 'node_modules', '.remotion', 'chrome-headless-shell')),
      detail: resolve(repoRoot, 'node_modules', '.remotion', 'chrome-headless-shell'),
    },
    references: {
      ok: ['style-bw.png', 'style-color.png'].every((name) =>
        existsSync(resolve(repoRoot, 'references', name))),
      detail: resolve(repoRoot, 'references'),
    },
    package: packageCheck(repoRoot),
    data_root: checkWritable(dataRoot),
    project_schema: projectCompatibilityCheck(projectsRoot),
    disk: diskCheck(dataRoot, minimumFreeBytes),
  };

  const required = new Set([
    'node',
    'npm',
    'ffmpeg',
    'ffprobe',
    'dependencies',
    'browser',
    'references',
    'package',
    'data_root',
    'project_schema',
  ]);
  const failures = Object.entries(checks)
    .filter(([name, check]) => required.has(name) && !check.ok)
    .map(([name, check]) => ({name, detail: check.detail, action: actionFor[name]}));
  const warnings = Object.entries(checks)
    .filter(([name, check]) => !required.has(name) && !check.ok)
    .map(([name, check]) => ({name, detail: check.detail, action: actionFor[name]}));
  const actions = [...new Set([...failures, ...warnings].map((item) => item.action).filter(Boolean))];

  return {
    ok: failures.length === 0,
    status: failures.length ? 'failed' : warnings.length ? 'warning' : 'ready',
    renderer_root: repoRoot,
    data_root: dataRoot,
    projects_root: projectsRoot,
    public_dir: publicDir,
    checks,
    failures,
    warnings,
    actions,
    next_action: actions[0] || 'Environment is ready. Continue with produce.',
  };
};

import {createHash} from 'node:crypto';
import {
  closeSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import {basename, dirname, extname, isAbsolute, relative, resolve} from 'node:path';
import {safeSlug} from './story-text.mjs';
import {CURRENT_PROJECT_SCHEMA_VERSION, migrateProjectDocuments} from './migrations.mjs';

export const PROJECT_SCHEMA_VERSION = CURRENT_PROJECT_SCHEMA_VERSION;

export const assertProjectId = (value) => {
  const id = String(value || '');
  if (!id || safeSlug(id, '') !== id || id === '.' || id === '..') {
    throw new Error('Project id must contain only letters, numbers, and single hyphen groups');
  }
  return id;
};

export const resolveInside = (base, ...segments) => {
  const absoluteBase = resolve(base);
  const target = resolve(absoluteBase, ...segments);
  const rel = relative(absoluteBase, target);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`Resolved path escapes ${absoluteBase}: ${target}`);
  }
  return target;
};

export const atomicWriteJson = (path, value) => {
  mkdirSync(dirname(path), {recursive: true});
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(temporary, path);
};

export const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

export const getProjectPaths = (
  repoRoot,
  projectId,
  projectsRoot = null,
  publicDir = null,
) => {
  const id = assertProjectId(projectId);
  const root = resolve(projectsRoot || resolve(repoRoot, 'projects'));
  const project = resolveInside(root, id);
  return {
    id,
    projectsRoot: root,
    project,
    config: resolveInside(project, 'project.json'),
    state: resolveInside(project, 'state.json'),
    lock: resolveInside(project, '.studio.lock'),
    source: resolveInside(project, 'source'),
    prompts: resolveInside(project, 'prompts'),
    output: resolveInside(project, 'output'),
    logs: resolveInside(project, 'logs'),
    revisions: resolveInside(project, 'revisions'),
    snapshots: resolveInside(project, 'snapshots'),
    review: resolveInside(project, 'review'),
    qa: resolveInside(project, 'qa'),
    audio: resolveInside(project, 'audio'),
    storyboardPlan: resolveInside(project, 'storyboard.generated.json'),
    storyboard: resolveInside(project, 'storyboard.json'),
    director: resolveInside(project, 'director.generated.json'),
    styleBakeoff: resolveInside(project, 'style-bakeoff.json'),
    styleBakeoffDir: resolveInside(project, 'style-bakeoff'),
    continuitySpec: resolveInside(project, 'continuity.spec.json'),
    continuityLedger: resolveInside(project, 'continuity.ledger.json'),
    audioOptions: resolveInside(project, 'audio-options.json'),
    audioManifest: resolveInside(project, 'audio-manifest.json'),
    audioDirector: resolveInside(project, 'audio-director.json'),
    providerState: resolveInside(project, 'provider-state.json'),
    semanticReport: resolveInside(project, 'semantic-report.json'),
    semanticObservations: resolveInside(project, 'semantic-observations.json'),
    visionJobs: resolveInside(project, 'vision-jobs.json'),
    reviewData: resolveInside(project, 'review', 'data.json'),
    reviewHtml: resolveInside(project, 'review', 'index.html'),
    reviewDecisions: resolveInside(project, 'review', 'decisions.json'),
    codexManifest: resolveInside(project, 'codex-image-jobs.json'),
    uploadedManifest: resolveInside(project, 'uploaded-pages.json'),
    renderProps: resolveInside(project, 'render-props.json'),
    publicAssets: resolveInside(publicDir || resolve(repoRoot, 'public'), 'projects', id, 'assets'),
    publicAssetPrefix: `projects/${id}/assets`,
  };
};

const uniqueImages = (images) => {
  const seen = new Set();
  const output = [];
  for (const image of images) {
    const absolute = resolve(image);
    if (!existsSync(absolute)) throw new Error(`Input image does not exist: ${absolute}`);
    const hash = createHash('sha256').update(readFileSync(absolute)).digest('hex');
    if (seen.has(hash)) continue;
    seen.add(hash);
    output.push({absolute, hash});
  }
  return output;
};

export const createProject = ({
  repoRoot,
  id,
  title,
  settings,
  storyText = null,
  images = [],
  projectsRoot = null,
  publicDir = null,
}) => {
  const paths = getProjectPaths(repoRoot, id, projectsRoot, publicDir);
  if (existsSync(paths.project)) throw new Error(`Project already exists: ${paths.id}`);
  if ((storyText === null) === (images.length === 0)) {
    throw new Error('Create a project with either story text or one or more images');
  }
  // Validate every external input before creating the project directory so a
  // bad path cannot leave an unusable half-created project behind.
  const validatedImages = images.length ? uniqueImages(images) : [];

  mkdirSync(paths.source, {recursive: true});
  mkdirSync(paths.prompts, {recursive: true});
  mkdirSync(paths.output, {recursive: true});
  mkdirSync(paths.logs, {recursive: true});
  mkdirSync(paths.revisions, {recursive: true});
  mkdirSync(paths.snapshots, {recursive: true});
  mkdirSync(paths.review, {recursive: true});
  mkdirSync(paths.qa, {recursive: true});
  mkdirSync(paths.audio, {recursive: true});
  mkdirSync(paths.publicAssets, {recursive: true});

  let source;
  if (storyText !== null) {
    const storyPath = resolveInside(paths.source, 'story.txt');
    writeFileSync(storyPath, `${String(storyText).trim()}\n`, 'utf8');
    source = {type: 'story', path: 'source/story.txt'};
  } else {
    const imageDir = resolveInside(paths.source, 'images');
    mkdirSync(imageDir, {recursive: true});
    const copied = validatedImages.map((image, index) => {
      const extension = extname(image.absolute).toLowerCase() || '.png';
      const name = `${String(index + 1).padStart(2, '0')}${extension}`;
      copyFileSync(image.absolute, resolveInside(imageDir, name));
      return {path: `source/images/${name}`, sha256: image.hash, original: basename(image.absolute)};
    });
    if (copied.length === 0) throw new Error('No unique images remain');
    source = {type: 'images', images: copied};
  }

  const now = new Date().toISOString();
  const project = {
    schema_version: PROJECT_SCHEMA_VERSION,
    id: paths.id,
    title: String(title).trim() || paths.id,
    created_at: now,
    updated_at: now,
    source,
    settings,
  };
  atomicWriteJson(paths.config, project);
  atomicWriteJson(paths.state, {
    schema_version: PROJECT_SCHEMA_VERSION,
    project_id: paths.id,
    status: 'created',
    current_revision: 0,
    production: null,
    pending_jobs: [],
    pending_scenes: [],
    qa: {},
    audio: {status: 'disabled'},
    provider: {status: 'not_started'},
    review: {status: 'not_started'},
    snapshots: [],
    updated_at: now,
    last_error: null,
    history: [{at: now, status: 'created', message: 'Project created'}],
  });
  return {project, paths};
};

export const loadProject = (repoRoot, projectId, projectsRoot = null, publicDir = null) => {
  const paths = getProjectPaths(repoRoot, projectId, projectsRoot, publicDir);
  if (!existsSync(paths.config)) throw new Error(`Project not found: ${paths.id}`);
  const rawProject = readJson(paths.config);
  const rawState = existsSync(paths.state) ? readJson(paths.state) : null;
  const migrated = migrateProjectDocuments(rawProject, rawState);
  return {
    paths,
    project: migrated.project,
    state: migrated.state,
    migration: {from: migrated.from, to: migrated.to, changed: migrated.changed, changes: migrated.changes},
  };
};

const snapshotFiles = (paths) => ({
  'project.json': paths.config,
  'state.json': paths.state,
  'storyboard.json': paths.storyboard,
  'storyboard.generated.json': paths.storyboardPlan,
  'director.generated.json': paths.director,
  'style-bakeoff.json': paths.styleBakeoff,
  'continuity.spec.json': paths.continuitySpec,
  'continuity.ledger.json': paths.continuityLedger,
  'codex-image-jobs.json': paths.codexManifest,
  'audio-options.json': paths.audioOptions,
  'audio-manifest.json': paths.audioManifest,
  'provider-state.json': paths.providerState,
  'semantic-report.json': paths.semanticReport,
});

export const createProjectSnapshot = (paths, label = '') => {
  mkdirSync(paths.snapshots, {recursive: true});
  const ids = readdirSync(paths.snapshots, {withFileTypes: true})
    .filter((entry) => entry.isDirectory() && /^s\d{4}$/.test(entry.name))
    .map((entry) => Number(entry.name.slice(1)));
  const id = `s${String(Math.max(0, ...ids) + 1).padStart(4, '0')}`;
  const directory = resolveInside(paths.snapshots, id);
  mkdirSync(directory, {recursive: true});
  const files = [];
  for (const [name, source] of Object.entries(snapshotFiles(paths))) {
    if (!source || !existsSync(source)) continue;
    copyFileSync(source, resolveInside(directory, name));
    files.push(name);
  }
  if (existsSync(paths.review)) {
    cpSync(paths.review, resolveInside(directory, 'review'), {recursive: true});
    files.push('review/');
  }
  const manifest = {schema_version: 1, id, label: String(label), created_at: new Date().toISOString(), files};
  atomicWriteJson(resolveInside(directory, 'snapshot.json'), manifest);
  return {...manifest, directory};
};

export const restoreProjectSnapshot = (paths, snapshotId) => {
  if (!/^s\d{4}$/.test(String(snapshotId))) throw new Error('Snapshot id must use s0001 format');
  const directory = resolveInside(paths.snapshots, String(snapshotId));
  const manifestPath = resolveInside(directory, 'snapshot.json');
  if (!existsSync(manifestPath)) throw new Error(`Snapshot not found: ${snapshotId}`);
  const safety = createProjectSnapshot(paths, `automatic backup before restoring ${snapshotId}`);
  const restored = [];
  for (const [name, target] of Object.entries(snapshotFiles(paths))) {
    const source = resolveInside(directory, name);
    if (!existsSync(source)) continue;
    copyFileSync(source, target);
    restored.push(name);
  }
  const reviewSource = resolveInside(directory, 'review');
  if (existsSync(reviewSource)) {
    cpSync(reviewSource, paths.review, {recursive: true, force: true});
    restored.push('review/');
  }
  return {restored_snapshot: snapshotId, safety_snapshot: safety.id, files: restored};
};

export const persistProjectMigration = (paths) => {
  const migrated = migrateProjectDocuments(readJson(paths.config), existsSync(paths.state) ? readJson(paths.state) : null);
  if (migrated.changed) {
    const snapshot = createProjectSnapshot(paths, `before schema migration ${migrated.from} to ${migrated.to}`);
    atomicWriteJson(paths.config, migrated.project);
    if (migrated.state) atomicWriteJson(paths.state, migrated.state);
    return {...migrated, snapshot: snapshot.id};
  }
  return migrated;
};

export const updateProjectState = (paths, status, message, error = null, metadata = {}) => {
  const now = new Date().toISOString();
  const current = existsSync(paths.state)
    ? readJson(paths.state)
    : {schema_version: PROJECT_SCHEMA_VERSION, project_id: paths.id, history: []};
  const next = {
    ...current,
    status,
    updated_at: now,
    last_error: error ? String(error) : null,
    ...metadata,
    history: [...(current.history || []), {at: now, status, message}].slice(-100),
  };
  if (status !== 'failed') delete next.resume_from;
  atomicWriteJson(paths.state, next);
  return next;
};

export const archiveProjectRevision = (paths, revision, reason = '') => {
  const number = Number(revision);
  if (!Number.isInteger(number) || number < 1) throw new Error('revision must be a positive integer');
  const directory = resolveInside(paths.revisions, `r${number}`);
  if (existsSync(directory)) throw new Error(`Revision archive already exists: ${directory}`);
  mkdirSync(directory, {recursive: true});
  const candidates = {
    'project.json': paths.config,
    'state.json': paths.state,
    'storyboard.json': paths.storyboard,
    'storyboard.generated.json': paths.storyboardPlan,
    'director.generated.json': paths.director,
    'style-bakeoff.json': paths.styleBakeoff,
    'continuity.spec.json': paths.continuitySpec,
    'continuity.ledger.json': paths.continuityLedger,
    'codex-image-jobs.json': paths.codexManifest,
    'audio-manifest.json': paths.audioManifest,
    'audio-options.json': paths.audioOptions,
  };
  const files = [];
  for (const [name, source] of Object.entries(candidates)) {
    if (!source || !existsSync(source)) continue;
    copyFileSync(source, resolveInside(directory, name));
    files.push(name);
  }
  atomicWriteJson(resolveInside(directory, 'revision.json'), {
    revision: number,
    archived_at: new Date().toISOString(),
    reason: String(reason || ''),
    files,
  });
  return {revision: number, directory, files};
};

export const listProjects = (repoRoot, projectsRoot = null, publicDir = null) => {
  const root = resolve(projectsRoot || resolve(repoRoot, 'projects'));
  if (!existsSync(root)) return [];
  return readdirSync(root, {withFileTypes: true})
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      try {
        return loadProject(repoRoot, entry.name, root, publicDir);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) =>
      (b.state?.updated_at || b.project.updated_at).localeCompare(
        a.state?.updated_at || a.project.updated_at,
      ),
    );
};

export const withProjectLock = async (paths, callback) => {
  let descriptor;
  try {
    descriptor = openSync(paths.lock, 'wx');
    writeFileSync(descriptor, `${process.pid}\n${new Date().toISOString()}\n`);
  } catch (error) {
    if (error?.code === 'EEXIST') {
      throw new Error(`Project ${paths.id} is already being modified (${paths.lock})`);
    }
    throw error;
  }
  try {
    return await callback();
  } finally {
    closeSync(descriptor);
    if (existsSync(paths.lock)) unlinkSync(paths.lock);
  }
};

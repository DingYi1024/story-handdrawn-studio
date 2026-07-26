import {existsSync, readdirSync, readFileSync, statSync} from 'node:fs';
import {resolve} from 'node:path';
import {loadProject, readJson, resolveInside} from './projects.mjs';

const KNOWN_STATUSES = new Set([
  'created', 'planning', 'awaiting_style_choice', 'awaiting_assets', 'importing',
  'ingesting', 'assets_ready', 'rendering_preview', 'preview_ready',
  'rendering_final', 'completed', 'failed', 'revising',
]);

const directoryBytes = (root) => {
  if (!existsSync(root)) return 0;
  let total = 0;
  const visit = (path) => {
    for (const entry of readdirSync(path, {withFileTypes: true})) {
      const child = resolve(path, entry.name);
      if (entry.isDirectory()) visit(child);
      else if (entry.isFile()) total += statSync(child).size;
    }
  };
  visit(root);
  return total;
};

const qaPassed = (path) => {
  if (!existsSync(path)) return false;
  try {
    const report = readJson(path);
    return report.passed === true || report.status === 'passed' || report.status === 'pass';
  } catch {
    return false;
  }
};

const sourceCheck = (loaded) => {
  if (loaded.project.source.type === 'story') {
    const path = resolveInside(loaded.paths.project, loaded.project.source.path);
    return {
      ok: existsSync(path) && readFileSync(path, 'utf8').trim().length > 0,
      detail: path,
    };
  }
  const paths = (loaded.project.source.images || []).map((image) =>
    resolveInside(loaded.paths.project, image.path));
  return {
    ok: paths.length > 0 && paths.every((path) => existsSync(path)),
    detail: `${paths.filter((path) => existsSync(path)).length}/${paths.length} source images`,
  };
};

const projectQaPath = (loaded, quality) =>
  loaded.state?.qa?.[quality]?.report || resolveInside(loaded.paths.qa, quality, 'report.json');

export const auditProject = (
  loaded,
  {nowMs = Date.now(), staleLockMs = 6 * 60 * 60 * 1000} = {},
) => {
  const status = loaded.state?.status || 'unknown';
  const checks = {
    source: sourceCheck(loaded),
    status: {ok: KNOWN_STATUSES.has(status), detail: status},
    lock: {ok: true, detail: 'unlocked'},
    preview: {ok: true, detail: 'not required by current state'},
    final: {ok: true, detail: 'not required by current state'},
    qa: {ok: true, detail: 'not required by current state'},
  };
  const issues = [];
  if (existsSync(loaded.paths.lock)) {
    const ageMs = Math.max(0, nowMs - statSync(loaded.paths.lock).mtimeMs);
    const stale = ageMs >= staleLockMs;
    checks.lock = {
      ok: !stale,
      detail: `${stale ? 'stale' : 'active'} lock, age ${Math.round(ageMs / 60000)} minutes`,
    };
    issues.push({
      severity: stale ? 'failure' : 'warning',
      code: stale ? 'stale_lock' : 'active_lock',
      detail: checks.lock.detail,
      action: stale
        ? `Verify no Studio process is running, then remove ${loaded.paths.lock}`
        : 'Wait for the active Studio operation to finish.',
    });
  }
  if (!checks.source.ok) {
    issues.push({severity: 'failure', code: 'source_missing', detail: checks.source.detail, action: 'Restore the project source from backup.'});
  }
  if (!checks.status.ok) {
    issues.push({severity: 'failure', code: 'unknown_status', detail: status, action: 'Upgrade the Skill or restore a valid snapshot.'});
  }
  if (['preview_ready', 'completed'].includes(status)) {
    const preview = resolveInside(loaded.paths.output, 'preview.mp4');
    checks.preview = {ok: existsSync(preview), detail: preview};
    if (!checks.preview.ok) {
      issues.push({severity: 'failure', code: 'preview_missing', detail: preview, action: `Resume project ${loaded.project.id} to regenerate its preview.`});
    }
  }
  if (status === 'completed') {
    const final = resolveInside(loaded.paths.output, 'final.mp4');
    const report = projectQaPath(loaded, 'final');
    checks.final = {ok: existsSync(final), detail: final};
    checks.qa = {ok: qaPassed(report), detail: report};
    if (!checks.final.ok) {
      issues.push({severity: 'failure', code: 'final_missing', detail: final, action: `Resume project ${loaded.project.id} to regenerate its final video.`});
    }
    if (!checks.qa.ok) {
      issues.push({severity: 'failure', code: 'final_qa_missing_or_failed', detail: report, action: `Run qa --project ${loaded.project.id} --quality final.`});
    }
  }
  if (status === 'failed') {
    issues.push({
      severity: 'failure',
      code: 'project_failed',
      detail: loaded.state?.last_error || 'No failure detail recorded',
      action: `Inspect status, fix the cause, then run resume --project ${loaded.project.id}.`,
    });
  } else if (status === 'awaiting_assets') {
    issues.push({
      severity: 'warning',
      code: 'assets_required',
      detail: `${loaded.state?.pending_jobs?.length || 0} image jobs pending`,
      action: `Generate pending image jobs, then run resume --project ${loaded.project.id}.`,
    });
  } else if (status === 'awaiting_style_choice') {
    issues.push({
      severity: 'warning',
      code: 'style_approval_required',
      detail: 'Style approval gate is unresolved',
      action: `Choose a theme with director --project ${loaded.project.id} --action choose.`,
    });
  }
  const failureCount = issues.filter((issue) => issue.severity === 'failure').length;
  const warningCount = issues.filter((issue) => issue.severity === 'warning').length;
  return {
    id: loaded.project.id,
    title: loaded.project.title,
    status,
    health: failureCount ? 'failure' : warningCount ? 'action_required' : 'healthy',
    bytes: directoryBytes(loaded.paths.project),
    checks,
    issues,
  };
};

export const auditPortfolio = ({
  repoRoot,
  projectsRoot = resolve(repoRoot, 'projects'),
  publicDir = resolve(repoRoot, 'public'),
  nowMs = Date.now(),
  staleLockMs,
}) => {
  const root = resolve(projectsRoot);
  const projects = [];
  if (existsSync(root)) {
    for (const entry of readdirSync(root, {withFileTypes: true}).filter((item) => item.isDirectory())) {
      try {
        projects.push(auditProject(
          loadProject(repoRoot, entry.name, root, publicDir),
          {nowMs, staleLockMs},
        ));
      } catch (error) {
        projects.push({
          id: entry.name,
          title: entry.name,
          status: 'unreadable',
          health: 'failure',
          bytes: directoryBytes(resolve(root, entry.name)),
          checks: {},
          issues: [{
            severity: 'failure',
            code: 'unreadable_project',
            detail: String(error.message || error),
            action: 'Restore this project from backup or move it out of the projects directory.',
          }],
        });
      }
    }
  }
  projects.sort((a, b) => a.id.localeCompare(b.id));
  const summary = {
    projects: projects.length,
    healthy: projects.filter((project) => project.health === 'healthy').length,
    action_required: projects.filter((project) => project.health === 'action_required').length,
    failed: projects.filter((project) => project.health === 'failure').length,
    bytes: projects.reduce((sum, project) => sum + project.bytes, 0),
  };
  return {
    schema_version: 1,
    ok: summary.failed === 0,
    status: summary.failed ? 'failures' : summary.action_required ? 'action_required' : 'healthy',
    projects_root: root,
    summary,
    projects,
    generated_at: new Date(nowMs).toISOString(),
  };
};

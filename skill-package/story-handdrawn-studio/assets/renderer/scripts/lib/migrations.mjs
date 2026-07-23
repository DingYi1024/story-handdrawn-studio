export const CURRENT_PROJECT_SCHEMA_VERSION = 4;

const clone = (value) => structuredClone(value);

export const migrateProjectDocuments = (projectInput, stateInput = null) => {
  const project = clone(projectInput);
  const state = stateInput ? clone(stateInput) : null;
  const from = Number(project.schema_version || 1);
  if (from > CURRENT_PROJECT_SCHEMA_VERSION) {
    throw new Error(`Project schema ${from} is newer than this Studio supports (${CURRENT_PROJECT_SCHEMA_VERSION})`);
  }
  const changes = [];
  if (from < 3) {
    project.settings = project.settings || {};
    project.settings.provider = project.settings.provider || {id: 'auto', max_attempts: 3};
    project.settings.review = project.settings.review || {semantic_strict: false};
    project.template = project.template || null;
    changes.push('added provider, review, and template settings');
  }
  if (from < 4) {
    project.settings = project.settings || {};
    project.settings.director = project.settings.director || {
      arc: 'auto', theme: 'auto', multi_shot: true,
      require_plan_approval: false, require_style_approval: false,
    };
    changes.push('added creative director, multi-shot, and style bake-off settings');
  }
  project.schema_version = CURRENT_PROJECT_SCHEMA_VERSION;
  if (state) {
    state.schema_version = CURRENT_PROJECT_SCHEMA_VERSION;
    state.provider = state.provider || {status: 'not_started'};
    state.review = state.review || {status: 'not_started'};
    state.snapshots = state.snapshots || [];
  }
  return {from, to: CURRENT_PROJECT_SCHEMA_VERSION, changed: from !== CURRENT_PROJECT_SCHEMA_VERSION, changes, project, state};
};

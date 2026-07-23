import {createHash} from 'node:crypto';
import {dirname, extname, posix, resolve} from 'node:path';
import {
  computeContinuityImpact,
  createContinuityLedger,
  stableHash,
} from './continuity.mjs';
import {
  applyCreativeDirectionToStoryboard,
  HANDDRAWN_THEMES,
  NARRATIVE_ARCS,
} from './creative-director.mjs';

export const DIRECTOR_SCHEMA_VERSION = 2;

const clone = (value) => JSON.parse(JSON.stringify(value));
const unique = (values) => [...new Set(values.filter(Boolean))];

export const hashSource = (value) =>
  createHash('sha256').update(String(value)).digest('hex');

export const createAutomaticContinuitySpec = (storyboard, project) => ({
  schemaVersion: 1,
  characters: [],
  props: [],
  scenes: storyboard.scenes.map((scene) => ({
    id: scene.id,
    characters: [],
    props: [],
    setting: {
      location: null,
      timeOfDay: null,
      palette: clone(project.settings?.visual?.palette || []),
    },
    dependsOn: [],
  })),
});

const continuityPrompt = (ledgerScene, continuityReference, referenceLabel = 'previous scene master') => {
  const cast = ledgerScene?.explicitCharacters?.length
    ? ledgerScene.explicitCharacters.join(', ')
    : 'no pre-authorized cast; include only people strictly required by the current sentence';
  const setting = ledgerScene?.setting || {};
  return [
    '',
    'Structured director continuity contract:',
    `- Explicit current cast: ${cast}. Never inherit a person's presence from another scene.`,
    `- Location: ${setting.location ?? 'not locked'}. Time: ${setting.timeOfDay ?? 'not locked'}.`,
    `- Palette: ${(ledgerScene?.palette || []).join(', ') || 'use the project palette'}.`,
    continuityReference
      ? `- The ${referenceLabel} is a continuity reference for identity, outfit and drawing language only; never copy its cast, pose or composition automatically.`
      : '- This is the first narrative scene; establish only identities explicitly required here.',
  ].join('\n');
};

export const createDirectorArtifacts = ({
  project,
  storyboard,
  manifest = null,
  sourceText = '',
  generator = 'codex',
  textMode = 'font',
  continuitySpec = null,
}) => {
  const directedStoryboard = applyCreativeDirectionToStoryboard(storyboard, {
    title: project.title,
    sourceText,
    arc: project.settings?.director?.arc === 'auto' ? null : project.settings?.director?.arc,
    theme: project.settings?.director?.theme === 'auto' ? null : project.settings?.director?.theme,
    multiShot: project.settings?.director?.multi_shot !== false,
  });
  const spec = clone(continuitySpec || createAutomaticContinuitySpec(storyboard, project));
  const ledger = createContinuityLedger(spec);
  const revision = 1;
  const plan = {
    kind: 'director-plan',
    schemaVersion: DIRECTOR_SCHEMA_VERSION,
    projectId: project.id,
    sourceHash: hashSource(sourceText),
    revision,
    generator,
    textMode,
    continuityVersion: ledger.version,
    semanticContinuity: continuitySpec ? 'user-or-agent-supplied' : 'safe-empty-cast',
    creativeDirection: {
      ...directedStoryboard.project.director,
      arc_label: NARRATIVE_ARCS[directedStoryboard.project.director.arc].label,
      theme_label: HANDDRAWN_THEMES[directedStoryboard.project.director.theme].label,
      gates: {
        beat_map: project.settings?.director?.require_plan_approval === true ? 'pending' : 'automatic',
        style_bakeoff: project.settings?.director?.require_style_approval === true ? 'pending' : 'optional',
      },
    },
    scenes: directedStoryboard.scenes.map((scene, index) => ({
      id: scene.id,
      index,
      revision,
      sourceText: scene.narration || scene.text,
      caption: scene.text,
      narration: scene.narration || scene.text,
      visualDirection: scene.visual,
      cast: ledger.scenes[index]?.explicitCharacters || [],
      setting: ledger.scenes[index]?.setting || null,
      continuityTags: [ledger.scenes[index]?.resolvedHash].filter(Boolean),
      dependsOn: (ledger.scenes[index]?.dependencies || []).map(({sceneId}) => sceneId),
      shots: clone(scene.shots || []),
      notes: [],
    })),
  };

  if (!manifest) return {director: plan, storyboard: directedStoryboard, continuitySpec: spec, continuityLedger: ledger, manifest: null};
  const nextManifest = clone(manifest);
  const sceneJobs = nextManifest.jobs.filter((job) => job.role !== 'reference');
  let previousMaster = null;
  for (const scene of plan.scenes) {
    const job = sceneJobs.find((candidate) => (candidate.scene_id || candidate.id) === scene.id);
    if (!job) continue;
    const ledgerScene = ledger.scenes.find(({id}) => id === scene.id);
    job.scene_id = scene.id;
    job.revision = revision;
    job.kind = 'scene_master';
    job.asset_stem = scene.id;
    job.continuity_version = ledger.version;
    job.continuity_refs = previousMaster ? [previousMaster] : [];
    job.references = unique([...(job.references || []), previousMaster]);
    job.prompt = `${job.prompt.trim()}${continuityPrompt(ledgerScene, previousMaster)}\n`;
    previousMaster = job.output_master;
  }
  for (const job of nextManifest.jobs.filter((item) => item.role === 'reference')) {
    job.revision = revision;
    job.kind = 'reference';
  }
  nextManifest.revision = revision;
  nextManifest.continuity_version = ledger.version;
  nextManifest.director_hash = stableHash(plan);
  return {director: plan, storyboard: directedStoryboard, continuitySpec: spec, continuityLedger: ledger, manifest: nextManifest};
};

const revisedAssetPath = (current, stem, suffix) => {
  if (!current) return current;
  return posix.join(posix.dirname(current), `${stem}_${suffix}.png`);
};

export const prepareSceneRevision = ({
  director,
  storyboardPlan,
  activeStoryboard = null,
  manifest,
  continuitySpec,
  continuityLedger,
  sceneIds,
  note,
  replacementText = null,
  replacementNarration = null,
  promptDirectory,
  currentAssetReferences = {},
}) => {
  const requested = unique(sceneIds);
  if (!requested.length) throw new Error('At least one scene id is required');
  if (replacementText !== null && requested.length !== 1) {
    throw new Error('Text replacement is supported for exactly one scene at a time');
  }
  const nextRevision = Math.max(1, Number(director.revision) || 1) + 1;
  const nextSpec = clone(continuitySpec);
  for (const sceneId of requested) {
    const scene = nextSpec.scenes.find((candidate) => candidate.id === sceneId);
    if (!scene) throw new Error(`Unknown continuity scene: ${sceneId}`);
    scene.revisionNote = String(note || '').trim();
    if (replacementNarration !== null) scene.sourceText = replacementNarration;
  }
  const nextLedger = createContinuityLedger(nextSpec);
  const impact = computeContinuityImpact(continuityLedger, nextLedger);
  const impactedSceneIds = unique([...requested, ...impact.impactedSceneIds]);

  const nextDirector = clone(director);
  nextDirector.revision = nextRevision;
  nextDirector.continuityVersion = nextLedger.version;
  const nextStoryboard = clone(storyboardPlan);
  nextStoryboard.schema_version = Math.max(3, Number(nextStoryboard.schema_version) || 0);
  nextStoryboard.project.storyboard_revision = nextRevision;
  const nextManifest = clone(manifest);
  const newJobs = [];

  for (const sceneId of impactedSceneIds) {
    const directorScene = nextDirector.scenes.find((scene) => scene.id === sceneId);
    const scene = nextStoryboard.scenes.find((candidate) => candidate.id === sceneId);
    const activeScene = activeStoryboard?.scenes?.find((candidate) => candidate.id === sceneId);
    if (!directorScene || !scene) throw new Error(`Unknown storyboard scene: ${sceneId}`);
    const directRequest = requested.includes(sceneId);
    const ledgerScene = nextLedger.scenes.find((candidate) => candidate.id === sceneId);
    directorScene.revision = nextRevision;
    directorScene.cast = ledgerScene?.explicitCharacters || [];
    directorScene.setting = ledgerScene?.setting || null;
    directorScene.continuityTags = [ledgerScene?.resolvedHash].filter(Boolean);
    directorScene.dependsOn = (ledgerScene?.dependencies || []).map(({sceneId: dependencyId}) => dependencyId);
    directorScene.notes = [...(directorScene.notes || []), {
      revision: nextRevision,
      note: directRequest ? String(note || '').trim() : 'Regenerated because upstream continuity changed',
    }];
    if (directRequest && replacementText !== null) {
      scene.text = replacementText;
      directorScene.caption = replacementText;
    }
    if (directRequest && replacementNarration !== null) {
      scene.narration = replacementNarration;
      directorScene.narration = replacementNarration;
      directorScene.sourceText = replacementNarration;
    }
    scene.visual = `${scene.visual}\nRevision ${nextRevision}: ${directRequest ? note : 'Preserve the revised upstream continuity.'}`;

    const existingJobIndex = nextManifest.jobs.findIndex((job) =>
      job.role !== 'reference' && (job.scene_id || job.id) === sceneId,
    );
    if (existingJobIndex < 0) throw new Error(`Missing image job for scene ${sceneId}`);
    const existingJob = nextManifest.jobs[existingJobIndex];
    const stem = `${sceneId}-r${nextRevision}`;
    const extension = extname(existingJob.output_master) || '.png';
    const outputMaster = resolve(dirname(existingJob.output_master), `${stem}_master${extension}`);
    const promptFile = resolve(promptDirectory, `${stem}_master.txt`);
    const revisionInstruction = directRequest
      ? `Revision instruction: ${String(note || '').trim()}`
      : 'Revision instruction: regenerate this scene only to preserve continuity with an upstream revised scene; do not change its narrative event.';
    const job = {
      ...existingJob,
      id: stem,
      scene_id: sceneId,
      revision: nextRevision,
      kind: 'scene_retake',
      asset_stem: stem,
      continuity_version: nextLedger.version,
      prompt_file: promptFile,
      prompt: `${existingJob.prompt.trim()}\n\n${revisionInstruction}${continuityPrompt(
        ledgerScene,
        currentAssetReferences[sceneId],
        'current accepted scene master',
      )}\n`,
      output_master: outputMaster,
      references: unique([
        ...(existingJob.references || []),
        currentAssetReferences[sceneId],
      ]),
      status: 'pending',
    };
    nextManifest.jobs[existingJobIndex] = job;
    newJobs.push(job);
    scene.assets = {
      ...scene.assets,
      text_image: scene.assets.text_image ? revisedAssetPath(scene.assets.text_image, stem, 'text') : null,
      bw: revisedAssetPath(scene.assets.bw, stem, 'bw'),
      color: revisedAssetPath(scene.assets.color, stem, 'color'),
    };
    if (activeScene) directorScene.previousAssets = clone(activeScene.assets);
  }

  nextManifest.revision = nextRevision;
  nextManifest.continuity_version = nextLedger.version;
  nextManifest.director_hash = stableHash(nextDirector);
  return {
    revision: nextRevision,
    director: nextDirector,
    storyboardPlan: nextStoryboard,
    manifest: nextManifest,
    continuitySpec: nextSpec,
    continuityLedger: nextLedger,
    impact: {...impact, impactedSceneIds},
    jobs: newJobs,
  };
};

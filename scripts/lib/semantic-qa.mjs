import {existsSync} from 'node:fs';
import {resolve} from 'node:path';

export const SEMANTIC_QA_SCHEMA_VERSION = 1;

const verdict = (id, status, sceneId, message, suggestion = null, evidence = null) => ({
  id, status, scene_id: sceneId, message, suggestion, evidence,
});

export const createVisionJobs = (storyboard, continuityLedger = null, manifest = null) => {
  const ledgerScenes = new Map((continuityLedger?.scenes || []).map((scene) => [String(scene.id), scene]));
  const jobs = new Map((manifest?.jobs || []).filter((job) => job.scene_id).map((job) => [String(job.scene_id), job]));
  return storyboard.scenes.map((scene) => {
    const continuity = ledgerScenes.get(String(scene.id));
    const imageJob = jobs.get(String(scene.id));
    return {
      id: `vision-${scene.id}`,
      scene_id: String(scene.id),
      assets: scene.assets || {},
      expected: {
        visual: scene.visual || '',
        caption: scene.text || '',
        characters: continuity?.explicitCharacters || [],
        props: continuity?.props || [],
        style: storyboard.project.style_lock || null,
        forbidden: ['watermark', 'logo', 'unrequested text', 'extra character'],
      },
      prompt: imageJob?.prompt || null,
      checks: ['scene_match', 'character_identity', 'character_count', 'props', 'caption_text', 'watermark', 'style'],
    };
  });
};

export const createSemanticQaReport = ({
  storyboard,
  continuityLedger = null,
  manifest = null,
  observations = null,
  publicDir = null,
  strict = false,
  generatedAt = new Date().toISOString(),
}) => {
  const visionJobs = createVisionJobs(storyboard, continuityLedger, manifest);
  const manifestByScene = new Map((manifest?.jobs || []).filter((job) => job.scene_id).map((job) => [String(job.scene_id), job]));
  const observedByScene = new Map(Object.entries(observations?.scenes || {}));
  const checks = [];
  for (const job of visionJobs) {
    const sceneId = job.scene_id;
    const scene = storyboard.scenes.find((candidate) => String(candidate.id) === sceneId);
    const assets = Object.values(job.assets).filter(Boolean);
    const requiredAssetKeys = (scene?.layers || []).includes('bw_full')
      ? ['bw', 'color']
      : (scene?.layers || []).includes('color')
        ? ['color']
        : ['color'];
    const missingDeclarations = requiredAssetKeys.filter((key) => !job.assets?.[key]);
    const missingAssets = publicDir
      ? assets.filter((path) => !existsSync(resolve(publicDir, path)))
      : [];
    checks.push(verdict(
      'asset_integrity',
      missingDeclarations.length === 0 && missingAssets.length === 0 ? 'pass' : 'fail',
      sceneId,
      missingDeclarations.length ? `Scene is missing required asset declarations: ${missingDeclarations.join(', ')}` : missingAssets.length ? 'One or more declared assets are missing' : 'Declared scene assets are present',
      'Regenerate or import the missing scene assets.',
      {assets, required: requiredAssetKeys, missing_declarations: missingDeclarations, missing: missingAssets},
    ));
    const manifestJob = manifestByScene.get(sceneId);
    if (manifest) {
      const prompt = manifestJob?.prompt || '';
      const guarded = /continuity|same|consistent|inherit|character/i.test(prompt);
      checks.push(verdict(
        'prompt_continuity_guard', guarded ? 'pass' : 'fail', sceneId,
        guarded ? 'Generation prompt contains a continuity guard' : 'Generation prompt lacks a continuity guard',
        'Regenerate the director prompt with the continuity ledger attached.',
      ));
    }
    const observation = observedByScene.get(sceneId);
    if (!observation) {
      checks.push(verdict(
        'visual_observation', strict ? 'fail' : 'needs_review', sceneId,
        'No semantic vision observation has been supplied; no visual claim is fabricated.',
        'Open the review page or provide semantic-observations.json for this scene.',
      ));
      continue;
    }
    for (const key of ['scene_match', 'character_identity', 'character_count', 'props', 'caption_text', 'watermark', 'style']) {
      const value = observation[key];
      const passed = key === 'watermark' ? value === false : value === true;
      checks.push(verdict(
        key, passed ? 'pass' : 'fail', sceneId,
        passed ? `${key} passed visual review` : `${key} failed visual review`,
        `Revise scene ${sceneId} with an explicit ${key} correction.`,
        value,
      ));
    }
  }
  const summary = checks.reduce((result, item) => {
    result[item.status] += 1;
    result.total += 1;
    return result;
  }, {pass: 0, fail: 0, needs_review: 0, total: 0});
  const failedScenes = [...new Set(checks.filter((item) => item.status === 'fail').map((item) => item.scene_id))];
  return {
    kind: 'semantic-qa-report', schema_version: SEMANTIC_QA_SCHEMA_VERSION, generated_at: generatedAt,
    status: summary.fail ? 'fail' : summary.needs_review ? 'needs_review' : 'pass',
    passed: summary.fail === 0,
    summary,
    checks,
    failed_scenes: failedScenes,
    revision_suggestions: failedScenes.map((sceneId) => ({
      scene_id: sceneId,
      note: checks.filter((item) => item.scene_id === sceneId && item.status === 'fail').map((item) => item.suggestion).filter(Boolean).join(' '),
    })),
    vision_jobs: visionJobs,
  };
};

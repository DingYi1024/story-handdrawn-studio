import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {
  createAutomaticContinuitySpec,
  createDirectorArtifacts,
  prepareSceneRevision,
} from '../scripts/lib/director.mjs';

const project = {
  id: 'director-test',
  settings: {visual: {palette: ['sage', 'brick']}},
};
const storyboard = {
  schema_version: 2,
  project: {title: 'Director', storyboard_revision: 1},
  scenes: [
    {id: '01', duration_sec: 4.5, text: '第一幕', narration: '第一幕', visual: '雨中', assets: {text_image: null, bw: 'assets/01_bw.png', color: 'assets/01_color.png'}},
    {id: '02', duration_sec: 4.5, text: '第二幕', narration: '第二幕', visual: '屋内', assets: {text_image: null, bw: 'assets/02_bw.png', color: 'assets/02_color.png'}},
  ],
};
const manifest = {
  generator: 'codex-image2',
  text_mode: 'font',
  jobs: [
    {id: 'character_reference', role: 'reference', prompt: 'character', prompt_file: 'character.txt', output_master: resolve('D:/public/character.png'), references: []},
    {id: '01', role: 'scene', prompt: 'scene one', prompt_file: '01.txt', output_master: resolve('D:/public/01_master.png'), references: []},
    {id: '02', role: 'scene', prompt: 'scene two', prompt_file: '02.txt', output_master: resolve('D:/public/02_master.png'), references: []},
  ],
};

test('automatic director emits versioned sidecars and a safe explicit cast contract', () => {
  const continuity = createAutomaticContinuitySpec(storyboard, project);
  assert.deepEqual(continuity.scenes.map((scene) => scene.characters), [[], []]);
  const result = createDirectorArtifacts({project, storyboard, manifest, sourceText: '第一幕。第二幕。'});
  assert.equal(result.director.revision, 1);
  assert.match(result.continuityLedger.version, /^continuity-v1-/);
  assert.equal(result.manifest.jobs[1].scene_id, '01');
  assert.equal(result.manifest.jobs[2].continuity_refs[0], result.manifest.jobs[1].output_master);
  assert.match(result.manifest.jobs[1].prompt, /Never inherit a person's presence/);
});

test('scene revision changes only requested jobs and archives a new asset stem', () => {
  const base = createDirectorArtifacts({project, storyboard, manifest, sourceText: '第一幕。第二幕。'});
  const revised = prepareSceneRevision({
    director: base.director,
    storyboardPlan: storyboard,
    activeStoryboard: storyboard,
    manifest: base.manifest,
    continuitySpec: base.continuitySpec,
    continuityLedger: base.continuityLedger,
    sceneIds: ['02'],
    note: '让雨伞放在门边，人物神情更平静',
    replacementText: '第二幕，回到家。',
    promptDirectory: resolve('D:/project/prompts/revisions/r2'),
    currentAssetReferences: {'02': resolve('D:/public/02_color.png')},
  });
  assert.equal(revised.revision, 2);
  assert.deepEqual(revised.impact.impactedSceneIds, ['02']);
  assert.equal(revised.jobs.length, 1);
  assert.equal(revised.jobs[0].id, '02-r2');
  assert.equal(revised.jobs[0].continuity_version, revised.continuityLedger.version);
  assert.match(revised.jobs[0].output_master, /02-r2_master\.png$/);
  assert.equal(revised.storyboardPlan.scenes[0].assets.color, 'assets/01_color.png');
  assert.equal(revised.storyboardPlan.scenes[1].assets.color, 'assets/02-r2_color.png');
});

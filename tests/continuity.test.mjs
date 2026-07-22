import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {extname, resolve} from 'node:path';
import {
  CONTINUITY_SCHEMA_VERSION,
  ContinuityValidationError,
  buildContinuityLedger,
  computeContinuityImpact,
  createContinuityLedger,
  stableHash,
  stableStringify,
  validateContinuity,
} from '../scripts/lib/continuity.mjs';

const fixtureDirectory = resolve('tests/fixtures/regression-cases');
const fixtureFiles = readdirSync(fixtureDirectory)
  .filter((name) => name.endsWith('.json'))
  .sort();
const fixtures = new Map(fixtureFiles.map((name) => {
  const value = JSON.parse(readFileSync(resolve(fixtureDirectory, name), 'utf8'));
  return [value.case, value];
}));

const clone = (value) => JSON.parse(JSON.stringify(value));
const reverseObjectKeys = (value) => {
  if (Array.isArray(value)) return value.map(reverseObjectKeys);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).reverse().map((key) => [key, reverseObjectKeys(value[key])]));
};

test('regression fixture corpus covers exactly the ten required lightweight cases', () => {
  assert.deepEqual([...fixtures.keys()].sort(), [
    'children',
    'dialogue',
    'emotional',
    'landscape',
    'long-story',
    'mid-story-recovery',
    'page-flip',
    'science',
    'single-character',
    'uploaded-image',
  ]);
  assert.equal(fixtureFiles.length, 10);
  for (const name of readdirSync(fixtureDirectory)) {
    assert.ok(['.json', '.txt'].includes(extname(name)), `${name} must stay a lightweight text fixture`);
  }
});

test('all regression fixtures validate and compile to versioned ledgers', () => {
  for (const [caseName, fixture] of fixtures) {
    const validation = validateContinuity(fixture.input);
    assert.equal(validation.valid, true, `${caseName}: ${JSON.stringify(validation.issues)}`);
    const ledger = createContinuityLedger(fixture.input);
    assert.equal(ledger.kind, 'continuity-ledger');
    assert.equal(ledger.schemaVersion, CONTINUITY_SCHEMA_VERSION);
    assert.match(ledger.contentHash, /^[a-f0-9]{64}$/);
    assert.match(ledger.version, /^continuity-v1-[a-f0-9]{16}$/);
    assert.equal(ledger.scenes.length, fixture.expect.sceneCount);
    assert.equal(ledger.timeline.settings.length, fixture.expect.sceneCount);
    assert.equal(ledger.timeline.palettes.scenes.length, fixture.expect.sceneCount);
  }
});

test('the ledger records character, outfit, palette, prop, and setting timelines', () => {
  const ledger = buildContinuityLedger(fixtures.get('single-character').input);
  assert.deepEqual(ledger.scenes.map((scene) => scene.explicitCharacters), [['lin'], ['lin'], []]);
  assert.deepEqual(ledger.timeline.characters.lin, [
    {sceneId: '01', present: true},
    {sceneId: '02', present: true},
    {sceneId: '03', present: false},
  ]);
  assert.deepEqual(ledger.timeline.outfits.lin.map((entry) => entry.outfit), [
    {bottom: 'charcoal-trousers', top: 'cream-shirt'},
    {bottom: 'charcoal-trousers', top: 'cream-shirt'},
  ]);
  assert.deepEqual(ledger.timeline.palettes.characters.lin[1].palette, ['#E8DCC8', '#343434']);
  assert.deepEqual(ledger.timeline.props.notebook, [
    {sceneId: '01', present: false},
    {sceneId: '02', present: true},
    {sceneId: '03', present: false},
  ]);
  assert.deepEqual(ledger.timeline.settings.map(({sceneId, location, timeOfDay}) => ({sceneId, location, timeOfDay})), [
    {sceneId: '01', location: 'studio', timeOfDay: 'morning'},
    {sceneId: '02', location: 'studio', timeOfDay: 'morning'},
    {sceneId: '03', location: 'studio', timeOfDay: 'evening'},
  ]);
});

test('current-scene characters are mandatory and are never carried forward implicitly', () => {
  const emotional = fixtures.get('emotional').input;
  const ledger = createContinuityLedger(emotional);
  assert.deepEqual(ledger.scenes[1].explicitCharacters, []);
  assert.deepEqual(Object.keys(ledger.scenes[1].characters), []);

  const missing = clone(emotional);
  delete missing.scenes[1].characters;
  const validation = validateContinuity(missing);
  assert.equal(validation.valid, false);
  assert.ok(validation.issues.some(({code, sceneId}) => code === 'EXPLICIT_CHARACTERS_REQUIRED' && sceneId === '02'));
  assert.throws(() => createContinuityLedger(missing), (error) =>
    error instanceof ContinuityValidationError && error.code === 'ERR_CONTINUITY_VALIDATION');
});

test('characters and props cannot appear before their declared introduction scene', () => {
  const dialogue = clone(fixtures.get('dialogue').input);
  dialogue.scenes[0].characters.push('yu');
  const dialogueIssues = validateContinuity(dialogue).issues;
  assert.ok(dialogueIssues.some(({code, entityId, sceneId}) =>
    code === 'PREMATURE_CHARACTER' && entityId === 'yu' && sceneId === '01'));

  const children = clone(fixtures.get('children').input);
  children.scenes[0].props.push('kite');
  const propIssues = validateContinuity(children).issues;
  assert.ok(propIssues.some(({code, entityId, sceneId}) =>
    code === 'PREMATURE_PROP' && entityId === 'kite' && sceneId === '01'));
});

test('state and held props cannot smuggle absent entities into the current scene', () => {
  const input = clone(fixtures.get('single-character').input);
  input.scenes[2].characterStates = {lin: {outfit: 'hidden-change'}};
  input.scenes[1].props = [];
  const codes = validateContinuity(input).issues.map(({code}) => code);
  assert.ok(codes.includes('STATE_FOR_ABSENT_CHARACTER'));
  assert.ok(codes.includes('PROP_NOT_EXPLICIT'));
});

test('stable hashes and ledger versions ignore object key ordering without mutating input', () => {
  const input = fixtures.get('landscape').input;
  const snapshot = clone(input);
  const reordered = reverseObjectKeys(input);
  assert.equal(stableStringify(input), stableStringify(reordered));
  assert.equal(stableHash(input), stableHash(reordered));
  const first = createContinuityLedger(input);
  const second = createContinuityLedger(reordered);
  assert.equal(first.contentHash, second.contentHash);
  assert.equal(first.version, second.version);
  assert.deepEqual(input, snapshot);
});

test('a continuity change produces a new version while an identical ledger has no impact', () => {
  const original = fixtures.get('dialogue').input;
  const changed = clone(original);
  changed.scenes[1].characterStates = {yu: {outfit: 'ochre-raincoat'}};
  const first = createContinuityLedger(original);
  const second = createContinuityLedger(changed);
  assert.notEqual(first.version, second.version);
  assert.equal(computeContinuityImpact(first, first).changed, false);
  assert.deepEqual(computeContinuityImpact(first, first).impactedSceneIds, []);
});

test('mid-story edits invalidate inheritors and recover at an explicit state reset', () => {
  const fixture = fixtures.get('mid-story-recovery');
  const impact = computeContinuityImpact(fixture.input, fixture.modifiedInput);
  assert.equal(impact.changed, true);
  assert.deepEqual(impact.changedSceneIds, ['02']);
  assert.deepEqual(impact.impactedSceneIds, fixture.expect.impactedSceneIds);
  assert.deepEqual(impact.dependencyImpactedSceneIds, ['03']);
  assert.deepEqual(impact.unaffectedSceneIds, fixture.expect.unaffectedSceneIds);
  assert.equal(impact.firstImpactedIndex, 1);
  assert.equal(impact.regenerateFromSceneId, '02');
  assert.ok(impact.reasons['03'].some((reason) => reason.startsWith('depends-on:02:')));
});

test('manual narrative dependencies propagate changes across page-flip scenes', () => {
  const before = fixtures.get('page-flip').input;
  const after = clone(before);
  after.scenes[0].palette = ['#F0D07A'];
  const impact = computeContinuityImpact(before, after);
  assert.deepEqual(impact.changedSceneIds, ['01']);
  assert.deepEqual(impact.impactedSceneIds, ['01', '02', '03']);
  assert.deepEqual(impact.dependencyImpactedSceneIds, ['02', '03']);
});

test('definition changes invalidate only scenes that use the entity plus their dependents', () => {
  const before = fixtures.get('science').input;
  const after = clone(before);
  after.props.find(({id}) => id === 'microscope').palette = ['#233847'];
  const impact = computeContinuityImpact(before, after);
  assert.deepEqual(impact.changedSceneIds, []);
  assert.deepEqual(impact.changedPropIds, ['microscope']);
  assert.deepEqual(impact.impactedSceneIds, ['02', '03']);
  assert.deepEqual(impact.unaffectedSceneIds, ['01']);
});

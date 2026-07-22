import {createHash} from 'node:crypto';

export const CONTINUITY_SCHEMA_VERSION = 1;
export const CONTINUITY_HASH_ALGORITHM = 'sha256';

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

const jsonValue = (value, seen = new Set(), inArray = false) => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('continuity data must contain only finite numbers');
    return Object.is(value, -0) ? 0 : value;
  }
  if (value === undefined) return inArray ? null : undefined;
  if (typeof value !== 'object') {
    throw new TypeError(`continuity data cannot contain ${typeof value} values`);
  }
  if (seen.has(value)) throw new TypeError('continuity data cannot contain circular references');
  seen.add(value);
  let normalized;
  if (Array.isArray(value)) {
    normalized = value.map((item) => jsonValue(item, seen, true));
  } else {
    normalized = {};
    for (const key of Object.keys(value).sort()) {
      const child = jsonValue(value[key], seen, false);
      if (child !== undefined) normalized[key] = child;
    }
  }
  seen.delete(value);
  return normalized;
};

/** Stable JSON serialization: object key order is ignored, array order is preserved. */
export const stableStringify = (value) => JSON.stringify(jsonValue(value));

/** A portable, deterministic digest for JSON-compatible continuity data. */
export const stableHash = (value) =>
  createHash(CONTINUITY_HASH_ALGORITHM).update(stableStringify(value)).digest('hex');

const cloneJson = (value) => (value === undefined ? undefined : JSON.parse(stableStringify(value)));
const unique = (values) => [...new Set(values)];
const sortIds = (values) => [...values].sort((left, right) => left.localeCompare(right, 'en'));

const issue = (code, message, path, details = {}) => ({code, message, path, ...details});

export class ContinuityValidationError extends Error {
  constructor(issues) {
    super(`invalid continuity input (${issues.length} issue${issues.length === 1 ? '' : 's'})`);
    this.name = 'ContinuityValidationError';
    this.code = 'ERR_CONTINUITY_VALIDATION';
    this.issues = issues;
  }
}

const readExplicitCharacters = (scene) => {
  for (const key of ['characters', 'explicitCharacters', 'explicit_characters']) {
    if (hasOwn(scene, key)) return {key, value: scene[key]};
  }
  return {key: 'characters', value: undefined};
};

const readCharacterStates = (scene) =>
  scene.characterStates ?? scene.character_states ?? scene.characterState ?? {};

const readSettingValue = (setting, camelKey, snakeKey) =>
  hasOwn(setting, camelKey) ? setting[camelKey] : setting[snakeKey];

const validateId = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]+$/.test(value);

/**
 * Validate a continuity specification without mutating or compiling it.
 * Issues are structured so a CLI/UI can attach them to the relevant scene.
 */
export const validateContinuity = (input) => {
  const issues = [];
  if (!isRecord(input)) {
    return {
      valid: false,
      issues: [issue('INVALID_ROOT', 'continuity input must be an object', '$')],
    };
  }

  const schemaVersion = input.schemaVersion ?? input.schema_version ?? CONTINUITY_SCHEMA_VERSION;
  if (schemaVersion !== CONTINUITY_SCHEMA_VERSION) {
    issues.push(issue(
      'UNSUPPORTED_SCHEMA_VERSION',
      `schema version must be ${CONTINUITY_SCHEMA_VERSION}`,
      '$.schemaVersion',
    ));
  }

  const characters = input.characters;
  const props = input.props ?? [];
  const scenes = input.scenes;
  if (!Array.isArray(characters)) {
    issues.push(issue('INVALID_CHARACTERS', 'characters must be an array', '$.characters'));
  }
  if (!Array.isArray(props)) issues.push(issue('INVALID_PROPS', 'props must be an array', '$.props'));
  if (!Array.isArray(scenes) || scenes.length === 0) {
    issues.push(issue('INVALID_SCENES', 'scenes must be a non-empty array', '$.scenes'));
  }
  if (!Array.isArray(characters) || !Array.isArray(props) || !Array.isArray(scenes)) {
    return {valid: issues.length === 0, issues};
  }

  const sceneIndex = new Map();
  scenes.forEach((scene, index) => {
    const path = `$.scenes[${index}]`;
    if (!isRecord(scene)) {
      issues.push(issue('INVALID_SCENE', 'scene must be an object', path));
      return;
    }
    if (!validateId(scene.id)) {
      issues.push(issue('INVALID_SCENE_ID', 'scene id must use letters, numbers, underscores, or hyphens', `${path}.id`));
    } else if (sceneIndex.has(scene.id)) {
      issues.push(issue('DUPLICATE_SCENE_ID', `duplicate scene id: ${scene.id}`, `${path}.id`, {sceneId: scene.id}));
    } else {
      sceneIndex.set(scene.id, index);
    }
  });

  const validateDefinitions = (definitions, kind) => {
    const ids = new Map();
    definitions.forEach((definition, index) => {
      const path = `$.${kind}[${index}]`;
      if (!isRecord(definition)) {
        issues.push(issue(`INVALID_${kind.toUpperCase()}_DEFINITION`, `${kind} definition must be an object`, path));
        return;
      }
      if (!validateId(definition.id)) {
        issues.push(issue('INVALID_ENTITY_ID', `${kind} id must use letters, numbers, underscores, or hyphens`, `${path}.id`));
      } else if (ids.has(definition.id)) {
        issues.push(issue('DUPLICATE_ENTITY_ID', `duplicate ${kind} id: ${definition.id}`, `${path}.id`, {entityId: definition.id}));
      } else {
        ids.set(definition.id, definition);
      }
      const introducedIn = definition.introducedIn ?? definition.introduced_in;
      if (introducedIn !== undefined && !sceneIndex.has(introducedIn)) {
        issues.push(issue(
          'UNKNOWN_INTRODUCTION_SCENE',
          `${kind} ${definition.id || index} is introduced in unknown scene ${introducedIn}`,
          `${path}.introducedIn`,
          {entityId: definition.id, sceneId: introducedIn},
        ));
      }
    });
    return ids;
  };

  const characterById = validateDefinitions(characters, 'characters');
  const propById = validateDefinitions(props, 'props');

  for (const [propId, definition] of propById) {
    if (definition.owner !== undefined && !characterById.has(definition.owner)) {
      issues.push(issue(
        'UNKNOWN_PROP_OWNER',
        `prop ${propId} has unknown owner ${definition.owner}`,
        `$.props.${propId}.owner`,
        {entityId: propId},
      ));
    }
  }

  scenes.forEach((scene, index) => {
    if (!isRecord(scene)) return;
    const path = `$.scenes[${index}]`;
    const {key: characterKey, value: explicitCharacters} = readExplicitCharacters(scene);
    if (!Array.isArray(explicitCharacters)) {
      issues.push(issue(
        'EXPLICIT_CHARACTERS_REQUIRED',
        'every scene must explicitly declare its current characters (use [] for an empty scene)',
        `${path}.${characterKey}`,
        {sceneId: scene.id},
      ));
    } else {
      if (unique(explicitCharacters).length !== explicitCharacters.length) {
        issues.push(issue('DUPLICATE_SCENE_CHARACTER', 'scene characters must not contain duplicates', `${path}.${characterKey}`, {sceneId: scene.id}));
      }
      for (const characterId of explicitCharacters) {
        if (!characterById.has(characterId)) {
          issues.push(issue('UNKNOWN_CHARACTER', `scene references unknown character ${characterId}`, `${path}.${characterKey}`, {sceneId: scene.id, entityId: characterId}));
          continue;
        }
        const definition = characterById.get(characterId);
        const introducedIn = definition.introducedIn ?? definition.introduced_in;
        if (introducedIn !== undefined && sceneIndex.get(introducedIn) > index) {
          issues.push(issue(
            'PREMATURE_CHARACTER',
            `character ${characterId} cannot appear before ${introducedIn}`,
            `${path}.${characterKey}`,
            {sceneId: scene.id, entityId: characterId, introducedIn},
          ));
        }
      }
    }

    const characterStates = readCharacterStates(scene);
    if (!isRecord(characterStates)) {
      issues.push(issue('INVALID_CHARACTER_STATES', 'characterStates must be an object', `${path}.characterStates`, {sceneId: scene.id}));
    } else {
      for (const [characterId, state] of Object.entries(characterStates)) {
        if (!Array.isArray(explicitCharacters) || !explicitCharacters.includes(characterId)) {
          issues.push(issue(
            'STATE_FOR_ABSENT_CHARACTER',
            `character state for ${characterId} requires that character in the explicit current cast`,
            `${path}.characterStates.${characterId}`,
            {sceneId: scene.id, entityId: characterId},
          ));
        }
        if (!isRecord(state)) {
          issues.push(issue('INVALID_CHARACTER_STATE', `state for ${characterId} must be an object`, `${path}.characterStates.${characterId}`, {sceneId: scene.id, entityId: characterId}));
        }
      }
    }

    const visibleProps = scene.props ?? [];
    if (!Array.isArray(visibleProps)) {
      issues.push(issue('INVALID_SCENE_PROPS', 'scene props must be an array', `${path}.props`, {sceneId: scene.id}));
    } else {
      if (unique(visibleProps).length !== visibleProps.length) {
        issues.push(issue('DUPLICATE_SCENE_PROP', 'scene props must not contain duplicates', `${path}.props`, {sceneId: scene.id}));
      }
      for (const propId of visibleProps) {
        if (!propById.has(propId)) {
          issues.push(issue('UNKNOWN_PROP', `scene references unknown prop ${propId}`, `${path}.props`, {sceneId: scene.id, entityId: propId}));
          continue;
        }
        const definition = propById.get(propId);
        const introducedIn = definition.introducedIn ?? definition.introduced_in;
        if (introducedIn !== undefined && sceneIndex.get(introducedIn) > index) {
          issues.push(issue(
            'PREMATURE_PROP',
            `prop ${propId} cannot appear before ${introducedIn}`,
            `${path}.props`,
            {sceneId: scene.id, entityId: propId, introducedIn},
          ));
        }
      }
    }

    if (isRecord(characterStates)) {
      for (const [characterId, state] of Object.entries(characterStates)) {
        if (!isRecord(state) || state.props === undefined) continue;
        if (!Array.isArray(state.props)) {
          issues.push(issue('INVALID_CHARACTER_PROPS', `props for ${characterId} must be an array`, `${path}.characterStates.${characterId}.props`, {sceneId: scene.id, entityId: characterId}));
          continue;
        }
        for (const propId of state.props) {
          if (!Array.isArray(visibleProps) || !visibleProps.includes(propId)) {
            issues.push(issue(
              'PROP_NOT_EXPLICIT',
              `character prop ${propId} must also be listed in the scene props`,
              `${path}.characterStates.${characterId}.props`,
              {sceneId: scene.id, entityId: propId},
            ));
          }
        }
      }
    }

    const dependsOn = scene.dependsOn ?? scene.depends_on ?? [];
    if (!Array.isArray(dependsOn)) {
      issues.push(issue('INVALID_DEPENDENCIES', 'dependsOn must be an array', `${path}.dependsOn`, {sceneId: scene.id}));
    } else {
      for (const dependencyId of dependsOn) {
        const dependencyIndex = sceneIndex.get(dependencyId);
        if (dependencyIndex === undefined) {
          issues.push(issue('UNKNOWN_DEPENDENCY', `scene depends on unknown scene ${dependencyId}`, `${path}.dependsOn`, {sceneId: scene.id}));
        } else if (dependencyIndex >= index) {
          issues.push(issue('FORWARD_DEPENDENCY', `scene may depend only on an earlier scene (${dependencyId})`, `${path}.dependsOn`, {sceneId: scene.id}));
        }
      }
    }
  });

  return {valid: issues.length === 0, issues};
};

const addDependency = (dependencyMap, sourceSceneId, field) => {
  if (!sourceSceneId) return;
  const fields = dependencyMap.get(sourceSceneId) ?? new Set();
  fields.add(field);
  dependencyMap.set(sourceSceneId, fields);
};

const sortedDefinitions = (definitions) =>
  [...definitions].map(cloneJson).sort((left, right) => left.id.localeCompare(right.id, 'en'));

/**
 * Compile a JSON continuity specification into a deterministic, render-ready ledger.
 * Presence is never inherited: ledger.scenes[n].explicitCharacters is always sourced
 * from that exact scene. Outfit, palette, and setting values may inherit and record
 * their source scene as a dependency.
 */
export const createContinuityLedger = (input) => {
  const validation = validateContinuity(input);
  if (!validation.valid) throw new ContinuityValidationError(validation.issues);

  const source = cloneJson(input);
  const schemaVersion = source.schemaVersion ?? source.schema_version ?? CONTINUITY_SCHEMA_VERSION;
  const characters = sortedDefinitions(source.characters);
  const props = sortedDefinitions(source.props ?? []);
  const characterById = new Map(characters.map((entry) => [entry.id, entry]));
  const propById = new Map(props.map((entry) => [entry.id, entry]));
  const firstCharacterAppearance = new Map();
  const firstPropAppearance = new Map();
  for (const scene of source.scenes) {
    const explicitCharacters = readExplicitCharacters(scene).value;
    for (const id of explicitCharacters) {
      if (!firstCharacterAppearance.has(id)) firstCharacterAppearance.set(id, scene.id);
    }
    for (const id of scene.props ?? []) {
      if (!firstPropAppearance.has(id)) firstPropAppearance.set(id, scene.id);
    }
  }

  const characterState = new Map();
  const settingState = new Map();
  const compiledScenes = [];

  source.scenes.forEach((rawScene, index) => {
    const explicitCharacters = [...readExplicitCharacters(rawScene).value];
    const rawCharacterStates = readCharacterStates(rawScene);
    const dependencies = new Map();
    for (const sourceId of rawScene.dependsOn ?? rawScene.depends_on ?? []) {
      addDependency(dependencies, sourceId, '$manual');
    }

    const resolvedCharacters = {};
    for (const characterId of explicitCharacters) {
      const definition = characterById.get(characterId);
      const override = rawCharacterStates[characterId] ?? {};
      const prior = characterState.get(characterId);

      let outfit;
      let outfitSource = null;
      if (hasOwn(override, 'outfit')) {
        outfit = cloneJson(override.outfit);
        outfitSource = rawScene.id;
      } else if (prior?.outfit !== undefined) {
        outfit = cloneJson(prior.outfit);
        outfitSource = prior.outfitSource;
        addDependency(dependencies, outfitSource, `characters.${characterId}.outfit`);
      } else {
        outfit = cloneJson(definition.defaultOutfit ?? definition.default_outfit ?? definition.outfit ?? null);
      }

      let palette;
      let paletteSource = null;
      if (hasOwn(override, 'palette')) {
        palette = cloneJson(override.palette);
        paletteSource = rawScene.id;
      } else if (prior?.palette !== undefined) {
        palette = cloneJson(prior.palette);
        paletteSource = prior.paletteSource;
        addDependency(dependencies, paletteSource, `characters.${characterId}.palette`);
      } else {
        palette = cloneJson(definition.palette ?? []);
      }

      characterState.set(characterId, {outfit, outfitSource, palette, paletteSource});
      resolvedCharacters[characterId] = {
        appearance: cloneJson(definition.appearance ?? null),
        outfit,
        palette,
        props: [...(override.props ?? [])],
      };
    }

    const rawSetting = isRecord(rawScene.setting) ? rawScene.setting : {};
    const setting = {};
    for (const [camelKey, snakeKey] of [['location', 'location'], ['timeOfDay', 'time_of_day'], ['palette', 'palette']]) {
      const explicit = hasOwn(rawSetting, camelKey) || hasOwn(rawSetting, snakeKey);
      if (explicit) {
        const value = cloneJson(readSettingValue(rawSetting, camelKey, snakeKey));
        setting[camelKey] = value;
        settingState.set(camelKey, {value, sourceSceneId: rawScene.id});
      } else if (settingState.has(camelKey)) {
        const prior = settingState.get(camelKey);
        setting[camelKey] = cloneJson(prior.value);
        addDependency(dependencies, prior.sourceSceneId, `setting.${camelKey}`);
      } else {
        setting[camelKey] = camelKey === 'palette' ? [] : null;
      }
    }

    const visibleProps = [...(rawScene.props ?? [])];
    const scenePalette = hasOwn(rawScene, 'palette')
      ? cloneJson(rawScene.palette)
      : cloneJson(setting.palette);
    const dependencyList = [...dependencies.entries()]
      .map(([sceneId, fields]) => ({sceneId, fields: [...fields].sort()}))
      .sort((left, right) => left.sceneId.localeCompare(right.sceneId, 'en'));
    const resolved = {
      explicitCharacters,
      characters: resolvedCharacters,
      props: visibleProps.map((id) => ({id, definition: cloneJson(propById.get(id))})),
      setting,
      palette: scenePalette,
    };
    compiledScenes.push({
      id: rawScene.id,
      index,
      explicitCharacters,
      characters: resolvedCharacters,
      props: visibleProps,
      setting,
      palette: scenePalette,
      dependencies: dependencyList,
      rawHash: stableHash(rawScene),
      resolvedHash: stableHash(resolved),
    });
  });

  const characterTimeline = {};
  const outfitTimeline = {};
  const characterPaletteTimeline = {};
  for (const character of characters) {
    characterTimeline[character.id] = compiledScenes.map((scene) => ({
      sceneId: scene.id,
      present: scene.explicitCharacters.includes(character.id),
    }));
    outfitTimeline[character.id] = compiledScenes
      .filter((scene) => scene.explicitCharacters.includes(character.id))
      .map((scene) => ({sceneId: scene.id, outfit: cloneJson(scene.characters[character.id].outfit)}));
    characterPaletteTimeline[character.id] = compiledScenes
      .filter((scene) => scene.explicitCharacters.includes(character.id))
      .map((scene) => ({sceneId: scene.id, palette: cloneJson(scene.characters[character.id].palette)}));
  }

  const propTimeline = {};
  for (const prop of props) {
    propTimeline[prop.id] = compiledScenes.map((scene) => ({
      sceneId: scene.id,
      present: scene.props.includes(prop.id),
    }));
  }

  const normalizedCharacters = characters.map((character) => ({
    ...character,
    introducedIn: character.introducedIn ?? character.introduced_in ?? firstCharacterAppearance.get(character.id) ?? null,
  }));
  const normalizedProps = props.map((prop) => ({
    ...prop,
    introducedIn: prop.introducedIn ?? prop.introduced_in ?? firstPropAppearance.get(prop.id) ?? null,
  }));
  const content = {
    kind: 'continuity-ledger',
    schemaVersion,
    characters: normalizedCharacters,
    props: normalizedProps,
    scenes: compiledScenes,
    timeline: {
      characters: characterTimeline,
      outfits: outfitTimeline,
      palettes: {
        characters: characterPaletteTimeline,
        scenes: compiledScenes.map((scene) => ({sceneId: scene.id, palette: cloneJson(scene.palette)})),
      },
      props: propTimeline,
      settings: compiledScenes.map((scene) => ({sceneId: scene.id, ...cloneJson(scene.setting)})),
    },
  };
  const contentHash = stableHash(content);
  return {
    ...content,
    hashAlgorithm: CONTINUITY_HASH_ALGORITHM,
    contentHash,
    version: `continuity-v${schemaVersion}-${contentHash.slice(0, 16)}`,
  };
};

export const buildContinuityLedger = createContinuityLedger;

const asLedger = (value) =>
  value?.kind === 'continuity-ledger' ? value : createContinuityLedger(value);

const changedDefinitionIds = (previous, next) => {
  const previousMap = new Map(previous.map((entry) => [entry.id, stableHash(entry)]));
  const nextMap = new Map(next.map((entry) => [entry.id, stableHash(entry)]));
  return sortIds(unique([...previousMap.keys(), ...nextMap.keys()]).filter(
    (id) => previousMap.get(id) !== nextMap.get(id),
  ));
};

const addDependents = (ledgers, seedIds, impacted, reasons) => {
  const dependents = new Map();
  for (const ledger of ledgers) {
    for (const scene of ledger.scenes) {
      for (const dependency of scene.dependencies) {
        const values = dependents.get(dependency.sceneId) ?? [];
        values.push({sceneId: scene.id, fields: dependency.fields});
        dependents.set(dependency.sceneId, values);
      }
    }
  }
  const queue = [...seedIds];
  while (queue.length > 0) {
    const sourceId = queue.shift();
    for (const dependent of dependents.get(sourceId) ?? []) {
      const reasonSet = reasons.get(dependent.sceneId) ?? new Set();
      reasonSet.add(`depends-on:${sourceId}:${dependent.fields.join(',')}`);
      reasons.set(dependent.sceneId, reasonSet);
      if (impacted.has(dependent.sceneId)) continue;
      impacted.add(dependent.sceneId);
      queue.push(dependent.sceneId);
    }
  }
};

/**
 * Compare two ledgers/specifications and return the minimal dependency-aware scene set
 * that should be regenerated. Removed scene ids are reported but excluded from the
 * next-ledger regeneration order.
 */
export const computeContinuityImpact = (previousValue, nextValue) => {
  const previous = asLedger(previousValue);
  const next = asLedger(nextValue);
  const previousScenes = new Map(previous.scenes.map((scene) => [scene.id, scene]));
  const nextScenes = new Map(next.scenes.map((scene) => [scene.id, scene]));
  const allSceneIds = unique([...previousScenes.keys(), ...nextScenes.keys()]);
  const changedSceneIds = allSceneIds.filter((id) => {
    const oldScene = previousScenes.get(id);
    const newScene = nextScenes.get(id);
    return oldScene?.rawHash !== newScene?.rawHash || oldScene?.index !== newScene?.index;
  });
  const removedSceneIds = changedSceneIds.filter((id) => !nextScenes.has(id));
  const addedSceneIds = changedSceneIds.filter((id) => !previousScenes.has(id));
  const changedCharacterIds = changedDefinitionIds(previous.characters, next.characters);
  const changedPropIds = changedDefinitionIds(previous.props, next.props);
  const impacted = new Set(changedSceneIds);
  const reasons = new Map();
  for (const id of changedSceneIds) reasons.set(id, new Set(['scene-changed']));

  for (const scene of next.scenes) {
    const oldScene = previousScenes.get(scene.id);
    if (oldScene && oldScene.resolvedHash !== scene.resolvedHash) {
      impacted.add(scene.id);
      const reasonSet = reasons.get(scene.id) ?? new Set();
      reasonSet.add('resolved-continuity-changed');
      reasons.set(scene.id, reasonSet);
    }
    for (const characterId of changedCharacterIds) {
      if (scene.explicitCharacters.includes(characterId)) {
        impacted.add(scene.id);
        const reasonSet = reasons.get(scene.id) ?? new Set();
        reasonSet.add(`character-definition:${characterId}`);
        reasons.set(scene.id, reasonSet);
      }
    }
    for (const propId of changedPropIds) {
      if (scene.props.includes(propId)) {
        impacted.add(scene.id);
        const reasonSet = reasons.get(scene.id) ?? new Set();
        reasonSet.add(`prop-definition:${propId}`);
        reasons.set(scene.id, reasonSet);
      }
    }
  }

  const seedIds = [...impacted];
  addDependents([previous, next], seedIds, impacted, reasons);

  const nextOrder = next.scenes.map((scene) => scene.id);
  const impactedSceneIds = nextOrder.filter((id) => impacted.has(id));
  const dependencyImpactedSceneIds = impactedSceneIds.filter((id) => !changedSceneIds.includes(id));
  const unaffectedSceneIds = nextOrder.filter((id) => !impacted.has(id));
  const firstImpactedIndex = impactedSceneIds.length === 0
    ? null
    : Math.min(...impactedSceneIds.map((id) => nextScenes.get(id).index));

  return {
    changed: previous.contentHash !== next.contentHash,
    previousVersion: previous.version,
    nextVersion: next.version,
    changedSceneIds,
    addedSceneIds,
    removedSceneIds,
    changedCharacterIds,
    changedPropIds,
    impactedSceneIds,
    dependencyImpactedSceneIds,
    unaffectedSceneIds,
    firstImpactedIndex,
    regenerateFromSceneId: firstImpactedIndex === null ? null : next.scenes[firstImpactedIndex].id,
    reasons: Object.fromEntries(
      impactedSceneIds.map((id) => [id, [...(reasons.get(id) ?? [])].sort()]),
    ),
  };
};

export const calculateContinuityImpact = computeContinuityImpact;

export const parseArgs = (tokens, {repeatable = []} = {}) => {
  const repeated = new Set(repeatable);
  const parsed = {_: []};

  const assign = (key, value) => {
    if (repeated.has(key)) {
      parsed[key] = [...(parsed[key] || []), value];
      return;
    }
    parsed[key] = value;
  };

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === '--') {
      parsed._.push(...tokens.slice(index + 1));
      break;
    }
    if (!token.startsWith('--')) {
      parsed._.push(token);
      continue;
    }

    const equalAt = token.indexOf('=');
    if (equalAt > 2) {
      assign(token.slice(2, equalAt), token.slice(equalAt + 1));
      continue;
    }

    const rawKey = token.slice(2);
    if (rawKey.startsWith('no-')) {
      assign(rawKey.slice(3), false);
      continue;
    }
    const next = tokens[index + 1];
    if (next !== undefined && !next.startsWith('--')) {
      assign(rawKey, next);
      index += 1;
    } else {
      assign(rawKey, true);
    }
  }

  return parsed;
};

export const stringArg = (args, key, fallback = undefined) => {
  const value = args[key];
  if (value === undefined || value === null || value === true || value === false) {
    return fallback;
  }
  return String(value);
};

export const numberArg = (args, key, fallback = undefined) => {
  const value = stringArg(args, key);
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`--${key} must be a number`);
  return parsed;
};


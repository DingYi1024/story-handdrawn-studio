export const terminalPunctuation = /[。！？!?；;]$/;
const narrativeTurn = /^(后来|然后|接着|突然|可是|但是|但|却|于是|直到|最后|没想到|第二天|那天|这时)/;

export const hardChunk = (value, maxLength = 36) => {
  const chunks = [];
  let remaining = value.trim();
  while (remaining.length > maxLength) {
    const window = remaining.slice(0, maxLength + 1);
    let cut = Math.max(
      window.lastIndexOf('，'),
      window.lastIndexOf('、'),
      window.lastIndexOf('；'),
    );
    if (cut < Math.floor(maxLength * 0.55)) cut = maxLength;
    else cut += 1;
    chunks.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
};

export const splitLongBeat = (sentence, softLimit = 36) => {
  const value = sentence.trim();
  if (value.length <= softLimit) return [value];
  const ending = value.match(/[。！？!?；;]$/)?.[0] || '';
  const body = ending ? value.slice(0, -1) : value;
  const clauses = body
    .split(/(?<=，|、)|(?=(?:后来|然后|接着|突然|可是|但是|但|却|于是|直到|最后|没想到|第二天|那天|这时))/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (clauses.length === 1) return hardChunk(value, softLimit);

  const beats = [];
  let current = '';
  for (const clause of clauses) {
    const candidate = `${current}${clause}`;
    const startsNewBeat = narrativeTurn.test(clause) && current.length >= 12;
    if (current && (candidate.length > softLimit || startsNewBeat)) {
      beats.push(current.replace(/[，、]$/, '。'));
      current = clause;
    } else {
      current = candidate;
    }
  }
  if (current) beats.push(`${current.replace(/[，、]$/, '')}${ending || '。'}`);
  return beats.flatMap((beat) => hardChunk(beat, softLimit));
};

export const splitStory = (text, {softLimit = 36} = {}) => {
  const normalized = text.replace(/\r/g, '').replace(/[ \t]+/g, ' ').trim();
  const paragraphs = normalized.split(/\n+/).map((part) => part.trim()).filter(Boolean);
  const beats = [];
  for (const paragraph of paragraphs) {
    const sentences = paragraph.match(/[^。！？!?；;]+[。！？!?；;]?/g) || [];
    for (const sentence of sentences) beats.push(...splitLongBeat(sentence, softLimit));
  }
  return beats
    .map((beat) => beat.trim())
    .filter(Boolean)
    .map((beat) => (terminalPunctuation.test(beat) ? beat : `${beat}。`));
};

export const formatCaption = (
  text,
  {maxCharsPerLine = 13, maxLines = 3} = {},
) => {
  const lines = [];
  let remaining = text.trim();
  while (remaining) {
    if (remaining.length <= maxCharsPerLine) {
      lines.push(remaining);
      break;
    }
    const window = remaining.slice(0, maxCharsPerLine + 1);
    let cut = Math.max(
      window.lastIndexOf('，'),
      window.lastIndexOf('、'),
      window.lastIndexOf('；'),
      window.lastIndexOf('：'),
    );
    if (cut < Math.floor(maxCharsPerLine * 0.45)) cut = maxCharsPerLine;
    else cut += 1;
    lines.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
    if (/^[。！？!?；;：:,，、]/.test(remaining)) {
      lines[lines.length - 1] += remaining[0];
      remaining = remaining.slice(1).trim();
    }
  }
  if (lines.length > maxLines) {
    throw new Error(
      `Caption needs ${lines.length} lines; story beat must be split before rendering`,
    );
  }
  return lines.join('\n');
};

export const durationFor = (caption, timing = {}) => {
  const {
    minimumSceneSeconds = 4.4,
    maximumSceneSeconds = 6.2,
    baseSeconds = 3.8,
    secondsPerLine = 0.48,
    secondsPerCharacter = 0.035,
    readingCharactersPerSecond = null,
    readingTailSeconds = 0.6,
  } = timing;
  const lineCount = caption.split('\n').length;
  const characterCount = [...caption.replace(/\n/g, '')].length;
  const layoutDuration =
    baseSeconds + lineCount * secondsPerLine + characterCount * secondsPerCharacter;
  const readingDuration = readingCharactersPerSecond
    ? characterCount / readingCharactersPerSecond + readingTailSeconds
    : 0;
  return Number(
    Math.min(
      maximumSceneSeconds,
      Math.max(minimumSceneSeconds, layoutDuration, readingDuration),
    ).toFixed(1),
  );
};

export const safeSlug = (value, fallback = 'project') =>
  value
    .normalize('NFKC')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || fallback;


import test from 'node:test';
import assert from 'node:assert/strict';
import {durationFor, formatCaption, safeSlug, splitStory} from '../scripts/lib/story-text.mjs';

test('splitStory preserves punctuation and narrative order', () => {
  const beats = splitStory('第一句话。后来他走进房间，但是没有开灯。');
  assert.equal(beats[0], '第一句话。');
  assert.ok(beats.join('').includes('后来他走进房间'));
  assert.ok(beats.every((beat) => /[。！？!?；;]$/.test(beat)));
});

test('formatCaption respects configured line capacity', () => {
  const caption = formatCaption('这是一段需要自动换行的中文故事字幕。', {
    maxCharsPerLine: 8,
    maxLines: 3,
  });
  assert.ok(caption.split('\n').length <= 3);
  assert.throws(
    () => formatCaption('一二三四五六七八九十一二三四五六七八九十', {maxCharsPerLine: 4, maxLines: 2}),
    /Caption needs/,
  );
});

test('durationFor can account for reading speed', () => {
  const fast = durationFor('一二三四五六七八九十', {maximumSceneSeconds: 12});
  const readable = durationFor('一二三四五六七八九十', {
    maximumSceneSeconds: 12,
    readingCharactersPerSecond: 2,
    readingTailSeconds: 1,
  });
  assert.ok(readable > fast);
});

test('safeSlug removes path and punctuation characters', () => {
  assert.equal(safeSlug(' ../纸上的夏天/ '), '纸上的夏天');
});


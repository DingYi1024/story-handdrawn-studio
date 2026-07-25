import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {PRESETS} from '../scripts/lib/presets.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const studio = resolve(root, 'scripts', 'studio.mjs');
const story = [
  '清晨，女孩在旧车站捡到一本没有名字的画册。',
  '第一页画着她小时候住过的院子。',
  '第二页出现一只戴红围巾的小狗。',
  '她沿着画里的街道继续往前走。',
  '雨落下来，画纸上的河流也开始发亮。',
  '她想起多年没有见过的外婆。',
  '画册最后只剩下一张空白页。',
  '她把今天的自己画在了那张纸上。',
  '傍晚，小狗把她带到一扇熟悉的木门前。',
  '门打开时，院子里的桂花正好落下来。',
  '外婆没有问她为什么这么久才回来。',
  '她们只是坐下，把这一天慢慢画完。',
].join('');

const runJson = (args, cwd) => {
  const result = spawnSync(process.execPath, [studio, ...args, '--json'], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
  assert.equal(result.status, 0, result.stderr);
  const jsonStart = result.stdout.indexOf('{');
  assert.notEqual(jsonStart, -1, result.stdout);
  return JSON.parse(result.stdout.slice(jsonStart));
};

test('production planning matrix covers every ratio and remains resumable at image boundaries', () => {
  const sandbox = mkdtempSync(resolve(tmpdir(), 'story-acceptance-matrix-'));
  try {
    for (const preset of ['portrait', 'vertical', 'square', 'landscape']) {
      const id = `accept-${preset}`;
      const planned = runJson([
        'produce',
        '--id', id,
        '--title', `${preset} 验收`,
        '--text', story,
        '--preset', preset,
        '--to', 'plan',
        '--data-root', sandbox,
      ], sandbox);
      assert.equal(planned.id, id);
      assert.equal(planned.state.status, 'awaiting_assets');

      const projectRoot = resolve(sandbox, 'projects', id);
      const storyboard = JSON.parse(readFileSync(resolve(projectRoot, 'storyboard.generated.json'), 'utf8'));
      const manifestBefore = readFileSync(resolve(projectRoot, 'codex-image-jobs.json'), 'utf8');
      assert.equal(storyboard.project.width, PRESETS[preset].width);
      assert.equal(storyboard.project.height, PRESETS[preset].height);
      assert.ok(storyboard.scenes.length >= 8);
      assert.ok(storyboard.scenes.every((scene) =>
        scene.layers[0] === 'bw_full'
        && scene.layers[1] === 'text'
        && scene.layers.at(-1) === 'color'));

      const waiting = runJson([
        'produce',
        '--project', id,
        '--to', 'final',
        '--data-root', sandbox,
      ], sandbox);
      assert.equal(waiting.status, 'awaiting_assets');
      assert.equal(waiting.action_required, 'generate_images');
      assert.ok(waiting.jobs.length >= storyboard.scenes.length);
      assert.equal(
        readFileSync(resolve(projectRoot, 'codex-image-jobs.json'), 'utf8'),
        manifestBefore,
      );
    }
  } finally {
    rmSync(sandbox, {recursive: true, force: true});
  }
});

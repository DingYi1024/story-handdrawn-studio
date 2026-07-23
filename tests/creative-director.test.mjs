import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyCreativeDirectionToStoryboard,
  applyThemeToSettings,
  createSceneShots,
  createStyleBakeoffPlan,
  recommendNarrativeArc,
  recommendTheme,
  rewritePromptStyle,
  themeStyleLock,
} from '../scripts/lib/creative-director.mjs';

const base = {
  project: {title: '会发芽的纸条'},
  scenes: [
    {id: '01', duration_sec: 7, text: '雨夜捡到纸条。', visual: '雨夜公交站', shot: 'story_beat'},
    {id: '02', duration_sec: 7, text: '种子终于发芽。', visual: '阳台嫩芽和太阳', shot: 'story_beat'},
  ],
};

test('creative director recommends an arc and original hand-drawn theme', () => {
  assert.equal(recommendNarrativeArc({sourceText: '她坚持照料，种子终于发芽。'}), 'growth_arc');
  assert.equal(recommendTheme({sourceText: '雨夜的公交站'}), 'rainy-ink');
});

test('theme selection changes the actual generation style and palette', () => {
  const settings = applyThemeToSettings({director: {}, visual: {}}, 'rainy-ink', 'growth_arc');
  assert.equal(settings.director.theme, 'rainy-ink');
  assert.equal(settings.director.arc, 'growth_arc');
  assert.deepEqual(settings.visual.palette, ['ink black', 'rain blue', 'cool grey', 'one warm window yellow']);
  assert.match(settings.visual.style_lock, /wet ink/);
  assert.match(themeStyleLock('rainy-ink'), /no generated text/);
});

test('approved theme replaces the original prompt style instead of conflicting with it', () => {
  const prompt = 'Scene: rain.\nStyle: stale pencil look\n\nCreative Director theme: stale ink.\nConstraints: no text.';
  const rewritten = rewritePromptStyle(prompt, 'child-crayon');
  assert.equal((rewritten.match(/^Style:/gm) || []).length, 1);
  assert.doesNotMatch(rewritten, /stale pencil|Creative Director theme/);
  assert.match(rewritten, /naive thick crayon outlines/);
  assert.match(rewritten, /Constraints: no text/);
});

test('creative direction adds backward-compatible multi-shot plans', () => {
  const directed = applyCreativeDirectionToStoryboard(base, {sourceText: '她坚持照料，种子终于发芽。'});
  assert.equal(directed.schema_version, 4);
  assert.equal(directed.project.director.arc, 'growth_arc');
  assert.equal(directed.scenes[0].shots.length, 2);
  assert.notEqual(directed.scenes[0].shots[0].camera_move, directed.scenes[0].shots[1].camera_move);
  assert.ok(directed.scenes[0].shots[0].element_motion.includes('rain'));
});

test('short scenes keep one shot and style bake-off preserves scene meaning', () => {
  assert.equal(createSceneShots({...base.scenes[0], duration_sec: 4.5}, 0, 2).length, 1);
  const plan = createStyleBakeoffPlan({projectId: 'note', title: '纸条', sourceText: '雨夜', scene: base.scenes[0], outputDirectory: 'style-bakeoff'});
  assert.equal(plan.jobs.length, 4);
  assert.equal(new Set(plan.jobs.map((job) => job.id)).size, 4);
  assert.ok(plan.jobs.every((job) => job.prompt.includes('雨夜公交站')));
});

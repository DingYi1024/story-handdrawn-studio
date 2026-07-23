# Creative Director Reference

Read this file when choosing story structure, visual style, multi-shot rhythm, or local motion.

## Director flow

1. Let `plan` recommend a narrative arc and hand-drawn theme from the title and source.
2. Inspect `director.generated.json`. Keep automatic choices unless the work has a clear commercial or structural requirement.
3. For a high-cost or style-sensitive work, run a style bake-off before generating every scene.
4. Approve a theme, then generate masters and continue the normal production loop.

```bash
python <SKILL_DIR>/scripts/run_story_video.py director --project PROJECT --action list
python <SKILL_DIR>/scripts/run_story_video.py director --project PROJECT --action styles
python <SKILL_DIR>/scripts/run_story_video.py director --project PROJECT --action choose --theme warm-diary
python <SKILL_DIR>/scripts/run_story_video.py director --project PROJECT --action plan --force
```

`styles` writes four controlled prompts and exact output paths to `style-bakeoff.json`. Generate each candidate with the same representative scene. Do not compare candidates that change story meaning or composition.

## Original narrative arcs

- `warm_story`: diary, memory, healing, human-scale stories.
- `suspense_reveal`: discovery, secrets, reversals.
- `growth_arc`: difficulty, action, change, earned resolution.
- `knowledge_explainer`: question, mechanism, example, conclusion.
- `brand_story`: person, problem, value, action.
- `loop_short`: compact 15–30 second story with a returning ending.

## Hand-drawn themes

- `warm-diary`: restrained wax-crayon colour and uneven felt-tip lines.
- `rainy-ink`: wet ink, rain blue, grey, one warm light.
- `child-crayon`: thick playful crayon and bright primary accents.
- `woodcut-story`: carved black marks, paper cream, muted vermilion.
- `science-notebook`: diagrams, graphite, marker fills, arrows and labels.

Keep theme names and prompt language original to this project. Never retain another repository's name, brand, watermark, or house-style claim.

## Multi-shot contract

`scene.shots[]` is optional and backward compatible. Long generated scenes normally receive two shots: an establishing view followed by a detail or payoff view. Captions and the black-and-white → text → colour reveal remain scene-level.

Safe camera moves: `static`, `push_in`, `pull_out`, `pan_left`, `pan_right`, `tilt_up`, `tilt_down`, `parallax`.

Local element effects: `rain`, `petals`, `sparkle`, `paper-float`, `ink-breathe`, `handheld-drift`.

Use different adjacent camera moves. Keep text outside the moving artwork transform. Prefer local deterministic motion; use generated video only when explicitly requested and justified by budget and continuity risk.

## Approval policy

- Automatic production: recommendations and shots may proceed without pausing.
- Style-sensitive work: prepare the bake-off and ask the user to select by eye.
- Never silently change aspect ratio, story meaning, cast, or selected visual identity.
- After multi-shot rendering, require motion-cut samples as well as scene-transition samples to contain visible artwork.

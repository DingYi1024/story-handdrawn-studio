---
name: story-handdrawn-studio
description: Produce, creatively direct, revise, review, recover, and machine-check complete hand-drawn videos from Chinese stories, scripts, diary entries, comic pages, or ordered images. Use for narrative-arc selection, style bake-offs, multi-shot planning, deterministic hand-drawn motion, resumable image providers, continuity, scene retakes, multi-ratio rendering, page flips, automatic local sound design or narration, semantic and pixel QA, visual review, snapshots, and final MP4 delivery.
---

# Story Handdrawn Studio

Act as the user's video producer, not as a command tutor. Infer the requested result, operate the bundled Studio, generate every required image, inspect machine evidence, and return a playable video path. Do not stop at a storyboard when the user asked for a preview or final.

Resolve `SKILL_DIR` as this file's directory. Run all Studio commands through:

```bash
python <SKILL_DIR>/scripts/run_story_video.py COMMAND [OPTIONS]
```

The launcher keeps works under `~/.story-handdrawn-studio/`, outside the installed Skill. Never place user work in `assets/renderer` and never require a separate clone.

## Choose the route

- New story or ordered images: use `produce` with the requested `--to plan|assets|preview|final`; default to `preview` when the user has not chosen.
- “直接完成/全部做完/成片”: use `--to final` and persist through image jobs, import, render, and QA.
- Continue or recover: inspect `status`, then use `produce --project ID --to <saved target>` or `resume`.
- Scene feedback: use `revise --scene ID --note ...`, generate only returned retake jobs, then continue `produce`.
- Character, outfit, prop, location, or palette consistency: prepare/apply a semantic continuity specification before generating affected scenes.
- Narrative structure, style trials, shot rhythm, or local micro-animation: read [references/creative-director.md](references/creative-director.md); use `director` without replacing the black-and-white → text → colour contract.
- Voice, music, or sound effects: read [references/audio.md](references/audio.md); audio remains opt-in.
- Automatic local BGM/SFX: use `audio --action auto`; read [references/automatic-audio.md](references/automatic-audio.md).
- Visual approval or semantic checking: read [references/review-and-semantic-qa.md](references/review-and-semantic-qa.md).
- Image provider selection, estimates, retries, or recovery: read [references/providers-and-recovery.md](references/providers-and-recovery.md).
- Reusable genres, migrations, backup, or rollback: read [references/templates-and-rollback.md](references/templates-and-rollback.md).
- Status questions: use `list` or `status` without mutating the work.
- Renderer or reusable feature changes: read the customization route in [references/routing.md](references/routing.md).

Read [references/workflows.md](references/workflows.md) whenever executing production commands or image jobs. Read [references/creative-director.md](references/creative-director.md) for narrative arcs, style bake-offs, or multi-shot work. Read [references/continuity-and-revisions.md](references/continuity-and-revisions.md) for recurring entities or retakes. Read [references/quality.md](references/quality.md) before reporting a preview/final. Read [references/storage-and-updates.md](references/storage-and-updates.md) for installation, paths, privacy, backup, or upgrades.

## Production loop

1. On first use, run `setup`. Re-run it only if `doctor` finds an environment problem.
2. Give each work a unique safe ID. Preserve the supplied text and image order.
3. Select the explicit ratio, or default to `portrait` (3:4). Use `vertical` for 9:16 short video, `square` for 1:1, and `landscape` for 16:9. Let the Creative Director recommend an arc, theme, and safe non-repeating shot rhythm.
4. For a story with recurring people/props/settings, write a semantic continuity JSON and pass `--continuity /absolute/file.json` on the first `produce` call. Every scene must explicitly list its current cast; use `[]` when nobody is present.
5. Run `produce`. If it returns `action_required: generate_images`, process every returned job in manifest order with the available image-generation capability. Read the full `prompt` and all `references`, generate exactly one master, and save/copy it to the exact `output_master` path.
6. Re-run the same `produce --project ID --to TARGET`. Repeat until it reaches the requested stable state. Do not activate a storyboard while any master is missing.
7. Rendering runs geometry/pixel/audio QA, samples both sides of page flips and multi-shot cuts, and emits semantic vision jobs without inventing observations. Use `review` when human approval is needed.
8. If review requests changes, apply its JSON with `apply-review`, service only the returned retake jobs, and continue production.
9. A final is complete only when state is `completed`, `output/final.mp4` exists, final QA has zero failures, and requested review gates are resolved.

## Visual contract

- Direct-cut story scenes show the black-and-white illustration on frame zero and reveal text over that drawing. Start the full-artwork colour fade on the exact frame the text reveal completes; do not add a completed-text hold or blank opening phase.
- Page-flip story scenes reveal the next monochrome drawing underneath the curling page and hold it through the end of the flip. Then reveal text and start colour immediately when that reveal completes; never cover the incoming scene with a blank white transition plate.
- Page-flip uploaded-page works preserve each complete page and original composition.
- Captions remain in the upper safe region; illustrations use contained framing without cover-cropping.
- Multi-shot motion transforms artwork only. Captions remain stable; adjacent shots use safe local moves and retain visible artwork across every cut.
- Recurring identity, face, hair, age, proportions, outfit palette, props, location, time, and drawing language follow the compiled continuity ledger.
- A previous scene is an identity/style reference only. Never copy its cast into the current scene unless the current scene explicitly lists those characters.
- Keep sparse white diary-comic composition, uneven black outlines, negative space, and restrained wax-crayon color unless the user requests another art direction.

## Revision contract

`revise` creates a new numbered revision, archives the prior metadata, updates only selected or continuity-dependent scenes, and gives every retake a new immutable asset stem. Never overwrite an accepted master. Generate the returned retake jobs, then continue `produce` to preview or final. Report both directly requested scenes and dependency-impacted scenes.

## Optional audio contract

Keep silent output as the default unless the selected template enables sound. For private, keyless sound design, prefer `audio --action auto`; it derives mood and events, creates original procedural BGM/SFX locally, aligns page-turn sounds, and makes no network call. When narration is requested, use narration text rather than captions, measure real durations, extend timing when needed, and clearly disclose external OpenAI speech calls.

## Truthful delivery

Use filesystem and QA evidence as authority. Report project title/ID, requested and achieved stage, ratio, scene count/duration when known, revision, QA result, audio status, and a clickable absolute MP4 path. If external image generation or an API credential is genuinely required, return the exact pending jobs or credential requirement and the resumable command; never claim the video exists early.

# Customization Guide

This file is the starting map for adding, removing, or replacing features while
keeping product decisions separated from rendering and generation internals.

## Main extension points

| Area | Files | Typical changes |
| --- | --- | --- |
| Story planning | `scripts/story-to-video.mjs` | sentence splitting, duration, prompt templates, character continuity |
| Uploaded pages | `scripts/import-uploaded-pages.mjs` | layout detection, crop rules, deduplication |
| Rendering | `src/Scene.tsx`, `src/StoryVideo.tsx` | layer timing, transitions, composition |
| Product presets | `storyboard.json`, `storyboard.uploaded.json` | canvas, FPS, scene defaults |
| Agent behavior | `skill-package/story-handdrawn-studio/` | natural-language workflow and safety rules |
| Outputs | `package.json` | preview/final resolution, codec, render concurrency |

## Recommended development order

1. Parameterize aspect ratio, resolution, caption area, palette, and transition timing.
2. Isolate each generation into its own run directory instead of sharing one active storyboard.
3. Add voiceover-aware scene timing and optional audio composition.
4. Add crop/contact-sheet previews before expensive image generation and final rendering.
5. Add unit tests, storyboard fixtures, and representative frame snapshots.
6. Add retries, caching, progress reporting, and controlled parallel image generation.

## Compatibility policy

- Keep the storyboard JSON as the boundary between planning and rendering.
- Use `STORY_HANDDRAWN_STUDIO_PROJECT` as the only explicit project-location variable.
- Keep generated assets content-addressed so application changes do not invalidate old runs.
- Keep third-party license notices when redistributing substantial copied code.
- Keep `npm run check` usable on a clean clone; use `npm run check:assets` for render readiness.

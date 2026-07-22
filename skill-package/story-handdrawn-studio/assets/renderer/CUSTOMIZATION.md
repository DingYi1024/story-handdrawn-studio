# Customization Guide

The project is intentionally split into stable boundaries so features can be added or removed without coupling image generation to rendering.

## Architecture map

| Area | Files | Responsibility |
| --- | --- | --- |
| Product settings | `scripts/lib/presets.mjs` | canvas, caption, timing, layout, transition, visual and render defaults |
| Project storage | `scripts/lib/projects.mjs` | isolation, safe paths, atomic JSON, locks and state history |
| Story rules | `scripts/lib/story-text.mjs` | splitting, caption formatting and reading-aware timing |
| Validation | `scripts/lib/storyboard-validator.mjs` | schema invariants, layers, captions, assets and traversal protection |
| Orchestration | `scripts/studio.mjs` | commands, state transitions, resume and render invocation |
| Input adapters | `scripts/story-to-video.mjs`, `scripts/import-*.mjs` | convert stories or pages into the storyboard contract |
| Renderer | `src/` | ratio-aware layout, reveals, transitions and Remotion compositions |
| Agent interface | `skill-package/story-handdrawn-studio/` | natural-language operating contract |

## Add a publishing preset

1. Add the even-pixel canvas to `PRESETS` in `scripts/lib/presets.mjs`.
2. Add or adapt proportional `layout` defaults if the format needs a different safe area.
3. Add a preset test in `tests/presets.test.mjs`.
4. Ingest representative pages, strictly validate them, and render a preview.

The renderer uses `project.width`, `height`, `fps`, and proportional layout values at runtime. A new preset should not require a new Remotion composition.

## Add a generator

Keep the output boundary identical to the existing manifest:

- one job per master image;
- exact absolute `output_master` location;
- explicit references for style and character continuity;
- no storyboard activation until every required master exists;
- derive aligned BW/color plates locally where possible.

Add the adapter beside `story-to-video.mjs`, then let `studio.mjs` own state changes. Avoid embedding provider SDK calls in React components.

## Add voiceover

Recommended sequence:

1. Add an optional `audio` block to project settings and validate it.
2. Produce narration per scene using `scene.narration`, never the line-broken caption.
3. Probe real audio duration and update scene timing before the final storyboard is activated.
4. Add audio composition in a separate Remotion component.
5. Preserve `--muted` as a supported picture-only export.

## Add a UI or queue

Treat `scripts/studio.mjs --json`, `project.json`, and `state.json` as the initial application boundary. A UI should invoke commands through a job service, stream logs, and never write runtime JSON while a `.studio.lock` exists. For multi-machine processing, replace the file lock with a transactional queue while keeping command semantics stable.

## Compatibility policy

- Storyboard JSON is the contract between preparation and rendering.
- New storyboard fields should be optional until all fixtures are migrated.
- Runtime paths stay under `projects/<id>` or `public/projects/<id>`.
- A status is written only after its artifact and validation succeed.
- `npm run check` must work on a clean clone; real-asset checks remain explicit.
- Keep third-party notices required by redistributed dependencies or assets.

## Recommended next modules

1. Voiceover-aware timing and subtitle export (SRT/ASS).
2. Provider adapters with retry, rate limiting, cost estimates, and deterministic cache keys.
3. Contact-sheet approval before image generation and final render.
4. Web job dashboard built over JSON command output and project state.
5. Visual regression snapshots for every preset and transition.

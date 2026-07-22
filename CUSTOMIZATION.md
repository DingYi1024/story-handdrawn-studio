# Customization Guide

The project is intentionally split into stable boundaries so features can be added or removed without coupling image generation to rendering.

## Architecture map

| Area | Files | Responsibility |
| --- | --- | --- |
| Product settings | `scripts/lib/presets.mjs` | canvas, caption, timing, layout, transition, visual and render defaults |
| Project storage | `scripts/lib/projects.mjs` | isolation, safe paths, atomic JSON, locks and state history |
| Story rules | `scripts/lib/story-text.mjs` | splitting, caption formatting and reading-aware timing |
| Automatic direction | `scripts/lib/director.mjs`, `scripts/lib/continuity.mjs` | versioned scene plans, explicit cast/state, dependency impact and retakes |
| Video QA | `scripts/lib/visual-qa.mjs`, `scripts/qa-video.mjs` | probe, deterministic samples, RGB metrics, verdicts and evidence frames |
| Optional audio | `scripts/lib/audio.mjs`, `scripts/audio-project.mjs` | scene timeline, TTS/files, measured timing, mix graph and mux |
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

## Extend voiceover or add a provider

Keep providers behind the portable `audio-manifest.json` boundary. Produce speech from `scene.narration`, measure its real duration, update timing before rendering, and reuse `muxAudioIntoVideo` so the H.264 picture stream is copied. Add provider-specific credentials and retries outside React. Preserve the disabled/silent route and add injected-network unit tests rather than requiring live credentials in CI.

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

1. Subtitle export (SRT/ASS) from the frame-accurate audio timeline.
2. Image/TTS provider retry, rate limiting, cost estimates, and deterministic cache keys.
3. Contact-sheet approval before image generation and final render.
4. Web job dashboard built over JSON command output and project state.
5. Perceptual visual regression baselines for every preset and transition.

# Workflow Reference

Use the wrapper for every action:

```bash
python <SKILL_DIR>/scripts/run_story_video.py COMMAND [OPTIONS]
```

## Commands

| Command | Purpose | Stable result |
| --- | --- | --- |
| `setup` | Prepare locked runtime dependencies and diagnose tools | healthy environment |
| `produce` | Create/continue an automatic plan → assets → preview → final loop | requested target or explicit image jobs |
| `create` | Copy text/images into an isolated project | `created` |
| `plan` / `ingest` / `import` | Manual preparation stages | `awaiting_assets` / `assets_ready` |
| `revise` | Archive the current revision and prepare scene retakes | `awaiting_assets` |
| `continuity` | Inspect/apply the continuity specification and impact report | current state preserved |
| `audio` | Plan, prepare, mix, or disable optional audio | audio sidecars / mixed final |
| `render` | Render and machine-check preview/final | `preview_ready` / `completed` |
| `qa` | Re-run machine video QA without rendering | report plus sampled frames |
| `resume` | Continue the saved production target | next truthful state |
| `regress` | Compile all ten continuity regression cases | pass/fail summary |
| `status` / `list` / `validate` / `doctor` | Inspect project or environment | no unintended content mutation |

## Automatic production

Story already present in the conversation:

```bash
python <SKILL_DIR>/scripts/run_story_video.py produce --id paper-summer --title "纸上的夏天" \
  --text "完整故事原文" --preset vertical --to preview
```

Ordered images:

```bash
python <SKILL_DIR>/scripts/run_story_video.py produce --id travel-diary --title "旅行手账" \
  --image /absolute/01.jpg --image /absolute/02.jpg --preset portrait --to final
```

For a story, `produce` normally pauses once with structured `generate_images` jobs. For each job:

1. Read the entire prompt and every reference image.
2. Use the available image-generation capability to create one master.
3. Save/copy the result to `output_master` exactly.
4. Confirm the file exists and can be decoded.
5. Process the next job in order; the character reference comes first.

Then continue the same target:

```bash
python <SKILL_DIR>/scripts/run_story_video.py produce --project paper-summer --to preview
```

Do not stop after only one scene, do not invent placeholder masters, and do not modify state by hand.

Use `--generator api` only when the user explicitly selects direct API image generation and `OPENAI_API_KEY` is present. The normal Agent route is `codex`, where the Agent services the returned image jobs.

## Manual stages

Manual commands remain available for debugging and custom automation:

```bash
python <SKILL_DIR>/scripts/run_story_video.py create --id paper-summer --title "纸上的夏天" --input /absolute/story.txt --preset vertical
python <SKILL_DIR>/scripts/run_story_video.py plan --project paper-summer
python <SKILL_DIR>/scripts/run_story_video.py import --project paper-summer
python <SKILL_DIR>/scripts/run_story_video.py render --project paper-summer --quality preview
python <SKILL_DIR>/scripts/run_story_video.py render --project paper-summer --quality final
```

`render` includes QA. A QA failure leaves the project resumable and points to `qa/QUALITY/report.json` and sampled frames.

## Presets

| Name | Ratio | Final size | Typical use |
| --- | --- | --- | --- |
| `portrait` | 3:4 | 1080×1440 | default story card |
| `vertical` | 9:16 | 1080×1920 | short-video feed |
| `square` | 1:1 | 1080×1080 | square social post |
| `landscape` | 16:9 | 1920×1080 | widescreen video |

Add `--transition page-flip` only for intact uploaded-page turning. Direct cut is the normal story reveal.

## Recovery

Run `status --project ID --json`, then normally repeat `produce --project ID --to TARGET`:

- `created`: plan story or ingest images.
- `awaiting_assets`: generate only listed missing masters.
- `assets_ready`: render preview.
- `preview_ready`: render final when requested.
- `failed`: read `last_error` and `resume_from`, fix the cause, continue.
- `completed`: verify final path and QA report; do not rerender without a reason.

## Output

Default data locations:

- Project: `~/.story-handdrawn-studio/projects/ID/`
- Preview/final: `projects/ID/output/preview.mp4` and `final.mp4`
- QA: `projects/ID/qa/preview|final/report.json`
- Revisions: `projects/ID/revisions/rN/`
- Audio sidecars: `projects/ID/audio-options.json` and `audio-manifest.json`
- Render assets: `~/.story-handdrawn-studio/public/projects/ID/assets/`

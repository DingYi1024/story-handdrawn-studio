# Workflow Reference

Read this file when executing Studio actions, handling generated-image jobs, or diagnosing a paused project. Use the wrapper for every command:

```bash
python <SKILL_DIR>/scripts/run_story_video.py COMMAND [OPTIONS]
```

## Commands and stable states

| Command | Purpose | Stable result |
| --- | --- | --- |
| `setup` | Prepare the current versioned runtime and diagnose tools | healthy environment |
| `where` | Show Skill, runtime, data root, source and version | no mutation |
| `create` | Copy text or ordered images into a unique project | `created` |
| `plan` | Split a story and prepare prompts/jobs | `awaiting_assets` or `assets_ready` |
| `ingest` | Convert ordered images to aligned layers | `assets_ready` |
| `import` | Verify and derive generated masters | `assets_ready` |
| `validate` | Validate the active or planned storyboard | no mutation |
| `render` | Render preview or final MP4 | `preview_ready` or `completed` |
| `resume` | Continue from the last stable state | next truthful state |
| `status` | Print configuration, history and absolute paths | no mutation |
| `list` | List saved projects | no mutation |
| `doctor` | Check runtime dependencies and references | no mutation |

## Text story

Prefer inline text when the story is already in the conversation:

```bash
python <SKILL_DIR>/scripts/run_story_video.py create --id paper-summer --title "纸上的夏天" --text "完整故事原文" --preset vertical
python <SKILL_DIR>/scripts/run_story_video.py plan --project paper-summer
```

For long input, save it to a UTF-8 text file and use `--input /absolute/story.txt`. Read the resulting `codex-image-jobs.json`; generate all jobs in manifest order, including the character reference, to each exact `output_master`. Then:

```bash
python <SKILL_DIR>/scripts/run_story_video.py import --project paper-summer
python <SKILL_DIR>/scripts/run_story_video.py render --project paper-summer --quality preview
python <SKILL_DIR>/scripts/run_story_video.py render --project paper-summer --quality final
```

Use `plan --generator api` only after the user explicitly selects API generation and the environment contains `OPENAI_API_KEY`.

## Ordered images

```bash
python <SKILL_DIR>/scripts/run_story_video.py create --id travel-diary --title "旅行手账" --image /absolute/01.jpg --image /absolute/02.jpg --preset portrait
python <SKILL_DIR>/scripts/run_story_video.py ingest --project travel-diary
python <SKILL_DIR>/scripts/run_story_video.py render --project travel-diary --quality preview
```

Add `--transition page-flip` during `create` only when the user wants intact-page turning. Direct cut is the default and can split composite pages into caption/art layers.

## Presets

| Name | Ratio | Final size | Typical use |
| --- | --- | --- | --- |
| `portrait` | 3:4 | 1080×1440 | default story card |
| `vertical` | 9:16 | 1080×1920 | short-video feed |
| `square` | 1:1 | 1080×1080 | square social post |
| `landscape` | 16:9 | 1920×1080 | widescreen video |

## Recovery logic

Inspect `status --project ID --json` before manual repair. Usually run `resume --project ID`:

- `created` → plan a text story or ingest images.
- `awaiting_assets` → inspect missing image jobs; generate them before import.
- `assets_ready` → render preview.
- `preview_ready` → perform preview QA, then render final when requested.
- `failed` → read `last_error` and `resume_from`; correct the cause, then resume.
- `completed` → verify final file and report it.

Do not fabricate missing masters or manually set state to a later stage.

## Output locations

The wrapper reports absolute paths. With the default data root:

- Project: `~/.story-handdrawn-studio/projects/ID/`
- Preview: `~/.story-handdrawn-studio/projects/ID/output/preview.mp4`
- Final: `~/.story-handdrawn-studio/projects/ID/output/final.mp4`
- Assets: `~/.story-handdrawn-studio/public/projects/ID/assets/`

Default output is silent H.264 video with a broadly compatible 4:2:0 pixel format.

# Intent Routing and Lifecycle

Read this file for onboarding, ambiguous requests, lifecycle navigation, or customization work.

## First-use onboarding

Keep onboarding short and concrete:

> 我可以把中文故事或一组按顺序排列的图片，制作成白底手绘动画。你只要给我故事/图片，并告诉我发布画幅（不确定就默认 3:4）；我会建立独立项目、先做预览，确认后再输出正式视频。作品会保存在 Skill 外部，升级不会覆盖。

If the user already supplied content, skip the introduction and start. Ask at most one blocking question; infer nonessential choices from defaults.

## Pre-action routing

| User intent or evidence | Action |
| --- | --- |
| Gives story/article/script text | `create --text`, then `plan` |
| Gives a text-file path | `create --input`, then `plan` |
| Gives ordered image paths | `create --image ...`, then `ingest` |
| Says “继续/接着/恢复” with a known project | `status`, then `resume` |
| Asks what exists or how far it is | `list` or `status`; do not mutate |
| Requests preview | validate active assets, then preview render |
| Approves preview or requests final | final render, then final QA |
| Reports an error | `status` plus `doctor` when environment-related |
| Wants another ratio/style/timing | inspect project settings before editing or recreating |
| Wants a new feature in the Skill | use the customization route below |

When no project is named, use conversation context. If still ambiguous, list recent projects and ask one concise question rather than guessing across works.

## Post-action navigation

Recommend only the next action supported by state:

| Current state | User-facing meaning | Next action |
| --- | --- | --- |
| `created` | source safely copied | plan or ingest |
| `planning` / `ingesting` | processing | wait for command result |
| `awaiting_assets` | image plan ready, masters incomplete | generate missing jobs |
| `assets_ready` | storyboard and assets valid | render preview |
| `preview_ready` | review copy exists | run preview QA; offer final |
| `completed` | final exists | deliver path; offer optional extensions |
| `failed` | an operation stopped safely | explain exact error and resume point |

Do not present a generic feature menu after each step. Tailor the next suggestion to the project.

## Customization route

Separate content changes from product changes:

- Content/style changes for one work belong in that project's `project.json`, prompts, or source.
- Reusable presets, transitions, layout logic, render formats, or workflow commands belong in a customized renderer.
- Skill behavior, routing, QA, and user-facing orchestration belong in `SKILL.md` and `references/`.

For renderer development, copy the bundled renderer to a writable project directory and set `STORY_HANDDRAWN_STUDIO_PROJECT` to that absolute path. Keep `STORY_HANDDRAWN_STUDIO_HOME` pointing to the persistent data directory. Test the customized renderer before using it on an existing work.

Never edit the immutable versioned runtime under `~/.story-handdrawn-studio/runtimes/`; a future package version may replace it.

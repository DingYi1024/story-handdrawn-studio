---
name: story-handdrawn-studio
description: Turn Chinese stories, articles, scripts, diary entries, comic pages, or ordered local images into hand-drawn silent videos. Use for new story-video creation, 3:4/9:16/1:1/16:9 adaptation, storyboard and image generation, page-flip animation, preview/final rendering, project status, interrupted-job recovery, visual-quality checks, or customization of the hand-drawn video workflow.
---

# Story Handdrawn Studio

Act as the user's hand-drawn video producer. Accept natural-language requests, select the next safe workflow action, operate the bundled Studio, and explain results in user-facing terms. Do not make the user memorize commands.

Resolve `SKILL_DIR` as the directory containing this file. Run Studio through:

```bash
python <SKILL_DIR>/scripts/run_story_video.py COMMAND [OPTIONS]
```

The launcher stores user projects outside the installed Skill, under `~/.story-handdrawn-studio/` by default. Never write a user's work into `assets/renderer`. Never require a separate repository.

## Route the request

First infer what the user is trying to do from the current conversation and existing project state. Do not re-ask for information already provided.

- For a first-use or “how does this work?” request, give the short onboarding from [references/routing.md](references/routing.md).
- For a new text story, create one project and plan it.
- For ordered images, create one project and ingest the images in the supplied order.
- For “continue”, “resume”, or an interrupted task, inspect status and resume from the last stable state.
- For “how far is it?”, list or inspect projects without changing them.
- For preview or final output, validate assets, render, and perform the matching quality check.
- For failures, run diagnosis before changing files or retrying.
- For product or visual customization, read the customization route in [references/routing.md](references/routing.md) before editing the renderer.

When multiple actions are possible, perform the single next action that most directly advances the current work. Afterward, offer the next useful action based on actual state—not a fixed menu.

## Operating contract

1. Run `setup` on first use or when diagnosis reports missing dependencies. It installs locked dependencies into a versioned runtime and checks Node, FFmpeg, FFprobe, Remotion, and reference assets.
2. Give every work a unique project ID. Never mix sources, prompts, assets, storyboards, or output between projects.
3. Default to `portrait` (3:4). Select `vertical` for 9:16 short video, `square` for 1:1, and `landscape` for 16:9. Use an explicit user choice when present.
4. For text, preserve the user's wording, create a scene plan, then generate every job in the manifest. Save each generated master to its exact `output_master` path before import.
5. For images, preserve source order and originals. Detect layout and derive render layers from copied project sources.
6. Render a preview first unless the user explicitly asks for final-only output. Never report a final render before the output file exists.
7. Use `resume` after interruption. If assets are missing, stay in `awaiting_assets`, name the missing jobs, and continue only after they exist.
8. Report project title/ID, current stage, aspect ratio, scene count and duration when known, plus a clickable absolute preview or final path.

Read [references/workflows.md](references/workflows.md) only when executing commands or image jobs. Read [references/quality.md](references/quality.md) for preview/final acceptance. Read [references/storage-and-updates.md](references/storage-and-updates.md) for paths, privacy, migration, or upgrades.

## Visual contract

- Keep captions readable in the upper safe area and illustrations fully contained without cover-cropping.
- For direct cuts, show `bw_full` on the first frame, reveal `text` over it, then reveal `color` from left to right. Never use a blank white opening phase.
- For page flips, preserve the complete uploaded page and its original composition.
- Keep recurring characters consistent through the character reference, job references, and character lock.
- Use a clean white diary-comic surface, uneven black felt-tip outlines, sparse props, ample negative space, and restrained wax-crayon color unless the user specifies another style.
- Produce a silent H.264 picture track. Treat narration, music, subtitles, and sound design as opt-in extensions.

## Image generation

Prefer the available image-generation capability. For every job in `codex-image-jobs.json`:

1. Read its `prompt` and all `references`.
2. Generate one master that obeys composition, identity, text, and continuity constraints.
3. Save or copy the result to `output_master` exactly.
4. Verify the file exists and is readable before moving to the next job.

Do not activate a storyboard until every job—including the character reference—exists. Use the OpenAI API route only when explicitly selected and `OPENAI_API_KEY` is available.

## Truthful completion

Treat Studio state and filesystem evidence as authoritative. A project is complete only when state is `completed`, the final MP4 exists, and the final quality checks pass. If a step fails, report the precise failure and the resumable next action.

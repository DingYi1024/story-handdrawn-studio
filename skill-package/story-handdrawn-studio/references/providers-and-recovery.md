# Providers, Cost, and Recovery

Inspect available image routes:

```bash
python <SKILL_DIR>/scripts/run_story_video.py providers
python <SKILL_DIR>/scripts/run_story_video.py assets --project PROJECT --action plan --provider auto
```

`auto` selects OpenAI only when `OPENAI_API_KEY` exists; otherwise it emits Codex image jobs for the host Agent. `codex` and `files` pause truthfully at an external work boundary. `openai` records an explicit estimate, retries up to the project's `max_attempts`, and persists `provider-state.json` after each attempt.

Use `assets --action status` before retrying. Use `assets --action retry --provider ...` to continue. Never report a generated image merely because a job was planned; the declared output file must exist and validate.

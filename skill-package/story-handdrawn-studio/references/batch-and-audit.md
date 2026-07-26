# Batch Production and Portfolio Audit

Read this file for multi-project production, queue recovery, or whole-library health checks.

## Batch manifest

Use a JSON manifest with one stable batch ID and up to 100 jobs:

```json
{
  "schema_version": 1,
  "id": "weekly-stories",
  "defaults": {
    "to": "preview",
    "preset": "vertical",
    "generator": "codex",
    "audio": "auto"
  },
  "jobs": [
    {
      "id": "rain-note",
      "title": "雨夜纸条",
      "input": "/absolute/rain.txt"
    },
    {
      "id": "sun-note",
      "title": "晴天纸条",
      "text": "阳光落在纸条上。",
      "to": "final"
    }
  ]
}
```

Each job must use exactly one source: `input`, `text`, or `images`. Supported targets are `plan`, `assets`, `preview`, and `final`. Automatic audio is optional and local.

Run the queue:

```bash
python <SKILL_DIR>/scripts/run_story_video.py batch --input /absolute/batch.json
```

The queue is sequential to protect render memory. It continues past image-generation and style-approval boundaries, persists after every job, and never marks a final complete without a final MP4 and passing QA. Service every returned project action, then repeat the same command.

The Skill snapshots the normalized manifest under `~/.story-handdrawn-studio/batches/BATCH_ID/`. Resume or inspect it without the original file:

```bash
python <SKILL_DIR>/scripts/run_story_video.py batch --id weekly-stories --action status
python <SKILL_DIR>/scripts/run_story_video.py batch --id weekly-stories --action run
python <SKILL_DIR>/scripts/run_story_video.py batch --id weekly-stories --action retry
```

Use `retry` only after correcting failed jobs. A changed manifest fingerprint is rejected; use a new batch ID when changing job definitions.

## Portfolio audit

Run a read-only audit before delivery, backup, migration, or cleanup:

```bash
python <SKILL_DIR>/scripts/run_story_video.py audit --json
python <SKILL_DIR>/scripts/run_story_video.py audit --json --strict
```

The audit checks project readability, source preservation, lifecycle states, active or stale locks, claimed preview/final files, final QA evidence, pending external actions, and storage size. `--strict` exits nonzero only when failures exist.

Never delete a reported stale lock automatically. Verify that no Studio process is running, then remove only the exact lock path named in the report.

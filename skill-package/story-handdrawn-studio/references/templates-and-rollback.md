# Templates, Migration, and Rollback

List built-in templates with `templates`. Current templates are `gentle-diary`, `warm-memory`, `children`, `science`, and `uploaded-comic`.

```bash
python <SKILL_DIR>/scripts/run_story_video.py create --template gentle-diary --id note --title "纸条" --input /absolute/story.txt
```

Schema upgrades are explicit and recoverable:

```bash
python <SKILL_DIR>/scripts/run_story_video.py migrate --project PROJECT
python <SKILL_DIR>/scripts/run_story_video.py snapshot --project PROJECT --label "before final changes"
python <SKILL_DIR>/scripts/run_story_video.py rollback --project PROJECT --snapshot s0001
```

Migration creates a backup snapshot before writing. Rollback creates another safety snapshot before restoring, so an accidental restore remains reversible. Snapshots contain project metadata, storyboards, continuity, provider/audio/semantic state, and review decisions; immutable source and public media remain outside the overwritten set.

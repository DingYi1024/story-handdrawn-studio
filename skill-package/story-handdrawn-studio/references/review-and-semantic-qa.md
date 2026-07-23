# Review and Semantic QA

Pixel QA verifies dimensions, FPS, duration, audio, the nonblank monochrome opening, later colour, timeline blanks, and three samples around every page flip. Semantic QA separately checks asset declarations, continuity prompt guards, and per-scene visual observations.

```bash
python <SKILL_DIR>/scripts/run_story_video.py semantic-qa --project PROJECT
python <SKILL_DIR>/scripts/run_story_video.py review --project PROJECT
```

Missing visual observations produce `needs_review`, not fabricated pass claims. `--strict` converts missing observations into failures. An Agent with vision may inspect every `vision-jobs.json` item and write `semantic-observations.json`; otherwise use the generated self-contained `review/index.html`.

The reviewer selects approve/revise per scene, writes a precise note, and exports JSON. Apply it with:

```bash
python <SKILL_DIR>/scripts/run_story_video.py apply-review --project PROJECT --input /absolute/review.json --to preview
```

Approved scenes remain untouched. Each rejected scene becomes an immutable numbered retake job, after which normal `produce` resumes.

# Continuity and Revisions

Read this file before planning a story with recurring entities, applying continuity changes, or handling scene feedback.

## Continuity specification

Create a JSON object with `schemaVersion: 1`, global `characters` and `props`, plus one entry for every storyboard scene. Scene IDs must match the generated `01`, `02`, … IDs. Presence is always explicit and is never inherited.

```json
{
  "schemaVersion": 1,
  "characters": [
    {
      "id": "xiaoman",
      "name": "小满",
      "introducedIn": "01",
      "description": "26岁中国女性，短黑色波波头、圆脸",
      "defaultOutfit": "芥末黄开衫、白色内搭、灰蓝长裙、米白帆布鞋",
      "palette": ["mustard", "dusty-blue", "off-white"]
    }
  ],
  "props": [
    {"id": "red-bag", "name": "砖红帆布包", "owner": "xiaoman", "introducedIn": "01"}
  ],
  "scenes": [
    {
      "id": "01",
      "characters": ["xiaoman"],
      "props": ["red-bag"],
      "characterStates": {"xiaoman": {"props": ["red-bag"]}},
      "setting": {"location": "雨夜公交站", "timeOfDay": "night", "palette": ["dusty-blue", "mustard"]},
      "dependsOn": []
    },
    {
      "id": "02",
      "characters": [],
      "props": [],
      "setting": {"location": "空荡站台", "timeOfDay": "night"},
      "dependsOn": ["01"]
    }
  ]
}
```

Important rules:

- Every scene has `characters`, even when empty.
- Do not introduce a character or prop before its `introducedIn` scene.
- Put state only under characters present in that scene.
- List a held prop in both `scene.props` and the character state's `props`.
- Use `dependsOn` only for real narrative/visual dependency on an earlier scene.
- Outfit, palette, location, and time may inherit through the ledger; character presence never does.

Pass the file during initial production:

```bash
python <SKILL_DIR>/scripts/run_story_video.py produce --id rain-note --title "雨夜纸袋" --input /absolute/story.txt --continuity /absolute/continuity.json --to preview
```

Inspect or replace continuity later:

```bash
python <SKILL_DIR>/scripts/run_story_video.py continuity --project rain-note
python <SKILL_DIR>/scripts/run_story_video.py continuity --project rain-note --apply /absolute/continuity-v2.json
```

If applying a new spec reports impacted scenes, revise those scenes before the next final.

## Scene-specific retake

Use one or more repeated `--scene` flags. `--text` changes a single displayed caption; `--narration` changes spoken/source narration. `--to` defaults to preview.

```bash
python <SKILL_DIR>/scripts/run_story_video.py revise --project rain-note \
  --scene 02 --note "不要出现人物，只保留空站台和被雨打湿的纸袋" --to preview
```

Generate every returned retake job to its exact new `output_master`, then:

```bash
python <SKILL_DIR>/scripts/run_story_video.py produce --project rain-note --to preview
```

The previous revision remains under `projects/ID/revisions/rN/`. Retake asset names contain `-rN`; do not overwrite or manually rename them.

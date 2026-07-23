# Optional Audio

Read this file only when the user requests narration, music, sound effects, or an audio-enabled final.

Audio is disabled by default. Supported inputs are supplied per-scene voice files, one looping BGM file, per-scene SFX files, and OpenAI speech synthesis. The pipeline measures real audio duration, can extend scene timing, normalizes/limits the mix, preserves the H.264 picture stream, and outputs AAC audio.

For fully local, automatically directed music and effects, use `audio --action auto` and read `automatic-audio.md`.

## Plan without external calls

```bash
python <SKILL_DIR>/scripts/run_story_video.py audio --project rain-note --action plan \
  --enable --provider openai --model tts-1-hd --voice alloy
```

Planning writes `audio-options.json` and `audio-manifest.json` but does not call the API.

## OpenAI narration

Explain that narration text will be sent to OpenAI, confirm `OPENAI_API_KEY` is available, then prepare:

```bash
python <SKILL_DIR>/scripts/run_story_video.py audio --project rain-note --action prepare \
  --enable --provider openai --model tts-1-hd --voice alloy
python <SKILL_DIR>/scripts/run_story_video.py produce --project rain-note --to final
```

Do not claim a live synthesis was tested when only local/unit tests were run.

## Supplied tracks

```bash
python <SKILL_DIR>/scripts/run_story_video.py audio --project rain-note --action prepare \
  --enable --provider files \
  --voiceover 01=/absolute/voice-01.wav \
  --voiceover 02=/absolute/voice-02.wav \
  --bgm /absolute/soft-bed.mp3 \
  --sfx 02=/absolute/rain-hit.wav
python <SKILL_DIR>/scripts/run_story_video.py produce --project rain-note --to final
```

Use `scene=absolute-file` for voiceover/SFX. Persistent advanced settings may be supplied with `--audio-config /absolute/audio-options.json`.

## Disable

```bash
python <SKILL_DIR>/scripts/run_story_video.py audio --project rain-note --action disable
```

When delivering an audio final, verify both video and audio streams and report that audio was deliberately enabled.

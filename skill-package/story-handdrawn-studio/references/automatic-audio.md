# Automatic Sound Director

Use the keyless local route when the user asks for a complete video with atmosphere or sound but does not require spoken narration:

```bash
python <SKILL_DIR>/scripts/run_story_video.py audio --project PROJECT --action auto
python <SKILL_DIR>/scripts/run_story_video.py produce --project PROJECT --to final
```

The director reads scene text/narration, chooses a calm, warm, tender, or suspense bed, detects rain, water, birds, steps, discoveries, and page flips, and synthesizes reusable 48 kHz sources with FFmpeg. It writes `audio-director.json`, source WAV files, `audio-options.json`, and `audio-manifest.json`. No story text or media leaves the machine.

Automatic audio deliberately does not fake speech. If spoken narration is requested, combine it with OpenAI TTS or supplied recordings as described in `audio.md`. Final QA must require an AAC audio stream.

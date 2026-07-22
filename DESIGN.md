# Rendering Contract

## Canvas and layout

- Supported defaults: 1080×1440 (3:4), 1080×1920 (9:16), 1080×1080 (1:1), 1920×1080 (16:9), 30fps.
- Caption, illustration, side and bottom regions are proportional project settings.
- All illustration assets use contained framing; source marks must not be cropped.
- Output dimensions must be positive even integers matching the declared ratio.

## Motion

- Direct cut: show `bw_full` on frame zero, reveal `text` over it, then reveal optional `detail` and `color`.
- The base BW plate never wipes in. Later drawing plates reveal from left to right with one consistent mask direction.
- Page flip overlaps adjacent pages by the configured transition duration and preserves the page master.
- Motion must remain deterministic from frame number and project configuration.

## Assets

- Every project owns `public/projects/<id>/assets`.
- Uploaded sources are copied and de-duplicated by content hash.
- Generated paths include a settings-and-content batch hash.
- BW/detail/color plates in one scene must have identical dimensions.
- Storyboards may never address files outside `public/`.

## State

```text
created → planning → awaiting_assets → importing → assets_ready
created → ingesting ──────────────────────────────→ assets_ready
assets_ready → rendering_preview → preview_ready
preview_ready → rendering_final → completed
```

`produce` persists `plan|assets|preview|final` as its target and traverses these states until it reaches that target or returns real pending image jobs. `revise` archives metadata under `revisions/rN`, emits immutable `-rN` retakes, and returns to `awaiting_assets`. Preview/final states are committed only after machine QA passes.

An operation failure records `failed`, `last_error`, and `resume_from`. The project lock prevents concurrent mutation, atomic JSON replacement prevents partial state, and `resume` continues from the last stable state.

## Continuity

`continuity.spec.json` is the editable semantic source; `continuity.ledger.json` is its deterministic compiled form. Every scene explicitly declares the current cast. Outfit, palette and setting can inherit with recorded dependencies, while presence cannot. A change computes direct and dependent scene impact before retakes are prepared.

## QA

Every Studio render probes its real MP4, samples deterministic first/reveal/timeline frames, validates geometry/FPS/duration and the `BW → text → color` story sequence, rejects sampled black/white blank frames, and saves a JSON report plus JPEG evidence. Similar-frame detection is a review warning unless a hard defect also exists.

## Audio

The default composition remains a silent picture track. Optional audio uses `scene.narration`, supplied tracks, or OpenAI speech; it probes real durations and may extend visual timing before render. FFmpeg mixes voiceover/BGM/SFX with loudness and limiter controls, copies the H.264 picture stream, pads audio to the exact timeline, and emits AAC. Music never changes caption reveal timing.

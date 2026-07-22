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

An operation failure records `failed`, `last_error`, and `resume_from`. The project lock prevents concurrent mutation, atomic JSON replacement prevents partial state, and `resume` continues from the last stable state.

## Audio

The default composition is a silent picture track. Captions use `scene.text`; future narration uses `scene.narration`. Music must not drive or alter text timing unless an explicit audio module changes this contract.

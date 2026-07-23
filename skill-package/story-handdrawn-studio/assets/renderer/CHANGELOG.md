# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] - 2026-07-23

### Added

- A local automatic sound director that detects story mood and events, synthesizes original 48 kHz BGM/SFX, and aligns page-turn effects without a network call.
- Semantic QA with truthful `needs_review` states, agent-readable vision jobs, strict observation mode, per-scene retake suggestions, and a self-contained local review page.
- Review-decision import that preserves approved scenes and produces immutable revision jobs only for rejected scenes.
- Image-provider catalog, automatic provider selection, explicit cost estimates, bounded retries, and persisted recovery state.
- Five production templates, project schema v3 migration, metadata snapshots, safety backups, and reversible rollback.
- Transition-focused QA sampling on both sides of every page flip and a three-platform GitHub Actions matrix.
- V1 showcase evidence: 23 sampled frames, verified audio stream, all three nonblank page flips, 32/32 semantic checks, and a local review workspace.

### Fixed

- Invalid input image paths are now validated before project directories are created, preventing abandoned half-created projects.

### Changed

- The Skill now routes sound, provider recovery, semantic review, templates, migration, snapshots, and rollback through progressive reference guides.
- Project state now records provider, review, snapshot, semantic, and automatic-audio artifacts.

## [0.5.1] - 2026-07-22

### Added

- A rebuilt 27.5-second showcase with original procedurally generated music, rain, seed chimes, watering, birds, and frame-aligned page-turn effects.
- Reproducible showcase audio sources/configuration, a dedicated three-transition GIF, and audio-stream assertions in video QA.

### Fixed

- Page-flip scenes now expose the incoming monochrome drawing instead of an outer white plate, hold the drawing until the flip completes, then begin text and color reveals.
- AAC muxing now emits a standard 48 kHz stereo stream.

### Changed

- The complete example, preview, final MP4, QA frames/report, cover, and animated previews were regenerated as an audio-enabled delivery.

## [0.5.0] - 2026-07-22

### Added

- An automatic `produce` director that persists a requested target and advances plan, assets, preview, final render, and QA until completion or a truthful external image-job boundary.
- Scene-specific `revise` retakes with immutable revision asset names, archived prior metadata, dependency impact propagation, and resumable production.
- Versioned continuity specifications and compiled ledgers for explicit per-scene cast, outfit, palette, props, setting, dependency tracking, and no accidental character carry-over.
- Machine video QA for geometry, FPS, duration, nonblank opening artwork, generated-story monochrome opening, later color, blank timeline frames, duplicate-frame hints, saved sample frames, and JSON reports.
- Optional supplied voiceover/BGM/SFX and OpenAI speech synthesis, measured narration timing, conservative FFmpeg mixing, loudness control, AAC muxing, and picture-stream preservation.
- Ten continuity regression fixtures covering single character, dialogue, long story, children, emotion, science, landscape, uploaded images, page flips, and mid-story recovery.
- A portable QA report and frame evidence for the complete 27.7-second showcase video.

### Changed

- Preview and final states are now written only after their machine QA passes.
- The mature Skill routes natural-language requests through `produce`, services every returned image job, and continues to the requested video instead of stopping at planning.
- Project state schema now records production target, revision, pending scenes/jobs, continuity version, QA results, and audio status.

### Security

- Revision outputs use new paths instead of overwriting accepted masters; continuity validation rejects unknown, premature, or implicitly carried entities.
- Audio and QA paths remain project-contained, optional external speech requires an explicit API key, and audio stays disabled by default.

## [0.3.3] - 2026-07-22

### Fixed

- Direct-cut scenes now show the complete monochrome illustration on frame zero, reveal captions over it, and reveal color last, eliminating the blank white opening phase.
- Story generation, image ingestion, storyboard validation, Skill guidance, and the published showcase now enforce the same `bw_full → text → color` contract.

## [0.3.2] - 2026-07-22

### Added

- A full-length animated README preview and direct MP4 links for the showcase, making the finished video visible without browsing repository directories.

## [0.3.1] - 2026-07-22

### Added

- A complete reproducible showcase, “The Sprouting Note”, with a four-scene storyboard, locked character reference, color and monochrome assets, preview render, final 1080×1920 video, and validation coverage.

## [0.3.0] - 2026-07-22

### Added

- Intent routing, first-use onboarding, lifecycle-aware next actions, progressive references, and preview/final visual acceptance rules.
- Persistent data home, versioned immutable renderer runtimes, legacy-data migration, and an explicit update/privacy contract.
- Claude Code marketplace metadata and deterministic package-contract validation.
- Configurable data/public roots across project creation, image planning, image import, validation, and Remotion rendering.

### Changed

- User projects, generated assets, and video outputs now live outside the installed Skill and survive package replacement.
- The Python launcher verifies dependency lock fingerprints and prepares each renderer version once.
- Skill guidance now prioritizes natural-language operation and truthful state-based navigation over command memorization.

### Security

- Runtime updates never overwrite user projects, legacy migration never overwrites an existing data root, and Codex import paths remain constrained to the selected project/public roots.

## [0.2.0] - 2026-07-22

### Added

- Isolated Studio projects with copied sources, project-scoped assets, atomic state history and locks.
- Self-contained installable Agent Skill with a bundled renderer, first-run setup wrapper, workflow reference, and UI metadata.
- `create`, `list`, `status`, `plan`, `ingest`, `import`, `validate`, `render`, `resume`, and `doctor` commands.
- Portrait, vertical, square, and landscape presets with dynamic Remotion metadata and proportional layout.
- Shared story, preset, path, process, and storyboard-validation libraries with Node unit tests.
- Reading-speed-aware scene duration and content/settings-addressed generation batches.

### Changed

- Story, upload, and Codex import adapters now support project-scoped workspaces and configurable output paths.
- The Agent Skill now operates the resumable Studio workflow and reports truthful state.
- Share packages include tests, customization guidance, changelog, licenses, and notices.

### Security

- Reject unsafe project identifiers, public-asset path traversal, invalid canvas settings, missing layers, and premature storyboard activation.

## [0.1.0] - 2026-07-22

### Added

- Story Handdrawn Studio renderer and Agent Skill baseline.
- Chinese story planning and ordered-image import workflows.
- Left-to-right `text → bw → color` reveals and optional page-flip transitions.
- Preview and final silent H.264 rendering presets.
- Cross-platform Python entry point with Windows npm resolution.
- Separate clean-clone structure checks and render-time asset checks.

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

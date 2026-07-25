# Release Readiness

Read this file only when maintaining, upgrading, packaging, or publishing the Skill.

## Required release gate

Run from the renderer source repository:

```bash
npm run check
npm run build
npm run package:skill
npm run verify:install
```

`verify:install` copies the packaged Skill into an isolated temporary directory, proves that `version` is read-only, performs a cold dependency setup, requires a strict ready-state doctor report, renders a complete square video with automatic local audio, and requires final machine QA to pass. It deletes the temporary work afterward.

Do not publish when any gate fails. A valid release must also keep the root package, lockfile root package, `VERSION`, Skill `VERSION`, bundled renderer, and marketplace metadata on one semantic version.

## Compatibility and recovery

- Never edit an existing immutable runtime under `~/.story-handdrawn-studio/runtimes/VERSION`.
- Preserve `~/.story-handdrawn-studio/projects/` and `public/projects/` during upgrades.
- Run `version` before and after an upgrade; require `runtime_ready: true` after `setup`.
- Run `doctor --json --strict`; follow its first `next_action` before retrying production.
- Refuse projects with a schema newer than the renderer supports. Upgrade the Skill instead of rewriting project metadata.

## Distribution

The GitHub repository is the source of truth. Publish only a tag that exactly matches `VERSION`; the release workflow rebuilds, tests, cold-installs, renders, verifies QA, and attaches the generated Skill archive.

After installing a new version, start a new Codex task so Skill discovery refreshes.

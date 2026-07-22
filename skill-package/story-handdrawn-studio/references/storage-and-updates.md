# Storage, Privacy, and Updates

Read this file when the user asks where files live, changes machines, upgrades the Skill, or reports missing work.

## Persistent data

By default all user work lives under:

```text
~/.story-handdrawn-studio/
├── projects/              # source copies, settings, storyboards, state, outputs
├── public/projects/       # render-time media assets
├── runtimes/VERSION/      # immutable renderer code and installed dependencies
└── npm-cache/             # private first-run dependency cache
```

Set `STORY_HANDDRAWN_STUDIO_HOME` to an absolute path before invoking the wrapper to choose another data location. Use one stable value across sessions.

The installed Skill contains a clean bundled renderer template. On first use of each release, the launcher copies it to `runtimes/VERSION` and installs locked dependencies there. Project data is never stored in that runtime.

## Upgrade contract

Update by replacing the installed `story-handdrawn-studio` Skill folder with the new release. Do not delete `~/.story-handdrawn-studio/`. The next invocation creates a new versioned runtime and continues using existing projects and assets.

The launcher can copy projects found in a pre-0.3 bundled installation into the persistent data root when the destination is still empty. It never overwrites a newer project directory during migration.

There is no background updater and no automatic remote code download. Runtime code changes only when the user installs a new Skill package or explicitly selects an external renderer.

## Backup and move

Back up the complete data root to preserve sources, generated assets, state, previews, and finals. After moving it, set `STORY_HANDDRAWN_STUDIO_HOME` to the restored absolute path.

Do not back up `runtimes/` if space is limited; those directories can be reconstructed from installed Skill packages. Always retain `projects/` and `public/projects/` together.

## Privacy

- Local text, images, configuration, and rendered files remain in the data root.
- `npm ci` accesses the package registry during first setup for a version.
- Image content leaves the machine only when an image-generation provider or explicit API route is used.
- The Skill does not upload projects, collect telemetry, start background jobs, or modify unrelated files.

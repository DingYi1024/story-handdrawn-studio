#!/usr/bin/env python3
"""Stable launcher for the self-contained Story Handdrawn Studio Skill."""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


SKILL_ROOT = Path(__file__).resolve().parent.parent
BUNDLED_RENDERER = SKILL_ROOT / "assets" / "renderer"
DATA_HOME_ENV = "STORY_HANDDRAWN_STUDIO_HOME"
EXTERNAL_RENDERER_ENV = "STORY_HANDDRAWN_STUDIO_PROJECT"


def executable(*names: str) -> str:
    for name in names:
        found = shutil.which(name)
        if found:
            return found
    raise SystemExit(f"Required command is missing: {' or '.join(names)}")


def data_home() -> Path:
    configured = os.environ.get(DATA_HOME_ENV)
    return (
        Path(configured).expanduser().resolve()
        if configured
        else (Path.home() / ".story-handdrawn-studio").resolve()
    )


def package_version(renderer: Path = BUNDLED_RENDERER) -> str:
    package_path = renderer / "package.json"
    if not package_path.exists():
        raise SystemExit(f"Renderer package is incomplete: {package_path}")
    return str(json.loads(package_path.read_text(encoding="utf-8"))["version"])


def require_renderer(renderer: Path) -> None:
    required = [renderer / "package.json", renderer / "scripts" / "studio.mjs"]
    missing = [str(path) for path in required if not path.exists()]
    if missing:
        raise SystemExit("Renderer is incomplete: " + ", ".join(missing))


def copy_ignore(_directory: str, names: list[str]) -> set[str]:
    excluded = {
        ".DS_Store",
        "__pycache__",
        "node_modules",
        "projects",
        "build",
        "out",
        "release",
    }
    return {name for name in names if name in excluded}


def prepare_versioned_runtime(home: Path, version: str) -> Path:
    require_renderer(BUNDLED_RENDERER)
    runtime_root = home / "runtimes"
    target = runtime_root / version
    if (target / "scripts" / "studio.mjs").exists():
        return target

    runtime_root.mkdir(parents=True, exist_ok=True)
    temporary = Path(tempfile.mkdtemp(prefix=f".{version}-", dir=runtime_root))
    try:
        shutil.copytree(
            BUNDLED_RENDERER,
            temporary,
            dirs_exist_ok=True,
            ignore=copy_ignore,
        )
        try:
            temporary.replace(target)
        except FileExistsError:
            # A concurrent launcher completed the same immutable runtime first.
            pass
    finally:
        if temporary.exists():
            shutil.rmtree(temporary)
    require_renderer(target)
    return target


def renderer_path(home: Path, version: str) -> tuple[Path, str]:
    configured = os.environ.get(EXTERNAL_RENDERER_ENV)
    if configured:
        renderer = Path(configured).expanduser().resolve()
        require_renderer(renderer)
        return renderer, "external"
    return prepare_versioned_runtime(home, version), "bundled"


def dependency_fingerprint(renderer: Path) -> str:
    lock_path = renderer / "package-lock.json"
    if not lock_path.exists():
        raise SystemExit(f"Renderer lockfile is missing: {lock_path}")
    return hashlib.sha256(lock_path.read_bytes()).hexdigest()


def install_dependencies(renderer: Path, home: Path, force: bool = False) -> None:
    fingerprint = dependency_fingerprint(renderer)
    marker = renderer / "node_modules" / ".story-handdrawn-dependencies.json"
    if marker.exists() and not force:
        try:
            if json.loads(marker.read_text(encoding="utf-8")).get("lock_sha256") == fingerprint:
                return
        except (OSError, json.JSONDecodeError):
            pass

    npm = executable("npm.cmd", "npm") if os.name == "nt" else executable("npm")
    npm_cache = home / "npm-cache"
    npm_cache.mkdir(parents=True, exist_ok=True)
    print("Preparing Story Handdrawn Studio (first run for this version)...", flush=True)
    subprocess.run(
        [npm, "ci", "--cache", str(npm_cache), "--prefer-offline", "--no-fund"],
        cwd=renderer,
        check=True,
    )
    marker.write_text(
        json.dumps({"lock_sha256": fingerprint}, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )


def migrate_legacy_data(home: Path) -> list[str]:
    """Copy data left by pre-0.3 installations without overwriting newer work."""
    copied: list[str] = []
    candidates = [
        (BUNDLED_RENDERER / "projects", home / "projects", "projects"),
        (
            BUNDLED_RENDERER / "public" / "projects",
            home / "public" / "projects",
            "public projects",
        ),
    ]
    for source, target, label in candidates:
        if source.exists() and any(source.iterdir()) and not target.exists():
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copytree(source, target)
            copied.append(label)
    return copied


def with_data_root(arguments: list[str], home: Path) -> list[str]:
    if "--data-root" in arguments or any(
        item.startswith("--data-root=") for item in arguments
    ):
        return arguments
    return [*arguments, "--data-root", str(home)]


def run_studio(renderer: Path, arguments: list[str], home: Path) -> int:
    node = executable("node.exe", "node") if os.name == "nt" else executable("node")
    completed = subprocess.run(
        [
            node,
            str(renderer / "scripts" / "studio.mjs"),
            *with_data_root(arguments, home),
        ],
        # Preserve the caller's working directory so relative --input/--image
        # paths behave like a normal CLI while Studio resolves its own code
        # and dependencies from the renderer location.
        cwd=Path.cwd(),
        check=False,
    )
    return completed.returncode


def main() -> int:
    arguments = sys.argv[1:]
    home = data_home()
    skill_version = package_version()
    configured_renderer = os.environ.get(EXTERNAL_RENDERER_ENV)
    renderer_version = (
        package_version(Path(configured_renderer).expanduser().resolve())
        if configured_renderer
        else skill_version
    )
    expected_renderer = (
        Path(configured_renderer).expanduser().resolve()
        if configured_renderer
        else home / "runtimes" / skill_version
    )

    if arguments and arguments[0] in {"where", "version"}:
        print(
            json.dumps(
                {
                    "skill": str(SKILL_ROOT),
                    "renderer": str(expected_renderer),
                    "renderer_source": "external" if configured_renderer else "bundled",
                    "data_root": str(home),
                    "version": renderer_version,
                    "skill_version": skill_version,
                },
                ensure_ascii=False,
                indent=2,
            )
        )
        return 0

    renderer, _source = renderer_path(home, skill_version)
    migrated = migrate_legacy_data(home)
    if migrated:
        print(f"Migrated legacy data: {', '.join(migrated)}", flush=True)

    if arguments and arguments[0] == "setup":
        install_dependencies(renderer, home, force="--force" in arguments[1:])
        return run_studio(renderer, ["doctor", "--json"], home)

    install_dependencies(renderer, home)
    return run_studio(renderer, arguments or ["help"], home)


if __name__ == "__main__":
    raise SystemExit(main())

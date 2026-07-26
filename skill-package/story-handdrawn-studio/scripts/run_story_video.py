#!/usr/bin/env python3
"""Stable launcher for the self-contained Story Handdrawn Studio Skill."""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
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


def recorded_browser_path(marker_data: dict[str, object]) -> Path | None:
    value = marker_data.get("browser_path")
    if not isinstance(value, str) or not value:
        return None
    path = Path(value).expanduser()
    return path if path.exists() else None


def runtime_health(renderer: Path, fingerprint: str | None = None) -> dict[str, object]:
    expected_fingerprint = fingerprint or dependency_fingerprint(renderer)
    marker = renderer / "node_modules" / ".story-handdrawn-dependencies.json"
    cli = renderer / "node_modules" / "@remotion" / "cli"
    browser = renderer / "node_modules" / ".remotion" / "chrome-headless-shell"
    marker_data: dict[str, object] = {}
    if marker.exists():
        try:
            marker_data = json.loads(marker.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            marker_data = {}
    installed_browser = browser if browser.exists() else recorded_browser_path(marker_data)
    checks = {
        "marker": marker.exists(),
        "lock_match": marker_data.get("lock_sha256") == expected_fingerprint,
        "remotion_cli": cli.exists(),
        "browser": installed_browser is not None,
    }
    return {
        "ready": all(checks.values()),
        "checks": checks,
        "marker": str(marker),
        "installed_at": marker_data.get("installed_at"),
        "node": marker_data.get("node"),
    }


def install_dependencies(renderer: Path, home: Path, force: bool = False) -> None:
    fingerprint = dependency_fingerprint(renderer)
    marker = renderer / "node_modules" / ".story-handdrawn-dependencies.json"
    if runtime_health(renderer, fingerprint)["ready"] and not force:
        return

    npm = executable("npm.cmd", "npm") if os.name == "nt" else executable("npm")
    npm_cache = home / "npm-cache"
    npm_cache.mkdir(parents=True, exist_ok=True)
    print("Preparing Story Handdrawn Studio (first run for this version)...", flush=True)
    try:
        subprocess.run(
            [
                npm,
                "ci",
                "--cache",
                str(npm_cache),
                "--prefer-offline",
                "--no-fund",
                "--no-audit",
            ],
            cwd=renderer,
            check=True,
        )
    except subprocess.CalledProcessError as error:
        raise SystemExit(
            "Dependency setup failed. Check network/npm access and free disk space, "
            "then run `setup --force`. "
            f"npm exited with status {error.returncode}; cache: {npm_cache}"
        ) from error

    remotion_cli = renderer / "node_modules" / "@remotion" / "cli" / "remotion-cli.js"
    if not remotion_cli.exists():
        raise SystemExit(
            "Dependency setup did not install the Remotion CLI. "
            "Run `setup --force`; reinstall the Skill if the problem repeats."
        )

    browser = renderer / "node_modules" / ".remotion" / "chrome-headless-shell"
    browser_path: Path | None = browser if browser.exists() else None
    if not browser.exists():
        node = executable("node.exe", "node") if os.name == "nt" else executable("node")
        print("Preparing the locked Remotion browser...", flush=True)
        try:
            browser_result = subprocess.run(
                [node, str(remotion_cli), "browser", "ensure"],
                cwd=renderer,
                check=True,
                capture_output=True,
                text=True,
            )
            if browser_result.stdout:
                print(browser_result.stdout, end="")
            if browser_result.stderr:
                print(browser_result.stderr, end="", file=sys.stderr)
            match = re.search(
                r"Has browser at (.+)",
                f"{browser_result.stdout}\n{browser_result.stderr}",
            )
            if match:
                candidate = Path(match.group(1).strip()).expanduser()
                if candidate.exists():
                    browser_path = candidate.resolve()
            if browser.exists():
                browser_path = browser.resolve()
        except subprocess.CalledProcessError as error:
            raise SystemExit(
                "Remotion browser setup failed. Check network/proxy access and free disk "
                "space, then run `setup --force`. "
                f"Browser setup exited with status {error.returncode}."
            ) from error
    if browser_path is None:
        raise SystemExit(
            "Remotion reported successful browser setup but no usable browser was found. "
            "Run `setup --force`; set a supported Chrome executable if needed."
        )

    marker.write_text(
        json.dumps(
            {
                "lock_sha256": fingerprint,
                "installed_at": datetime.now(timezone.utc).isoformat(),
                "node": subprocess.run(
                    [executable("node.exe", "node") if os.name == "nt" else executable("node"), "--version"],
                    check=False,
                    capture_output=True,
                    text=True,
                ).stdout.strip(),
                "browser_path": str(browser_path),
            },
            ensure_ascii=False,
        )
        + "\n",
        encoding="utf-8",
    )
    health = runtime_health(renderer, fingerprint)
    if not health["ready"]:
        missing = [name for name, ok in health["checks"].items() if not ok]
        raise SystemExit(
            "Runtime verification failed after setup: "
            + ", ".join(missing)
            + ". Run `setup --force`; reinstall the Skill if the problem repeats."
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
        health = (
            runtime_health(expected_renderer)
            if expected_renderer.exists()
            and (expected_renderer / "package-lock.json").exists()
            else {"ready": False, "checks": {}, "installed_at": None, "node": None}
        )
        print(
            json.dumps(
                {
                    "skill": str(SKILL_ROOT),
                    "renderer": str(expected_renderer),
                    "renderer_source": "external" if configured_renderer else "bundled",
                    "data_root": str(home),
                    "version": renderer_version,
                    "skill_version": skill_version,
                    "runtime_ready": health["ready"],
                    "runtime_checks": health["checks"],
                    "runtime_installed_at": health["installed_at"],
                    "runtime_node": health["node"],
                },
                ensure_ascii=False,
                indent=2,
            )
        )
        return 0

    try:
        renderer, _source = renderer_path(home, skill_version)
    except PermissionError as error:
        raise SystemExit(
            f"Cannot create the data/runtime directory at {home}: {error}. "
            f"Set {DATA_HOME_ENV} to a writable absolute directory and retry."
        ) from error
    migrated = migrate_legacy_data(home)
    if migrated:
        print(f"Migrated legacy data: {', '.join(migrated)}", flush=True)

    if arguments and arguments[0] == "setup":
        install_dependencies(renderer, home, force="--force" in arguments[1:])
        return run_studio(renderer, ["doctor", "--json", "--strict"], home)

    install_dependencies(renderer, home)
    return run_studio(renderer, arguments or ["help"], home)


if __name__ == "__main__":
    raise SystemExit(main())

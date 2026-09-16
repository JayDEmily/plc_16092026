#!/usr/bin/env python3
"""Locate one installed OpenAI-bundled browser client without version guessing."""

from __future__ import annotations

import json
import os
from pathlib import Path


def default_codex_root() -> Path:
    configured = os.environ.get("CODEX_HOME")
    if configured:
        return Path(configured)
    profile = os.environ.get("USERPROFILE")
    return Path(profile) / ".codex" if profile else Path.home() / ".codex"


def resolve() -> dict:
    root = default_codex_root() / "plugins/cache/openai-bundled/browser"
    result = {
        "schema": "CCO_BROWSER_RUNTIME_RESOLUTION_V3",
        "status": "FAIL",
        "cache_root": str(root.resolve()),
        "runtime_identity": None,
        "failure": "BROWSER_RUNTIME_UNAVAILABLE",
    }
    try:
        directories = sorted((p for p in root.iterdir() if p.is_dir()), key=lambda p: p.name)
        if len(directories) != 1:
            raise ValueError(f"Expected exactly one installed browser package; found {len(directories)}: "
                             + ", ".join(p.name for p in directories))
        directory = directories[0]
        manifest_path = directory / ".codex-plugin/plugin.json"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        if not isinstance(manifest, dict) or manifest.get("name") != "browser":
            raise ValueError(f"Manifest plugin name must be exactly browser: {manifest_path}")
        if manifest.get("version") != directory.name:
            raise ValueError(f"Manifest version must equal package directory version: {directory}")
        client_path = directory / "scripts/browser-client.mjs"
        if not client_path.is_file():
            raise ValueError(f"Installed browser client is missing: {client_path}")
        result.update(status="PASS", failure=None, runtime_identity={
            "plugin_name": "browser",
            "plugin_version": directory.name,
            "manifest_path": str(manifest_path.resolve()),
            "runtime_client_path": str(client_path.resolve()),
            "runtime_client_import_specifier": client_path.resolve().as_uri(),
        })
    except (OSError, ValueError) as error:
        result["error"] = str(error)
    return result


if __name__ == "__main__":
    resolution = resolve()
    print(json.dumps(resolution, ensure_ascii=False, indent=2))
    raise SystemExit(0 if resolution["status"] == "PASS" else 1)

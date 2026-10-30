"""Companion MCP servers that setup registers next to knowledge-hub when they are installed (1.11.0, 2026-10-07).

A companion is a local tool with its own MCP server that KH's rules rely on. Setup cannot know where a
person installed it, so each companion leaves a DISCOVERY FILE at a fixed place when it starts:

  {"name": "<mcp server name>", "command": "<executable>", "args": ["<script>", ...]}

  companion              discovery file
  app-session-manager    %LOCALAPPDATA%/AppSessionManager/mcp.json   (Windows; written by its tray)

`kh setup` (and so every helper upgrade, which ends with setup) registers each companion it finds, in
the same CLI and the same way as knowledge-hub. A companion installed AFTER setup is caught at session
start: the SessionStart hook adds one line asking the assistant to run setup again (note()).
A new companion is a new CATALOG row, not new code.
"""
from __future__ import annotations

import json
import os
import re
from pathlib import Path

# name -> where its discovery file lives, as (environment variable, path under it)
CATALOG = {
    "app-session-manager": ("LOCALAPPDATA", "AppSessionManager/mcp.json"),
}


def discovery_file(name: str) -> Path | None:
    var, rel = CATALOG[name]
    base = os.getenv(var)
    return Path(base) / rel if base else None


def find() -> list[dict]:
    """The installed companions: [{"name", "command", "args"}], only those whose files still exist."""
    found = []
    for name in CATALOG:
        path = discovery_file(name)
        if path is None or not path.is_file():
            continue
        try:
            spec = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        command, args = spec.get("command"), spec.get("args") or []
        if spec.get("name") != name or not command or not isinstance(args, list):
            continue
        # A moved or uninstalled tool leaves a stale file behind; registering it would give a dead server.
        if not Path(command).is_file() or (args and not Path(args[0]).is_file()):
            continue
        found.append({"name": name, "command": command, "args": [str(a) for a in args]})
    return found


def names() -> list[str]:
    """Every companion name, installed or not: --remove takes each one out."""
    return list(CATALOG)


def registered(cli: str, name: str, profile: Path) -> bool:
    """Whether this CLI's own config already names the server (read only, no CLI call)."""
    from . import owner
    if cli == owner.CLAUDE_CODE:
        files = [profile / ".claude.json"]
        if os.path.normcase(str(profile.expanduser().resolve())) == os.path.normcase(
                str((Path.home() / ".claude").resolve())):
            files.append(Path.home() / ".claude.json")
        for path in files:
            try:
                if name in (json.loads(path.read_text(encoding="utf-8")).get("mcpServers") or {}):
                    return True
            except (OSError, ValueError):
                continue
        return False
    path = profile / ("settings.json" if cli == "gemini" else "config.toml")
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return False
    if cli == "gemini":
        try:
            return name in (json.loads(text).get("mcpServers") or {})
        except ValueError:
            return False
    return re.search(rf'^\[mcp_servers\.(?:{re.escape(name)}|"{re.escape(name)}")\]', text, re.M) is not None


def note(cli: str, profile: Path, helper_python: str) -> str:
    """One line for the SessionStart rules when a companion is installed but this CLI lacks it; "" else."""
    missing = [c["name"] for c in find() if not registered(cli, c["name"], profile)]
    if not missing:
        return ""
    return (f"COMPANION TOOL NOT CONNECTED: {', '.join(missing)} is installed on this machine but this CLI "
            f"has no MCP server for it. When a task needs it, or the person agrees, run "
            f"\"{helper_python}\" -m kh_helper.cli setup (safe to repeat; it registers it next to "
            f"knowledge-hub) and tell the person to restart this app so the new tool loads.")

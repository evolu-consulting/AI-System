"""The assistant CLIs KH connects to, and how each one is set up (1.6.0, 2026-09-28).

KH is meant for every assistant CLI, not only Claude Code. Each CLI keeps its own profile folder, and
the helper copy in that folder serves that CLI alone (owner.py). This module knows, per CLI:

  profile   where its config folder is
  mcp       how the knowledge-hub MCP server is registered there
  hooks     which KH hooks it can run, if any

  CLI           profile                              MCP                                hooks
  claude-code   $CLAUDE_CONFIG_DIR or ~/.claude      `claude mcp add -s user`           settings.json, all five
  grok          $GROK_HOME or ~/.grok                config.toml [mcp_servers.*]        hooks/knowledge-hub.json: PreToolUse, Stop
  codex         $CODEX_HOME or ~/.codex              config.toml [mcp_servers.*]        none
  gemini        ~/.gemini                            settings.json mcpServers           none

Installed companion tools (companions.py, 1.11.0) get their MCP server written the same way, next to KH's.

Grok runs Claude-style hooks but ignores what SessionStart and UserPromptSubmit print, so only the two
hooks whose output it reads are written. A CLI without usable hooks gets KH's rules from the MCP server
instead: its instructions, and the kh_context(event) tool.

WHICH CLI a copy of the helper serves is read from where it is installed: <profile>/kh-helper.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

from . import owner

SERVER = "knowledge-hub"
BACKUP_TAG = ".kh-bak-"     # setup keeps a copy of each file before it changes it; uninstall deletes them


def _env_dir(var: str, default: str) -> Path:
    value = os.getenv(var)
    return Path(value) if value else Path.home() / default


PROFILES = {
    owner.CLAUDE_CODE: lambda: _env_dir("CLAUDE_CONFIG_DIR", ".claude"),
    "grok": lambda: _env_dir("GROK_HOME", ".grok"),
    "codex": lambda: _env_dir("CODEX_HOME", ".codex"),
    "gemini": lambda: Path.home() / ".gemini",
}
NAMES = {owner.CLAUDE_CODE: "Claude Code", "grok": "Grok CLI", "codex": "Codex CLI", "gemini": "Gemini CLI"}
# A folder named like this is that CLI's profile even when its environment variable is not set here.
FOLDER_PREFIX = {".claude": owner.CLAUDE_CODE, ".grok": "grok", ".codex": "codex", ".gemini": "gemini"}


def profile(cli: str) -> Path:
    return PROFILES[cli]()


def cli_of_home(home: Path) -> str | None:
    """The CLI whose profile holds this helper folder, or None when it is in no CLI's profile."""
    parent = owner._resolve(Path(home).parent)
    for cli in PROFILES:
        if owner._resolve(profile(cli)) == parent:
            return cli
    name = Path(home).parent.name.lower()
    for prefix, cli in FOLDER_PREFIX.items():
        if name.startswith(prefix):
            return cli
    return None


def server_command(kh_url: str) -> tuple[str, list[str]]:
    return sys.executable, ["-m", "kh_helper.cli", "--kh-url", kh_url, "mcp"]


def _backup(path: Path) -> str | None:
    if not path.exists():
        return None
    backup = path.with_name(f"{path.name}{BACKUP_TAG}{time.strftime('%Y%m%d-%H%M%S')}")
    shutil.copy2(path, backup)
    return str(backup)


def config_files(cli: str, settings: Path | None = None) -> list[Path]:
    """The files setup writes for this CLI (hooks file aside, which is deleted outright)."""
    if settings:
        return [settings]
    home = profile(cli)
    if cli == owner.CLAUDE_CODE:
        from .hooks import claude_settings_path
        return [claude_settings_path()]
    return [home / ("settings.json" if cli == "gemini" else "config.toml")]


def remove_backups(cli: str, settings: Path | None = None) -> int:
    """Delete the backups setup made (<file>.kh-bak-*): on a borrowed computer they still name KH."""
    count = 0
    for path in config_files(cli, settings):
        for backup in path.parent.glob(f"{path.name}{BACKUP_TAG}*"):
            try:
                backup.unlink()
                count += 1
            except OSError:
                pass
    return count


# ── setup per CLI ────────────────────────────────────────────────────────────

def setup(cli: str, kh_url: str, remove: bool = False, mcp: bool = True, settings: Path | None = None) -> dict:
    """Connect KH to one CLI (or, with remove, take out exactly what this did)."""
    if cli == owner.CLAUDE_CODE:
        from .hooks import claude_settings_path, setup_claude
        return {"cli": cli, **setup_claude(settings or claude_settings_path(), kh_url, remove=remove, mcp=mcp)}
    home = profile(cli)
    result: dict = {"cli": cli}
    if cli == "grok":
        result.update(_grok_hooks(home, remove))
    if mcp:
        if cli in ("grok", "codex"):
            write, path = _toml_mcp, settings or home / "config.toml"
        else:
            write, path = _json_mcp, settings or home / "settings.json"
        result["mcp_server"] = write(path, SERVER, *server_command(kh_url), remove)
        result["companions"] = {c["name"]: write(path, c["name"], c["command"], c["args"], remove)
                                for c in _companions(remove)}
    else:
        result["mcp_server"] = "skipped"
    return result


def _companions(remove: bool) -> list[dict]:
    """The companion servers to write: those installed, or on remove every known name (1.11.0)."""
    from . import companions
    if remove:
        return [{"name": n, "command": "", "args": []} for n in companions.names()]
    return companions.find()


def _grok_hooks(home: Path, remove: bool) -> dict:
    """Grok reads every file in ~/.grok/hooks, so KH's hooks live in one file of their own."""
    path = home / "hooks" / f"{SERVER}.json"
    existed = path.exists()
    if remove:
        if existed:
            path.unlink()
        return {"hooks_file": str(path), "hooks_removed": 2 if existed else 0, "hooks_added": 0}
    from .hooks import HOOKS, hook_exe

    def group(event: str) -> dict:
        g = {"hooks": [{"type": "command", "timeout": 30,
                        "command": f"{hook_exe()} -m kh_helper.cli hook {event} --cli grok"}]}
        if HOOKS[event].get("matcher"):
            g["matcher"] = HOOKS[event]["matcher"]
        return g

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"hooks": {e: [group(e)] for e in ("PreToolUse", "Stop")}}, indent=2) + "\n",
                    encoding="utf-8")
    return {"hooks_file": str(path), "hooks_removed": 2 if existed else 0, "hooks_added": 2}


def _toml_mcp(path: Path, name: str, command: str, args: list[str], remove: bool) -> str:
    """Grok and Codex both read [mcp_servers.<name>] from config.toml. Only that server's table is touched."""
    lines = path.read_text(encoding="utf-8").splitlines() if path.exists() else []
    heads = {f"[mcp_servers.{name}]", f'[mcp_servers."{name}"]'}
    subs = (f"[mcp_servers.{name}.", f'[mcp_servers."{name}".')
    kept, skipping, found = [], False, False
    for line in lines:
        s = line.strip()
        if s.startswith("["):
            skipping = s in heads or s.startswith(subs)
            found = found or skipping
        if not skipping:
            kept.append(line)
    while kept and not kept[-1].strip():
        kept.pop()
    if remove and not found:
        return "not there"
    _backup(path)
    if not remove:
        # JSON strings are valid TOML basic strings for these values (paths and a URL).
        kept += ["", f"[mcp_servers.{name}]", f"command = {json.dumps(command)}",
                 f"args = [{', '.join(json.dumps(a) for a in args)}]"]
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(kept) + "\n", encoding="utf-8")
    return "removed" if remove else name


def _json_mcp(path: Path, name: str, command: str, args: list[str], remove: bool) -> str:
    settings = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    servers = settings.setdefault("mcpServers", {})
    if remove:
        if name not in servers:
            return "not there"
        del servers[name]
        if not servers:
            settings.pop("mcpServers")
    else:
        servers[name] = {"command": command, "args": args}
    _backup(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(settings, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return "removed" if remove else name

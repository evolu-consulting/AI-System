"""node_modules ready before the builder starts (Node apps at the root of a unit's worktree or in sub-folders).

Each unit builds in a fresh git worktree and node_modules is never in git, so every builder began with
`npm install`: its turns waited for it (each turn re-sends the whole context), and some deleted the
package-lock.json it left behind. The engine now installs first, with the stack's own prepare()
(`npm ci --prefer-offline`, `npm install` without a lockfile): after the run's first unit the packages come
from the npm cache, so the next worktrees are ready in seconds.

    ready = prepare(worktree)          # [relative app folders installed]

A REAL install per worktree on purpose, never a link to another checkout's node_modules: the engine and the
agents delete trees in several ways, and a junction there would delete the real dependencies (line.stacks.node).
Only where node_modules is git-ignored (it must never show up in a unit's diff). Never raises: without it the
builder installs, as before.
"""

from __future__ import annotations

import os
import subprocess
from typing import List

from .. import stacks


def _apps(tree: str) -> List[str]:
    out = [tree] if os.path.isfile(os.path.join(tree, "package.json")) else []
    return out + stacks.nested_apps(tree)


def _ignored(worktree: str, rel: str) -> bool:
    """Is <rel>/node_modules git-ignored? Asked of a real (empty) folder: a "node_modules/" pattern only matches a
    directory, and a query path with a trailing slash is matched by stray patterns (a global ignore file whose first
    line is a lone CR matched every such query on one machine). The empty folder goes again right after (an empty
    node_modules would read as installed)."""
    folder = os.path.join(worktree, rel, "node_modules") if rel and rel != "." else os.path.join(worktree, "node_modules")
    path = ((rel + "/") if rel and rel != "." else "") + "node_modules"
    made = not os.path.exists(folder)
    flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    try:
        if made:
            os.makedirs(folder)
        ok = subprocess.run(["git", "check-ignore", "-q", path.replace("\\", "/")], cwd=worktree,
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=flags,
                            timeout=30).returncode == 0
    except (OSError, subprocess.SubprocessError):
        ok = False
    if made:
        try:
            os.rmdir(folder)
        except OSError:
            pass
    return ok


def prepare(worktree: str, log=None) -> List[str]:
    """Install node_modules of every Node app of `worktree` that has none yet. Returns the app folders done."""
    say = log or (lambda m: None)
    done: List[str] = []
    try:
        for app in _apps(worktree):
            rel = os.path.relpath(app, worktree)
            if os.path.isdir(os.path.join(app, "node_modules")) or not _ignored(worktree, rel):
                continue
            lock = os.path.join(app, "package-lock.json")
            had_lock = os.path.exists(lock)
            why = stacks.STACKS["react"].prepare(app)
            if not had_lock and os.path.exists(lock):
                try:                         # `npm install` without a lockfile writes one: outside the unit's claims
                    os.remove(lock)
                except OSError:
                    pass
            if why:
                say("node_modules for %s not installed: %s" % (rel, why))
            else:
                done.append(rel.replace("\\", "/"))
    except Exception as e:   # noqa: BLE001 - installing first saves turns; the builder can still install
        say("node_modules not installed: %s" % e)
    return done


__all__ = ["prepare"]

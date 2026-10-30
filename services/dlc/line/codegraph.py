"""Code graph of the target repository, built locally by Graphify (AST only: no model, no API key).

The agents of a run used to learn the code by reading it (Glob / Grep / Read turns, each one paid as model
tokens). Graphify parses the repository once into a graph (files, classes, functions, calls, imports) and answers
structural questions from it for free:

    info = refresh(cfg, repo, run=run)     # extract (incremental after the first time) -> {"ok", "graph", ...}
    text = ask(cfg, run, "query", {"question": "where are notes saved"})
    text = ask(cfg, run, "explain", {"name": "saveNote"})       # a node and its neighbours
    text = ask(cfg, run, "affected", {"name": "saveNote"})      # what depends on it (impact of a change)
    text = ask(cfg, run, "path", {"a": "App", "b": "db"})
    text = summary(cfg, run)                                   # the hubs, for prompts (sizer, planner)

The index lives OUTSIDE the repository (<codegraph_dir>/<repo name>-<hash>/graphify-out/), so a scan never
dirties the checkout or a commit. `graphify extract --code-only` honours the repository's .gitignore (no
node_modules, no build output). Install: deploy/windows/install-graphify.ps1 (or deploy/linux/install-graphify.sh)
puts graphify under DLC_HOME/tools/graphify; LINE_GRAPHIFY names another executable.

Off when graphify is not installed (LINE_CODEGRAPH=auto) or LINE_CODEGRAPH=0. Never raises: a run without a
graph works as before, its agents read the code themselves.
"""

from __future__ import annotations

import hashlib
import os
import re
import shutil
import subprocess
import threading
import time
from typing import Any, Dict, List, Optional

TOOL = "code_graph"
OPS = ("query", "explain", "affected", "path", "hubs")
MAX_CHARS = 6000
QUERY_TIMEOUT_S = 60

_lock = threading.Lock()
#: run -> {"repo", "graph", "nodes", "edges"}: the graph the agents of that run query (set by refresh)
_RUNS: Dict[str, Dict[str, Any]] = {}
_COUNTS = re.compile(r"(\d+)\s+nodes,\s+(\d+)\s+edges")


def _home() -> str:
    return os.environ.get("DLC_HOME", "").strip() or os.path.join(os.path.expanduser("~"), "dlc")


def exe(cfg: Any) -> str:
    """The graphify executable: LINE_GRAPHIFY, else DLC_HOME/tools/graphify (the install script's venv), else PATH."""
    named = str(getattr(cfg, "graphify", "") or "").strip()
    if named:
        return named if os.path.isfile(named) else (shutil.which(named) or "")
    base = os.path.join(_home(), "tools", "graphify")
    for rel in (("Scripts", "graphify.exe"), ("bin", "graphify")):
        p = os.path.join(base, *rel)
        if os.path.isfile(p):
            return p
    return shutil.which("graphify") or ""


def enabled(cfg: Any) -> bool:
    mode = str(getattr(cfg, "codegraph", "auto") or "auto").strip().lower()
    if mode in ("0", "off", "false", "no"):
        return False
    return bool(exe(cfg))


def index_dir(cfg: Any, repo: str) -> str:
    base = str(getattr(cfg, "codegraph_dir", "") or "") or os.path.join(str(getattr(cfg, "workroot", "") or _home()),
                                                                          "codegraph")
    full = os.path.normcase(os.path.abspath(repo))
    name = re.sub(r"[^A-Za-z0-9_.-]+", "_", os.path.basename(os.path.abspath(repo).rstrip("\\/")) or "repo")
    return os.path.join(base, "%s-%s" % (name, hashlib.sha1(full.encode("utf-8")).hexdigest()[:8]))


def graph_path(cfg: Any, repo: str) -> str:
    return os.path.join(index_dir(cfg, repo), "graphify-out", "graph.json")


def _env() -> Dict[str, str]:
    """No credentials reach graphify: with --code-only it needs none, and without a key it can never call a model."""
    from .llm.cli import scrub_env
    env = scrub_env(os.environ)
    env.update(PYTHONIOENCODING="utf-8", PYTHONUTF8="1", NO_COLOR="1")
    return env


def _run(argv: List[str], cwd: str, timeout: int) -> subprocess.CompletedProcess:
    from .procjob import Job
    flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    proc = subprocess.Popen(argv, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL,
                            text=True, encoding="utf-8", errors="replace", env=_env(), creationflags=flags)
    job = Job.attach(proc)
    try:
        out, _ = proc.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        proc.kill()
        out, _ = proc.communicate()
        raise TimeoutError("graphify did not finish within %ds" % timeout) from None
    finally:
        if job is not None:
            job.close()
    return subprocess.CompletedProcess(argv, proc.returncode, out, "")


def refresh(cfg: Any, repo: str, run: str = "", log: Any = None) -> Dict[str, Any]:
    """(Re)build the graph of `repo` (incremental: graphify skips unchanged files) and attach it to `run`.
    -> {"ok", "graph", "nodes", "edges", "ms"} or {"ok": False, "error"}."""
    say = log or (lambda m: None)
    if not repo or not os.path.isdir(repo) or not enabled(cfg):
        return {"ok": False, "error": "off" if repo else "no repository"}
    out_dir = index_dir(cfg, repo)
    os.makedirs(out_dir, exist_ok=True)
    workers = str(max(1, min(4, (os.cpu_count() or 2) // 2)))
    argv = [exe(cfg), "extract", os.path.abspath(repo), "--code-only", "--max-workers", workers, "--out", out_dir]
    t0 = time.monotonic()
    try:
        cp = _run(argv, out_dir, int(getattr(cfg, "codegraph_timeout_s", 300) or 300))
    except (OSError, TimeoutError) as e:
        say("%s: code graph: %s" % (run or "-", e))
        return {"ok": False, "error": str(e)[:300]}
    gp = os.path.join(out_dir, "graphify-out", "graph.json")
    ms = int((time.monotonic() - t0) * 1000)
    if cp.returncode != 0 or not os.path.isfile(gp):
        tail = (cp.stdout or "").strip()[-400:]
        say("%s: code graph failed (exit %s): %s" % (run or "-", cp.returncode, tail))
        return {"ok": False, "error": "graphify exit %s: %s" % (cp.returncode, tail), "ms": ms}
    m = None
    for m in _COUNTS.finditer(cp.stdout or ""):
        pass
    info = {"ok": True, "repo": os.path.abspath(repo), "graph": gp, "ms": ms,
            "nodes": int(m.group(1)) if m else 0, "edges": int(m.group(2)) if m else 0}
    if run:
        with _lock:
            _RUNS[run] = info
    say("%s: code graph %d nodes, %d edges (%d ms)" % (run or "-", info["nodes"], info["edges"], ms))
    return info


def attached(run: str) -> Optional[Dict[str, Any]]:
    with _lock:
        return dict(_RUNS[run]) if run in _RUNS else None


def detach(run: str) -> None:
    with _lock:
        _RUNS.pop(run, None)


def _clip(text: str, limit: int = MAX_CHARS) -> str:
    text = (text or "").strip()
    return text if len(text) <= limit else text[:limit] + "\n... (cut at %d chars; ask a narrower question)" % limit


def ask(cfg: Any, run: str, op: str, args: Dict[str, Any]) -> str:
    """Answer one code_graph tool call from the run's graph. Raises ValueError for a bad call or no graph."""
    info = attached(run)
    if info is None:
        raise ValueError("No code graph for this run (graphify is not installed or the scan failed): "
                         "read the code with Glob / Grep / Read instead.")
    op = (op or "query").strip().lower()
    if op not in OPS:
        raise ValueError("op must be one of %s" % ", ".join(OPS))
    g = ["--graph", info["graph"]]
    if op == "query":
        q = str(args.get("question") or args.get("query") or "").strip()
        if not q:
            raise ValueError("question is required for op query")
        budget = max(300, min(int(args.get("budget") or 1500), 4000))
        argv = [exe(cfg), "query", q, "--budget", str(budget)] + g
    elif op in ("explain", "affected"):
        name = str(args.get("name") or "").strip()
        if not name:
            raise ValueError("name is required for op %s" % op)
        argv = [exe(cfg), op, name] + g
    elif op == "path":
        a, b = str(args.get("a") or "").strip(), str(args.get("b") or "").strip()
        if not a or not b:
            raise ValueError("a and b are required for op path")
        argv = [exe(cfg), "path", a, b] + g
    else:
        argv = [exe(cfg), "god-nodes", "--top", str(max(5, min(int(args.get("top") or 15), 40)))] + g
    try:
        cp = _run(argv, os.path.dirname(info["graph"]), QUERY_TIMEOUT_S)
    except (OSError, TimeoutError) as e:
        raise ValueError("graphify did not answer: %s" % e) from None
    text = (cp.stdout or "").strip()
    head = "Code graph of %s (graphify, %s nodes; file:line refs are relative to the repository root)\n" % (
        os.path.basename(info["repo"]), info.get("nodes") or "?")
    return _clip(head + (text or "(no answer)"))


def summary(cfg: Any, run: str, top: int = 15) -> str:
    """The most connected nodes of the run's graph (the code's hubs), '' without a graph. For prompts."""
    if attached(run) is None:
        return ""
    try:
        return ask(cfg, run, "hubs", {"top": top})
    except ValueError:
        return ""


__all__ = ["TOOL", "OPS", "exe", "enabled", "index_dir", "graph_path", "refresh", "attached", "detach", "ask",
           "summary"]

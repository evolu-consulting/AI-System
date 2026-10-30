"""Projects: a named application the engine keeps a repository for, so a frontend never handles server paths.

A project owns one git repository the engine places under DLC_HOME/targets/<project id>. Its first run is
usually New System (the empty folder becomes the repository); later Enhancement and Bug Fix runs work on the
same repository, so every run builds on the previous ones. Enhancement and Bug Fix runs of one project run
at the same time: they understand, design and plan in parallel, and their project's change queue
(line.changequeue) lets them change the repository one at a time, first come first served. A New System, a
migration or any other flow owns the project alone (a start next to another live run answers 409).

Registry: DLC_HOME/projects.json (a list; small, written atomically under a lock). Runs belong to a project
through their detail.project (set by POST /api/runs {"project"}); older runs are matched by target path.

Workspace root (DLC_WORKSPACE_ROOT, optional): one folder the engine may use for code that already exists.
A project can then start from a folder picked under that root, or from a git URL cloned into it (an access
token is used for the clone only and never stored). Every path is resolved (links included) and must stay
inside the root; the frontend sees paths relative to it. The engine needs a git repository with branch main
checked out and no uncommitted changes, or an empty folder (New System makes the repository).

GET  /api/projects                 {"projects": [project]}               newest first
POST /api/projects {"name", "description"?, "source"?}  -> 201 project
     source {"kind": "new"} (default)                                   folder chosen by the engine
            {"kind": "folder", "path": <relative to the root>}          an existing folder under the root
            {"kind": "git", "url", "token"?, "folder"?}                 cloned into <root>/<folder>
     rag_project?: an existing project of the knowledge store to link (default: dlc-<id>, made on demand)
GET  /api/projects/{id}            {"project", "runs": [run summary]}    runs newest first
GET  /api/workspace?path=<rel>     {"root", "path", "folders": [entry]}  one level of the workspace root
"""

from __future__ import annotations

import base64
import json
import os
import re
import shutil
import subprocess
import threading
from typing import Any, Callable, Dict, List, Optional, Tuple

from . import codes
from .codes import LineError
from .contracts import E_ESCALATION, E_LLM_CALL, E_RUN, TERMINAL_RUN_STATES
from .contracts import now_ms
from .ship._util import child_env

_lock = threading.Lock()
_ID = re.compile(r"^[a-z0-9][a-z0-9-]{0,47}$")
_RAG_ID = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")


def rag_of(row: Dict[str, Any]) -> str:
    """The knowledge store project of a DLC project (rows made before the mapping get dlc-<id>)."""
    return str(row.get("rag_project") or "dlc-" + row["id"])


def home() -> str:
    return os.environ.get("DLC_HOME", "").strip() or os.path.join(os.path.expanduser("~"), "dlc")


def workspace_root() -> str:
    """The folder existing code may come from ('' = this engine offers new projects only)."""
    r = os.environ.get("DLC_WORKSPACE_ROOT", "").strip()
    return os.path.realpath(r) if r and os.path.isdir(r) else ""


def _registry() -> str:
    return os.path.join(home(), "projects.json")


def _slug(s: str) -> str:
    t = re.sub(r"[^A-Za-z0-9]+", "-", s or "").strip("-").lower() or "project"
    return t[:40].strip("-")


def _load() -> List[Dict[str, Any]]:
    p = _registry()
    if not os.path.isfile(p):
        return []
    with open(p, encoding="utf-8") as fh:
        data = json.load(fh)
    return data if isinstance(data, list) else []


def _save(rows: List[Dict[str, Any]]) -> None:
    p = _registry()
    os.makedirs(os.path.dirname(p), exist_ok=True)
    tmp = p + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(rows, fh, indent=1)
    os.replace(tmp, p)


def _norm(path: str) -> str:
    return os.path.normcase(os.path.abspath(path)) if path else ""


def _safe(*paths: str) -> List[str]:
    """git -c options trusting these repositories for one command. The engine service runs as another account
    (LocalSystem) than the owner of the folders in the workspace root, so git refuses them ('dubious
    ownership'). Git compares the repository and its .git folder in whichever slash form it computed, so
    every form is listed; -c reaches git's own subprocesses (upload-pack of a clone or fetch) too."""
    out: List[str] = []
    for p in paths:
        if not p:
            continue
        a = os.path.abspath(p)
        for form in (a, a.replace("\\", "/")):
            for v in (form, form + "/.git", form + "\\.git"):
                if v not in out:
                    out.append(v)
    return [x for v in out for x in ("-c", "safe.directory=" + v)]


def _trust(path: str) -> None:
    """Also record the source repository as safe in the engine account's global git config: git drops -c
    options for the receive-pack / upload-pack it starts on a local repository (push, fetch)."""
    have = subprocess.run(["git", "config", "--global", "--get-all", "safe.directory"], capture_output=True,
                          text=True, encoding="utf-8", errors="replace", env=child_env(), timeout=15).stdout or ""
    have_set = {l.strip() for l in have.splitlines()}
    for v in _safe(path)[1::2]:
        v = v.split("=", 1)[1]
        if v not in have_set:
            subprocess.run(["git", "config", "--global", "--add", "safe.directory", v], capture_output=True,
                           env=child_env(), timeout=15)


def _git(cwd: str, *args: str, timeout: float = 30, trust: Tuple[str, ...] = ()) -> subprocess.CompletedProcess:
    return subprocess.run(["git"] + _safe(cwd, *trust) + ["-C", cwd] + list(args), capture_output=True, text=True,
                          encoding="utf-8", errors="replace", env=child_env(), timeout=timeout)


def _inside(root: str, rel: Any) -> str:
    """The real path of root/rel, refused unless it stays inside the root (no '..', no link out of it)."""
    rel = str(rel or "").strip().replace("\\", "/")
    if not root:
        raise ValueError("this engine has no workspace root (DLC_WORKSPACE_ROOT)")
    if rel.startswith("/"):
        raise ValueError("path must be relative to the workspace root")
    rel = rel.rstrip("/")
    if not rel or os.path.isabs(rel) or ":" in rel or any(x in ("..", ".") for x in rel.split("/")):
        raise ValueError("path must be a folder inside the workspace root, relative to it")
    real = os.path.realpath(os.path.join(root, rel))
    if os.path.normcase(os.path.commonpath([real, root])) != os.path.normcase(root) or _norm(real) == _norm(root):
        raise ValueError("path is outside the workspace root")
    return real


def _rel(root: str, path: str) -> str:
    return os.path.relpath(path, root).replace("\\", "/") if root and path else ""


#: Never copied into a working copy (dependencies, build output, secrets, local tool state).
SKIP_DIRS = {".git", "node_modules", ".venv", "venv", "env", "__pycache__", "dist", "build", "bin", "obj", "target",
             ".next", ".nuxt", ".idea", ".vs", ".vscode", "coverage", ".pytest_cache", ".mypy_cache", ".gradle"}
SKIP_FILE = re.compile(r"^(\.env(\..*)?|.*\.(log|pyc|pyo|tmp|swp))$", re.I)
CODE_EXT = {".py", ".js", ".jsx", ".ts", ".tsx", ".java", ".kt", ".cs", ".go", ".rb", ".php", ".vue", ".svelte",
            ".rs", ".c", ".cc", ".cpp", ".h", ".hpp", ".swift", ".scala", ".sql", ".html", ".css", ".scss", ".abap",
            ".cds", ".sh", ".ps1"}
MAX_COPY_FILES = 20000
MAX_FILE_BYTES = 50 * 1024 * 1024


def _walk(path: str, depth: int = 99):
    """Folders under path, dependency / build / tool folders and links left out."""
    base = os.path.abspath(path).rstrip("\\/").count(os.sep)
    for d, dirs, files in os.walk(path):
        dirs[:] = [x for x in dirs if x not in SKIP_DIRS and not os.path.islink(os.path.join(d, x))]
        if os.path.abspath(d).count(os.sep) - base >= depth:
            dirs[:] = []
        yield d, dirs, files


def _nested_repos(path: str) -> List[str]:
    out = []
    for d, dirs, _ in _walk(path, depth=3):
        for x in list(dirs):
            if os.path.exists(os.path.join(d, x, ".git")):
                out.append(os.path.relpath(os.path.join(d, x), path).replace("\\", "/"))
                dirs.remove(x)
    return out[:10]


def _looks_like_code(path: str) -> bool:
    n = 0
    for _, _, files in _walk(path):
        for f in files:
            n += 1
            if os.path.splitext(f)[1].lower() in CODE_EXT:
                return True
            if n > 5000:
                return False
    return False


def _head(path: str) -> Tuple[str, str]:
    """(branch, commit) of a repository ('' branch = detached HEAD; '' commit = no commit yet)."""
    head = _git(path, "symbolic-ref", "-q", "HEAD")
    sha = _git(path, "rev-parse", "-q", "--verify", "HEAD^{commit}")
    return ((head.stdout or "").strip().replace("refs/heads/", ""),
            (sha.stdout or "").strip() if sha.returncode == 0 else "")


def inspect(path: str) -> Dict[str, Any]:
    """What the engine does with a folder, and why it cannot be used ('' = it can):
    empty = the engine builds right there; git = the engine works on its own clone of the current commit
    (uncommitted changes stay out); files = the engine works on its own copy, the folder is not changed."""
    if not os.listdir(path):
        return {"kind": "empty", "has_code": False, "why": ""}
    if os.path.exists(os.path.join(path, ".git")):
        branch, sha = _head(path)
        if sha:
            dirty = [l for l in (_git(path, "status", "--porcelain").stdout or "").splitlines() if l.strip()]
            return {"kind": "git", "branch": branch, "has_code": True, "uncommitted": len(dirty), "why": ""}
    nested = _nested_repos(path)
    if nested:
        return {"kind": "files", "has_code": True, "nested": nested,
                "why": "holds git repositories (%s): open it and pick the one to work on" % ", ".join(nested[:3])}
    return {"kind": "files", "has_code": _looks_like_code(path), "why": ""}


def _used(rows: List[Dict[str, Any]]) -> Dict[str, str]:
    out = {}
    for r in rows:
        for k in ("path", "source_path"):
            if r.get(k):
                out[_norm(r[k])] = r["id"]
    return out


def _entry(root: str, p: str, used: Dict[str, str]) -> Dict[str, Any]:
    e: Dict[str, Any] = {"name": os.path.basename(p), "path": _rel(root, p)}
    try:
        e.update(inspect(p))
    except (OSError, subprocess.SubprocessError) as ex:
        e.update(kind="unreadable", has_code=False, why=str(ex)[:200])
    if used.get(_norm(p)):
        e.update(project=used[_norm(p)], why="already the folder of project %s" % used[_norm(p)])
    return e


def workspace(rel: str = "") -> Dict[str, Any]:
    """One level of the workspace root (and the folder itself as 'current'): what a project started from each
    folder would do, and which project already uses it."""
    root = workspace_root()
    if not root:
        return {"root": "", "path": "", "folders": [], "current": None}
    here = _inside(root, rel) if str(rel or "").strip("/\\ ") else root
    if not os.path.isdir(here):
        raise LineError(codes.NOT_FOUND, "folder %s" % rel, {"path": rel})
    used = _used(_load())
    out = []
    for n in sorted(os.listdir(here), key=str.lower)[:500]:
        p = os.path.join(here, n)
        if n.startswith(".") or n in SKIP_DIRS or not os.path.isdir(p) or _norm(os.path.realpath(p)) != _norm(p):
            continue                                  # hidden, dependency folders and links are not offered
        out.append(_entry(root, p, used))
    return {"root": root, "path": _rel(root, here) if here != root else "", "folders": out,
            "current": _entry(root, here, used) if here != root else None}


# ------------------------------------------------------------------ git hosts

_GIT_URL = re.compile(r"^(https?://\S+|ssh://\S+|[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:\S+)$")
#: The user name each host expects with an access token over https (Basic auth).
TOKEN_USER = {"github": "x-access-token", "gitlab": "oauth2", "bitbucket": "x-token-auth"}


def provider(url: str) -> str:
    host = re.sub(r"^[a-z+]+://", "", url.lower()).split("/")[0].split("@")[-1].split(":")[0]
    return next((name for name in TOKEN_USER if name in host), "git")


def _auth(url: str, token: str, user: str = "") -> List[str]:
    """git -c options carrying the token for one command: it never lands in the url, .git/config or a log."""
    if not token:
        return []
    who = user or TOKEN_USER.get(provider(url), "x-access-token")
    basic = base64.b64encode(("%s:%s" % (who, token)).encode()).decode()
    return ["-c", "http.extraHeader=Authorization: Basic " + basic]


def _run_git(argv: List[str], secret: str = "", timeout: float = 900,
             trust: Tuple[str, ...] = ()) -> subprocess.CompletedProcess:
    try:
        own = (argv[1],) if argv[:1] == ["-C"] else ()      # the repository the command runs in
        # core.autocrlf=false like the pipeline's git (ship._util.git): with the engine running as a person whose
        # global config says autocrlf=true, a checkout would write CRLF files the pipeline then sees as changed
        cp = subprocess.run(["git", "-c", "core.autocrlf=false"] + _safe(*own, *trust) + argv, capture_output=True,
                            text=True, encoding="utf-8", errors="replace",
                            env=child_env(), timeout=timeout)
    except subprocess.TimeoutExpired:
        raise LineError(codes.BUILD_FAIL, "git took longer than %d minutes" % (timeout // 60), {})
    if cp.returncode != 0:
        err = cp.stderr or cp.stdout or ""
        if secret:
            err = err.replace(secret, "***")
        raise LineError(codes.BUILD_FAIL, "git failed: %s" % err.strip()[-500:], {})
    return cp


def _clone(root: str, src: Dict[str, Any], folder: str) -> str:
    url = str(src.get("url") or "").strip()
    token = str(src.get("token") or "").strip()
    branch = str(src.get("branch") or "").strip()
    if not _GIT_URL.match(url):
        raise ValueError("url must be an https, ssh or user@host:path git address")
    if token and not url.startswith("https://"):
        raise ValueError("an access token works with an https url only")
    if branch and not re.match(r"^[A-Za-z0-9._/-]{1,200}$", branch):
        raise ValueError("branch name has characters git does not allow")
    dest = os.path.join(root, folder)
    if os.path.exists(dest):
        raise LineError(codes.STATE_CONFLICT, "folder %s already exists in the workspace root" % folder,
                        {"path": folder})
    try:
        _run_git(_auth(url, token, str(src.get("username") or "").strip()) + ["clone", "-q"]
                 + (["--branch", branch] if branch else []) + ["--", url, dest], secret=token)
    except LineError:
        shutil.rmtree(dest, ignore_errors=True)
        raise
    return dest


def _clone_folder(src: Dict[str, Any], url: str, name: str) -> str:
    last = url.rstrip("/").rsplit("/", 1)[-1].rsplit(":", 1)[-1]
    if last.endswith(".git"):
        last = last[:-4]
    return _slug(str(src.get("folder") or "") or last or name)


# ------------------------------------------------------------------ the engine's working copy

def _working_clone(source: str, dest: str) -> Dict[str, str]:
    """The engine's own clone of a repository's current commit, on local branch main (the engine's branch)."""
    _trust(source)
    branch, sha = _head(source)
    _run_git(["clone", "-q", "--no-hardlinks", "--", source, dest], trust=(source,))
    _run_git(["-C", dest, "config", "core.autocrlf", "false"])   # agents' own git sees what the engine sees
    _run_git(["-C", dest, "checkout", "-q", "-B", "main", sha])
    return {"source_branch": branch, "source_commit": sha}


def _ignored(d: str, names: List[str]) -> List[str]:
    out = []
    for n in names:
        p = os.path.join(d, n)
        if os.path.islink(p) or (os.path.isdir(p) and n in SKIP_DIRS):
            out.append(n)
        elif os.path.isfile(p) and (SKIP_FILE.match(n) or os.path.getsize(p) > MAX_FILE_BYTES):
            out.append(n)
    return out


def _working_copy(source: str, dest: str) -> int:
    """The engine's own copy of a folder without git: files copied (dependencies, build output, secrets and
    large files left out), then one baseline commit on main. The folder itself is not changed."""
    n = sum(len(f) for _, _, f in _walk(source))
    if n > MAX_COPY_FILES:
        raise ValueError("folder has %d files (more than %d without dependencies): pick the code folder inside it"
                         % (n, MAX_COPY_FILES))
    shutil.copytree(source, dest, ignore=_ignored)
    rules = "\n".join(sorted(x + "/" for x in SKIP_DIRS if x != ".git")) + "\n.env\n.env.*\n*.log\n"
    gi = os.path.join(dest, ".gitignore")
    with open(gi, "a", encoding="utf-8", newline="\n") as fh:
        fh.write("\n# DLC working copy\n" + rules)
    _run_git(["-C", dest, "init", "-q"])
    _run_git(["-C", dest, "config", "core.autocrlf", "false"])
    _run_git(["-C", dest, "symbolic-ref", "HEAD", "refs/heads/main"])
    _run_git(["-C", dest, "add", "-A"])
    _run_git(["-C", dest, "-c", "gc.auto=0", "commit", "-q", "--allow-empty", "-m",
              "baseline: files of %s" % os.path.basename(source)])
    return n


def sync(project: Dict[str, Any]) -> str:
    """Before a run: bring commits made on the source branch since the last run into the working copy
    (fast-forward or merge). '' = up to date, else why not (the run is refused, nothing changed)."""
    src, wc, branch = project.get("source_path"), project.get("path"), project.get("source_branch")
    if project.get("source_kind") != "git" or not src or not wc or not branch or not os.path.isdir(src):
        return ""
    _trust(src)
    if _git(wc, "fetch", "-q", "origin", branch, timeout=300, trust=(src,)).returncode != 0:
        return "could not read branch %s of the source repository" % branch
    if _git(wc, "merge-base", "--is-ancestor", "FETCH_HEAD", "HEAD").returncode == 0:
        return ""
    if _git(wc, "merge", "-q", "--no-edit", "FETCH_HEAD", timeout=300).returncode != 0:
        _git(wc, "merge", "--abort")
        return ("branch %s of the source changed the same lines as the engine's work: use Push to source, merge "
                "branch dlc/%s there, then run again" % (branch, project["id"]))
    return ""


def deliver(pid: str) -> Dict[str, Any]:
    """Push the engine's work to the source repository as branch dlc/<project id> (the source's own branches
    and working folder are not touched)."""
    project = get(pid)
    if project.get("source_kind") != "git":
        raise LineError(codes.STATE_CONFLICT, "project %s has no source repository: its code stays in the engine's "
                        "working copy" % pid, {"project": pid})
    branch = "dlc/" + pid
    _trust(project["source_path"])
    _run_git(["-C", project["path"], "push", "-q", "--force", "origin", "main:refs/heads/" + branch], timeout=300,
             trust=(project["source_path"], project["path"]))
    return {"project": pid, "branch": branch, "commit": _git(project["path"], "rev-parse", "HEAD").stdout.strip()}


def create(body: Dict[str, Any], actor: str = "") -> Dict[str, Any]:
    name = str(body.get("name") or "").strip()
    if not name:
        raise ValueError("body needs {\"name\": <project name>}")
    if len(name) > 80:
        raise ValueError("name is longer than 80 characters")
    src = body.get("source") or {}
    kind = str(src.get("kind") or "new") if isinstance(src, dict) else ""
    if kind not in ("new", "folder", "git"):
        raise ValueError("source.kind must be new, folder or git")
    root = workspace_root()
    if kind != "new" and not root:
        raise ValueError("this engine has no workspace root (DLC_WORKSPACE_ROOT): only new projects")
    base = _slug(name)
    with _lock:
        rows = _load()
        taken = {r["id"] for r in rows}
        pid, n = base, 2
        while pid in taken or os.path.exists(os.path.join(home(), "targets", pid)):
            pid, n = "%s-%d" % (base, n), n + 1
        rp = str(body.get("rag_project") or "").strip()
        if rp:
            if not _RAG_ID.match(rp):
                raise ValueError("rag_project is not a RAG System project id")
            owner = next((r["id"] for r in rows if rag_of(r) == rp), "")
            if owner:
                raise LineError(codes.STATE_CONFLICT, "RAG project %s is already linked to project %s" % (rp, owner),
                                {"project": owner})
        row: Dict[str, Any] = {"id": pid, "name": name, "description": str(body.get("description") or "").strip()[:2000],
                               "source": kind, "rag_project": rp or "dlc-" + pid, "created_ms": now_ms(),
                               "created_by": actor,
                               # the Deliver step of every run (pipeline._deliver): branch = push dlc/<id>; off = keep
                               "deliver": "off" if str(body.get("deliver") or "").lower() == "off" else "branch"}
        wc = os.path.join(home(), "targets", pid)
        if kind == "new":
            path = wc
            os.makedirs(path)
        else:
            if kind == "folder":
                source = _inside(root, src.get("path"))
                if not os.path.isdir(source):
                    raise LineError(codes.NOT_FOUND, "folder %s" % src.get("path"), {"path": src.get("path")})
                owner = _used(rows).get(_norm(source))
                if owner:
                    raise LineError(codes.STATE_CONFLICT, "folder is already the folder of project %s" % owner,
                                    {"project": owner})
            else:
                url = str(src.get("url") or "").strip()
                source = _clone(root, src, _clone_folder(src, url, name))
                row["repo_url"], row["provider"] = re.sub(r"//[^/@]+@", "//", url), provider(url)   # no credentials
            info = inspect(source)
            if info["why"]:
                raise ValueError("folder %s %s" % (_rel(root, source), info["why"]))
            row.update(source_path=source, source_kind=info["kind"], has_code=info["has_code"])
            try:
                if info["kind"] == "empty":
                    path = source                      # nothing to protect: New System builds right there
                elif info["kind"] == "git":
                    path = wc
                    row.update(_working_clone(source, wc), uncommitted_left_out=info.get("uncommitted", 0))
                else:
                    path = wc
                    row["copied_files"] = _working_copy(source, wc)
            except Exception:
                shutil.rmtree(wc, ignore_errors=True)
                raise
        row["path"] = path
        rows.append(row)
        _save(rows)
    return _public(row)


def _public(row: Dict[str, Any]) -> Dict[str, Any]:
    """Server paths stay on the server; a workspace project shows its folder relative to the workspace root."""
    out = {k: v for k, v in row.items() if k not in ("path", "source_path")}
    out["rag_project"] = rag_of(row)
    if row.get("source", "new") != "new":
        out["workspace_path"] = _rel(workspace_root(), row.get("source_path") or row.get("path") or "")
    return out


def get(pid: str) -> Dict[str, Any]:
    if not _ID.match(pid or ""):
        raise LineError(codes.NOT_FOUND, "project %s" % pid, {"project": pid})
    for r in _load():
        if r["id"] == pid:
            return r
    raise LineError(codes.NOT_FOUND, "project %s" % pid, {"project": pid})


def runs_of(store: Any, project: Dict[str, Any]) -> List[Dict[str, Any]]:
    path = _norm(project["path"])
    out = []
    for r in store.query(E_RUN):
        d = r.get("detail") or {}
        if d.get("project") == project["id"] or (not d.get("project") and _norm(d.get("target") or "") == path):
            out.append(r)
    return sorted(out, key=lambda r: r.get("created_ms", 0), reverse=True)


def _delivered(project: Dict[str, Any], runs: List[Dict[str, Any]]) -> bool:
    """True once a run of the project has completed (green), or when the project started from existing code:
    its repository then holds an application to enhance or fix."""
    return bool(project.get("has_code")) or any(r.get("state") == "green" for r in runs)


def view(store: Any, project: Dict[str, Any], summary: Callable[[Any, Dict[str, Any]], Dict[str, Any]],
         runs: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Any]:
    runs = runs_of(store, project) if runs is None else runs
    active = next((r for r in runs if r.get("state") not in TERMINAL_RUN_STATES), None)
    green = next((r for r in runs if r.get("state") == "green"), None)
    out = {k: project.get(k) for k in ("id", "name", "description", "created_ms", "created_by")}
    out["deliver"] = project.get("deliver") or "branch"
    pub = _public(project)
    out.update({k: pub[k] for k in ("source", "workspace_path", "repo_url", "provider", "source_kind", "source_branch",
                                    "uncommitted_left_out", "copied_files") if pub.get(k)})
    out["rag_project"] = rag_of(project)
    out.update(runs=len(runs), has_code=_delivered(project, runs),
               active_run=summary(store, active) if active else None,
               live_runs=[{"id": r["id"], "state": r.get("state"), "flow": (r.get("detail") or {}).get("flow") or ""}
                          for r in runs if r.get("state") not in TERMINAL_RUN_STATES],
               last_run=summary(store, runs[0]) if runs else None,
               last_green_run=green["id"] if green else "",
               updated_ms=max([project.get("created_ms", 0)] + [r.get("updated_ms", 0) for r in runs]),
               usage=usage_of(store, runs), attention=attention_of(store, active, runs[0] if runs else None,
                                                  [r for r in runs if r.get("state") not in TERMINAL_RUN_STATES]),
               progress=progress_of(store, runs))
    if project.get("closed"):
        out["closed"] = dict(project["closed"])
    return out


def usage_of(store: Any, runs: List[Dict[str, Any]]) -> Dict[str, Any]:
    """What the project's runs cost: dollars and tokens over every model call of every run (agents, hooks,
    retro, distiller). tokens_in counts what was sent (input plus cache reads and writes), tokens_out what
    came back."""
    usd, t_in, t_out = 0.0, 0, 0
    for r in runs:
        for c in store.query(E_LLM_CALL, run=r["id"]) or []:
            u = c.get("usage") or {}
            usd += float(c.get("usd") or 0)
            t_in += int(u.get("input") or 0) + int(u.get("cacheRead") or 0) + int(u.get("cacheWrite") or 0)
            t_out += int(u.get("output") or 0)
    return {"usd": round(usd, 4), "tokens_in": t_in, "tokens_out": t_out}


_node_counts: Dict[str, Tuple[int, int]] = {}      # finished run -> (complete nodes, nodes): never changes again


def progress_of(store: Any, runs: List[Dict[str, Any]]) -> Dict[str, Any]:
    """The project's progress: complete nodes over all nodes of all its runs (a node is complete when done, or
    skipped because the run did not need it)."""
    from .runview import nodes
    done = total = 0
    for r in runs:
        rid = r["id"]
        got = _node_counts.get(rid)
        if got is None:
            try:
                ns = nodes(store, rid)
            except Exception:   # noqa: BLE001 - a run that cannot be read counts as nothing
                continue
            got = (sum(1 for n in ns if n.get("state") in ("done", "skipped")), len(ns))
            if r.get("state") in TERMINAL_RUN_STATES:
                _node_counts[rid] = got
        done += got[0]
        total += got[1]
    return {"done": done, "total": total, "pct": int(round(100.0 * done / total)) if total else 0}


def attention_of(store: Any, active: Optional[Dict[str, Any]], last: Optional[Dict[str, Any]],
                 live: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Any]:
    """Does the project need a person now, and why: one of its live runs waits at a gate for a decision (kind
    "approval": the run and how many wait), its running process is held by a hook, stopped, or waits for answers;
    or, with nothing running, its latest run failed and nobody marked it resolved (POST /api/runs/{run}:resolve; a
    new run of the project clears it too)."""
    def no() -> Dict[str, Any]:
        return {"needed": False, "why": ""}
    waiting = [r for r in live or [] if (r.get("detail") or {}).get("gate")]
    if waiting:                                   # many runs of a project can be live: any one waiting counts
        g = waiting[0]["detail"]["gate"]
        return {"needed": True, "kind": "approval", "run": waiting[0]["id"], "count": len(waiting),
                "why": "%d run(s) wait for your approval (step %s of %s)" % (len(waiting), g.get("step") or "",
                                                                         waiting[0]["id"])}
    if active is not None:
        d = active.get("detail") or {}
        if d.get("gate"):
            return {"needed": True, "why": "step %s: %s" % (d["gate"].get("step") or "", "waiting for your decision")}
        if d.get("hook_hold"):
            return {"needed": True, "why": "held by hook %s" % (d["hook_hold"].get("name") or "")}
        if d.get("paused"):
            return {"needed": True, "why": "stopped by %s" % (d["paused"].get("by") or "a person")}
        if active.get("state") == "parked":
            return {"needed": True, "why": "waiting for answers"}
        return no()
    ld = (last or {}).get("detail") or {}
    if last is not None and last.get("state") == "escalated" and not ld.get("resolved")             and (ld.get("supervisor") or {}).get("action") != "retry":
        esc = (store.query(E_ESCALATION, run=last["id"]) or [{}])[-1]
        return {"needed": True, "why": "last run failed: %s" % (esc.get("code") or "escalated")}
    return no()


def all_rows() -> List[Dict[str, Any]]:
    return _load()


def list_all(store: Any, summary: Callable[[Any, Dict[str, Any]], Dict[str, Any]],
             closed: bool = False) -> List[Dict[str, Any]]:
    """The open projects (Home), or with closed=True the closed ones (to re-open)."""
    views = [view(store, p, summary) for p in _load() if bool(p.get("closed")) == closed]
    return sorted(views, key=lambda v: v.get("updated_ms", 0), reverse=True)


_close_lock = threading.Lock()


def set_closed(store: Any, pid: str, closed: bool, actor: str = "") -> Dict[str, Any]:
    """Close a project (hidden from Home; no new run until it is re-opened) or re-open it. Its repository, runs and
    knowledge stay as they are. A project with a process still running cannot be closed: stop it first."""
    with _close_lock:
        rows = _load()
        row = next((r for r in rows if r.get("id") == pid), None)
        if row is None:
            raise LineError(codes.NOT_FOUND, "project %s" % pid, {"project": pid})
        if closed:
            live = [r for r in runs_of(store, row) if r.get("state") not in TERMINAL_RUN_STATES]
            if live:
                raise LineError(codes.STATE_CONFLICT, "project %s has a process still running (%s): stop it before "
                                "closing the project" % (pid, live[0]["id"]), {"project": pid, "run": live[0]["id"]})
            row["closed"] = {"by": actor, "ms": now_ms()}
        else:
            row.pop("closed", None)
        _save(rows)
    return {"project": pid, "closed": closed}


def detail(store: Any, pid: str, summary: Callable[[Any, Dict[str, Any]], Dict[str, Any]]) -> Dict[str, Any]:
    p = get(pid)
    runs = runs_of(store, p)
    return {"project": view(store, p, summary, runs), "runs": [summary(store, r) for r in runs]}


def resolve_run_target(store: Any, payload: Dict[str, Any]) -> None:
    """POST /api/runs with {"project"}: fill the target from the project, refuse a second live run and an
    Enhancement / Bug Fix on a project that has no code yet."""
    pid = str(payload.get("project") or "").strip()
    if not pid:
        return
    if payload.get("target"):
        raise ValueError("give either project or target, not both")
    p = get(pid)
    if p.get("closed"):
        raise LineError(codes.STATE_CONFLICT, "project %s is closed: re-open it first" % pid, {"project": pid})
    runs = runs_of(store, p)
    live = [r for r in runs if r.get("state") not in TERMINAL_RUN_STATES]
    flow = str(payload.get("flow") or "")
    ref = str((p.get("processes") or {}).get(flow.strip().lower()) or "")
    if live:                                    # runs share a project when their process queues (its "queue")
        from . import changequeue
        from .config import load_config
        want = payload.get("process") or ref
        mine = changequeue.policy_for(load_config(), store, flow, str(p.get("path") or ""),
                                      {"process": want} if want else {})
        if not (mine["enabled"] and all(changequeue.shares_project(store, r) for r in live)):
            raise LineError(codes.STATE_CONFLICT, "project %s already has a run in progress (%s); only Enhancement and "
                            "Bug Fix runs share a project (by default: runs whose process queues its changes)"
                            % (pid, live[0]["id"]), {"project": pid, "run": live[0]["id"]})
    if flow in ("enhance", "enhancement", "bug", "bug-fix") and not _delivered(p, runs):
        raise LineError(codes.STATE_CONFLICT, "project %s has no completed build yet: run New System first" % pid,
                        {"project": pid})
    if ref and not payload.get("process"):              # the process this project runs for this flow
        from .process import registry
        try:
            registry.usable(store, ref.split("@")[0])
        except ValueError as e:
            raise LineError(codes.STATE_CONFLICT, "project %s is bound to %s for %s, which cannot start a run: %s"
                            % (pid, ref, flow, e), {"project": pid, "process": ref})
        payload["process"] = ref
    why = "" if live else sync(p)       # runs in progress own the working copy: no merge under them
    if why:
        raise LineError(codes.STATE_CONFLICT, why, {"project": pid})
    payload["target"] = p["path"]
    payload["project"] = pid


def bind_process(pid: str, flow: str, ref: str, actor: str = "") -> Dict[str, Any]:
    """The process a project runs for a flow: "<id>" (its latest active version at each run's start), "<id>@<n>"
    (pinned) or "" (none: the flow's default). Earlier bindings stay in process_history."""
    with _lock:
        rows = _load()
        row = next((r for r in rows if r.get("id") == pid), None)
        if row is None:
            raise KeyError(pid)
        procs = dict(row.get("processes") or {})
        old = procs.get(flow, "")
        if ref:
            procs[flow] = ref
        else:
            procs.pop(flow, None)
        row["processes"] = procs
        row.setdefault("process_history", []).append({"flow": flow, "from": old, "to": ref, "by": actor or "admin",
                                                      "ms": now_ms()})
        _save(rows)
    return {"project": pid, "processes": procs}


__all__ = ["create", "get", "bind_process", "rag_of", "all_rows", "runs_of", "view", "list_all", "detail", "resolve_run_target", "home", "workspace",
           "workspace_root", "inspect", "sync", "deliver", "provider"]

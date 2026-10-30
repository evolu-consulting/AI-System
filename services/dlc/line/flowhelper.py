"""`dlc flow <mode>`: the helper the delivery workflows call (New System, Enhancement, Bug Fix, Feature Migration).

Every input comes from environment variables (the workflow's shell node sets them from its inputs), so a spec
with quotes or newlines never becomes part of a command line. Prints ONE JSON object on stdout.

  new        DLC_NAME, DLC_SPEC or DLC_SPEC_FILE or DLC_PACK -> a spec pack plus a fresh target repository
  enhance    DLC_TARGET, DLC_NAME, DLC_SPEC or DLC_SPEC_FILE -> a spec pack for an existing target repository
  bug        DLC_TARGET, DLC_NAME, DLC_TITLE, DLC_REPRO, DLC_EXPECTED, DLC_ACTUAL [, DLC_CONTEXT]
  wait       DLC_RUN [, DLC_WAIT_HOURS or DLC_WAIT_MIN (default 40 min)] -> until final or parked on questions
  migrate    DLC_V1, DLC_V2 [, DLC_V1_REPOS, DLC_V2_REPOS, DLC_V1_REF, DLC_V1_BASE, DLC_V2_REF, DLC_NOTES,
             DLC_MIG_MODE ask|decide, DLC_SCOPE, DLC_BUILD, DLC_MAX_USD, DLC_MAX_USD_REPO] -> checked inputs for
             POST /api/migrations
  migwait    DLC_MIGRATION [, DLC_WAIT_HOURS (12) or DLC_WAIT_MIN] -> until final or parked on decisions
  migresume  DLC_MIGRATION [, DLC_MAX_USD, DLC_MAX_USD_REPO, DLC_RESCAN] -> POST :resume, then waits like migwait

DLC_HOME (default ~/dlc) holds packs/ and targets/. DLC_LINE_URL defaults to http://127.0.0.1:8796.
Exit codes: 0 done (wait: green / analysed), 2 bad input, 3 wait: parked on questions, 4 wait: escalated or
cancelled, 5 wait: still running at the time limit. A wait result carries "done": true only for 0 and 3.
"""

from __future__ import annotations

import datetime as _dt
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from typing import Any, Dict, Optional

MODES = ("new", "enhance", "bug", "wait", "migrate", "migwait", "migresume")
_SKIP = {"node_modules", "vendor", "dist", "build", ".venv", "venv"}


class _Exit(Exception):
    def __init__(self, obj: Dict[str, Any], code: int) -> None:
        super().__init__(code)
        self.obj, self.code = obj, code


def _env(k: str) -> str:
    return os.environ.get(k, "") or ""


def _home() -> str:
    return _env("DLC_HOME") or os.path.join(os.path.expanduser("~"), "dlc")


def _line() -> str:
    return (_env("DLC_LINE_URL") or "http://127.0.0.1:8796").rstrip("/")


def _out(obj: Dict[str, Any], code: int = 0) -> None:
    raise _Exit(obj, code)


def _fail(msg: str) -> None:
    _out({"ok": False, "error": msg}, 2)


def _stamp() -> str:
    return _dt.datetime.now().strftime("%Y%m%d-%H%M%S")


def _slug(s: str) -> str:
    t = re.sub(r"[^A-Za-z0-9]+", "-", s or "").strip("-").lower() or "work"
    return t[:40].strip("-") if len(t) > 40 else t


def _write(path: str, text: str) -> None:
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(text.replace("\r\n", "\n"))


def _read(path: str) -> str:
    with open(path, encoding="utf-8-sig") as fh:
        return fh.read()


def bug_spec(title: str, repro: str, expected: str, actual: str, context: str = "") -> str:
    """The spec of a bug fix: one F-item = the expected behaviour, everything else unchanged."""
    ctx = (context + "\n\n") if context else ""
    return ("# Bug fix: %s\n\n%sThis is a bug fix on the existing code in this repository. Keep every other behaviour "
            "exactly as it is.\n\n## F1 %s\n\nSteps to reproduce:\n\n%s\n\n- Expected: %s\n- Today it does: %s\n"
            "- After the fix, the steps above give the expected result, and the behaviour the existing tests cover "
            "is unchanged.\n" % (title, ctx, title, repro, expected, actual))


def bug_report_spec(report: str) -> str:
    """The spec of a bug fix from free text (what happened, a ticket link, pasted or attached notes): the agents
    read any linked ticket and the project's knowledge themselves and turn it into one failing test and a fix."""
    return ("# Bug fix: %s\n\nThis is a bug fix on the existing code in this repository. Keep every other behaviour "
            "exactly as it is.\n\n## What happened\n\n%s\n\n## F1 The reported behaviour is fixed\n\n"
            "- Work out the expected behaviour from the report above, any ticket or page it links, and the project's "
            "knowledge (earlier fixes, decisions, lessons) before changing code.\n"
            "- A test reproduces the reported behaviour and fails before the fix, passes after it.\n"
            "- The behaviour the existing tests cover is unchanged.\n" % (report_title(report), report.strip()))


def report_title(report: str) -> str:
    """A short title from the first meaningful line of a free-text report (a bare URL stays as is)."""
    for line in (report or "").splitlines():
        t = line.strip().lstrip("#>-* ").strip()
        if t and not t.startswith("<!--"):
            return t[:80]
    return "bug"


#: limit of a spec sent over HTTP (POST /api/packs)
MAX_SPEC_CHARS = 2_000_000


def create_pack(body: Dict[str, Any]) -> Dict[str, Any]:
    """POST /api/packs: a spec pack under DLC_HOME/packs from markdown text (new / enhance) or a bug report."""
    kind = str(body.get("kind") or "new")
    if kind not in ("new", "enhance", "bug"):
        raise ValueError("kind must be new, enhance or bug")
    name = str(body.get("name") or "").strip()
    report = str(body.get("report") or "") if kind == "bug" and not body.get("repro") else ""
    if report.strip():            # free text: what happened, a ticket link, attached notes
        if len(report) > MAX_SPEC_CHARS:
            raise ValueError("report is larger than %d characters" % MAX_SPEC_CHARS)
        spec = bug_report_spec(report)
        name = name or report_title(report)
    elif kind == "bug":
        fields = {k: str(body.get(k) or "").strip() for k in ("title", "repro", "expected", "actual", "context")}
        missing = [k for k in ("title", "repro", "expected", "actual") if not fields[k]]
        if len(missing) == 4:
            raise ValueError("a bug report needs report: what happened (text, a ticket link or attached notes)")
        if missing:
            raise ValueError("a bug report needs %s" % ", ".join(missing))
        spec = bug_spec(fields["title"], fields["repro"], fields["expected"], fields["actual"], fields["context"])
        name = name or fields["title"]
    else:
        spec = str(body.get("spec") or "")
        if not spec.strip():
            raise ValueError("spec (markdown text) is required")
    if not name:
        raise ValueError("name is required")
    if len(spec) > MAX_SPEC_CHARS:
        raise ValueError("spec is larger than %d characters" % MAX_SPEC_CHARS)
    return {"pack": _new_pack(name, spec, kind), "kind": kind, "name": name, "chars": len(spec)}


def _new_pack(name: str, spec: str, kind: str) -> str:
    d = os.path.join(_home(), "packs", "%s-%s-%s" % (kind, _slug(name), _stamp()))
    os.makedirs(d, exist_ok=True)
    _write(os.path.join(d, "spec.md"), spec)
    meta = {"id": _slug(name), "title": name, "kind": kind, "template": {"required": ["spec.md"]}, "files": ["spec.md"]}
    _write(os.path.join(d, "pack.json"), json.dumps(meta, indent=2))
    return d


def _spec() -> str:
    if _env("DLC_SPEC"):
        return _env("DLC_SPEC")
    f = _env("DLC_SPEC_FILE")
    if f:
        if not os.path.isfile(f):
            _fail("DLC_SPEC_FILE is not a file: %s" % f)
        return _read(f)
    return ""


def _git(*args: str, cwd: Optional[str] = None) -> subprocess.CompletedProcess:
    return subprocess.run(["git"] + list(args), cwd=cwd, capture_output=True, text=True)


def _is_repo(path: str) -> bool:
    if not path or not os.path.exists(path):
        return False
    return _git("-C", path, "rev-parse", "--is-inside-work-tree").returncode == 0


def _is_repo_or_estate(path: str) -> bool:
    if not path or not os.path.isdir(path):
        return False
    if os.path.exists(os.path.join(path, ".git")):
        return True
    level = [path]
    for _ in range(3):
        nxt = []
        for d in level:
            try:
                kids = [e for e in os.scandir(d) if e.is_dir()]
            except OSError:
                continue
            for c in kids:
                if c.name in _SKIP or c.name.startswith("."):
                    continue
                if os.path.exists(os.path.join(c.path, ".git")):
                    return True
                nxt.append(c.path)
        level = nxt
    return False


def _get(url: str, timeout: float = 30) -> Any:
    with urllib.request.urlopen(url, timeout=timeout) as r:
        return json.loads(r.read() or b"null")


def _wait_until(default_min: float) -> float:
    m = default_min
    if _env("DLC_WAIT_HOURS"):
        m = 60 * float(_env("DLC_WAIT_HOURS"))
    elif _env("DLC_WAIT_MIN"):
        m = float(_env("DLC_WAIT_MIN"))
    return time.monotonic() + 60 * min(max(m, 0.05), 7 * 24 * 60)


class _Poll:
    def __init__(self) -> None:
        self.s = float(_env("DLC_POLL_S") or 15)
        self.mx = float(_env("DLC_POLL_MAX_S") or 300)

    def pause(self, until: float) -> None:
        left = until - time.monotonic()
        time.sleep(max(min(self.s, left), 0.05))
        self.s = min(self.s * 2, self.mx)


def _wait_migration(mig: str) -> None:
    line, until, poll = _line(), _wait_until(720), _Poll()
    state, d = "", None
    while time.monotonic() < until:
        try:
            d = _get("%s/api/migrations/%s" % (line, mig))
        except (OSError, ValueError, urllib.error.URLError):
            poll.pause(until)
            continue
        m = (d or {}).get("migration") or {}
        state = str(m.get("state") or "")
        if state in ("green", "escalated", "analysed"):
            break
        if state == "parked":
            qs = [{"conflict": q.get("conflict"), "feature": q.get("feature"), "text": q.get("text"),
                   "options": " | ".join(str(o.get("id")) for o in (q.get("options") or []))}
                  for q in (d.get("questions") or [])]
            summary = "; ".join("%s %s: %s" % (q["conflict"], q["feature"], q["options"]) for q in qs)
            _out({"ok": True, "done": True, "migration": mig, "state": state, "parked": True,
                  "code": str(m.get("code") or ""), "message": str(m.get("message") or ""),
                  "run": str(m.get("run") or ""), "report": str(m.get("report") or ""), "questions": qs,
                  "summary": "%d decision(s) wait for a person: %s" % (len(qs), summary),
                  "board": "%s/?migration=%s" % (line, mig), "answer": "%s/api/migrations/%s/answers" % (line, mig),
                  "next": "answer on the board (or POST the answers), then run this flow again with migration=%s" % mig,
                  "spent_usd": ((m.get("budget") or {}).get("spent"))}, 3)
        poll.pause(until)
    code = 0 if state in ("green", "analysed") else 4 if state == "escalated" else 5
    m = ((d or {}).get("migration") or {})
    out = {"ok": code == 0, "migration": mig, "state": state, "parked": False, "code": str(m.get("code") or ""),
           "message": str(m.get("message") or ""), "run": str(m.get("run") or ""), "report": str(m.get("report") or ""),
           "questions": [], "summary": "migration %s is %s" % (mig, state), "next": "",
           "board": "%s/?migration=%s" % (line, mig), "spent_usd": (m.get("budget") or {}).get("spent") if d else None}
    if code == 0:
        out["done"] = True
    if str(m.get("code") or "") == "MIGRATION_BUDGET":
        out["next"] = ("raise the cap on the board (or POST %s/api/migrations/%s:resume {max_usd, max_usd_repo}), "
                       "then run this flow again with migration=%s" % (line, mig, mig))
    if code == 5:
        out["next"] = "still running: run this flow again with migration=%s to keep waiting" % mig
    _out(out, code)


def _mode_new() -> None:
    name = _env("DLC_NAME")
    if not name:
        _fail("DLC_NAME is required")
    spec, pack_in = _spec(), _env("DLC_PACK")
    if pack_in and os.path.isfile(pack_in) and pack_in.lower().endswith(".md"):
        pack = _new_pack(name, _read(pack_in), "new")
    elif pack_in:
        if not os.path.isfile(os.path.join(pack_in, "spec.md")):
            _fail("DLC_PACK has no spec.md: %s" % pack_in)
        pack = os.path.abspath(pack_in)
    elif spec:
        pack = _new_pack(name, spec, "new")
    else:
        _fail("DLC_SPEC, DLC_SPEC_FILE or DLC_PACK is required")
    target = os.path.join(_home(), "targets", "%s-%s" % (_slug(name), _stamp()))
    os.makedirs(target, exist_ok=True)
    _git("-C", target, "init", "-q")
    _git("-C", target, "symbolic-ref", "HEAD", "refs/heads/main")
    _write(os.path.join(target, ".gitignore"), "__pycache__/\n*.pyc\n.venv/\n")
    _write(os.path.join(target, "README.md"), "# %s\n\nBuilt by the DLC line.\n" % name)
    _git("-C", target, "add", "-A")
    _git("-C", target, "-c", "gc.auto=0", "-c", "user.name=dlc", "-c", "user.email=dlc@localhost",
         "commit", "-q", "-m", "initial commit")
    _out({"ok": True, "process": "new-system", "pack": pack, "target": target})


def _mode_enhance() -> None:
    tgt = _env("DLC_TARGET")
    if not _is_repo(tgt):
        _fail("DLC_TARGET is not a git repository: %s" % tgt)
    spec = _spec()
    if not spec:
        _fail("DLC_SPEC or DLC_SPEC_FILE is required")
    pack = _new_pack(_env("DLC_NAME") or "enhancement", spec, "enhance")
    _out({"ok": True, "process": "enhancement", "pack": pack, "target": os.path.abspath(tgt)})


def _mode_bug() -> None:
    tgt = _env("DLC_TARGET")
    if not _is_repo(tgt):
        _fail("DLC_TARGET is not a git repository: %s" % tgt)
    for k in ("DLC_TITLE", "DLC_REPRO", "DLC_EXPECTED", "DLC_ACTUAL"):
        if not _env(k):
            _fail("%s is required" % k)
    title = _env("DLC_TITLE")
    spec = bug_spec(title, _env("DLC_REPRO"), _env("DLC_EXPECTED"), _env("DLC_ACTUAL"), _env("DLC_CONTEXT"))
    pack = _new_pack(_env("DLC_NAME") or title, spec, "bug")
    _out({"ok": True, "process": "bug-fix", "pack": pack, "target": os.path.abspath(tgt)})


def _mode_wait() -> None:
    run = _env("DLC_RUN")
    if not run:
        _fail("DLC_RUN is required")
    line, until, poll = _line(), _wait_until(40), _Poll()
    state, d = "", None
    while time.monotonic() < until:
        try:
            d = _get("%s/api/runs/%s" % (line, run), 20)
        except (OSError, ValueError, urllib.error.URLError):
            poll.pause(until)
            continue
        state = str(((d or {}).get("run") or {}).get("state") or "")
        if state in ("green", "escalated", "cancelled"):
            break
        try:
            q = _get("%s/api/runs/%s/questions" % (line, run), 20) or {}
            open_q = [x for x in (q.get("questions") or []) if x.get("state") in ("open", "held")]
            if q.get("parked") and open_q:
                summary = "; ".join("%s: %s" % (x.get("qid"), x.get("decision")) for x in open_q)
                _out({"ok": True, "done": True, "run": run, "state": state, "parked": True,
                      "questions": [{"qid": x.get("qid"), "decision": x.get("decision"),
                                     "recommended": x.get("recommended")} for x in open_q],
                      "summary": "%d question(s) wait for a person: %s" % (len(open_q), summary),
                      "board": "%s/board?run=%s" % (line, run)}, 3)
        except (OSError, ValueError, urllib.error.URLError):
            pass
        poll.pause(until)
    code = 0 if state == "green" else 4 if state in ("escalated", "cancelled") else 5
    spent = ((d or {}).get("budget") or {}).get("spent") if d else None
    out = {"ok": code == 0, "run": run, "state": state, "parked": False, "spent_usd": spent,
           "board": "%s/board?run=%s" % (line, run)}
    if code == 0:
        out["done"] = True
    _out(out, code)


def _mode_migrate() -> None:
    for s in ("V1", "V2"):
        p, m = _env("DLC_" + s), _env("DLC_%s_REPOS" % s)
        if m and not os.path.isfile(m):
            _fail("DLC_%s_REPOS is not a file: %s" % (s, m))
        if not m and not _is_repo_or_estate(p):
            _fail("DLC_%s is neither a git repository nor a folder of git repositories: %s" % (s, p))
        if m and not os.path.isdir(p):
            _fail("DLC_%s is not a folder: %s" % (s, p))
    notes = _env("DLC_NOTES")
    if notes and not os.path.isfile(notes):
        _fail("DLC_NOTES is not a file: %s" % notes)
    mm = _env("DLC_MIG_MODE") or "ask"
    if mm not in ("ask", "decide"):
        _fail("DLC_MIG_MODE must be ask or decide")
    ab = lambda k: os.path.abspath(_env(k)) if _env(k) else ""  # noqa: E731
    _out({"ok": True, "process": "feature-migration", "mode": mm, "v1": ab("DLC_V1"), "v2": ab("DLC_V2"),
          "v1_ref": _env("DLC_V1_REF"), "v1_base": _env("DLC_V1_BASE"), "v2_ref": _env("DLC_V2_REF"),
          "v1_repos": ab("DLC_V1_REPOS"), "v2_repos": ab("DLC_V2_REPOS"), "notes": ab("DLC_NOTES"),
          "scope": _env("DLC_SCOPE"), "build": "false" if _env("DLC_BUILD") == "false" else "true",
          "max_usd": _env("DLC_MAX_USD"), "max_usd_repo": _env("DLC_MAX_USD_REPO")})


def _mode_migwait() -> None:
    mig = _env("DLC_MIGRATION")
    if not mig:
        _fail("DLC_MIGRATION is required")
    _wait_migration(mig)


def _mode_migresume() -> None:
    mig = _env("DLC_MIGRATION")
    if not mig:
        _fail("DLC_MIGRATION is required")
    body: Dict[str, Any] = {}
    if _env("DLC_MAX_USD"):
        body["max_usd"] = float(_env("DLC_MAX_USD"))
    if _env("DLC_MAX_USD_REPO"):
        body["max_usd_repo"] = float(_env("DLC_MAX_USD_REPO"))
    if _env("DLC_RESCAN") == "true":
        body["rescan"] = True
    req = urllib.request.Request("%s/api/migrations/%s:resume" % (_line(), mig), json.dumps(body).encode(),
                                 {"Content-Type": "application/json"}, method="POST")
    try:
        urllib.request.urlopen(req, timeout=30).read()
    except urllib.error.HTTPError as e:
        _out({"ok": False, "migration": mig, "error": "resume refused: %s" % e.read().decode("utf-8", "replace")}, 4)
    except (OSError, urllib.error.URLError) as e:
        _out({"ok": False, "migration": mig, "error": "resume refused: %s" % e}, 4)
    _wait_migration(mig)


def main(mode: str) -> int:
    fn = {"new": _mode_new, "enhance": _mode_enhance, "bug": _mode_bug, "wait": _mode_wait,
          "migrate": _mode_migrate, "migwait": _mode_migwait, "migresume": _mode_migresume}.get(mode)
    try:
        if fn is None:
            _fail("mode must be one of %s" % ", ".join(MODES))
        fn()
        return 0
    except _Exit as e:
        sys.stdout.write(json.dumps(e.obj, separators=(",", ":"), default=str) + "\n")
        sys.stdout.flush()
        return e.code


__all__ = ["main", "MODES", "create_pack", "bug_spec"]

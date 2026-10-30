"""Settle a BLOCKED unit before the retry ladder escalates it, the way a tech lead would.

Bench runs on 2026-10-17: every failed team-lane run stopped on a BLOCKED unit, never on code: the unit needed a
file it did not claim (the app's package.json, a module another unit wires), or said its locked acceptance test was
wrong (a harness that crashes Node 24 on Windows, a module name the test guessed). Each went straight to a person.
resolve() handles those cases first; anything it cannot settle goes to the ladder as before.

  shared file     a manifest, lockfile or tool config (SHARED) the unit needs: added to its claims at once; the
                  merge queue's merger settles a conflict with another unit that changed it too
  free file       a file no unmerged unit claims: added to the unit's claims
  owned file      a file an unmerged unit claims: the unit waits (WAITING, detail.wait_for) until that unit merged,
                  then goes back to ready with the file added; on_tick() releases it
  locked test     the arbiter (role test_arbiter, the run's main model, read and run tools in the unit's worktree)
                  reads the spec, the test and the builder's reason and rules:
                    test_wrong  the repairer (role test_repairer) fixes only those test files on main from the
                                arbiter's ruling and the spec (same test names, criteria and trace tags), the line
                                checks they still parse and define the same tests, commits them, re-locks the new
                                sha, and the unit starts again from the new main
                    code_wrong  the ruling goes to the builder as a correction (detail.nudge); the unit goes back
                    host        not settled here (the ladder escalates)
Limits: one repair per test file, Config.arbiter_max rulings per run, two settlements per unit; every settlement is
recorded on the unit (detail.settled) and as an event.
"""

from __future__ import annotations

import json
import os
import re
import shutil
from typing import Any, Dict, List, Optional

from .. import codes
from ..contracts import E_ACC_TEST, E_UNIT, UnitState, now_ms
from ..ship._util import git, git_out
from ..statemachine import update_row
from . import graph as G

ARBITER_ROLE = "test_arbiter"
REPAIR_ROLE = "test_repairer"
UNIT_MAX = 2
ARBITER_TURNS = 25
ARBITER_USD = 1.0
REPAIR_TURNS = 30
REPAIR_USD = 1.0
#: files every unit may need to touch: the app's manifests, lockfiles and tool configs
SHARED = re.compile(r"(^|/)(package(-lock)?\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|requirements[\w.-]*"
                    r"\.txt|pyproject\.toml|setup\.cfg|tsconfig[\w.-]*\.json|(vite|vitest|jest|babel|eslint|webpack|"
                    r"rollup|tailwind|postcss)\.config\.[cm]?[jt]s|\.babelrc|\.gitignore|\.npmrc|\.nvmrc)$", re.I)
_PATH = re.compile(r"(?<![\w/.-])((?:[\w.-]+/)*[\w.-]+\.(?:py|js|jsx|mjs|cjs|ts|tsx|json|css|html|txt|toml|cfg|yaml|"
                   r"yml|lock))\b")
_TEST_DIR = "tests/acceptance/"

ARBITER = """You are the arbiter of an automated delivery line. A builder stopped (BLOCKED) and blames a LOCKED
acceptance test, which it may not change. Decide who is right. You may read files and run commands; change nothing.

THE SPEC (the part this unit implements):
-----
{spec}
-----

THE LOCKED TEST FILE(S):
{tests}

THE BUILDER'S REASON:
-----
{reason}
-----

The working copy (the builder's work so far) is the current directory. Run the locked test the way the line does
({cmd}) and read the code it exercises. Rule:
  test_wrong  the test checks something the spec does not ask for, guesses a name or structure the spec leaves open,
              or depends on this machine (a browser, a fixed path or port, git state, a runtime crash its own harness
              causes); say exactly what the test must change, keeping what the spec asks
  code_wrong  the test is fair and the code (or the builder's reading of the spec) is what must change; say what
  host        the machine or a tool is broken and neither test nor code can fix it

Your final message is ONE JSON object, then a last line SUBMIT:
{{"verdict": "test_wrong|code_wrong|host", "files": ["<test files the ruling is about>"], "why": "...",
  "change": "<for test_wrong: what the test must do instead; for code_wrong: what the code must do>"}}
SUBMIT
"""

REPAIR = """You repair locked acceptance test files of an automated delivery line, after an arbiter ruled them
wrong. Change ONLY these files: {files}. Keep every test name, its criterion and its trace comments; keep testing
what the spec asks, through the app's public interface (its API, CLI or UI entry), with data the test creates and
removes itself; no browser, no fixed path or port, no git state, no network, no code that crashes the runtime on exit.

THE ARBITER'S RULING:
{ruling}

THE SPEC:
-----
{spec}
-----

The repository is the current directory (main, before this run's code is built, so the tests are expected to fail
until the feature exists). When done, end with a short summary and a last line SUBMIT.
"""


def enabled(cfg: Any) -> bool:
    mode = str(getattr(cfg, "arbiter", "auto") or "auto").strip().lower()
    if mode in ("0", "off", "false", "no"):
        return False
    return mode in ("1", "on", "true", "yes") or str(getattr(cfg, "llm", "fake")) != "fake"


def paths_in(reason: str) -> List[str]:
    out: List[str] = []
    for m in _PATH.finditer(reason or ""):
        p = m.group(1).replace("\\", "/").lstrip("./")
        if p and p not in out and not p.startswith(("http", "www.")):
            out.append(p)
    return out[:12]


def _resolve_path(repo: str, p: str) -> Optional[str]:
    """A path the builder named, as a repo-relative path: as written, or the one file in the repo ending with it."""
    if os.path.exists(os.path.join(repo, *p.split("/"))):
        return p
    hits: List[str] = []
    for root, dirs, files in os.walk(repo):
        dirs[:] = [d for d in dirs if d not in ("node_modules", ".git", "dist", "build", "__pycache__")]
        for f in files:
            rel = os.path.relpath(os.path.join(root, f), repo).replace("\\", "/")
            if rel.endswith("/" + p) or rel == p:
                hits.append(rel)
    if len(hits) == 1:
        return hits[0]
    # a file to create: keep it when its folder exists (e.g. NotesApp/client/noteSelect.js)
    return p if "/" in p and os.path.isdir(os.path.join(repo, *p.split("/")[:-1])) else None


def _settled(pipe: Any, uid: str, kind: str, info: Dict[str, Any], nudge: str = "", ready: bool = True,
             reset: bool = False) -> bool:
    row = pipe.sstore.get(E_UNIT, uid) or {}
    detail = dict(row.get("detail") or {})
    detail["settled"] = list(detail.get("settled") or []) + [dict(info, kind=kind, ms=now_ms())]
    if nudge:
        detail["nudge"] = nudge
    update_row(pipe.wstore, E_UNIT, uid, {"detail": detail})
    if reset:
        pipe.sandbox.cleanup(type("U", (), {"id": uid, "run": pipe.run})(), delete_branch=True)
    if ready:
        try:
            pipe.sm.advance_unit(uid, UnitState.READY, row.get("state"), code=codes.BLOCKED,
                                 extra=[(codes.UNIT_REQUEUED, {"code": codes.BLOCKED, "from": row.get("state"),
                                                               "why": "settled: " + kind})])
        except Exception as e:   # noqa: BLE001 - a state race: the ladder handles the unit as before
            pipe.log("%s: %s settle %s: %s" % (pipe.run, uid, kind, e))
            return False
    pipe.log("%s: %s BLOCKED settled (%s): %s" % (pipe.run, uid, kind, json.dumps(info)[:300]))
    return True


def _claims(pipe: Any, uid: str, row: Dict[str, Any], files: List[str]) -> bool:
    """Grant or wait for the files a BLOCKED unit needs outside its claims."""
    claims = list(row.get("claims") or [])
    need = [f for f in files if not f.startswith(_TEST_DIR) and not any(G.claim_matches(f, c) for c in claims)]
    if not need:
        return False
    owners: Dict[str, str] = {}
    for u in pipe._units():
        if u["id"] == uid or u.get("state") == UnitState.MERGED.value:
            continue
        for f in need:
            if not SHARED.search(f) and any(G.claim_matches(f, c) for c in (u.get("claims") or [])):
                owners[f] = u["id"]
    detail = dict(row.get("detail") or {})
    update_row(pipe.wstore, E_UNIT, uid, {"claims": claims + need})
    if owners:                                            # another unit is building it: wait for its merge
        detail["wait_for"] = sorted(set(owners.values()))
        update_row(pipe.wstore, E_UNIT, uid, {"detail": detail})
        return _settled(pipe, uid, "wait", {"files": need, "wait_for": detail["wait_for"]},
                        nudge="You may now also change: %s (they are in your claims). %s merged its part first; build "
                              "on it." % (", ".join(need), ", ".join(detail["wait_for"])), ready=False)
    return _settled(pipe, uid, "claims", {"files": need},
                    nudge="You may now also change: %s (added to your claims). Make the change there." % ", ".join(need))


def on_tick(pipe: Any) -> None:
    """Release WAITING units whose wait_for units merged (watchdog tick)."""
    if getattr(pipe, "sandbox", None) is None:            # before the build stage
        return
    units = {u["id"]: u for u in pipe._units()}
    for u in units.values():
        wait = list((u.get("detail") or {}).get("wait_for") or [])
        if u.get("state") != UnitState.WAITING.value or not wait:
            continue
        if all((units.get(w) or {}).get("state") == UnitState.MERGED.value for w in wait):
            detail = dict(u.get("detail") or {})
            detail.pop("wait_for", None)
            update_row(pipe.wstore, E_UNIT, u["id"], {"detail": detail})
            pipe.sandbox.cleanup(type("U", (), {"id": u["id"], "run": pipe.run})(), delete_branch=True)
            try:
                pipe.sm.advance_unit(u["id"], UnitState.READY, UnitState.WAITING, code=codes.BLOCKED,
                                     extra=[(codes.UNIT_REQUEUED, {"code": codes.BLOCKED, "from": "waiting",
                                                                   "why": "waited for %s" % ", ".join(wait)})])
                pipe.log("%s: %s released (waited for %s)" % (pipe.run, u["id"], ", ".join(wait)))
            except Exception as e:   # noqa: BLE001
                pipe.log("%s: release %s: %s" % (pipe.run, u["id"], e))


def _json(text: str, key: str) -> Optional[Dict[str, Any]]:
    dec = json.JSONDecoder()
    for i in reversed([m.start() for m in re.finditer(r"\{", text or "")]):
        try:
            data, _end = dec.raw_decode(text, i)
        except ValueError:
            continue
        if isinstance(data, dict) and key in data:
            return data
    return None


def _locked(pipe: Any) -> List[Dict[str, Any]]:
    return [r for r in pipe.sstore.query(E_ACC_TEST, run=pipe.run) if r.get("locked")]


def _test_files(pipe: Any, row: Dict[str, Any], reason: str) -> List[str]:
    locked = _locked(pipe)
    named = [r["path"] for r in locked if r.get("path") and (r["path"] in reason or os.path.basename(r["path"]) in reason
                                                              or str(r.get("id") or "#") in reason)]
    if not named:                                        # the unit's own locked tests
        mine = set(row.get("tests") or [])
        named = [r["path"] for r in locked if r.get("id") in mine]
    return sorted(set(named))[:3]


def _rulings(pipe: Any) -> int:
    return sum(1 for u in pipe._units() for s in ((u.get("detail") or {}).get("settled") or [])
               if s.get("kind") in ("test_repaired", "code_wrong", "test_ruling"))


def _test(pipe: Any, uid: str, row: Dict[str, Any], reason: str) -> bool:
    from .. import stacks
    cfg = pipe.cfg
    if _rulings(pipe) >= int(getattr(cfg, "arbiter_max", 3) or 3):
        return False
    files = _test_files(pipe, row, reason)
    if not files:
        return False
    repaired = {f for u in pipe._units() for s in ((u.get("detail") or {}).get("settled") or [])
                if s.get("kind") == "test_repaired" for f in s.get("files") or []}
    wt = row.get("worktree") or pipe.sandbox.path(type("U", (), {"id": uid, "run": pipe.run})())
    if not os.path.isdir(wt):
        wt = pipe.repo
    st = stacks.for_repo(pipe.repo)
    text = "\n\n".join("== %s\n%s" % (f, _read(pipe.repo, f)[:12000]) for f in files)
    spec = pipe._spec_for(type("U", (), {"f_items": row.get("f_items") or []})())
    prompt = ARBITER.format(spec=spec[:20000], tests=text, reason=reason[:3000], cmd=st.test_cmd(
        [r.get("name") or "" for r in _locked(pipe) if r.get("path") in files][:8]))
    try:
        res = pipe.llm.agentic(ARBITER_ROLE, wt, prompt, ARBITER_TURNS, ARBITER_USD, key="arbiter:%s" % uid,
                               run=pipe.run)
    finally:
        pipe._charge_stage()
    ruling = _json(str(getattr(res, "text", "") or ""), "verdict") or {}
    verdict = str(ruling.get("verdict") or "").strip().lower()
    info = {"files": files, "verdict": verdict, "why": str(ruling.get("why") or "")[:600],
            "change": str(ruling.get("change") or "")[:800]}
    if verdict == "code_wrong":
        return _settled(pipe, uid, "code_wrong", info,
                        nudge="An arbiter checked your claim that the locked test is wrong and ruled the test fair: "
                              "%s What the code must do: %s" % (info["why"], info["change"]))
    if verdict != "test_wrong" or any(f in repaired for f in files):
        return False                                      # host, unclear, or repaired once already: the ladder
    if not _repair(pipe, files, info, spec):
        return False
    return _settled(pipe, uid, "test_repaired", info, reset=True,
                    nudge="The locked test %s was repaired after an arbiter ruled it wrong (%s). Your worktree "
                          "starts again from main with the repaired test." % (", ".join(files), info["why"]))


def _read(repo: str, rel: str) -> str:
    try:
        with open(os.path.join(repo, *rel.split("/")), encoding="utf-8") as fh:
            return fh.read()
    except OSError:
        return ""


def _repair(pipe: Any, files: List[str], info: Dict[str, Any], spec: str) -> bool:
    """The repairer edits the test files in a scratch worktree of main; checked, committed on main, re-locked."""
    from .. import stacks
    from ..understand.test_check import sha256_bytes
    repo = pipe.repo
    scratch = os.path.join(pipe.workdir, "repair-%d" % now_ms())
    git(repo, "worktree", "add", "-q", "--detach", scratch, "main")
    try:
        before = {f: _read(scratch, f) for f in files}
        try:
            pipe.llm.agentic(REPAIR_ROLE, scratch, REPAIR.format(files=", ".join(files), spec=spec[:20000],
                                                                  ruling=json.dumps(info, indent=1)),
                             REPAIR_TURNS, REPAIR_USD, key="repair:%s" % "+".join(files), run=pipe.run)
        finally:
            pipe._charge_stage()
        changed = (git(scratch, "status", "--porcelain", check=False).stdout or "").splitlines()   # raw: " M path"
        touched = {l[3:].strip().strip('"').replace("\\", "/") for l in changed if l.strip()}
        if not touched or not touched <= set(files):
            pipe.log("%s: test repair refused: it changed %s" % (pipe.run, sorted(touched) or "nothing"))
            return False
        st = stacks.for_repo(scratch)
        for f in files:
            new = _read(scratch, f)
            if st.compile_error(f, new.encode("utf-8")):
                pipe.log("%s: test repair refused: %s does not parse" % (pipe.run, f))
                return False
            old_names, new_names = st.defined_tests(f, before[f]), st.defined_tests(f, new)
            if old_names is not None and new_names is not None and not old_names <= new_names:
                pipe.log("%s: test repair refused: %s lost tests %s" % (pipe.run, f, sorted(old_names - new_names)))
                return False
        if git(repo, "status", "--porcelain", check=False).stdout.strip():
            pipe.log("%s: test repair not applied: main has uncommitted changes" % pipe.run)
            return False
        for f in files:
            shutil.copyfile(os.path.join(scratch, *f.split("/")), os.path.join(repo, *f.split("/")))
        git(repo, "add", "--", *files)
        git(repo, "-c", "gc.auto=0", "commit", "-q", "-m",
            "line %s: acceptance test repaired after an arbiter ruling (%s)" % (pipe.run, info.get("why", "")[:120]))
        for r in _locked(pipe):
            if r.get("path") in files:
                with open(os.path.join(repo, *r["path"].split("/")), "rb") as fh:
                    update_row(pipe.sstore, E_ACC_TEST, r["id"], {"sha": sha256_bytes(fh.read())})
        pipe._set_detail(tests_commit=git_out(repo, "rev-parse", "HEAD"))
        return True
    finally:
        git(repo, "worktree", "remove", "--force", scratch, check=False)
        shutil.rmtree(scratch, ignore_errors=True)


def resolve(pipe: Any, uid: str, reason: str) -> bool:
    """Settle a BLOCKED unit; True when settled (the ladder is skipped), False to let the ladder decide."""
    if not enabled(pipe.cfg):
        return False
    row = pipe.sstore.get(E_UNIT, uid) or {}
    if row.get("state") != UnitState.WAITING.value or len((row.get("detail") or {}).get("settled") or []) >= UNIT_MAX:
        return False
    from ..watchdog import blocked_kind
    kind = blocked_kind(reason)
    files = [p for p in (_resolve_path(pipe.repo, p) for p in paths_in(reason)) if p]
    try:
        if files and _claims(pipe, uid, row, files):
            return True
        if kind == "test" or (kind == "host" and any(f.startswith(_TEST_DIR) for f in files)):
            return _test(pipe, uid, row, reason)
    except Exception as e:   # noqa: BLE001 - settling helps; the ladder still decides when it cannot
        pipe.log("%s: settling %s failed: %s" % (pipe.run, uid, e))
    return False


__all__ = ["SHARED", "enabled", "paths_in", "resolve", "on_tick"]

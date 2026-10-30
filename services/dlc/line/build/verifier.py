"""Verifier (block 12): the server checks a submitted unit itself; the builder's word counts for nothing.

gate(...) -> Gate, checks in order (first failure wins):
  NO_PROGRESS      empty diff whose acceptance tests are not green as they stand, or the same diff
                   as the previous failed attempt (an empty diff whose tests the server runs green,
                   e.g. satisfied by a merged contract unit, passes with already_satisfied: nothing
                   to merge)
  TEST_TAMPER      a locked acceptance test file is in the diff or its sha256 changed
  CLAIM_VIOLATION  a changed file is outside the unit's claims
  SECRET_FOUND     an added line matches a secret pattern (value never echoed)
  BUILD_FAIL       a changed .py file does not compile, or the test modules do not import
  TEST_FAIL        the unit's acceptance tests fail when the server runs
                   `python -m unittest <names>` in the worktree (clean env, no credentials)
  Test / build failures carry fingerprint = sha1(test id + error type + first stack line)
  (several failures: sha1 of the sorted per-failure fingerprints).

verify(unit, attempt, store, sandbox, cfg) -> Gate: runs gate(), records the gate and attempt,
then SUBMITTED -> VERIFIED, or applies the retry ladder (decide):
  retry         same model, evidence of this failure goes into the next prompt   -> READY
  switch_model  same failure twice in a row, or retry_n failures on the rung     -> READY, model_alt
  escalate      the alternate model's rung exhausted the same way                -> FAILED
The ladder is the one of line.watchdog (plan_failure / apply_failure on unit.detail.failures),
shared with BLOCKED / LLM error / merge conflict failures: one failure count per unit and rung.
Events: VERIFY_FAILED {code, fingerprint, decision, evidence}, UNIT_STATE + UNIT_REQUEUED, or
UNIT_STATE + ESCALATED (escalation record, code = the gate code).
"""

from __future__ import annotations

import hashlib
import os
import re
import subprocess
import sys
from dataclasses import dataclass
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence, Tuple

from .. import codes, stacks
from ..codes import LineError
from ..config import Config
from ..contracts import (
    E_ACC_TEST, E_ATTEMPT, E_GATE, E_UNIT, AccTest, Attempt, Gate, Unit, UnitState,
    from_dict, to_dict,
)
from . import graph as G
from ._common import cfg_or_default, clock_ms, env, load_unit
from .builder import _update_attempt, attempt_id, model_for_rung, test_names
from .sandbox import Diff

TEST_TIMEOUT_S = 600
EVIDENCE_MAX = 3000

SECRET_RULES: Tuple[Tuple[str, "re.Pattern[str]"], ...] = (
    ("private_key", re.compile(r"-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY-----")),
    ("aws_access_key", re.compile(r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b")),
    ("github_token", re.compile(r"\bgh[pousr]_[A-Za-z0-9]{36,}\b")),
    ("slack_token", re.compile(r"\bxox[abprs]-[A-Za-z0-9-]{10,}\b")),
    ("api_key_sk", re.compile(r"\bsk-(?:[A-Za-z0-9_-]{2,}-)?[A-Za-z0-9_-]{20,}\b")),
    ("google_api_key", re.compile(r"\bAIza[0-9A-Za-z_-]{35}\b")),
    ("jwt", re.compile(r"\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}")),
    ("assigned_secret", re.compile(
        r"(?i)\b(?:password|passwd|pwd|secret|api[_-]?key|access[_-]?key|auth[_-]?token|client[_-]?secret|token)"
        r"\b\s*[:=]\s*['\"][^'\"\s]{8,}['\"]")),
)


# ------------------------------------------------------------------ fingerprints


def _sha1(*parts: str) -> str:
    return hashlib.sha1("\x1f".join(parts).encode("utf-8", "replace")).hexdigest()


def fingerprint(test_id: str, error_type: str, first_stack_line: str) -> str:
    return _sha1(test_id, error_type, first_stack_line.strip())


def combine(fps: Iterable[str]) -> str:
    fps = sorted(set(f for f in fps if f))
    if not fps:
        return ""
    return fps[0] if len(fps) == 1 else _sha1(*fps)


# ------------------------------------------------------------------ unittest output

_HEAD = re.compile(r"^(FAIL|ERROR): (\S+) \((.+?)\)\s*$")
_RAN = re.compile(r"^Ran (\d+) tests? in ")


def parse_unittest(output: str, workdir: str = "") -> Tuple[int, List[Dict[str, str]]]:
    """(tests run, failures). failure = {test, kind, error_type, first_line, message, fingerprint}."""
    lines = output.splitlines()
    ran = 0
    for l in lines:
        m = _RAN.match(l)
        if m:
            ran = int(m.group(1))
    fails: List[Dict[str, str]] = []
    wd = os.path.normcase(os.path.abspath(workdir)) if workdir else ""
    i = 0
    while i < len(lines):
        m = _HEAD.match(lines[i])
        if not m:
            i += 1
            continue
        kind, name, owner = m.groups()
        test_id = owner if owner.endswith("." + name) else owner + "." + name
        i += 1
        block: List[str] = []
        while i < len(lines) and not lines[i].startswith("=" * 20):
            if lines[i].startswith("-" * 20) and block and _RAN.match(lines[i + 1] if i + 1 < len(lines) else ""):
                break
            block.append(lines[i])
            i += 1
        body = [b for b in block if not b.startswith("-" * 20)]
        first = ""
        for b in body:
            s = b.strip()
            if s.startswith('File "'):
                first = _rel_frame(s, wd)
                break
        tail = [b for b in body if b.strip() and not b.startswith(" ") and not b.startswith("Traceback")]
        last = tail[-1].strip() if tail else ""
        etype = last.split(":", 1)[0].strip() if last else kind
        etype = etype.rsplit(".", 1)[-1] if etype else kind
        fails.append({"test": test_id, "kind": kind, "error_type": etype, "first_line": first,
                      "message": last[:300], "fingerprint": fingerprint(test_id, etype, first)})
    return ran, fails


def _rel_frame(line: str, wd: str) -> str:
    m = re.match(r'File "(.+?)"(.*)$', line)
    if not m:
        return line
    path, rest = m.groups()
    p = os.path.normcase(os.path.abspath(path)) if os.path.isabs(path) else path
    if wd and os.path.isabs(path) and p.startswith(wd):
        path = os.path.relpath(os.path.abspath(path), wd)
    elif os.path.isabs(path):
        path = os.path.basename(path)
    return 'File "%s"%s' % (path.replace("\\", "/"), rest)


def _test_env() -> Dict[str, str]:
    from ..stacks.base import TEST_ENV_KEEP           # the same machine folders as every other test run
    out = {k: os.environ[k] for k in TEST_ENV_KEEP if k in os.environ}
    out.update({"PYTHONDONTWRITEBYTECODE": "1", "PYTHONIOENCODING": "utf-8", "PYTHONHASHSEED": "0"})
    return out


def run_tests(workdir: str, names: Sequence[str], timeout_s: int = TEST_TIMEOUT_S, _stack: Any = None) -> Dict[str, Any]:
    """Run `python -m unittest <names>` in workdir. Returns {rc, ran, failures, output, timeout}.
    A non-Python target stack (line.stacks) runs its own runner and returns the same shape."""
    st = _stack or stacks.for_repo(workdir)
    if not st.is_python:
        return st.run(workdir, names, max(float(timeout_s), float(st.test_timeout_s)))
    from ..runtime import python_exe
    cmd = [python_exe(), "-m", "unittest"] + list(names)
    try:
        p = subprocess.run(cmd, cwd=workdir, env=_test_env(), stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                           timeout=timeout_s)
    except subprocess.TimeoutExpired as e:
        out = (e.output or b"").decode("utf-8", "replace") if isinstance(e.output, bytes) else str(e.output or "")
        return {"rc": -1, "ran": 0, "failures": [], "output": out, "timeout": True}
    out = p.stdout.decode("utf-8", "replace")
    ran, fails = parse_unittest(out, workdir)
    return {"rc": p.returncode, "ran": ran, "failures": fails, "output": out, "timeout": False}


# ------------------------------------------------------------------ the gate


def _file_shas(path: str) -> List[str]:
    with open(path, "rb") as fh:
        raw = fh.read()
    lf = raw.replace(b"\r\n", b"\n")
    return [hashlib.sha256(x).hexdigest() for x in (raw, lf, lf.replace(b"\n", b"\r\n"))]


def _norm(p: str) -> str:
    return G._norm(p)


def scan_secrets(patch: str) -> List[Dict[str, Any]]:
    """Added lines of a unified diff that match SECRET_RULES: [{"file","line","rule"}] (no values)."""
    hits: List[Dict[str, Any]] = []
    cur, ln = "", 0
    for l in patch.splitlines():
        if l.startswith("+++ "):
            cur = l[4:].strip()
            cur = cur[2:] if cur.startswith("b/") else cur
            continue
        if l.startswith("@@"):
            m = re.search(r"\+(\d+)", l)
            ln = int(m.group(1)) if m else 0
            continue
        if l.startswith("+") and not l.startswith("+++"):
            for rule, rx in SECRET_RULES:
                if rx.search(l[1:]):
                    hits.append({"file": cur, "line": ln, "rule": rule})
                    break
            ln += 1
        elif not l.startswith("-"):
            ln += 1
    return hits


def _compile_errors(workdir: str, diff: Diff) -> List[Dict[str, str]]:
    out = []
    st = stacks.for_repo(workdir)
    if not st.is_python:
        for status, p in diff.files:
            if status == "D":
                continue
            try:
                with open(os.path.join(workdir, p), "rb") as fh:
                    err = st.compile_error(p, fh.read())
            except (OSError, ValueError):
                continue
            if err:
                first = 'File "%s"' % p
                et = err.split(":", 1)[0].strip() or "SyntaxError"
                out.append({"test": p, "error_type": et, "first_line": first, "message": err,
                            "fingerprint": fingerprint(p, et, first)})
    for status, p in diff.files:
        if status == "D" or not p.endswith(".py"):
            continue
        full = os.path.join(workdir, p)
        try:
            with open(full, "rb") as fh:
                compile(fh.read(), p, "exec", dont_inherit=True)
        except SyntaxError as e:
            first = 'File "%s", line %s' % (p, e.lineno)
            out.append({"test": p, "error_type": type(e).__name__, "first_line": first,
                        "message": "%s: %s" % (type(e).__name__, e.msg),
                        "fingerprint": fingerprint(p, type(e).__name__, first)})
        except (OSError, ValueError):
            continue
    return out


def _evidence(fails: Sequence[Mapping[str, Any]], output: str = "") -> str:
    parts = ["- %s: %s (%s)" % (f.get("test", ""), f.get("message", ""), f.get("first_line", "")) for f in fails]
    text = "\n".join(parts)
    if output:
        text += "\n\nTest output (tail):\n" + output[-(EVIDENCE_MAX // 2):]
    return text[:EVIDENCE_MAX]


def _tampered(workdir: str, paths: Sequence[str], locked: Sequence[AccTest]) -> List[str]:
    changed = {_norm(p) for p in paths}
    out = []
    for t in locked:
        tp = _norm(t.path)
        if tp in changed:
            out.append(tp)
            continue
        full = os.path.join(workdir, tp)
        if not os.path.isfile(full) or (t.sha and t.sha not in _file_shas(full)):
            out.append(tp)
    return sorted(set(out))


def _record(ev: Optional[Dict[str, Any]], names: Sequence[str], r: Mapping[str, Any], workdir: str) -> None:
    """Seal evidence (LINE_SEAL=1): the command the server ran, its output tail and exit code."""
    if ev is None:
        return
    st = stacks.for_repo(workdir)
    cmd = ("python -m unittest " + " ".join(names)) if st.is_python else "%s %s" % (st.name, " ".join(names))
    ev.update(cmd=cmd.strip(), output=str(r.get("output") or "")[-EVIDENCE_MAX:], exit_code=r.get("rc"),
              ran=r.get("ran", 0))


def _empty_gate(workdir: str, base: Dict[str, Any], tests: Sequence[AccTest], locked: Sequence[AccTest],
                timeout_s: int, ev: Optional[Dict[str, Any]] = None) -> Gate:
    """An empty diff. When the unit owns acceptance tests and the server's own run of them is green on the
    unchanged worktree (work merged earlier, e.g. a contract unit, already satisfies them), the unit is done
    with nothing to merge: passed with already_satisfied. Anything else is NO_PROGRESS, as before."""
    names = test_names(list(tests))
    if names and not _tampered(workdir, [], locked):
        r = run_tests(workdir, names, timeout_s)
        _record(ev, names, r, workdir)
        if not r["timeout"] and not r["failures"] and r["rc"] == 0 and r["ran"] > 0:
            return Gate.passed(**dict(base, tests=len(names), ran=r["ran"], passed=r["ran"], already_satisfied=True))
        fails = r["failures"]
        return Gate.fail(codes.NO_PROGRESS, **dict(base, ran=r["ran"], failures=fails),
                         evidence="The submission changed no files, and the unit's acceptance tests are not green "
                                  "without a change:\n" + _evidence(fails, r["output"]))
    return Gate.fail(codes.NO_PROGRESS, **base, evidence="The submission changed no files.")


def gate(unit: Unit, workdir: str, diff: Diff, tests: Sequence[AccTest] = (), locked: Sequence[AccTest] = (),
         prev_diff_sha: str = "", timeout_s: int = TEST_TIMEOUT_S, ev: Optional[Dict[str, Any]] = None) -> Gate:
    """The verifier's checks on one submitted attempt. Pure apart from running the tests.
    ev (seal on): filled with the evidence of the check that decided (command, output tail, exit code)."""
    base = {"diff_sha": diff.sha, "files": diff.paths}
    if diff.empty:
        return _empty_gate(workdir, base, tests, locked, timeout_s, ev)
    if prev_diff_sha and diff.sha == prev_diff_sha:
        return Gate.fail(codes.NO_PROGRESS, **base,
                         evidence="The submission is identical to the previous failed attempt.")

    tampered = _tampered(workdir, diff.paths, locked)
    if tampered:
        return Gate.fail(codes.TEST_TAMPER, **dict(base, tests=tampered),
                         evidence="Locked acceptance test files were changed: %s. Restore them; never edit tests."
                         % ", ".join(tampered))

    outside = [p for p in diff.paths if not any(G.claim_matches(p, c) for c in unit.claims)]
    if outside:
        return Gate.fail(codes.CLAIM_VIOLATION, **dict(base, outside=outside, claims=list(unit.claims)),
                         evidence="Files changed outside the claims %s: %s. Revert them."
                         % (", ".join(unit.claims), ", ".join(outside)))

    secrets = scan_secrets(diff.patch)
    if secrets:
        where = ", ".join("%s:%s (%s)" % (h["file"], h["line"], h["rule"]) for h in secrets)
        return Gate.fail(codes.SECRET_FOUND, **dict(base, secrets=secrets),
                         evidence="Possible secrets added at %s. Remove them; read configuration at runtime." % where)

    bad = _compile_errors(workdir, diff)
    if bad:
        return Gate.fail(codes.BUILD_FAIL, combine(f["fingerprint"] for f in bad), **dict(base, failures=bad),
                         evidence=_evidence(bad))

    names = test_names(list(tests))
    if not names:
        if ev is not None:      # no owned test: the compile check above is what the server ran
            py = [p for p in diff.paths if p.endswith(".py")]
            ev.update(cmd="python -m py_compile " + " ".join(py) if py else "git diff --name-status",
                      output="compiled without errors: %s" % (", ".join(py) or "no Python file") + "; changed: "
                      + ", ".join(diff.paths), exit_code=0, ran=0)
        return Gate.passed(**dict(base, tests=0, ran=0))
    r = run_tests(workdir, names, timeout_s)
    _record(ev, names, r, workdir)
    if r["timeout"]:
        return Gate.fail(codes.TEST_FAIL, fingerprint(",".join(names), "Timeout", ""),
                         **dict(base, ran=0, timeout=True), evidence="The tests did not finish in %ds." % timeout_s)
    fails = r["failures"]
    if fails:
        load_errors = [f for f in fails if f["test"].startswith("unittest.loader.")
                       or f["error_type"] in ("ImportError", "ModuleNotFoundError", "SyntaxError")]
        code = codes.BUILD_FAIL if len(load_errors) == len(fails) else codes.TEST_FAIL
        return Gate.fail(code, combine(f["fingerprint"] for f in fails),
                         **dict(base, ran=r["ran"], failures=fails, passed=max(r["ran"] - len(fails), 0)),
                         evidence=_evidence(fails, r["output"]))
    if r["rc"] != 0 or r["ran"] == 0:
        tail = [l for l in r["output"].splitlines() if l.strip()]
        last = tail[-1].strip() if tail else "no output"
        return Gate.fail(codes.BUILD_FAIL, fingerprint(",".join(names), "RunError", last),
                         **dict(base, ran=r["ran"], rc=r["rc"]), evidence=_evidence([], r["output"]))
    return Gate.passed(**dict(base, tests=len(names), ran=r["ran"], passed=r["ran"]))


# ------------------------------------------------------------------ retry ladder


@dataclass
class Decision:
    action: str          # "retry" | "switch_model" | "escalate"
    rung: int            # rung of the next attempt (0 primary model, 1 alternate model)
    model: str           # model of the next attempt ("" on escalate)
    reason: str


def _att(a: Any) -> Attempt:
    return a if isinstance(a, Attempt) else from_dict(Attempt, a)


def repeat_key(a: Attempt) -> str:
    if a.fingerprint:
        return a.fingerprint
    return a.code + "|" + str((a.detail or {}).get("repeat_key", ""))


def decide(history: Sequence[Any], cfg: Optional[Config] = None) -> Decision:
    """history: the unit's failed attempts in order, last = the failure just verified.
    Same rule as the one ladder (line.watchdog.decide): retry_n failures on a rung, or a failure
    whose repeat key already occurred on the rung -> next rung; rung 0 -> 1 switches to
    config.model_alt; leaving rung 1 escalates."""
    from ..watchdog import decide as ladder_decide
    cfg = cfg_or_default(cfg)
    hist = [_att(a) for a in history if _att(a).code and _att(a).outcome in ("failed", "")]
    if not hist:
        return Decision("retry", 0, cfg.model, "no failure recorded")
    cur = hist[-1]
    prev = [{"rung": a.rung, "fingerprint": repeat_key(a)} for a in hist[:-1]]
    nxt, reason = ladder_decide(prev, repeat_key(cur), cur.rung, cfg.retry_n)
    return _decision(nxt, cur.rung, reason, cur.code, sum(1 for a in hist if a.rung == cur.rung), cfg)


def _decision(nxt: int, rung: int, reason: str, code: str, on_rung: int, cfg: Config) -> Decision:
    if nxt == rung:
        return Decision("retry", rung, model_for_rung(rung, cfg),
                        "attempt %d of %d on rung %d (%s)" % (on_rung, cfg.retry_n, rung, code))
    why = "same failure twice (%s)" % code if reason == "repeat" else "%d failures on rung %d" % (on_rung, rung)
    if nxt >= 2:
        return Decision("escalate", nxt, "", why)
    return Decision("switch_model", nxt, model_for_rung(nxt, cfg), why)


# ------------------------------------------------------------------ verify (with side effects)


def _acc(store: Any, ids: Iterable[str]) -> List[AccTest]:
    out = []
    for tid in ids:
        row = store.get(E_ACC_TEST, tid)
        if row:
            out.append(from_dict(AccTest, row))
    return out


def verify(unit: Any, attempt: Optional[int], store: Any, sandbox: Any, cfg: Optional[Config] = None,
           timeout_s: int = TEST_TIMEOUT_S) -> Gate:
    cfg = cfg_or_default(cfg)
    u = load_unit(store, unit)
    n = int(attempt or u.attempt or 1)
    tests = _acc(store, u.tests)
    locked = [from_dict(AccTest, r) for r in store.query(E_ACC_TEST, run=u.run) if r.get("locked")]
    prev = store.get(E_ATTEMPT, attempt_id(u.id, n - 1)) if n > 1 else None
    prev_sha = ((prev or {}).get("detail") or {}).get("diff_sha", "") if (prev or {}).get("code") else ""
    workdir = u.worktree or sandbox.path(u)
    diff = sandbox.diff(u)
    ev: Optional[Dict[str, Any]] = {} if getattr(cfg, "seal_enabled", False) else None
    g = gate(u, workdir, diff, tests, locked, prev_sha, timeout_s, ev)

    listed = g.detail.get("outside") or g.detail.get("tests")
    rk = ",".join(sorted(listed)) if not g.ok and isinstance(listed, list) else ""
    grow = {"gate": to_dict(g), "unit": u.id, "attempt": n, "name": "verify", "run": u.run}
    if ev:
        grow["evidence_item"] = ev
    store.put(E_GATE, "%s:verify" % attempt_id(u.id, n), grow, run=u.run)
    _update_attempt(store, u, n, outcome="verified" if g.ok else "failed", code=g.code, fingerprint=g.fingerprint,
                    ended_ms=clock_ms(store),
                    detail={"evidence": g.detail.get("evidence", ""), "diff_sha": diff.sha, "repeat_key": rk,
                            "passed": g.detail.get("passed", 0)})
    e = env(u.run, cfg, unit=u.id, attempt=n, model=u.model)
    if g.ok:
        store.transition(E_UNIT, u.id, UnitState.VERIFIED, UnitState.SUBMITTED)
        body = {"from": UnitState.SUBMITTED.value, "to": UnitState.VERIFIED.value}
        if g.detail.get("already_satisfied"):
            body["already_satisfied"] = True
        store.emit(codes.UNIT_STATE, e, body)
        return g

    # the one per-unit ladder (line.watchdog): gate failures, BLOCKED, LLM errors and merge conflicts
    # share unit.detail.failures, so a rung never runs more than retry_n failed attempts
    from ..statemachine import StateMachine
    from ..watchdog import LADDER_LOCK, apply_failure, failures_on_rung, plan_failure
    key = g.fingerprint or "%s|%s" % (g.code, rk)
    with LADDER_LOCK:
        urow = store.get(E_UNIT, u.id) or to_dict(u)
        ld = plan_failure(urow, g.code, key, cfg.retry_n, cfg.model, cfg.model_alt,
                          {"gate": g.code, "attempt": n})
        on_rung = failures_on_rung({"rung": ld.from_rung, "detail": {"failures": ld.failures}})
        d = _decision(ld.rung, ld.from_rung, ld.reason, g.code, on_rung, cfg)
        if d.action != "escalate":
            d.model = ld.model
        g.detail["decision"] = to_dict(d)
        store.emit(codes.VERIFY_FAILED, e, {"code": g.code, "fingerprint": g.fingerprint, "decision": d.action,
                                            "next_model": d.model, "reason": d.reason,
                                            "evidence": str(g.detail.get("evidence", ""))[:1000]})
        apply_failure(store, u.id, ld, sm=StateMachine(store, cfg.agent_version, u.model), esc_code=g.code,
                      message="retry ladder exhausted: " + d.reason, ready_ms=clock_ms(store))
    return g

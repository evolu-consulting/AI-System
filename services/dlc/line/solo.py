"""The solo lane, simple first: one strong agent does the whole request in one session, the line checks the result.

The multi-agent lanes pay a fixed cost before any code is written (spec analyst, two readers, feature graph, test
author, planner) and every agent starts cold. On the NotesApp bench that was 3-12x what one Claude Code session
with its knowledge tools spent on the same requests, and 8 of 9 failed runs stopped on locked tests, not on code.
The solo lane works like that session: the agent (role solo, the run's main model, code tools + the run's dlc mcp tools: step_context,
search_knowledge, code_graph) reads the request and the code, implements, writes its own tests and runs them. What
the line keeps is what a session alone lacks:

  gate      code, never the model: the whole test suite of the worktree (the root stack's suite, so earlier runs'
            locked acceptance tests guard against regressions, plus every nested app's `npm test`); red -> the
            output goes back to the same agent, at most Config.solo_fix_rounds times
  QAS       main is exported to the idle QAS color and the same suite runs there from a clean checkout with fresh
            dependencies (a file the agent forgot to commit, a package it never declared)
  review    level 2 only: once the gate is green an independent reviewer (role solo_reviewer, a fast mid-size model,
            read-only tools) checks the diff against each point of the request; points it finds not done go back to
            the agent as a fix round, and still not done after the last round end the run
  ledger    every call on the run's budget, caps per call (solo_max_usd) and per run (max_usd_run)
  upgrade   a solo run that escalates is run again by the supervisor (line.reopen), one level up when it judges
            the failure major

Who takes it: levels 1 and 2 of the change sizer (understand.sizer), with Config.solo on (auto: with a real model).
Level 1 gets smaller caps (LEVEL1_MAX_TURNS / LEVEL1_MAX_USD, one fix round) and no review.

Resume: a run merged by a stopped driver (detail.solo.merged) goes straight to QAS; any other stop builds again
from main in a fresh worktree.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
from typing import Any, Dict, List

from . import codes, stacks
from .contracts import E_RUN, RunState, now_ms
from .ship._util import git, git_out, tail

ROLE = "solo"
LEAD_ROLE = "solo_lead"                 # levels 3-4 with Config.solo_lead on: the solo agent plus subagents (Task)
REVIEW_ROLE = "solo_reviewer"
LANE = "solo"
LEVEL1_MAX_TURNS = 60
LEVEL1_MAX_USD = 1.5
REVIEW_MAX_TURNS = 15
REVIEW_MAX_USD = 0.6
MAX_DIFF = 60_000
BRANCH = "line/%s/solo"
MAX_SPEC = 40_000
GATE_TAIL = 6000
#: never committed from the agent's worktree: installed packages, caches, local databases
EXCLUDE = (":(exclude,glob)**/node_modules/**", ":(exclude,glob)**/__pycache__/**", ":(exclude,glob)**/*.pyc",
           ":(exclude,glob)**/*.db", ":(exclude,glob)**/*.sqlite", ":(exclude,glob)**/*.sqlite3",
           ":(exclude,glob)**/.pytest_cache/**")


def keep_eol(wt: str, base: str = "HEAD") -> List[str]:
    """Agents on Windows save files with CRLF: a file that is LF-only at `base` and now has CRLF is written back with
    LF, so the commit shows the real change, not every line. New files and files that had CR at base stay as they
    are. -> the files rewritten."""
    out = []
    for rel in (git_out(wt, "diff", "--name-only", "--diff-filter=M", base) or "").splitlines():
        path = os.path.join(wt, *rel.split("/"))
        try:
            with open(path, "rb") as fh:
                now = fh.read()
        except OSError:
            continue
        if b"\r\n" not in now or b"\0" in now[:8000]:
            continue
        old = subprocess.run(["git", "-C", wt, "cat-file", "-p", "%s:%s" % (base, rel)], capture_output=True)
        if old.returncode != 0 or b"\r" in (old.stdout or b"") or b"\0" in (old.stdout or b"")[:8000]:
            continue
        with open(path, "wb") as fh:
            fh.write(now.replace(b"\r\n", b"\n"))
        out.append(rel)
    return out


_ORDER = [s.value for s in (RunState.ADMITTED, RunState.UNDERSTANDING, RunState.PLANNING, RunState.BUILDING,
                            RunState.INTEGRATING, RunState.QAS)]

PROMPT = """You deliver one change request end to end in this repository, alone, the way a senior engineer works in
their own Claude Code session. Nobody reviews your plan; an independent gate runs the whole test suite on your
result and again on a clean export of it, so what you hand over must work from a fresh checkout.

THE REQUEST ({flow}):
-----
{spec}
-----

Working copy: {wt}
(a git worktree on branch {branch}; do not commit, do not switch branches: the line commits your files)
Tests already in the repository: {tests}
{graph}
How to work:
1. Look first. Call step_context once with the request's intent: earlier decisions, lessons and findings of this
   project. Then find the code the request touches ({look}) and read what you need.
2. Implement the whole request, every point of it. Follow the repository's structure, stack and style; touch only
   what the request needs; leave other folders alone.
3. Tests: add or update automated tests that cover each point of the request, run by the project's normal test
   command (npm test in a Node app's folder, python -m unittest at the root). Tests must not depend on this machine:
   no absolute paths, no installed browser, no git state, no network, no fixed port; each test sets up and removes
   its own data. Existing tests keep passing; change one only where the request changes that behaviour.
4. Prove it: install the dependencies, run the full test suite, start the app once the way its README says, check
   that it answers, then stop it. Fix whatever fails.
5. Declare every package you use in the manifest (package.json, requirements.txt); keep node_modules, build output
   and local databases out of git (.gitignore).
6. Where the request is unclear or contradicts itself, or changes behaviour an existing test or client relies on: do
   not stop. Choose the reading that serves the user best, build it, and write the decision down where the next
   person finds it (a "Decisions" section in the app's README, and the test's name). A person reviews these.

Your final message: a short summary (what changed, which files, how you verified it), then the decisions under a
line DECISIONS: (one per line: the question, what you chose, why; "none" when there were none), then a last line
SUBMIT. Write BLOCKED:<kind>: <reason> instead only when you cannot go on, where kind is one of
  spec    no reasonable reading of the request exists (not merely unclear: then decide, see 6.)
  unsafe  the request would harm data, security or users
  access  a credential, a permission or an outside system you cannot reach
  host    a tool or the machine itself is broken
and the reason says exactly what is missing and what would let you go on.
"""

LEAD = """
This request is large. You are the lead: you own the plan, the code and the result, and you may hand bounded parts
to subagents (the Task tool) to save your own context and time:
- Delegate only parts that are independent of each other and of your open decisions: searching and reading the
  code to answer a question, drafting the tests of one point of the request, reviewing your finished diff with a
  fresh eye, or one module whose interface you fixed first. Give each subagent the exact files, the interface and
  what to return; ask research and test subagents to use model "sonnet".
- Do the sequential core yourself: the data model, the shared code paths, the wiring between parts, and every
  integration of a subagent's result. Two writers never edit the same file; a subagent that writes code gets its
  own files only, and you read what it changed before you go on.
- Do not delegate what you can do in a few steps; every subagent starts cold and costs its own reading.
"""

FIX = """

THE GATE FAILED after your last attempt (round {n} of {rounds}). It ran the whole test suite in your working copy:
-----
{output}
-----
Your earlier work is still in the working copy. Find the cause and fix the code (or a test that is wrong for this
request); do not delete or weaken a test only to make it pass. Run the full suite again yourself, then end with
the summary and SUBMIT.
"""

REVIEW = """You check one delivered change against the request it answers. You only look; you change nothing.
The change's tests already pass. Do not judge style, naming or taste.

THE REQUEST:
-----
{spec}
-----

THE CHANGE (git diff against main, lockfiles left out):
-----
{diff}
-----

The working copy is the current directory: Read / Glob / Grep it when the diff alone does not show enough.
List only points of the request that the change does not do, does differently, or breaks (an existing feature, an
API an old client uses, a limit or error the request states). Quote the request's words and give the evidence
(file:line, or what is missing). A point the change decided on purpose and recorded (README "Decisions", a test
name) where the request is unclear is NOT a miss.

Your final message is ONE JSON object, then a last line SUBMIT:
{{"verdict": "pass|fix", "missing": [{{"point": "<the request's words>", "evidence": "<file:line or what is missing>"}}]}}
SUBMIT
"""

REVIEW_FIX = """

AN INDEPENDENT REVIEW of your change against the request (round {n} of {rounds}) found points not done:
{points}
Check each one in the code. Fix it, or where the request is unclear and you chose on purpose, record the decision
(README "Decisions") and list it under DECISIONS:. Run the full suite again, then the summary, DECISIONS: and SUBMIT.
"""


# ------------------------------------------------------------------ who takes the lane

def enabled(cfg: Any) -> bool:
    mode = str(getattr(cfg, "solo", "auto") or "auto").strip().lower()
    if mode in ("0", "off", "false", "no"):
        return False
    if mode in ("1", "on", "true", "yes"):
        return True
    return str(getattr(cfg, "llm", "fake")) != "fake"


def review_on(cfg: Any, level: int) -> bool:
    mode = str(getattr(cfg, "solo_review", "auto") or "auto").strip().lower()
    if mode in ("0", "off", "false", "no"):
        return False
    return mode in ("1", "on", "true", "yes") or level >= 2


def lead_on(cfg: Any) -> bool:
    """Levels 3-4 go to one lead agent with subagents instead of the team: auto = whenever the solo lane is on
    (the team lane was green 1 time in 4 at 2-4 times the cost); 0 = the team lanes."""
    mode = str(getattr(cfg, "solo_lead", "auto") or "auto").strip().lower()
    if mode in ("0", "off", "false", "no"):
        return False
    return mode in ("1", "on", "true", "yes") or enabled(cfg)


# ------------------------------------------------------------------ the gate (code)

def suite(tree: str) -> Dict[str, Any]:
    """The whole test suite of a tree: the root stack's own suite, then `npm test` of every nested Node app.
    -> {"ok", "ran", "parts": [{"where", "rc", "ran", "ok"}], "output"}. A tree with no test at all is not ok."""
    from .build.verifier import run_tests
    parts: List[Dict[str, Any]] = []
    out: List[str] = []
    root = stacks.for_repo(tree)
    nested = stacks.nested_apps(tree) if root.is_python or getattr(root, "nests", False) else []
    node = stacks.STACKS["react"]
    prepared: Dict[str, str] = {d: node.prepare(d) or "" for d in nested}   # before the root suite: its tests may
    r = run_tests(tree, [], _stack=root)                                     # start a nested app (bench run 4, C5)
    ran = int(r.get("ran") or 0)
    # python -m unittest with nothing to discover: rc 5 (3.12+) or 0 with "Ran 0 tests"; that is not a failure
    # as long as some other part has tests
    empty = root.is_python and ran == 0 and not r.get("failures") and r.get("rc") in (0, 5)
    ok = (r.get("rc") == 0 and not r.get("timeout")) or empty
    parts.append({"where": ".", "stack": root.name, "rc": r.get("rc"), "ran": ran, "ok": ok, "empty": empty})
    if not empty:
        out.append("== . (%s) rc=%s ran=%d\n%s" % (root.name, r.get("rc"), ran, tail(r.get("output") or "", 3000)))
    from .stacks.base import run as run_argv, test_env
    from .stacks.node import npm_argv
    for d in nested:
        rel = os.path.relpath(d, tree).replace("\\", "/")
        problem = prepared.get(d, "")
        if problem:
            parts.append({"where": rel, "stack": "npm", "rc": -1, "ran": 0, "ok": False})
            out.append("== %s: npm install failed\n%s" % (rel, tail(problem, 2000)))
            continue
        nr = run_argv(npm_argv("test"), d, float(node.suite_timeout_s), test_env())
        nok = nr.get("rc") == 0 and not nr.get("timeout")
        parts.append({"where": rel, "stack": "npm", "rc": nr.get("rc"), "ran": 1, "ok": nok})
        out.append("== %s (npm test) rc=%s\n%s" % (rel, nr.get("rc"), tail(nr.get("output") or "", 3000)))
    has_tests = any(p["ran"] for p in parts)
    if not has_tests:
        out.append("no automated test found: the root suite ran nothing and no nested app has tests")
    return {"ok": has_tests and all(p["ok"] for p in parts), "ran": sum(p["ran"] for p in parts), "parts": parts,
            "output": "\n".join(out)}


def suite_argv() -> List[str]:
    """The QAS smoke command: suite() of the deployed color (cwd), exit 0 when green."""
    from .config import SDLC_DIR
    from .runtime import frozen, python_exe
    if frozen():
        from .llm.cli import console_exe
        return [console_exe(), "suite"]
    code = ("import sys; sys.path.insert(0, %r); from line.solo import main; sys.exit(main(['.']))" % SDLC_DIR)
    return [python_exe(), "-c", code]


def main(argv: List[str]) -> int:
    res = suite(os.path.abspath(argv[0] if argv else "."))
    print(res["output"])
    print("suite: %s (%d ran)" % ("ok" if res["ok"] else "FAILED", res["ran"]))
    return 0 if res["ok"] else 1


# ------------------------------------------------------------------ the lane

def _forward(pipe: Any, to: RunState) -> None:
    """Enter `to` through the states between (the run machine moves one stage at a time); never backwards."""
    cur = pipe._state()
    if cur not in _ORDER:
        return
    for st in _ORDER[_ORDER.index(cur) + 1:_ORDER.index(to.value) + 1]:
        pipe._enter(RunState(st))


def _solo(pipe: Any) -> Dict[str, Any]:
    return dict(((pipe.store.get(E_RUN, pipe.run) or {}).get("detail") or {}).get("solo") or {})


def _save(pipe: Any, **kv: Any) -> Dict[str, Any]:
    cur = _solo(pipe)
    cur.update(kv)
    pipe._set_detail(solo=cur)
    if "attempts" in kv:
        _outcomes(pipe, cur)
    return cur


def _outcomes(pipe: Any, cur: Dict[str, Any], **extra: Any) -> None:
    """What the build agent and the reviewer did, for the retro (line.outcomes)."""
    from . import outcomes
    attempts = cur.get("attempts") or []
    outcomes.record(pipe.store, pipe.run, str(cur.get("role") or ROLE),
                    rounds=[dict({"n": a.get("n"), "agent": str(a.get("outcome") or "")[:300], "gate": a.get("gate"),
                                  "tests_ran": a.get("ran")}, **({"blocked": a["blocked"]} if a.get("blocked") else {}))
                            for a in attempts],
                    first_gate_green=bool(attempts and attempts[0].get("gate")),
                    questions=cur.get("questions") or [], decisions=cur.get("decisions") or [], **extra)
    reviewed = [a for a in attempts if "review" in a]
    if reviewed:
        outcomes.record(pipe.store, pipe.run, REVIEW_ROLE,
                        misses_per_round=[len(a.get("review") or []) for a in reviewed],
                        points=[m.get("point") for a in reviewed for m in (a.get("review") or [])],
                        passed_last=not reviewed[-1].get("review"))


def _worktree(pipe: Any) -> str:
    repo, branch = pipe.repo, BRANCH % pipe.run
    wt = os.path.join(pipe.workdir, "solo")
    from .changequeue import repo_lock
    with repo_lock(repo):                          # runs of one project share the repository's worktree list
        git(repo, "worktree", "prune", check=False)
        if os.path.isdir(wt):
            git(repo, "worktree", "remove", "--force", wt, check=False)
            shutil.rmtree(wt, ignore_errors=True)
        git(repo, "branch", "-D", branch, check=False)
        git(repo, "worktree", "add", "-q", "-b", branch, wt, "main")
    return wt


#: why a solo agent stopped (PROMPT); spec / unsafe / access / host go to a person (supervisor), other may retry
BLOCK_KINDS = ("spec", "unsafe", "access", "host")
_KIND = re.compile(r"^\s*(%s)\s*[:\-]\s*" % "|".join(BLOCK_KINDS), re.I)


def blocked(outcome: str, text: str = "") -> tuple:
    """(kind, reason) of a BLOCKED answer: the reason from the final message's BLOCKED line (the outcome may be
    cut), its kind as the agent named it, else what the watchdog reads in the words ('host'), else 'other'."""
    line = next((ln.strip() for ln in reversed((text or "").splitlines())
                 if ln.strip().upper().startswith("BLOCKED")), "") or (outcome or "").strip()
    reason = line[len("BLOCKED"):].lstrip(" :").strip()
    m = _KIND.match(reason)
    if m:
        return m.group(1).lower(), reason[m.end():].strip()
    from .watchdog import blocked_kind
    return ("host" if blocked_kind(reason) == "host" else "other"), reason


def decisions(text: str) -> List[str]:
    """The lines under DECISIONS: in the agent's final message (up to SUBMIT / BLOCKED), "none" left out."""
    lines = (text or "").splitlines()
    for i in range(len(lines) - 1, -1, -1):
        if not lines[i].strip().upper().startswith("DECISIONS:"):
            continue
        out = [lines[i].strip()[len("DECISIONS:"):]]
        for ln in lines[i + 1:]:
            if ln.strip().upper().startswith(("SUBMIT", "BLOCKED")):
                break
            out.append(ln)
        items = [d.strip().lstrip("-*").strip() for d in out]
        return [d[:400] for d in items if d and d.lower() != "none"][:12]
    return []


def _changed(wt: str) -> bool:
    return bool(git(wt, "status", "--porcelain", check=False).stdout.strip())


def _tests_in(repo: str) -> str:
    found: List[str] = []
    for root, dirs, files in os.walk(repo):
        dirs[:] = [d for d in dirs if d not in ("node_modules", ".git", "dist", "build", "__pycache__")]
        rel = os.path.relpath(root, repo).replace("\\", "/")
        if "test" in rel.lower():
            found += ["%s/%s" % (rel, f) for f in files if f.endswith((".py", ".js", ".ts", ".mjs", ".cjs"))]
        if len(found) >= 30:
            break
    return ", ".join(sorted(found)[:30]) or "(none)"


def _prompt(pipe: Any, wt: str, spec: str, flow: str) -> str:
    from . import codegraph, specdesign
    hubs = codegraph.summary(pipe.cfg, pipe.run, top=12)
    library = specdesign.prompt_block(pipe, spec)         # problem -> solution per context from earlier requests
    return (library + "\n" if library else "") + PROMPT.format(flow=flow or "change", spec=spec[:MAX_SPEC], wt=wt, branch=BRANCH % pipe.run,
                         tests=_tests_in(wt),
                         graph=("The repository's most connected code (code_graph hubs):\n" + hubs + "\n") if hubs else "",
                         look="code_graph first, then Glob / Grep" if hubs else "Glob / Grep")


def _diff(wt: str) -> str:
    """The worktree's change against main as the reviewer sees it: new files included, lockfiles left out."""
    git(wt, "add", "-A", "--", ".", *EXCLUDE)
    cp = git(wt, "diff", "--cached", "--", ".", ":(exclude,glob)**/package-lock.json",
             ":(exclude,glob)**/yarn.lock", ":(exclude,glob)**/pnpm-lock.yaml", check=False)
    text = cp.stdout or ""
    return text if len(text) <= MAX_DIFF else text[:MAX_DIFF] + "\n... (diff cut at %d characters)" % MAX_DIFF


def misses(text: str) -> List[Dict[str, str]]:
    """The points the reviewer found not done: [] for a pass, an answer without a verdict, or no JSON at all."""
    dec = json.JSONDecoder()
    for i in reversed([m.start() for m in re.finditer(r"\{", text or "")]):
        try:
            data, _end = dec.raw_decode(text, i)
        except ValueError:
            continue
        if isinstance(data, dict) and "verdict" in data:
            if str(data.get("verdict") or "").strip().lower() != "fix":
                return []
            out = []
            for m in data.get("missing") or []:
                if isinstance(m, dict) and str(m.get("point") or "").strip():
                    out.append({"point": str(m["point"])[:400], "evidence": str(m.get("evidence") or "")[:400]})
            return out[:10]
    return []


def _review(pipe: Any, wt: str, spec: str, n: int) -> List[Dict[str, str]]:
    """The independent reviewer of a green round; advisory when it fails (the gate already passed)."""
    prompt = REVIEW.format(spec=spec[:MAX_SPEC], diff=_diff(wt) or "(no change)")
    try:
        res = pipe.llm.agentic(REVIEW_ROLE, wt, prompt, REVIEW_MAX_TURNS, REVIEW_MAX_USD, key="review#%d" % n,
                               run=pipe.run)
    except Exception as e:   # noqa: BLE001 - a review that cannot run does not stop a green change
        pipe.log("%s: solo review %d failed: %s" % (pipe.run, n, e))
        return []
    finally:
        pipe._charge_stage()
    return misses(str(getattr(res, "text", "") or ""))


def _build(pipe: Any) -> str:
    """Agent + gate (+ review) rounds in a fresh worktree; returns the commit on the solo branch. Raises Escalate."""
    from .pipeline import Escalate
    from .understand.sizer import level_of
    cfg = pipe.cfg
    detail = (pipe.store.get(E_RUN, pipe.run) or {}).get("detail") or {}
    with open(os.path.join(pipe.pack, "spec.md"), encoding="utf-8") as fh:
        spec = fh.read()
    wt = _worktree(pipe)
    prompt = _prompt(pipe, wt, spec, str(detail.get("flow") or ""))
    level = level_of(pipe)
    rounds = max(int(getattr(cfg, "solo_fix_rounds", 2) or 0), 0)
    turns = int(getattr(cfg, "solo_max_turns", 120) or 120)
    cap = float(getattr(cfg, "solo_max_usd", 4.0) or 4.0)
    if level <= 1:
        rounds, turns, cap = min(rounds, 1), min(turns, LEVEL1_MAX_TURNS), min(cap, LEVEL1_MAX_USD)
    review = review_on(cfg, level)
    role = LEAD_ROLE if level >= 3 else ROLE
    if role == LEAD_ROLE:
        prompt += LEAD
    _save(pipe, role=role)
    attempts: List[Dict[str, Any]] = []
    feedback = ""
    for n in range(rounds + 1):
        pipe._check_cancel()
        t0 = now_ms()
        try:
            res = pipe.llm.agentic(role, wt, prompt + feedback, turns, cap, key="solo#%d" % n, run=pipe.run)
        finally:
            pipe._charge_stage()
        outcome = str(getattr(res, "outcome", "") or "")
        att: Dict[str, Any] = {"n": n, "outcome": outcome, "usd": round(float(getattr(res, "usd", 0) or 0), 4),
                               "ms": now_ms() - t0}
        text = str(getattr(res, "text", "") or "")
        decided = decisions(text)
        if decided:
            _save(pipe, decisions=decided)
        stopped = outcome.startswith("BLOCKED") and "max_turns" not in outcome and "budget" not in outcome \
            and "no_outcome" not in outcome
        pipe._check_cancel()
        g = suite(wt)
        if stopped:
            kind, why = blocked(outcome, text)
            att["blocked"] = {"kind": kind, "reason": why[:600]}
            # the agent stopped on a question but its work is there and green: the question goes to a person with the
            # result (detail.solo.questions) and the run goes on; nothing done or a red suite is a real stop
            if not (g["ok"] and _changed(wt)):
                attempts.append(dict(att, gate=g["ok"]))
                _save(pipe, attempts=attempts)
                # the block is a claim ("this cannot be done without X"): the retry's result judges it (line.outcomes)
                from . import outcomes
                outcomes.record(pipe.store, pipe.run, role, judged_by_retry=True, blocked_kind=kind,
                                blocked_reason=why)
                raise Escalate(codes.NO_PROGRESS, "the solo agent stopped (%s): %s" % (kind, why[:300]),
                               {"lane": LANE, "attempts": attempts, "text": tail(text, 2000), "blocked_kind": kind,
                                "blocked_reason": why[:2000]})
            _save(pipe, questions=_solo(pipe).get("questions", []) + [why[:600]])
        att.update(gate=g["ok"], ran=g["ran"], parts=g["parts"])
        attempts.append(att)
        _save(pipe, attempts=attempts)
        pipe.log("%s: solo round %d (level %d): agent %s, gate %s (%d ran)"
                 % (pipe.run, n, level, outcome, "ok" if g["ok"] else "red", g["ran"]))
        if not g["ok"]:
            feedback = FIX.format(n=n + 1, rounds=rounds, output=tail(g["output"], GATE_TAIL))
            continue
        if not review:
            break
        found = _review(pipe, wt, spec, n)
        att["review"] = found
        _save(pipe, attempts=attempts)
        pipe.log("%s: solo review %d: %s" % (pipe.run, n, "%d point(s) not done" % len(found) if found else "pass"))
        if not found:
            break
        if n >= rounds:
            raise Escalate(codes.NO_PROGRESS, "the review still finds %d point(s) of the request not done after %d "
                           "round(s)" % (len(found), rounds), {"lane": LANE, "attempts": attempts, "missing": found})
        feedback = REVIEW_FIX.format(n=n + 1, rounds=rounds,
                                     points="\n".join("- %s (%s)" % (m["point"], m["evidence"]) for m in found))
    else:
        raise Escalate(codes.NO_PROGRESS, "the solo lane's gate stayed red after %d fix round(s)" % rounds,
                       {"lane": LANE, "attempts": attempts, "output": tail(g["output"], 3000)})
    keep_eol(wt)
    git(wt, "add", "-A", "--", ".", *EXCLUDE)
    if git(wt, "diff", "--cached", "--quiet", check=False).returncode == 0:
        raise Escalate(codes.NO_PROGRESS, "the solo agent changed nothing", {"lane": LANE, "attempts": attempts})
    git(wt, "-c", "gc.auto=0", "commit", "-q", "-m", "line %s: solo" % pipe.run)
    return git_out(wt, "rev-parse", "HEAD")


def _merge(pipe: Any, sha: str) -> None:
    from .pipeline import Escalate
    repo = pipe.repo
    from .changequeue import repo_lock
    with repo_lock(repo):
        cp = git(repo, "merge", "-q", "--ff-only", sha, check=False)
        if cp.returncode != 0:
            raise Escalate(codes.STATE_CONFLICT, "main moved while the solo agent worked; merge refused",
                           {"lane": LANE, "sha": sha, "stderr": (cp.stderr or "")[-1000:]})
        wt = os.path.join(pipe.workdir, "solo")
        git(repo, "worktree", "remove", "--force", wt, check=False)
        shutil.rmtree(wt, ignore_errors=True)
        git(repo, "branch", "-D", BRANCH % pipe.run, check=False)


def run(pipe: Any) -> None:
    """The solo lane from understanding to green; raises Escalate (the pipeline ends the run with it)."""
    from .pipeline import Escalate, QAS_DIR
    from .ship.deploy import Deployer
    from .understand import ingest
    from . import gates
    if gates.enabled(pipe):                  # Enhancement / Bug Fix: the gated flow of steps 4-13 (line.gates)
        gates.run(pipe)
        return
    state = _solo(pipe)
    if not (pipe.store.get(E_RUN, pipe.run) or {}).get("spec_hash"):
        pipe._hook("run_start")
        pv = ingest(pipe.pack, pipe.sstore, pipe.rag, run=pipe.run, cfg=pipe.cfg)   # frozen request, no model
        from .statemachine import update_row
        update_row(pipe.store, E_RUN, pipe.run, {"spec_hash": pv.version})
    # QAS runs the solo branch's commit; main moves only once that is green, so a red QAS leaves main as it was
    # (bench run 4: a run merged first, failed QAS, and its retry started on the half-delivered main)
    sha = str(state.get("merged") or state.get("built") or "")
    if not sha or not git(pipe.repo, "cat-file", "-e", sha + "^{commit}", check=False).returncode == 0:
        from . import changequeue
        changequeue.wait_turn(pipe)               # implement, test, merge: one run of the project at a time
        _forward(pipe, RunState.BUILDING)
        pipe._board("build", "solo agent", "one agent reads, builds and tests the request; the gate runs the suite")
        sha = _build(pipe)
        state = _save(pipe, built=sha)
    _forward(pipe, RunState.INTEGRATING)
    _forward(pipe, RunState.QAS)
    pipe._hook("before_qas")
    deployer = Deployer(pipe.sstore, pipe.repo, pipe.cfg, qas_root=os.path.join(pipe.workdir, QAS_DIR),
                        smoke_cmd=pipe.smoke_cmd or suite_argv())
    res = pipe._qas_locked(lambda: deployer.deploy(pipe.run, ref=sha))
    _outcomes(pipe, _solo(pipe), qas="green" if res.deployed or res.reason == "already_live" else "failed: %s" % res.reason)
    if not res.deployed and res.reason != "already_live":
        raise Escalate(codes.SMOKE_FAIL, "the suite failed on a clean QAS export (%s); main is unchanged" % res.reason,
                       {"lane": LANE, "sha": sha, "output": tail(str((res.detail or {}).get("output", "")), 3000)})
    if not state.get("merged"):
        _merge(pipe, sha)
        state = _save(pipe, merged=sha)
    if not (((pipe.store.get(E_RUN, pipe.run) or {}).get("detail") or {}).get("spec_design") or {}).get("retained"):
        from . import specdesign                         # what this request taught, for the next one (never raises)
        with open(os.path.join(pipe.pack, "spec.md"), encoding="utf-8") as fh:
            spec_text = fh.read()
        specdesign.retain(pipe, spec_text, list(state.get("decisions") or []),
                          str(((pipe.store.get(E_RUN, pipe.run) or {}).get("detail") or {}).get("flow") or ""))
    pipe._hook("before_green")
    pipe._deliver()
    pipe._quiesce()
    spent = pipe._spent()
    pipe._board("qas", "green", "whole suite green on the QAS export")
    st = _solo(pipe)
    if st.get("decisions") or st.get("questions"):     # what a person should look at in the green result
        pipe._board("decisions", "to review", "\n".join(["question: " + q for q in st.get("questions") or []]
                                                        + ["decided: " + d for d in st.get("decisions") or []])[:3000])
    pipe._board("result", "green", "$%.2f spent; main at %s" % (spent, res.sha or ""))
    pipe._advance(RunState.GREEN, extra=[(codes.RUN_GREEN, {
        "sha": res.sha or git_out(pipe.repo, "rev-parse", "main"), "color": res.color, "lane": LANE,
        "qas": {"suite": "green"}, "usd": round(spent, 6), "units": 0, "quarantined": []})])


__all__ = ["ROLE", "LEAD_ROLE", "REVIEW_ROLE", "LANE", "enabled", "review_on", "lead_on", "suite", "suite_argv", "decisions", "misses",
           "main", "run"]


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

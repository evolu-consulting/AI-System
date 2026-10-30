"""The merger: the agent that integrates a verified unit into main, so builders only implement.

The merge queue (line.ship.merge_queue) rebases a unit onto main in the run's integration worktree. When
that stops on a conflict (stage "rebase") or the rebased unit turns acceptance tests red (stage "tests"),
the queue hands the worktree, as it is, to resolve(): one agentic call (role merger, tools: Bash, Read,
Edit, Grep ... and the run's dlc mcp tools, search_knowledge first) that

  1. reads both sides: what the unit was asked to do (its spec sections and commits) and what main
     gained since (commits of the units merged before it),
  2. asks the project's knowledge which business rule decides the overlap (search_knowledge),
  3. resolves the conflict in the working tree keeping both intents, `git add`, `git rebase --continue`
     (stage rebase), or fixes the integration so the locked acceptance tests pass and commits (stage tests),
  4. ends SUBMIT, or BLOCKED:<reason> when the unit cannot be integrated as specified (e.g. a locked
     acceptance test that no code can satisfy): that goes to a person, not back to the builder.

The engine then checks the work itself: rebase finished, no conflict markers, locked acceptance tests
untouched; the queue reruns the tests. A failed or empty resolution sends the unit back to its builder as
before (the merger's notes ride along in unit.detail.merge_conflict). LINE_MERGER: auto (on with a real
model) | 1 | 0; at most LINE_MERGER_MAX_CALLS calls per unit.
"""

from __future__ import annotations

import os
import re
from typing import Any, Callable, Dict, List, Optional

from .. import codes
from ..contracts import E_ACC_TEST, E_UNIT
from ._util import git, git_out, run_env, tail

ROLE = "merger"
MAX_DIFF = 12_000

PROMPT = """You are the merger of an automated delivery line. Builders only implement; you own git and the
integration of their work into main. Work only in this folder (the integration worktree): {wt}

Unit {unit}: {title}
{situation}

What the unit was asked to do (spec sections of its features):
-----
{spec}
-----

Commits of the unit (being rebased onto main):
{unit_log}

Commits main gained since the unit started (other units, merged before it):
{main_log}

{evidence}

Do this, in order:
1. Read both sides of every overlap (git diff, git log -p on the files involved) and work out what each side
   meant to do.
2. Call search_knowledge for the business rule that decides each overlap (the feature or screen, the field,
   the rule, earlier decisions). Keep both intents unless a rule of the project says otherwise; say which
   rule decided.
3. {task}
4. Never change these locked acceptance test files: {locked}. Never push, never touch other branches,
   never `git rebase --abort`.

End your reply with a last line SUBMIT when the work is integrated, or BLOCKED:<one-line reason> when the
unit cannot be integrated as specified (for example a locked acceptance test that no code can satisfy): a
person decides then.
"""

TASK_REBASE = ("Resolve every conflicted file in the working tree (no conflict markers left), `git add` it and run "
               "`git -c core.editor=true rebase --continue`; repeat until the rebase is finished.")
TASK_TESTS = ("The rebase was clean but these acceptance tests are red on the integrated code. Fix the integration "
              "in the code (not the tests) so they pass, run them (python -m unittest <names>), then "
              "`git add -A` and `git commit -m \"merger: integrate {unit}\"`.")

_MARKER = re.compile(r"^(<{7}|>{7})( |$)", re.M)


def enabled(cfg: Any) -> bool:
    mode = str(getattr(cfg, "merger", "auto") or "auto").strip().lower()
    if mode in ("0", "off", "false", "no"):
        return False
    if mode in ("1", "on", "true", "yes"):
        return True
    return str(getattr(cfg, "llm", "fake")) != "fake"


def _locked(store: Any, run: str) -> List[str]:
    paths = []
    for t in store.query(E_ACC_TEST, run=run):
        p = str(t.get("path") or "").replace("\\", "/")
        if p and p not in paths:
            paths.append(p)
    return paths


def _rebasing(wt: str) -> bool:
    for name in ("rebase-merge", "rebase-apply"):
        p = git(wt, "rev-parse", "--git-path", name, check=False).stdout.strip()
        if p and os.path.isdir(p if os.path.isabs(p) else os.path.join(wt, p)):
            return True
    return False


def _markers(wt: str, files: List[str]) -> List[str]:
    bad = []
    for f in files:
        try:
            with open(os.path.join(wt, f), encoding="utf-8", errors="replace") as fh:
                if _MARKER.search(fh.read()):
                    bad.append(f)
        except OSError:
            pass
    return bad


class Merger:
    """resolve(run, unit_row, wt, stage, info) -> {"resolved", "blocked", "reason", "usd", "summary"}."""

    def __init__(self, store: Any, cfg: Any, llm: Any, spec_for: Optional[Callable[[Dict[str, Any]], str]] = None):
        self.store, self.cfg, self.llm = store, cfg, llm
        self.spec_for = spec_for or (lambda _row: "")

    def calls(self, unit_row: Dict[str, Any]) -> int:
        return int((unit_row.get("detail") or {}).get("merger_calls", 0) or 0)

    def may_try(self, unit_row: Dict[str, Any]) -> bool:
        return self.calls(unit_row) < max(int(getattr(self.cfg, "merger_max_calls", 2) or 0), 0)

    def resolve(self, run: str, unit_row: Dict[str, Any], wt: str, stage: str, info: Dict[str, Any]) -> Dict[str, Any]:
        unit = str(unit_row.get("id", ""))
        old_main, head = str(info.get("main", "")), str(info.get("head", ""))
        locked = _locked(self.store, run)
        files = list(info.get("files") or [])
        if stage == "rebase":
            situation = "The rebase onto main stopped on conflicts in: %s" % (", ".join(files) or "(see git status)")
            evidence = "Conflicts as they stand (git diff):\n%s" % tail(git(wt, "diff", check=False).stdout, MAX_DIFF)
            task = TASK_REBASE
        else:
            situation = "The unit rebased cleanly onto main, but acceptance tests are red on the result."
            evidence = "Red acceptance tests: %s\nTest output:\n%s" % (
                ", ".join(info.get("tests") or []), tail(str(info.get("output", "")), MAX_DIFF))
            task = TASK_TESTS.format(unit=unit)
        base = git(wt, "merge-base", old_main, head, check=False).stdout.strip() if old_main and head else ""
        prompt = PROMPT.format(
            wt=wt, unit=unit, title=unit_row.get("title", ""), situation=situation,
            spec=self.spec_for(unit_row)[:MAX_DIFF] or "(no spec sections)",
            unit_log=git(wt, "log", "--oneline", "-20", "%s..%s" % (old_main, head), check=False).stdout.strip()
            if old_main and head else "(unknown)",
            main_log=git(wt, "log", "--oneline", "-20", "%s..%s" % (base, old_main), check=False).stdout.strip()
            if base else "(unknown)",
            evidence=evidence, task=task, locked=", ".join(locked) or "(none)")
        self._count(unit)
        out: Dict[str, Any] = {"resolved": False, "blocked": False, "reason": "", "usd": 0.0, "summary": ""}
        try:
            res = self.llm.agentic(ROLE, wt, prompt, int(getattr(self.cfg, "merger_max_turns", 40) or 40),
                                   float(getattr(self.cfg, "merger_max_usd", 2.0) or 2.0),
                                   key="merger:%s:%s" % (unit, stage), run=run)
            outcome = str(getattr(res, "outcome", "") or "")
            out.update(usd=round(float(getattr(res, "usd", 0) or 0), 4),
                       summary=str(getattr(res, "text", "") or "")[-1500:])
        except Exception as e:   # noqa: BLE001 - the merger helps; the builder path still exists
            outcome = ""
            out["reason"] = "merger call failed: %s" % str(e)[:300]
        if outcome.upper().startswith("BLOCKED"):
            out.update(blocked=True, reason=outcome.split(":", 1)[-1].strip() or "blocked")
        elif outcome.upper().startswith("SUBMIT"):
            why = self._check(wt, old_main, head, files, locked)
            out.update(resolved=not why, reason=why)
        elif not out["reason"]:
            out["reason"] = "the merger ended without SUBMIT or BLOCKED"
        if stage == "rebase" and not out["resolved"] and _rebasing(wt):
            git(wt, "rebase", "--abort", check=False)
        env = run_env(self.store, self.cfg, run, unit, int(unit_row.get("attempt", 0) or 0), "")
        self.store.emit(codes.MERGER_RAN, env, {"unit": unit, "stage": stage, "outcome": outcome[:200],
                                               "resolved": out["resolved"], "blocked": out["blocked"],
                                               "reason": out["reason"][:300], "usd": out["usd"], "files": files})
        return out

    def _count(self, unit: str) -> None:
        row = self.store.get(E_UNIT, unit) or {}
        detail = dict(row.get("detail") or {})
        detail["merger_calls"] = int(detail.get("merger_calls", 0) or 0) + 1
        row["detail"] = detail
        self.store.put(E_UNIT, unit, row, run=row.get("run", ""))

    @staticmethod
    def _check(wt: str, old_main: str, head: str, files: List[str], locked: List[str]) -> str:
        """'' when the merger's work holds, else why not. A locked test may be as main has it or as the unit
        brought it, nothing else."""
        if _rebasing(wt):
            return "the rebase is still in progress"
        if git(wt, "diff", "--name-only", "--diff-filter=U", check=False).stdout.strip():
            return "unmerged files are left"
        changed = git(wt, "diff", "--name-only", "HEAD", check=False).stdout.split()
        if changed:
            return "uncommitted changes are left: %s" % ", ".join(changed[:5])
        left = _markers(wt, files)
        if left:
            return "conflict markers are left in: %s" % ", ".join(left)
        if locked and old_main:
            touched = set(git_out(wt, "diff", "--name-only", old_main, "HEAD", "--", *locked).split())
            if touched and head:
                touched &= set(git_out(wt, "diff", "--name-only", head, "HEAD", "--", *sorted(touched)).split())
            if touched:
                return "locked acceptance tests were changed: %s" % ", ".join(touched)
        return ""


__all__ = ["Merger", "enabled", "ROLE"]

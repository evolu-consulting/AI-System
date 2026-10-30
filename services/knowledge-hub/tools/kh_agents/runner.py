"""Phase 4 pilot runner: N agents do KH's own maintenance work through KH (docs/roadmap-e-to-5-design.md 6.2).

KH is the coordination layer only: every agent is its own KH principal, a task is a unit with a lease, steps hand
off through a fenced ``handoff`` record, shared state lives in a ``task_memory`` record written with If-Match, each
step writes ``task.step`` / ``task.blocked`` / ``task.done`` events, and side effects go through the effect ledger,
where high-risk keys answer 428 until a listed human confirmer approves them (S9). An optional drill calls the
global stop (``/v1/admin/agents:stop``), measures the time until agent writes answer 423, then resumes; agents
that held a lease see ``stale_epoch`` and redo the step under a new epoch.

Backends (who does the work of a step):
  dry         deterministic scripted agents, no model and no cost (default). The scripted reviewer stands in for
              the human confirmer: it approves, except for PRs the script marks risky.
  claude_cli  headless Claude Code (``claude -p --output-format json``), read-only tools on the KH repo, one call
              per step. OFF unless passed explicitly; it spends the operator's Claude quota.
The runner never pushes, opens PRs or merges for real: an effect is a ledger entry whose result holds the
artifact; the operator performs the approved real act.

    .venv\\Scripts\\python tools\\kh_agents\\runner.py --backend dry --agents 6 --tasks 12 --stop-drill
    .venv\\Scripts\\python tools\\kh_agents\\runner.py --backend claude_cli --agents 2 --tasks 3 --approver none

Secrets: the dev bootstrap token is read from the container env (docker inspect) and kept in memory only; the
namespace client secret is rotated per run (POST /v1/admin/ns/{ns}:client) and never printed.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import queue
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import uuid
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
sys.path.insert(0, str(REPO / "tools" / "stagef" / "consumer_sim"))
from simlib import Sim, scrub  # noqa: E402  (HTTP client + secret handling shared with the stage F simulator)

MANIFEST = HERE / "manifest.json"
# The design names the namespace kh_ops, but PUT /v1/admin/ns reserves every name that starts with "kh".
DEFAULT_NS = os.getenv("KH_AGENTS_NS", "ops_pilot")
# A claim only spans :claim -> :complete (the backend ran before it), so a short TTL frees an effect whose attempt a
# global stop cut, and the redone step can claim it again.
EFFECT_CLAIM_TTL_S = 30
DEFAULT_PROJECTS = ["knowledge-hub", "kh-bench"]
AGENT_VERSION = "kh-agents/0.1.0"
LEASE_TTL_S = 60

# ── task catalogue: KH maintenance work (design 6.2, "first real work") ──────────────────────────────────
# step = (name, ops role, done_when, effects); effect keys get "-<task id>" appended.
TASKS = {
    "finding_chain": {
        "title": "Finding to PR: the 5-step chain; the merge is a high-risk effect",
        "chain": True,
        "steps": [("finding", "triager", "the finding is stated with file, symptom and severity", []),
                  ("reproduce", "reproducer", "a failing test or command reproduces it", []),
                  ("patch", "patcher", "a patch on a branch fixes it", ["branch/push/fix"]),
                  ("tests", "tester", "the affected suites pass", []),
                  ("pr_open", "pr_opener", "a PR is open with the patch and the test evidence", ["pr/open/fix"])],
        "after": ("merge", "merger", "the PR is merged", ["merge/fix"]),
    },
    "finding_triage": {"title": "Triage one open finding", "steps": [
        ("triage", "triager", "the finding has an owner, a severity and a next step", ["comment/finding"])]},
    "dep_cve_check": {"title": "Dependency and CVE check, opening a branch PR", "steps": [
        ("scan", "scanner", "requirements are checked against known CVEs", []),
        ("branch_pr", "pr_opener", "a branch PR bumps what needs bumping", ["branch/push/deps", "pr/open/deps"])]},
    "bench_report": {"title": "Bench run and report", "steps": [
        ("run_bench", "bench_runner", "tier-1 bench numbers are collected", []),
        ("report", "reporter", "a report compares them with the last run", ["report/write/bench"])]},
    "distil_review_prep": {"title": "Distil review preparation", "steps": [
        ("collect", "collector", "the proposed distil items of the week are listed", []),
        ("prepare", "reviewer_prep", "a review sheet groups them for fen", ["report/write/distil"])]},
    "changelog_draft": {"title": "Changelog draft", "steps": [
        ("collect", "collector", "commits since the last changelog are listed", []),
        ("draft", "writer", "a changelog draft is on a branch", ["branch/push/changelog"])]},
}
MIX = ["finding_chain", "finding_triage", "finding_chain", "dep_cve_check", "finding_chain", "bench_report",
       "finding_chain", "distil_review_prep", "finding_chain", "changelog_draft"]


def _h(*parts) -> int:
    return int(hashlib.sha256("|".join(map(str, parts)).encode()).hexdigest()[:8], 16)


# ── backends ─────────────────────────────────────────────────────────────────────────────────────────────

class DryBackend:
    """Deterministic scripted agents. With seed s, about 1 task in 8 blocks (needs a human) at one step and about
    1 chain in 7 opens a PR the scripted reviewer rejects at merge. No model, no cost."""
    name = "dry"

    def __init__(self, seed: int):
        self.seed = seed

    def step(self, task: dict, step: str, role: str, inputs: dict, memory: dict) -> dict:
        t0 = time.perf_counter()
        steps = [s[0] for s in task["spec"]["steps"]]
        block_at = steps[_h(self.seed, task["id"], "where") % len(steps)]
        blocked = _h(self.seed, task["id"], "block") % 8 == 3 and step == block_at
        risky = bool(task["spec"].get("chain")) and _h(self.seed, task["id"], "risky") % 7 == 2
        tokens = 0                                   # no model: no tokens
        if blocked:
            return {"outcome": "blocked", "summary": f"{step}: scripted block", "needs_human": True,
                    "reason": "cannot proceed without a human decision (scripted)", "artifacts": [],
                    "cost_usd": 0.0, "tokens": tokens, "wall_s": time.perf_counter() - t0}
        art = f"{task['id']}/{step}.{'diff' if step in ('patch', 'branch_pr', 'draft') else 'md'}"
        return {"outcome": "done", "summary": f"{role} finished {step} (scripted)", "artifacts": [art],
                "risky": risky, "cost_usd": 0.0, "tokens": tokens, "wall_s": time.perf_counter() - t0}

    def review(self, task: dict, key: str, high_risk: bool) -> tuple[str, str]:
        """The scripted human confirmer: approve, except a risky chain's merge."""
        if key.startswith("merge/") and task.get("risky"):
            return "reject", "scripted reviewer: the PR touches more than the finding"
        return "approve", "scripted reviewer: looked at the artifact"


class ClaudeCliBackend:
    """Headless Claude Code, one ``claude -p`` per step, read-only tools on the repo (the bench's pattern: a
    separate CLAUDE_CONFIG_DIR when KH_AGENTS_PROFILE is set, the operator's Claude Code variables removed)."""
    name = "claude_cli"
    TOOLS = "Read,Grep,Glob"

    def __init__(self, model: str, max_turns: int, timeout_s: int):
        if not shutil.which("claude"):
            raise SystemExit("claude_cli backend: the claude CLI is not on PATH")
        self.model, self.max_turns, self.timeout_s = model, max_turns, timeout_s

    def step(self, task: dict, step: str, role: str, inputs: dict, memory: dict) -> dict:
        done_when = next(s[2] for s in task["all_steps"] if s[0] == step)
        prompt = (f"You are the '{role}' agent of a KH maintenance pilot, working read-only in the KH repository.\n"
                  f"Task {task['id']}: {task['spec']['title']}.\nYour step: {step}. Done when: {done_when}.\n"
                  f"Inputs from the previous step: {json.dumps(inputs)[:3000]}\n"
                  f"Task memory notes: {json.dumps(memory.get('notes', [])[-6:])[:2000]}\n"
                  "Do the step as far as read-only tools allow. Do not modify files. Answer with ONE JSON object "
                  "only: {\"outcome\": \"done\"|\"blocked\", \"summary\": \"<= 400 chars\", \"artifacts\": "
                  "[\"<short text of a proposed artifact>\"], \"needs_human\": true|false, \"reason\": \"...\"}")
        env = {**os.environ, "PYTHONIOENCODING": "utf-8"}
        if os.getenv("KH_AGENTS_PROFILE"):
            env["CLAUDE_CONFIG_DIR"] = os.environ["KH_AGENTS_PROFILE"]
        for k in ("CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT", "CLAUDE_PID"):
            env.pop(k, None)
        cmd = ["claude", "-p", prompt, "--output-format", "json", "--model", self.model,
               "--allowedTools", self.TOOLS, "--max-turns", str(self.max_turns)]
        t0 = time.perf_counter()
        try:
            p = subprocess.run(cmd, cwd=str(REPO), env=env, capture_output=True, text=True, encoding="utf-8",
                               timeout=self.timeout_s, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            out = json.loads(p.stdout or "{}")
        except (subprocess.TimeoutExpired, ValueError) as exc:
            return {"outcome": "blocked", "summary": f"claude_cli failed: {type(exc).__name__}", "needs_human": True,
                    "reason": "backend error", "artifacts": [], "cost_usd": 0.0, "tokens": 0,
                    "wall_s": time.perf_counter() - t0}
        usage = out.get("usage") or {}
        res = _first_json(out.get("result") or "")
        return {"outcome": "blocked" if res.get("outcome") == "blocked" else "done",
                "summary": str(res.get("summary") or out.get("result") or "")[:400],
                "artifacts": [str(a)[:300] for a in (res.get("artifacts") or [])][:5],
                "needs_human": bool(res.get("needs_human")), "reason": str(res.get("reason") or "")[:300],
                "cost_usd": float(out.get("total_cost_usd") or 0.0),
                "tokens": int(usage.get("input_tokens", 0)) + int(usage.get("output_tokens", 0)),
                "wall_s": time.perf_counter() - t0}

    def review(self, task, key, high_risk):
        return None, "a human decides"          # never auto-approved: --approver auto is refused for this backend


def _first_json(text: str) -> dict:
    i = text.find("{")
    while i >= 0:
        try:
            v = json.loads(text[i:text.rindex("}") + 1])
            return v if isinstance(v, dict) else {}
        except ValueError:
            i = text.find("{", i + 1)
    return {}


# ── connection and namespace setup ───────────────────────────────────────────────────────────────────────

def load_manifest(mode: str, confirmers: list[str]) -> dict:
    man = json.loads(MANIFEST.read_text(encoding="utf-8"))
    st = man["settings"]
    eff = st["effects"]
    prefixes = list(st["pilot"]["always_human"])
    if mode == "shadow":
        prefixes.append("*")                 # shadow: every effect needs a human (design 6.4)
    eff["approval_required"] = prefixes
    eff["confirm_policy"]["emails"] = sorted({e.lower() for e in eff["confirm_policy"]["emails"] + confirmers})
    st["pilot"]["mode"] = mode
    return man


def connect(ns: str = DEFAULT_NS, projects=None, attach: bool = True) -> Sim:
    """A Sim on namespace ``ns`` with a fresh namespace client (the secret stays in memory)."""
    sim = Sim.connect(ns=ns)
    p = sim.person
    cur = p.get(f"/v1/admin/ns/{ns}")
    if cur.status == 404 or cur.j.get("state") in ("purged",):
        if not attach:
            raise SystemExit(f"namespace {ns} does not exist: run the runner first")
        r = p.put(f"/v1/admin/ns/{ns}", {"projects": projects or DEFAULT_PROJECTS,
                                          "display": "phase 4 pilot: agents on KH's own work"})
        if r.status != 201:
            raise SystemExit(f"attach {ns}: {r.brief()}")
        sim.set_client(r.j["client"])
        return sim
    if cur.j.get("state") == "detached":
        r = p.post(f"/v1/admin/ns/{ns}:reattach")
        if r.status not in (200, 201):
            raise SystemExit(f"reattach {ns}: {r.brief()}")
    r = p.post(f"/v1/admin/ns/{ns}:client")
    if r.status != 201:
        raise SystemExit(f"client for {ns}: {r.brief()}")
    sim.set_client(r.j)
    return sim


# ── the run ──────────────────────────────────────────────────────────────────────────────────────────────

class Stopped(Exception):
    """KH answered 423 (namespace suspended by the global stop) or the lease epoch went stale."""


class Run:
    def __init__(self, sim: Sim, args, backend):
        self.sim, self.args, self.backend = sim, args, backend
        self.run_id = f"run-{time.strftime('%Y%m%dT%H%M%SZ', time.gmtime())}-{uuid.uuid4().hex[:4]}"
        self.q: queue.Queue = queue.Queue()
        self.lock = threading.Lock()
        self.pending = 0
        self.tasks: dict[str, dict] = {}
        self.log: dict[str, int] = {k: 0 for k in (
            "steps", "steps_redone", "lease_held", "write_conflict", "stale_epoch", "http_423", "approvals",
            "rejects", "approval_428", "blocked", "done", "effects_done", "handoffs")}
        self.drill: dict = {}
        self.suspended = threading.Event()
        self.commits = 0
        self.confirmer = sim.person

    def count(self, k, n=1):
        with self.lock:
            self.log[k] = self.log.get(k, 0) + n

    # tasks
    def plan(self):
        n = self.args.tasks
        kinds = [MIX[i % len(MIX)] for i in range(n)]
        if self.args.only:
            kinds = [self.args.only] * n
        for i, kind in enumerate(kinds):
            spec = TASKS[kind]
            tid = f"t-{self.run_id[4:]}-{i:03d}"
            all_steps = list(spec["steps"]) + ([spec["after"]] if spec.get("after") else [])
            self.tasks[tid] = {"id": tid, "kind": kind, "spec": spec, "all_steps": all_steps,
                               "project": self.args.projects[i % len(self.args.projects)], "attempt": 1,
                               "cost": 0.0, "tokens": 0, "status": "open"}
        with self.lock:
            self.pending = len(self.tasks)
        for tid in self.tasks:
            self.q.put((tid, 0))

    def finish(self, tid, status):
        self.tasks[tid]["status"] = status
        with self.lock:
            self.pending -= 1

    def headers(self, task, lease=None, epoch=None, extra=None):
        h = {"X-KH-Run": self.run_id, "X-KH-Unit": task["id"], "X-KH-Attempt": str(task["attempt"])}
        if lease:
            h.update({"X-KH-Lease": lease, "X-KH-Epoch": str(epoch)})
        h.update(extra or {})
        return h

    def chk(self, r, what):
        if r.status == 423:
            self.count("http_423")
            raise Stopped(what)
        if r.status == 409 and r.error in ("stale_epoch", "lease_lost"):
            self.count("stale_epoch")
            raise Stopped(what)
        return r

    # one step, end to end
    def do_step(self, agent, tid: str, k: int) -> str:
        """Returns 'next', 'blocked', 'done' or 'retry'."""
        task = self.tasks[tid]
        step, role, done_when, effects = task["all_steps"][k]
        lease = f"unit/{tid}"
        r = agent.post(f"/leases/{lease}:acquire", {"ttl_s": LEASE_TTL_S}, route="lease acquire")
        if r.status == 409 and r.error == "lease_held":
            self.count("lease_held")
            return "retry"
        self.chk(r, "acquire")
        if r.status != 200:
            raise RuntimeError(f"acquire {lease}: {r.brief()}")
        ep = r.j["epoch"]
        try:
            return self._step_locked(agent, task, k, step, role, done_when, effects, lease, ep)
        finally:
            agent.post(f"/leases/{lease}:release", {"epoch": ep}, route="lease release")

    def _memory(self, agent, task):
        r = self.chk(agent.get(f"/records/task_memory/{task['id']}", route="memory get"), "memory get")
        if r.status == 404:
            body = {"task_id": task["id"], "task_kind": task["kind"], "chain": bool(task["spec"].get("chain")),
                    "status": "open", "writes": 1, "steps_done": [], "notes": [], "effects": {}, "facts": {}}
            r = self.chk(agent.put(f"/records/task_memory/{task['id']}", body, params={"project": task["project"]},
                                   headers=self.headers(task, extra={"If-None-Match": "*"}), route="memory create"),
                         "memory create")
            if r.status == 409:
                return self._memory(agent, task)
            if r.status != 201:
                raise RuntimeError(f"memory create: {r.brief()}")
        return r.j.get("body") or {}, r.headers.get("ETag")

    def _commit(self, agent, task, change):
        """If-Match update of task_memory; a 409 write_conflict re-reads and re-applies (no lost update)."""
        for _ in range(8):
            mem, etag = self._memory(agent, task)
            new = change(dict(mem))
            new["writes"] = int(mem.get("writes", 0)) + 1
            r = self.chk(agent.put(f"/records/task_memory/{task['id']}", new,
                                   headers=self.headers(task, extra={"If-Match": etag}), route="memory update"),
                         "memory update")
            if r.status == 200:
                with self.lock:
                    self.commits += 1
                return new
            if r.status == 409 and r.error == "write_conflict":
                self.count("write_conflict")
                continue
            raise RuntimeError(f"memory update: {r.brief()}")
        raise RuntimeError("memory update: too many conflicts")

    def _event(self, agent, task, kind, body, lease, ep, idem=None):
        b = {"task_id": task["id"], "task_kind": task["kind"], "chain": bool(task["spec"].get("chain")),
             "backend": self.backend.name, "agent_version": AGENT_VERSION, **body}
        extra = {"Idempotency-Key": idem} if idem else None
        r = self.chk(agent.post("/events", {"kind": kind, "project": task["project"], "body": b},
                                headers=self.headers(task, lease, ep, extra), route=f"event {kind}"), kind)
        if r.status == 422 and r.error == "idempotency_mismatch":
            return                                  # this principal already delivered it in an earlier attempt
        if r.status != 200:
            raise RuntimeError(f"event {kind}: {r.brief()}")

    def _effect(self, agent, task, key, result) -> str:
        """Claim (428 -> human decision -> claim again) and complete one effect. Returns done|rejected|waiting."""
        for _ in range(3):
            r = self.chk(agent.post(f"/effects/{key}:claim", {"ttl_s": EFFECT_CLAIM_TTL_S}, headers=self.headers(task),
                                    route="effect claim"), "effect claim")
            if r.status == 201:
                r = self.chk(agent.post(f"/effects/{key}:complete", {"result": result}, headers=self.headers(task),
                                        route="effect complete"), "effect complete")
                if r.status != 200:
                    raise RuntimeError(f"effect complete {key}: {r.brief()}")
                self.count("effects_done")
                return "done"
            if r.status == 409 and r.error == "effect_claimed":
                eff = r.j.get("effect") or {}
                st = eff.get("state")
                if st == "done":
                    return "done"                  # a redone step after a stop: never deliver twice
                if st == "claimed" and eff.get("holder") == agent.name:
                    # our own claim from an attempt the global stop cut between :claim and :complete
                    r = self.chk(agent.post(f"/effects/{key}:complete", {"result": result}, headers=self.headers(task),
                                            route="effect complete"), "effect complete")
                    if r.status == 200:
                        self.count("effects_done")
                        return "done"
                time.sleep(0.5)
                continue
            if r.status == 428 and r.error == "approval_required":
                self.count("approval_428")
                ap = r.j.get("approval") or {}
                if ap.get("decision") == "reject":
                    return "rejected"
                if self.args.approver != "auto":
                    return "waiting"
                decision, note = self.backend.review(task, key, True)
                a = self.chk(self.confirmer.post(f"/effects/{key}:approve", {"decision": decision, "note": note},
                                                 route="effect approve"), "approve")
                if a.status not in (200, 201):
                    raise RuntimeError(f"approve {key}: {a.brief()}")
                self.count("approvals" if decision == "approve" else "rejects")
                if decision == "reject":
                    return "rejected"
                continue
            raise RuntimeError(f"effect claim {key}: {r.brief()}")
        # Still claimed by another agent (its attempt was cut by a global stop; the claim lives until its TTL):
        # requeue the step instead of failing the task. Seen on dev 2026-10-11 (S15): 1 task in 3 drills errored.
        self.count("effect_busy")
        return "busy"

    def _step_locked(self, agent, task, k, step, role, done_when, effects, lease, ep) -> str:
        mem, _ = self._memory(agent, task)
        if step in (mem.get("steps_done") or []):
            return "done" if k == len(task["all_steps"]) - 1 else "next"     # committed before a stop: move on
        inputs = {}
        if k > 0:
            r = self.chk(agent.get(f"/records/handoff/{task['id']}.{step}", route="handoff get"), "handoff get")
            if r.status == 200:
                inputs = (r.j.get("body") or {}).get("inputs") or {}
        res = self.backend.step(task, step, role, inputs, mem)
        with self.lock:
            task["cost"] += res.get("cost_usd", 0.0)
            task["tokens"] += res.get("tokens", 0)
            if res.get("risky"):
                task["risky"] = True
        base = {"step": step, "step_no": k + 1, "role": role, "summary": res.get("summary", "")[:400],
                "cost_usd": round(res.get("cost_usd", 0.0), 6), "tokens": int(res.get("tokens", 0)),
                "wall_s": round(res.get("wall_s", 0.0), 3), "artifacts": res.get("artifacts", [])}
        if res["outcome"] == "blocked":
            return self._block(agent, task, base, lease, ep, res.get("reason") or "blocked", res.get("needs_human", True))
        keys = [f"{e}-{task['id']}" for e in effects]
        for key in keys:
            got = self._effect(agent, task, key, {"artifacts": res.get("artifacts", []), "by": agent.name})
            if got == "busy":
                return "retry"                     # the lease is released in do_step's finally
            if got != "done":
                reason = "the human confirmer rejected " + key if got == "rejected" else "waiting for approval of " + key
                return self._block(agent, task, {**base, "effects": [key]}, lease, ep, reason, True)
        self._event(agent, task, "task.step", {**base, "outcome": "done", "effects": keys}, lease, ep,
                    idem=f"{task['id']}.{step}.step.{task['attempt']}")
        last = k == len(task["all_steps"]) - 1
        if not last:
            nxt = task["all_steps"][k + 1]
            r = self.chk(agent.put(f"/records/handoff/{task['id']}.{nxt[0]}",
                                   {"from_unit": task["id"], "from_step": step, "to_role": nxt[1], "to_step": nxt[0],
                                    "task_id": task["id"], "inputs": {"summary": base["summary"],
                                                                      "artifacts": base["artifacts"]},
                                    "done_when": nxt[2], "artifacts": base["artifacts"]},
                                   params={"project": task["project"]},
                                   headers=self.headers(task, lease, ep, {"If-None-Match": "*"}), route="handoff put"),
                         "handoff")
            if r.status not in (201, 412) and not (r.status == 409 and r.error in ("write_conflict", "exists", "duplicate")):
                raise RuntimeError(f"handoff: {r.brief()}")
            self.count("handoffs")
        elif not self.sim.events(kind="task.done", unit_id=task["id"]):
            # Idempotency keys are per principal and a redo after a stop may run on another agent, so the
            # orchestrator checks the log first; only the lease holder gets here, so the check cannot race.
            self._event(agent, task, "task.done", {**base, "outcome": "done", "effects": keys,
                                                   "cost_usd": round(task["cost"], 6), "tokens": task["tokens"]},
                        lease, ep, idem=f"{task['id']}.done")
            r = agent.post("/metrics", {"series": "task_cost_usd", "value": round(task["cost"], 6),
                                        "unit_id": task["id"], "run_id": self.run_id, "project": task["project"],
                                        "dims": {"task_kind": task["kind"], "backend": self.backend.name}},
                           headers={"Idempotency-Key": f"{task['id']}.cost"}, route="metric")
            self.chk(r, "metric")

        def change(m):
            m["steps_done"] = list(m.get("steps_done") or []) + [step]
            m["notes"] = (list(m.get("notes") or []) + [f"{step}: {base['summary']}"[:300]])[-20:]
            m["effects"] = {**(m.get("effects") or {}), **{key: "done" for key in keys}}
            m["status"] = "done" if last else f"after_{step}"
            if task["spec"].get("chain") and step == "pr_open":
                m["facts"] = {**(m.get("facts") or {}), "chain_complete": True}
            return m
        self._commit(agent, task, change)
        self.count("steps")
        return "done" if last else "next"

    def _block(self, agent, task, base, lease, ep, reason, needs_human) -> str:
        self._event(agent, task, "task.blocked", {**base, "outcome": "blocked", "reason": reason[:300],
                                                  "needs_human": bool(needs_human), "sev": 0}, lease, ep,
                    idem=f"{task['id']}.{base['step']}.blocked")

        def change(m):
            m["status"] = "blocked"
            m["notes"] = (list(m.get("notes") or []) + [f"{base['step']}: blocked: {reason}"[:300]])[-20:]
            return m
        self._commit(agent, task, change)
        self.count("blocked")
        return "blocked"

    # agents
    def agent_loop(self, agent):
        while True:
            with self.lock:
                if self.pending <= 0:
                    return
            try:
                tid, k = self.q.get(timeout=0.3)
            except queue.Empty:
                continue
            if self.suspended.is_set():
                self.q.put((tid, k))
                time.sleep(0.3)
                continue
            try:
                out = self.do_step(agent, tid, k)
            except Stopped:
                # The global stop: wait for resume, then redo the step under a new attempt and epoch.
                while self.suspended.is_set():
                    time.sleep(0.2)
                with self.lock:
                    self.tasks[tid]["attempt"] += 1
                self.count("steps_redone")
                self.q.put((tid, k))
                continue
            except Exception as exc:  # noqa: BLE001
                print(f"  agent {agent.name} task {tid}: {scrub(str(exc))[:300]}", flush=True)
                self.finish(tid, "error")
                continue
            if out == "retry":
                time.sleep(0.2)
                self.q.put((tid, k))
            elif out == "next":
                self.q.put((tid, k + 1))
            else:
                if out == "done":
                    self.count("done")
                self.finish(tid, out)

    # global stop drill
    @staticmethod
    def _probe(probe) -> int:
        """One agent write (a short lease on a fresh name, released at once); returns the HTTP status."""
        name = f"probe/{uuid.uuid4().hex[:8]}"
        w = probe.post(f"/leases/{name}:acquire", {"ttl_s": 5}, route="probe")
        if w.status == 200:
            probe.post(f"/leases/{name}:release", {"epoch": w.j.get("epoch")}, route="probe")
        return w.status

    def stop_drill(self, probe):
        """Stop every agent namespace, time until an agent write answers 423, hold, resume, check restore."""
        target = max(3, int(sum(len(t["all_steps"]) for t in self.tasks.values()) * 0.4))
        while self.commits < target:
            with self.lock:
                if self.pending <= 0:
                    return
            time.sleep(0.05)
        p = self.sim.person
        self.suspended.set()
        t0 = time.monotonic()
        r = p.post("/v1/admin/agents:stop", route="agents:stop")
        d = {"stop_status": r.status, "stopped": r.j.get("stopped"), "exempt": r.j.get("exempt"),
             "commits_before": self.commits}
        if r.status != 200:
            self.suspended.clear()
            self.drill = d
            return
        t423 = None
        while time.monotonic() - t0 < 15:
            if self._probe(probe) == 423:
                t423 = time.monotonic() - t0
                break
            time.sleep(0.1)
        d["seconds_to_423"] = None if t423 is None else round(t423, 2)
        time.sleep(self.args.hold_s)
        st = p.get(f"/v1/admin/ns/{self.sim.ns}").j.get("state")
        d["state_while_stopped"] = st
        r = p.post("/v1/admin/agents:resume", route="agents:resume")
        d.update(resume_status=r.status, resumed=r.j.get("resumed"))
        time.sleep(0.2)
        d["state_after_resume"] = p.get(f"/v1/admin/ns/{self.sim.ns}").j.get("state")
        # wait out the 5 s state cache so agents do not hit a cached 'suspended'
        ok, secs = self.sim.wait(lambda: self._probe(probe) == 200, timeout=15)
        d["seconds_to_writable_after_resume"] = round(secs, 2) if ok else None
        self.drill = d
        self.suspended.clear()

    def execute(self):
        a = self.args
        self.plan()
        agents = [self.sim.principal(f"ops-agent-{i:02d}", "agent", projects=a.projects) for i in range(1, a.agents + 1)]
        for ag in agents:
            ag.token()
        probe = self.sim.principal("ops-probe", "agent", projects=a.projects)
        probe.token()
        t0 = time.monotonic()
        threads = [threading.Thread(target=self.agent_loop, args=(ag,), daemon=True) for ag in agents]
        drill = threading.Thread(target=self.stop_drill, args=(probe,), daemon=True) if a.stop_drill else None
        for t in threads + ([drill] if drill else []):
            t.start()
        try:
            for t in threads:
                t.join()
            if drill:
                drill.join(timeout=60)
        finally:
            if self.suspended.is_set() or (self.drill and self.drill.get("resume_status") is None
                                           and self.drill.get("stop_status") == 200):
                self.sim.person.post("/v1/admin/agents:resume", route="agents:resume (safety)")
        return {"run_id": self.run_id, "ns": self.sim.ns, "backend": self.backend.name, "mode": a.mode,
                "agents": a.agents, "tasks": len(self.tasks), "seconds": round(time.monotonic() - t0, 1),
                "status": {s: sum(1 for t in self.tasks.values() if t["status"] == s)
                           for s in sorted({t["status"] for t in self.tasks.values()})},
                "counters": self.log, "stop_drill": self.drill or None}


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--backend", choices=["dry", "claude_cli"], default="dry")
    ap.add_argument("--agents", type=int, default=6)
    ap.add_argument("--tasks", type=int, default=12)
    ap.add_argument("--only", choices=sorted(TASKS), help="run only this task kind")
    ap.add_argument("--mode", choices=["shadow", "on"], default="shadow",
                    help="shadow: every effect needs approval; on: only the always-human prefixes")
    ap.add_argument("--approver", choices=["auto", "none"], default="auto",
                    help="auto: the backend's scripted reviewer decides as the dev confirmer (dry only); "
                         "none: 428 stays pending and the task blocks for a human")
    ap.add_argument("--confirmer", action="append", default=[],
                    help="extra confirm_policy e-mail (the dev bootstrap identity is always added)")
    ap.add_argument("--stop-drill", action="store_true", help="global stop + resume in the middle of the run")
    ap.add_argument("--hold-s", type=float, default=2.0, help="seconds the stop is held")
    ap.add_argument("--ns", default=DEFAULT_NS)
    ap.add_argument("--projects", default=",".join(DEFAULT_PROJECTS))
    ap.add_argument("--seed", type=int, default=13)
    ap.add_argument("--model", default=os.getenv("KH_AGENTS_MODEL", "claude-sonnet-5"))
    ap.add_argument("--max-turns", type=int, default=12)
    ap.add_argument("--timeout-s", type=int, default=600)
    ap.add_argument("--no-scorecard", action="store_true")
    ap.add_argument("--out", default=os.getenv("KH_AGENTS_OUT") or str(Path(tempfile.gettempdir()) / "kh_agents"))
    a = ap.parse_args(argv)
    a.projects = [x for x in a.projects.split(",") if x]
    if a.backend == "claude_cli" and a.approver == "auto":
        a.approver = "none"                  # a real run is never approved by a script
    backend = DryBackend(a.seed) if a.backend == "dry" else ClaudeCliBackend(a.model, a.max_turns, a.timeout_s)

    sim = connect(a.ns, a.projects)
    me = sim.person.get("/v1/me").j.get("principal") or ""
    man = load_manifest(a.mode, a.confirmer + ([me] if me else []))
    r = sim.admin.put("/manifest", man, route="PUT /manifest")
    if r.status != 200:
        raise SystemExit(f"manifest: {r.brief()}")
    print(f"namespace {a.ns}: manifest rev {r.j.get('manifest_rev')} (changed {r.j.get('changed')}), mode {a.mode}, "
          f"backend {backend.name}, {a.agents} agents, {a.tasks} tasks", flush=True)
    sim.wait(lambda: True, timeout=0)
    time.sleep(0.2)
    res = Run(sim, a, backend).execute()
    print(json.dumps(scrub(res), indent=1, default=str), flush=True)
    os.makedirs(a.out, exist_ok=True)
    path = Path(a.out) / f"{res['run_id']}.json"
    card = None
    if not a.no_scorecard:
        import scorecard
        card = scorecard.compute(sim)
        print(scorecard.render(card), flush=True)
    path.write_text(json.dumps({"run": scrub(res), "scorecard": card}, indent=1, default=str), encoding="utf-8")
    print(f"written {path}", flush=True)
    return res, card


if __name__ == "__main__":
    main()

"""The project's change queue: many runs of one project understand, design and plan at the same time; the work
that changes the repository (implement, test, merge, QAS, delivery) goes one run at a time, first come first
served, where FIRST means first APPROVED: a run joins the queue (gets its place, "order") when every draft
step before its serial part is approved, not when it starts. A run still in design is in nobody's way: it waits
for no one and no one waits for it; when another run joins the queue, every run still waiting at a draft gate
writes its draft again on top of the new queue (refresh_drafts) before a person approves it.
How a process queues is its definition's "queue" block (check_policy() has the defaults), never code:

    "queue": {"enabled": true,          runs of the process share their project and take a slot
              "serial_from": "build",   the first step (id or kind) that waits its turn; it and every later
                                        step run one run of the project at a time
              "hold_until": "end",      "end": the slot is held until the run ends (final review included);
                                        "merged": it is let go once the build is merged into main
              "refresh_drafts": true}   a draft waiting at its gate is written again on top of the queue when
                                        an earlier slot pushes newly approved work or leaves unfinished

    reserve(pipe)            the run takes the next slot of its project when it starts, before any design, with the
                             request in a few lines (summary); idempotent
    push(pipe, step, docs)   an approved draft step puts its artifacts (spec, plan, test plan) into the run's slot;
                             later runs parked at a draft gate are woken (wake_later) to refresh their drafts
    fingerprint(store, run)  what the run's drafts were written on: the earlier slots and the work they pushed
    planned(pipe)            every draft step is approved: the slot JOINS the queue (next order) and the runs
                             waiting at a draft gate are woken to check their drafts against it
    wait_turn(pipe)          before the serial part: join the queue, then wait until every slot that joined
                             before is done. A slot whose run ended is taken out at once. (A run that is still in
                             design never holds anyone up, so nothing is waited for with a time limit any more;
                             wait_minutes / ignore stay for slots written by an engine before 0.7.)
    check_mine(pipe)         the owner of an ignored slot stops itself (QUEUE_SLOT_LOST) the next time it looks
    release(store, run)      the run ended (green or escalated), or its build merged (hold_until "merged"): its
                             slot leaves the queue
    requeue(store, run)      a failed run is run again: it takes a new slot at the end of the queue
    text(store, project)     the queue for a prompt: what earlier runs of the project will change, so the spec,
                             domain and QC agents design on top of it instead of against it

Only the flows that change a delivered system queue (Enhancement, Bug Fix); a New System or a migration owns
the project alone (line.projects refuses a second live run next to it). Rows live in the engine store
(E_SLOT, id "<project>:<seq 6 digits>"); each change is also written to the run's knowledge store project as one
row (id change-queue-<project>) so an agent's step_context finds it. repo_lock(path) serialises the git commands
that several runs of one project may start at the same moment (worktree add/remove, merge into main).
"""

from __future__ import annotations

import json
import os
import threading
import time
from typing import Any, Callable, Dict, List, Optional

from . import codes
from .contracts import E_RUN, E_SLOT, TERMINAL_RUN_STATES, now_ms

QUEUED_FLOWS = ("enhance", "enhancement", "bug", "bug-fix", "bugfix")
ACTIVE = ("reserved", "planned", "implementing")
DEFAULT_WAIT_MIN = 60
POLL_S = 5.0
SUMMARY_CHARS = 400
DOC_CHARS = 1500
TEXT_CHARS = 6000
DEFAULT_POLICY = {"enabled": True, "serial_from": "build", "hold_until": "end", "refresh_drafts": True}
HOLD_UNTIL = ("end", "merged")
_lock = threading.Lock()
_repo_locks: Dict[str, threading.RLock] = {}
WAKER: Optional[Callable[[str], Any]] = None    # set by line.pipeline.make_driver: resume a parked run


def queued(flow: str) -> bool:
    """The default for a flow whose process does not say (no process definition applies to it)."""
    return str(flow or "").strip().lower() in QUEUED_FLOWS


def check_policy(q: Any) -> Dict[str, Any]:
    """A definition's "queue" block laid over the defaults; ValueError on a bad value (line.process validates)."""
    if q is None:
        q = {}
    if not isinstance(q, dict):
        raise ValueError("queue must be an object")
    unknown = sorted(set(q) - set(DEFAULT_POLICY))
    if unknown:
        raise ValueError("queue: unknown key(s) %s (known: %s)" % (", ".join(unknown), ", ".join(DEFAULT_POLICY)))
    out = dict(DEFAULT_POLICY, **q)
    for k in ("enabled", "refresh_drafts"):
        if not isinstance(out[k], bool):
            raise ValueError("queue.%s must be true or false" % k)
    if out["hold_until"] not in HOLD_UNTIL:
        raise ValueError("queue.hold_until must be one of %s" % ", ".join(HOLD_UNTIL))
    if not isinstance(out["serial_from"], str) or not out["serial_from"].strip():
        raise ValueError("queue.serial_from must name a step (its id or kind)")
    return out


def _def_policy(data: Optional[Dict[str, Any]], flow: str) -> Dict[str, Any]:
    if data is None:                               # no process applies: the flow's default
        return dict(DEFAULT_POLICY, enabled=queued(flow))
    try:
        return check_policy(data.get("queue"))
    except ValueError:
        return dict(DEFAULT_POLICY, enabled=queued(flow))


def policy_for(cfg: Any, store: Any, flow: str, target: str = "", detail: Optional[Dict[str, Any]] = None
               ) -> Dict[str, Any]:
    """The queue policy of the process a new run of `flow` would run (detail may name one: detail.process)."""
    if cfg is None:
        return dict(DEFAULT_POLICY, enabled=queued(flow))
    try:
        from .process import definition as D
        r = D.select(cfg, target, flow, detail or {}, store=store)
        return _def_policy(r.data if r else None, flow)
    except Exception:   # noqa: BLE001 - a definition that cannot run is refused later, with its reason
        return dict(DEFAULT_POLICY, enabled=queued(flow))


def policy(cfg: Any, store: Any, run: str) -> Dict[str, Any]:
    """The run's queue policy: the definition it froze (detail.gated.process), else the copy its slot took at the
    start, else the process its flow would run now."""
    d = _detail(store, run)
    snap = (d.get("gated") or {}).get("process") or {}
    if snap.get("def"):
        return _def_policy(snap["def"], str(d.get("flow") or ""))
    cur = mine(store, run)
    if cur and isinstance(cur.get("policy"), dict):
        return dict(DEFAULT_POLICY, **cur["policy"])
    return policy_for(cfg, store, str(d.get("flow") or ""), str(d.get("target") or ""), d)


def shares_project(store: Any, run_row: Dict[str, Any]) -> bool:
    """A live run lets another run of its project start next to it: it holds a slot in the change queue (a run
    that has not reached its slot yet: its flow's default)."""
    cur = mine(store, str(run_row.get("id") or ""))
    if cur is not None:
        return cur.get("state") in ACTIVE + ("ignored",)
    return queued(str((run_row.get("detail") or {}).get("flow") or ""))


def repo_lock(path: str) -> threading.RLock:
    key = os.path.normcase(os.path.abspath(str(path or "")))
    with _lock:
        return _repo_locks.setdefault(key, threading.RLock())


# ------------------------------------------------------------------ settings (Admin > Change queue)

def _settings_path() -> str:
    home = os.environ.get("DLC_HOME", "").strip() or os.path.join(os.path.expanduser("~"), "dlc")
    return os.path.join(home, "change-queue.json")


def settings() -> Dict[str, Any]:
    try:
        with open(_settings_path(), encoding="utf-8") as fh:
            got = json.load(fh) or {}
    except (OSError, ValueError):
        got = {}
    try:
        wait = int(got.get("wait_minutes", DEFAULT_WAIT_MIN))
    except (TypeError, ValueError):
        wait = DEFAULT_WAIT_MIN
    return {"wait_minutes": max(0, wait)}


def save_settings(body: Dict[str, Any], actor: str = "") -> Dict[str, Any]:
    try:
        wait = int(body.get("wait_minutes"))
    except (TypeError, ValueError):
        raise ValueError("wait_minutes must be a whole number of minutes")
    if not 0 <= wait <= 7 * 24 * 60:
        raise ValueError("wait_minutes must be between 0 and 10080 (a week)")
    path = _settings_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    out = {"wait_minutes": wait, "by": actor, "ms": now_ms()}
    with open(path + ".tmp", "w", encoding="utf-8") as fh:
        json.dump(out, fh)
    os.replace(path + ".tmp", path)
    return settings()


def wait_minutes() -> int:
    return int(settings()["wait_minutes"])


# ------------------------------------------------------------------ rows

def _detail(store: Any, run: str) -> Dict[str, Any]:
    return dict((store.get(E_RUN, run) or {}).get("detail") or {})


def _project_of(store: Any, run: str) -> str:
    return str(_detail(store, run).get("project") or "")


def pos(slot: Dict[str, Any]) -> Optional[float]:
    """The slot's place in the queue (its order of approval), None while its run is still in design. A slot of an
    engine before 0.7 that was planned keeps its start order (seq)."""
    if slot.get("order") is not None:
        return float(slot["order"])
    if slot.get("planned_ms") or slot.get("state") in ("planned", "implementing"):
        return float(slot.get("seq") or 0)
    return None


def _key(r: Dict[str, Any]) -> tuple:
    p = pos(r)
    return (p is None, p if p is not None else 0.0, int(r.get("seq") or 0))


def slots(store: Any, project: str, every: bool = False) -> List[Dict[str, Any]]:
    """The project's slots in queue order (the ones that joined, by order of approval; then the ones in design, by
    start); only the active ones unless every."""
    rows = [r for r in store.query(E_SLOT) if r.get("project") == project]
    rows.sort(key=_key)
    return rows if every else [r for r in rows if r.get("state") in ACTIVE]


def earlier(store: Any, run: str, every: bool = False) -> List[Dict[str, Any]]:
    """The slots the run's work is built on: the ones that joined the queue before it (all that joined, while the
    run is still in design); active ones only unless every."""
    me = mine(store, run)
    if not me:
        return []
    mp = pos(me)
    rows = [r for r in slots(store, str(me.get("project")), every=True) if r.get("run") != run
            and pos(r) is not None and (mp is None or pos(r) < mp)]
    return rows if every else [r for r in rows if r.get("state") in ACTIVE]


def _next_order(store: Any, project: str) -> int:
    return int(max([pos(r) or 0 for r in slots(store, project, every=True)] + [0])) + 1


def mine(store: Any, run: str) -> Optional[Dict[str, Any]]:
    """The run's latest slot (active or not), or None."""
    rows = [r for r in store.query(E_SLOT, run=run) if r.get("run") == run]
    return max(rows, key=lambda r: int(r.get("seq") or 0)) if rows else None


def _put(store: Any, row: Dict[str, Any]) -> Dict[str, Any]:
    row["updated_ms"] = now_ms()
    store.put(E_SLOT, row["id"], row, run=row["run"])
    return row


def _summary(store: Any, run: str) -> str:
    """The request in a few lines: the run's name and the first lines of its spec."""
    row = store.get(E_RUN, run) or {}
    name = str(_detail(store, run).get("name") or "")
    text = ""
    pack = str(row.get("pack_path") or "")
    try:
        with open(os.path.join(pack, "spec.md"), encoding="utf-8") as fh:
            text = fh.read(4000)
    except OSError:
        pass
    lines = [ln.strip(" #*-\t") for ln in text.splitlines() if ln.strip(" #*-\t")]
    body = " ".join(lines)
    out = (name + ": " if name and not body.lower().startswith(name.lower()) else "") + body
    return " ".join(out.split())[:SUMMARY_CHARS] or name or run


def reserve(pipe: Any) -> Optional[Dict[str, Any]]:
    """Take the next slot of the run's project (a queued flow only); the run's active slot when it has one."""
    store, run = pipe.store, pipe.run
    d = _detail(store, run)
    project = str(d.get("project") or "")
    if not project:
        return None
    cur = mine(store, run)
    if cur and cur.get("state") in ACTIVE + ("ignored",):
        return cur
    pol = policy(getattr(pipe, "cfg", None), store, run)
    if not pol["enabled"]:
        return None
    with _lock:
        cur = mine(store, run)
        if cur and cur.get("state") in ACTIVE + ("ignored",):
            return cur
        seq = max([int(r.get("seq") or 0) for r in slots(store, project, every=True)] + [0]) + 1
        row = _put(store, {"id": "%s:%06d" % (project, seq), "project": project, "seq": seq, "run": run,
                           "flow": str(d.get("flow") or ""), "state": "reserved", "summary": _summary(store, run),
                           "docs": {}, "created_ms": now_ms(), "actor": str(d.get("actor") or ""),
                           "policy": pol})
    _mirror(pipe.cfg, store, project, d)
    _event(pipe, "queue.reserved", row)
    return row


def push(pipe: Any, step: str, docs: Dict[str, str]) -> None:
    """An approved draft step's artifacts go into the run's slot (each cut to DOC_CHARS)."""
    store, run = pipe.store, pipe.run
    with _lock:
        cur = mine(store, run)
        if not cur or cur.get("state") not in ACTIVE:
            return
        got = dict(cur.get("docs") or {})
        for name, doc in (docs or {}).items():
            if str(doc or "").strip():
                got[name] = str(doc)[:DOC_CHARS]
        if got == (cur.get("docs") or {}) and step in (cur.get("pushed") or {}):
            return                                  # a resume passing an approved step again: nothing new
        cur["docs"] = got
        cur.setdefault("pushed", {})[step] = now_ms()
        _put(store, cur)
    _mirror(pipe.cfg, store, cur["project"], _detail(store, run))
    if pos(cur) is not None:                       # in the queue: runs in design build on what it pushed
        wake_later(store, cur)


def planned(pipe: Any) -> None:
    """Every draft step before the serial part is approved: the slot joins the queue at the end (first approved,
    first served) and the runs waiting at a draft gate check their drafts against it."""
    store, run = pipe.store, pipe.run
    with _lock:
        cur = mine(store, run)
        if not cur or cur.get("state") != "reserved":
            return
        cur["state"], cur["planned_ms"] = "planned", now_ms()
        cur["order"] = _next_order(store, str(cur.get("project")))
        _put(store, cur)
    _mirror(pipe.cfg, store, cur["project"], _detail(store, run))
    _event(pipe, "queue.planned", cur)
    wake_later(store, cur)


def check_mine(pipe: Any) -> None:
    """Raise Escalate(QUEUE_SLOT_LOST) when the run's slot was ignored by a later run."""
    from .pipeline import Escalate
    cur = mine(pipe.store, pipe.run)
    if cur and cur.get("state") == "ignored":
        raise Escalate(codes.QUEUE_SLOT_LOST, "this run's slot #%d in the change queue of project %s was ignored "
                       "after %s minutes (%s); the run stops so that it changes nothing out of order. Run it again "
                       "to join the end of the queue." % (int(cur.get("seq") or 0), cur.get("project"),
                                                          cur.get("waited_min"), cur.get("ignored_by") or "a later run"),
                       {"slot": cur.get("id"), "ignored_by": cur.get("ignored_by")})


def release(store: Any, run: str, why: str = "done") -> Optional[Dict[str, Any]]:
    """The run's slot leaves the queue: "done" / "merged" (its change is in main), else dropped (later runs that
    wait at a draft gate are woken: their drafts must not build on it any more)."""
    with _lock:
        cur = mine(store, run)
        if not cur or cur.get("state") not in ACTIVE:
            return None
        cur["state"], cur["ended_ms"], cur["end"] = "done" if why in ("done", "merged") else "dropped", now_ms(), why
        out = _put(store, cur)
    if out["state"] == "dropped":
        wake_later(store, out)
    return out


def merged(pipe: Any) -> Optional[Dict[str, Any]]:
    """The run's build is merged into main: with hold_until "merged" its slot leaves the queue now, so the next
    run builds while this one waits for its final review."""
    if policy(getattr(pipe, "cfg", None), pipe.store, pipe.run)["hold_until"] != "merged":
        return None
    out = release(pipe.store, pipe.run, "merged")
    if out:
        _event(pipe, "queue.released", out)
    return out


def serial_step(steps: List[Dict[str, Any]], pol: Dict[str, Any]) -> int:
    """Index of the first step that waits its turn (serial_from names a step id, else a step kind); len(steps)
    when the queue is off or nothing matches."""
    if not pol.get("enabled"):
        return len(steps)
    want = str(pol.get("serial_from") or "build")
    for i, s in enumerate(steps):
        if s.get("id") == want:
            return i
    for i, s in enumerate(steps):
        if s.get("kind") == want:
            return i
    return len(steps)


# ------------------------------------------------------------------ drafts written on top of the queue

def fingerprint(store: Any, run: str) -> str:
    """What the run's drafts are written on: each earlier slot of its project with the steps it pushed (and when),
    or that it left the queue unfinished. A slot that finished keeps its mark, so a later run is not asked to write
    its drafts again only because an earlier change was merged."""
    out = []
    for s in earlier(store, run, every=True):
        gone = s.get("state") in ("dropped", "ignored")
        if gone and not s.get("pushed"):
            continue                                # it never designed anything: nothing to take back
        pushed = ",".join("%s@%s" % (k, v) for k, v in sorted((s.get("pushed") or {}).items()))
        out.append("%s[%s]%s" % (s.get("id"), pushed, "x" if gone else ""))
    return "|".join(out)


def changed_since(store: Any, run: str, fp: str) -> List[Dict[str, Any]]:
    """The earlier slots whose part of the fingerprint differs from `fp` (what the run's drafts were written on)."""
    old = {p.split("[", 1)[0]: p for p in (fp or "").split("|") if p}
    new = {p.split("[", 1)[0]: p for p in fingerprint(store, run).split("|") if p}
    ids = [k for k in new if old.get(k) != new[k]] + [k for k in old if k not in new]
    rows = {s["id"]: s for s in earlier(store, run, every=True)}
    return [rows[k] for k in ids if k in rows]


def refresh_text(store: Any, run: str, fp: str) -> str:
    """What an agent is told when the queue changed under its draft."""
    lines = []
    for s in changed_since(store, run, fp):
        gone = s.get("state") in ("dropped", "ignored")
        what = "left the queue unfinished: do not build on it any more" if gone else \
            "now has approved %s" % ", ".join(sorted((s.get("pushed") or {}).keys()) or ["work"])
        lines.append("- queue #%d %s (%s): %s" % (int(pos(s) or 0), s.get("run"),
                                                   str(s.get("summary") or "")[:160], what))
    return ("\n\nTHE CHANGE QUEUE CHANGED since you wrote your draft (another run was approved first and joined "
            "it, or one left it):\n%s\n"
            "Write the document again for the system as it will be after the CHANGE QUEUE shown above: keep what "
            "still holds and every point a person settled, change only what the queue change touches, and say in "
            "the Summary (or the first lines) which queued change you took in.\n"
            % "\n".join(lines or ["- an earlier change moved"]))


def wake_later(store: Any, slot: Dict[str, Any]) -> List[str]:
    """The other runs of the slot's project that wait at a draft gate are resumed: each checks its drafts against
    the queue (its fingerprint) and writes them again when the queue moved under them (its own policy decides:
    refresh_drafts). -> the runs woken."""
    if WAKER is None:
        return []
    out = []
    for s in slots(store, str(slot.get("project"))):
        if s.get("id") == slot.get("id") or s.get("run") == slot.get("run"):
            continue
        rid = str(s.get("run"))
        d = _detail(store, rid)
        g = str((d.get("gate") or {}).get("name") or "")
        if not g or g == "needs" or (s.get("policy") or {}).get("refresh_drafts") is False:
            continue
        if ((d.get("gated") or {}).get("pending") or {}).get(g) or d.get("paused"):
            continue                                # a person already decided, or an operator stopped it
        try:
            WAKER(rid)
            out.append(rid)
        except Exception:   # noqa: BLE001 - the run refreshes at its next resume instead
            pass
    return out


def set_wait(store: Any, run: str, wait: Optional[Dict[str, Any]]) -> None:
    """detail.queue_wait: the run waits for its turn (its step shows "queued"), or None once it has it."""
    row = store.get(E_RUN, run) or {}
    detail = dict(row.get("detail") or {})
    if wait is None and "queue_wait" not in detail:
        return
    if wait is None:
        detail.pop("queue_wait", None)
    else:
        detail["queue_wait"] = dict(wait, since_ms=(detail.get("queue_wait") or {}).get("since_ms") or now_ms())
    try:
        from .statemachine import update_row
        update_row(store, E_RUN, run, {"detail": detail})
    except Exception:   # noqa: BLE001 - a display field; the queue itself lives in the slot rows
        pass


def requeue(store: Any, run: str) -> Optional[Dict[str, Any]]:
    """A run that is run again leaves its old slot and joins the end of its project's queue, keeping what it
    had pushed (it is re-planned only if its draft steps run again)."""
    d = _detail(store, run)
    project = str(d.get("project") or "")
    if not project or not queued(str(d.get("flow") or "")):
        return None
    with _lock:
        cur = mine(store, run)
        if cur and cur.get("state") in ACTIVE:
            cur["state"], cur["ended_ms"], cur["end"] = "dropped", now_ms(), "run again"
            _put(store, cur)
        seq = max([int(r.get("seq") or 0) for r in slots(store, project, every=True)] + [0]) + 1
        return _put(store, {"id": "%s:%06d" % (project, seq), "project": project, "seq": seq, "run": run,
                            "flow": str(d.get("flow") or ""), "state": "planned" if (cur or {}).get("planned_ms")
                            else "reserved", "order": _next_order(store, project) if (cur or {}).get("planned_ms")
                            else None, "summary": (cur or {}).get("summary") or _summary(store, run),
                            "docs": dict((cur or {}).get("docs") or {}), "created_ms": now_ms(),
                            "planned_ms": (cur or {}).get("planned_ms"), "requeued_from": (cur or {}).get("id"),
                            "actor": str(d.get("actor") or "")})


def _ignore(pipe: Any, slot: Dict[str, Any], waited_min: int) -> None:
    store = pipe.store
    with _lock:
        cur = store.get(E_SLOT, slot["id"]) or slot
        if cur.get("state") not in ACTIVE:
            return
        cur.update(state="ignored", ended_ms=now_ms(), end="ignored", ignored_by=pipe.run, waited_min=waited_min)
        _put(store, cur)
    text = ("FINDING [change queue]: slot #%d of run %s (project %s) was ignored after %d minutes. Symptom: run %s "
            "was ready to implement but the earlier slot was still being analysed (not planned) when the wait "
            "limit (Admin > Change queue) ran out. Cause: %s. Fix: the owner run stops itself (QUEUE_SLOT_LOST) "
            "when it next looks; a person runs it again to join the end of the queue, or raises the wait limit. "
            "Request of the ignored slot: %s"
            % (int(cur.get("seq") or 0), cur.get("run"), cur.get("project"), waited_min, pipe.run,
               "its run was still at a draft step or waiting for a person", str(cur.get("summary") or "")[:300]))
    _finding(pipe.cfg, _detail(store, pipe.run), text)
    try:
        from . import outcomes
        outcomes.record(store, str(cur.get("run")), "change_queue", slot_ignored={
            "slot": cur.get("id"), "by": pipe.run, "waited_min": waited_min})
    except Exception:   # noqa: BLE001 - a fact for the retro, never a failure
        pass
    _mirror(pipe.cfg, store, str(cur.get("project")), _detail(store, pipe.run))
    _event(pipe, "queue.ignored", cur)
    wake_later(store, cur)
    pipe.log("%s: change queue: ignored slot %s of run %s after %d min" % (pipe.run, cur.get("id"), cur.get("run"),
                                                                          waited_min))


def wait_turn(pipe: Any, poll_s: float = POLL_S) -> Dict[str, Any]:
    """Block until the run's slot is first in its project's queue, then mark it implementing. The run's own slot
    is reserved first when it has none (a run that started before the queue existed)."""
    store, run = pipe.store, pipe.run
    if not mine(store, run):
        if reserve(pipe) is None:
            return {}
    planned(pipe)                                   # joins the queue: first approved, first served
    shown = ""
    while True:
        check_mine(pipe)
        me = mine(store, run) or {}
        if me.get("state") not in ("reserved", "planned"):
            set_wait(store, run, None)
            return me                               # its turn, or already served (let go once merged)
        ahead = earlier(store, run)                 # joined before it and not done (in design: in nobody's way)
        for s in list(ahead):                       # a slot whose run already ended leaves the queue
            st = str((store.get(E_RUN, str(s.get("run"))) or {}).get("state") or "")
            if not st or st in TERMINAL_RUN_STATES:
                release(store, str(s.get("run")), "run ended")
                ahead.remove(s)
        if not ahead:
            with _lock:
                me = mine(store, run) or me
                me["state"], me["started_ms"] = "implementing", now_ms()
                _put(store, me)
            set_wait(store, run, None)
            _mirror(pipe.cfg, store, str(me.get("project")), _detail(store, run))
            _event(pipe, "queue.turn", me)
            pipe._board("build", "queue: my turn", "queue #%d is first in the change queue" % int(pos(me) or 0))
            return me
        head = ahead[0]
        msg = "waiting: queue #%d, behind %d (first: #%d run %s, %s)" % (
            int(pos(me) or 0), len(ahead), int(pos(head) or 0), head.get("run"), head.get("state"))
        if msg != shown:
            pipe._board("build", "in the change queue", msg)
            set_wait(store, run, {"seq": int(pos(me) or 0), "behind": len(ahead), "text": msg,
                                  "head": {"seq": int(pos(head) or 0), "run": head.get("run"),
                                           "state": head.get("state")}})
            shown = msg
        pipe._check_cancel()
        time.sleep(poll_s)


# ------------------------------------------------------------------ what the agents read

def text(store: Any, project: str, run: str = "") -> str:
    """The queue as the agents of `run` read it: the slots before it (they will change the system first), with
    the request and the approved spec, plan and test plan of each; '' when nothing is queued."""
    if run and mine(store, run):
        rows = earlier(store, run)
    else:
        rows = [r for r in slots(store, project) if pos(r) is not None and r.get("run") != run]
    if not rows:
        return ""
    if run:
        head = ("CHANGE QUEUE of project %s: %d earlier change(s) will be implemented BEFORE this one, in this "
                "order. Design, plan and write tests for the system as it will be after them: do not redo what they "
                "add, reuse it; where this request touches the same feature, build on their result (e.g. a button "
                "they move is where they move it)." % (project, len(rows)))
    else:                                           # the knowledge store copy: every waiting change, no "this one"
        head = ("CHANGE QUEUE of project %s: %d change(s) are waiting to be implemented, first one next. A new "
                "request designs for the system as it will be after all of them: it reuses what they add and builds "
                "on their result where it touches the same feature." % (project, len(rows)))
    out = [head]
    for r in rows:
        out.append("#%d %s (%s, %s): %s" % (int(pos(r) or 0), r.get("run"), r.get("flow"), r.get("state"),
                                             r.get("summary") or ""))
        for name, doc in sorted((r.get("docs") or {}).items()):
            out.append("  %s: %s" % (name, " ".join(str(doc).split())[:600]))
    return "\n".join(out)[:TEXT_CHARS]


def view(store: Any, project: str) -> Dict[str, Any]:
    rows = slots(store, project, every=True)
    return {"project": project, "wait_minutes": wait_minutes(),
            "active": [_public(r) for r in rows if r.get("state") in ACTIVE],
            "recent": [_public(r) for r in rows if r.get("state") not in ACTIVE][-20:]}


def _public(r: Dict[str, Any]) -> Dict[str, Any]:
    return {k: r.get(k) for k in ("id", "seq", "run", "flow", "state", "summary", "created_ms", "planned_ms",
                                  "started_ms", "ended_ms", "end", "ignored_by", "waited_min", "actor",
                                  "policy", "order")} | {
        "docs": sorted((r.get("docs") or {}).keys())}


# ------------------------------------------------------------------ knowledge store mirror, finding, events

def _rag(cfg: Any, d: Dict[str, Any]) -> str:
    try:
        from . import agent_memory
        if not agent_memory.enabled(cfg):
            return ""
    except Exception:   # noqa: BLE001
        return ""
    return str(d.get("rag_project") or "")


def _mirror(cfg: Any, store: Any, project: str, d: Dict[str, Any]) -> None:
    proj = _rag(cfg, d)
    if not proj:
        return
    body = text(store, project) or "CHANGE QUEUE of project %s: empty (no change is waiting)." % project
    try:
        from .ragmap import _http
        _http(cfg, "POST", "/vector/add", {"id": "change-queue-" + project, "text": body, "scope": "knowledge",
                                           "metadata": {"project": proj, "scope": "knowledge", "kind": "change-queue",
                                                        "subject": "change queue", "topic": "change queue"}})
    except Exception:   # noqa: BLE001 - the engine store is the truth; the mirror is best effort
        pass


def _finding(cfg: Any, d: Dict[str, Any], body: str) -> None:
    proj = _rag(cfg, d)
    if not proj:
        return
    try:
        from .ragmap import _http
        _http(cfg, "POST", "/vector/add", {"text": body, "scope": "findings", "metadata": {
            "project": proj, "scope": "findings", "kind": "finding", "subject": "change queue",
            "topic": "change queue", "role": "change_queue"}})
    except Exception:   # noqa: BLE001
        pass


def _event(pipe: Any, kind: str, row: Dict[str, Any]) -> None:
    try:
        pipe.log("%s: %s %s #%s" % (pipe.run, kind, row.get("project"), row.get("seq")))
    except Exception:   # noqa: BLE001
        pass

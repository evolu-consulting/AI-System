"""The PM's plan: a WBS schedule per project, the way a Laidon PM runs a real
implementation (the Centrica project schedule, the PM Works kick-off deck).

- Phases, tasks and milestones in a tree; WBS numbers come from the tree order.
- Dates are WORKING days (Mon-Fri) minus the project's blackout ranges.
- Dependencies FS (finish-to-start), SS (start-to-start), FF (finish-to-finish),
  with a lag in working days. A task with no dependency starts at its pinned
  start, else its nearest pinned ancestor, else the plan start.
- Parents roll up: start = earliest child, end = latest child, % complete
  weighted by duration.
- Each task gets: expected % for today, variance, working days remaining, a
  7-30-60-90 look-ahead bucket, health in the PM's colours (blue completed,
  red past due, yellow late to start or behind by more than 20 points, green),
  and whether it is on the critical path (no float).
- Tasks are on the LAIDON side, the CLIENT side (reminders go to the client
  contact) or the AGENT side (they follow an SDLC run and update themselves).
- A milestone may trigger a customer INVOICE; completing it raises a notice
  until someone records the invoice as sent.
"""

import json
import math
from datetime import date, datetime, timedelta

import db

SIDES = ("laidon", "client", "agent")
KINDS = ("phase", "task", "milestone")
STATUSES = ("not_started", "in_progress", "completed")
DEP_TYPES = ("FS", "SS", "FF")


# ---------------------------------------------------------------- calendar

def _d(text):
    try:
        return datetime.strptime(str(text)[:10], "%Y-%m-%d").date()
    except (TypeError, ValueError):
        return None


def _s(d):
    return d.strftime("%Y-%m-%d") if d else None


class Calendar:
    def __init__(self, holidays):
        self.off = []
        for h in holidays or []:
            a, b = _d(h.get("from")), _d(h.get("to") or h.get("from"))
            if a and b:
                self.off.append((min(a, b), max(a, b)))

    def workday(self, d):
        if d.weekday() >= 5:
            return False
        return not any(a <= d <= b for a, b in self.off)

    def on_or_after(self, d):
        while not self.workday(d):
            d += timedelta(days=1)
        return d

    def on_or_before(self, d):
        while not self.workday(d):
            d -= timedelta(days=1)
        return d

    def add(self, d, n):
        """n working days after d (n may be negative); d itself is snapped to a workday first."""
        step = 1 if n >= 0 else -1
        d = self.on_or_after(d) if n >= 0 else self.on_or_before(d)
        for _ in range(abs(n)):
            d += timedelta(days=step)
            while not self.workday(d):
                d += timedelta(days=step)
        return d

    def end_of(self, start, duration):
        return self.add(start, max(0, duration - 1))

    def start_of(self, end, duration):
        return self.add(end, -max(0, duration - 1))

    def between(self, a, b):
        """Working days from a to b inclusive (0 when b < a)."""
        if b < a:
            return 0
        n, d = 0, a
        while d <= b:
            if self.workday(d):
                n += 1
            d += timedelta(days=1)
        return n


# ---------------------------------------------------------------- rows

def _row(r):
    return {"id": r["id"], "projectId": r["project_id"], "parentId": r["parent_id"], "sort": r["sort"], "kind": r["kind"],
            "title": r["title"], "details": r["details"], "side": r["side"], "owner": r["owner"], "role": r["role"],
            "stream": r["stream"], "durationDays": r["duration_days"], "loeHours": r["loe_hours"],
            "start": r["start_date"], "end": r["end_date"], "pinnedStart": r["pinned_start"],
            "baselineStart": r["baseline_start"], "baselineEnd": r["baseline_end"], "actualEnd": r["actual_end"],
            "pct": r["pct"], "status": r["status"], "deps": db.jload(r["deps_json"], []), "invoice": bool(r["invoice"]),
            "invoiceSent": r["invoice_sent"], "clientVisible": bool(r["client_visible"]), "runId": r["run_id"],
            "nodeId": r["node_id"]}


def rows(project_id):
    return [_row(r) for r in db.q("SELECT * FROM task WHERE project_id=? ORDER BY sort, id", project_id)]


def get(tid):
    r = db.one("SELECT * FROM task WHERE id=?", tid)
    return _row(r) if r else None


FIELDS = {"parentId": "parent_id", "sort": "sort", "kind": "kind", "title": "title", "details": "details", "side": "side",
          "owner": "owner", "role": "role", "stream": "stream", "durationDays": "duration_days", "loeHours": "loe_hours",
          "pinnedStart": "pinned_start", "pct": "pct", "status": "status", "deps": "deps_json", "invoice": "invoice",
          "invoiceSent": "invoice_sent", "clientVisible": "client_visible", "runId": "run_id", "nodeId": "node_id",
          "actualEnd": "actual_end"}


def _clean(body, existing=None):
    out = {}
    for key, col in FIELDS.items():
        if key not in body:
            continue
        v = body[key]
        if key == "kind" and v not in KINDS:
            raise ValueError("kind must be one of " + ", ".join(KINDS))
        if key == "side" and v not in SIDES:
            raise ValueError("side must be one of " + ", ".join(SIDES))
        if key == "status" and v not in STATUSES:
            raise ValueError("status must be one of " + ", ".join(STATUSES))
        if key == "deps":
            deps = []
            for d in v or []:
                t = d.get("type", "FS") if isinstance(d, dict) else "FS"
                tid = int(d.get("task") if isinstance(d, dict) else d)
                if t not in DEP_TYPES:
                    raise ValueError("a dependency type is FS, SS or FF")
                deps.append({"task": tid, "type": t, "lag": int((d.get("lag") if isinstance(d, dict) else 0) or 0)})
            v = json.dumps(deps)
        if key in ("durationDays",):
            v = max(0, int(v or 0))
        if key in ("pct",):
            v = max(0.0, min(1.0, float(v or 0)))
        if key in ("loeHours",):
            v = float(v or 0)
        if key in ("invoice", "clientVisible"):
            v = 1 if v else 0
        if key in ("pinnedStart", "invoiceSent", "actualEnd"):
            v = _s(_d(v)) if v else None
        out[col] = v
    # Status and % complete move together, the way the PM's sheet does.
    if "status" in out and "pct" not in out:
        out["pct"] = 1.0 if out["status"] == "completed" else (existing or {}).get("pct", 0) if out["status"] == "in_progress" else 0.0
        if out["status"] == "in_progress" and not out["pct"]:
            out["pct"] = 0.1
    if "pct" in out and "status" not in out:
        out["status"] = "completed" if out["pct"] >= 1 else "in_progress" if out["pct"] > 0 else "not_started"
    if out.get("status") == "completed" and "actual_end" not in out:
        out["actual_end"] = _s(date.today())
    if out.get("kind") == "milestone":
        out["duration_days"] = 0
    return out


def add(project_id, body):
    if not db.project_get(project_id):
        raise KeyError(project_id)
    if not str(body.get("title") or "").strip():
        raise ValueError("title is required")
    vals = _clean(dict({"kind": "task", "side": "laidon", "durationDays": 1}, **body))
    if "sort" not in vals:
        vals["sort"] = (db.one("SELECT COALESCE(MAX(sort),0) AS m FROM task WHERE project_id=?", project_id)["m"] or 0) + 10
    vals.update(project_id=project_id, created_at=db.now(), updated_at=db.now())
    tid = db.ex("INSERT INTO task(%s) VALUES (%s)" % (", ".join(vals), ",".join("?" * len(vals))), *vals.values())
    return tid


def update(tid, body):
    t = get(tid)
    if not t:
        raise KeyError(tid)
    vals = _clean(body, {"pct": t["pct"]})
    if "parent_id" in vals and vals["parent_id"]:
        p = vals["parent_id"]
        while p:  # no cycles in the tree
            if p == tid:
                raise ValueError("a task cannot sit under itself")
            p = (db.one("SELECT parent_id FROM task WHERE id=?", p) or {}).get("parent_id")
    if vals:
        vals["updated_at"] = db.now()
        db.ex("UPDATE task SET %s WHERE id=?" % ", ".join("%s=?" % k for k in vals), *vals.values(), tid)
    return get(tid)


def delete(tid):
    """Delete a task with its whole subtree, and drop dependencies on it."""
    t = get(tid)
    if not t:
        raise KeyError(tid)
    gone, todo = set(), [tid]
    while todo:
        x = todo.pop()
        gone.add(x)
        todo += [r["id"] for r in db.q("SELECT id FROM task WHERE parent_id=?", x)]
    for x in gone:
        db.ex("DELETE FROM task WHERE id=?", x)
    for r in db.q("SELECT id, deps_json FROM task WHERE project_id=?", t["projectId"]):
        deps = [d for d in db.jload(r["deps_json"], []) if d.get("task") not in gone]
        db.ex("UPDATE task SET deps_json=? WHERE id=?", json.dumps(deps), r["id"])


def set_baseline(project_id):
    view = schedule(project_id)
    for t in view["tasks"]:
        db.ex("UPDATE task SET baseline_start=?, baseline_end=? WHERE id=?", t["start"], t["end"], t["id"])
    return schedule(project_id)


# ---------------------------------------------------------------- agent-side tasks follow their run

def _sync_agent(t):
    if not t["runId"]:
        return t
    run = db.run_get(t["runId"])
    if not run:
        return t
    steps = db.steps_of(run["id"])
    if t["nodeId"]:
        mine = [s for s in steps if s["node_id"] == t["nodeId"]]
        if not mine:
            return t
        last = mine[-1]
        if last["status"] == "done":
            pct, status, end = 1.0, "completed", (last["finished_at"] or "")[:10]
        elif last["status"] in ("pending", "skipped") and len(mine) == 1:
            pct, status, end = 0.0, "not_started", None
        else:
            pct, status, end = 0.5, "in_progress", None
    else:
        main = [s for s in steps if s["status"] != "skipped"]
        done = sum(1 for s in main if s["status"] in ("done", "rework"))
        pct = 1.0 if run["status"] == "done" else (done / len(main) if main else 0)
        status = "completed" if run["status"] == "done" else "in_progress" if done or run["status"] != "pending" else "not_started"
        end = (run["finished_at"] or "")[:10] if run["status"] == "done" else None
    if (pct, status) != (t["pct"], t["status"]):
        db.ex("UPDATE task SET pct=?, status=?, actual_end=COALESCE(?, actual_end), updated_at=? WHERE id=?",
              pct, status, end, db.now(), t["id"])
        t = dict(t, pct=pct, status=status, actualEnd=end or t["actualEnd"])
    return t


# ---------------------------------------------------------------- the schedule

def schedule(project_id, today=None):
    """Dates, roll-ups and PM metrics for every task of a project, plus the summary."""
    p = db.project_get(project_id)
    if not p:
        raise KeyError(project_id)
    cal = Calendar(db.jload(p["holidays_json"], []))
    today = today or date.today()
    ts = [_sync_agent(t) for t in rows(project_id)]
    by = {t["id"]: t for t in ts}
    kids = {}
    for t in ts:
        kids.setdefault(t["parentId"] if t["parentId"] in by else None, []).append(t)
    for v in kids.values():
        v.sort(key=lambda x: (x["sort"], x["id"]))
    pinned = [_d(t["pinnedStart"]) for t in ts if t["pinnedStart"]]
    plan_start = cal.on_or_after(min(pinned) if pinned else today)

    def anchor(t):
        x = t
        while x:
            if x["pinnedStart"]:
                return cal.on_or_after(_d(x["pinnedStart"]))
            x = by.get(x["parentId"])
        return plan_start

    # Dependencies of a parent apply to all its children (they cannot start before it may).
    def deps_of(t):
        out, x = list(t["deps"]), by.get(t["parentId"])
        while x:
            out += x["deps"]
            x = by.get(x["parentId"])
        return out

    S, E = {}, {}
    leaves = [t for t in ts if t["id"] not in {c["parentId"] for c in ts}]

    def rollup():
        def walk(t):
            ch = kids.get(t["id"]) or []
            if not ch:
                return S.get(t["id"]), E.get(t["id"])
            spans = [walk(c) for c in ch]
            ss = [a for a, _ in spans if a]
            ee = [b for _, b in spans if b]
            S[t["id"]], E[t["id"]] = (min(ss) if ss else None), (max(ee) if ee else None)
            return S[t["id"]], E[t["id"]]
        for root in kids.get(None, []):
            walk(root)

    for it in range(60):
        changed = False
        for t in leaves:
            dur = 0 if t["kind"] == "milestone" else max(1, t["durationDays"])
            start = anchor(t)
            end_floor = None
            for d in deps_of(t):
                src = by.get(d["task"])
                if not src or S.get(src["id"]) is None:
                    continue
                lag = int(d.get("lag") or 0)
                if d["type"] == "FS":
                    start = max(start, cal.add(E[src["id"]], 1 + lag) if dur else cal.add(E[src["id"]], lag))
                elif d["type"] == "SS":
                    start = max(start, cal.add(S[src["id"]], lag))
                else:  # FF
                    end_floor = max(end_floor or E[src["id"]], cal.add(E[src["id"]], lag))
            end = cal.end_of(start, dur) if dur else start
            if end_floor and end < end_floor:
                end = end_floor
                start = max(start, cal.start_of(end, dur)) if dur else end
            if S.get(t["id"]) != start or E.get(t["id"]) != end:
                S[t["id"]], E[t["id"]] = start, end
                changed = True
        rollup()
        if not changed and it:
            break
    else:
        raise ValueError("the dependencies go round in a circle")

    # Roll-up of progress: duration-weighted over leaves.
    def prog(t):
        ch = kids.get(t["id"]) or []
        if not ch:
            w = max(1, t["durationDays"])
            return t["pct"] * w, w
        a = [prog(c) for c in ch]
        done, weight = sum(x for x, _ in a), sum(y for _, y in a)
        return done, weight

    # Float: latest finish allowed by successors (leaves only), then roll the minimum up.
    succ = {}
    for t in leaves:
        for d in deps_of(t):
            if d["task"] in by:
                succ.setdefault(d["task"], []).append((t, d))
    project_end = max([e for e in E.values() if e] or [plan_start])
    late_finish = {}
    order = sorted(leaves, key=lambda t: E.get(t["id"]) or plan_start, reverse=True)
    for _ in range(len(order) + 1):  # until nothing moves (ties in end dates need extra passes)
        moved = False
        for t in order:
            lf = project_end
            for s, d in _successors(t, succ, by, kids):
                s_lf = late_finish.get(s["id"], project_end)
                s_ls = cal.start_of(s_lf, max(1, s["durationDays"])) if s["kind"] != "milestone" else s_lf
                if d["type"] == "FS":
                    # A milestone sits on its predecessor's last day; a task starts the next working day.
                    lf = min(lf, s_ls if s["kind"] == "milestone" else cal.add(s_ls, -1))
                elif d["type"] == "SS":
                    lf = min(lf, cal.end_of(s_ls, max(1, t["durationDays"])))
                else:
                    lf = min(lf, s_lf)
            if late_finish.get(t["id"]) != lf:
                late_finish[t["id"]] = lf
                moved = True
        if not moved:
            break

    out = []
    counts = {"completed": 0, "in_progress": 0, "not_started": 0, "pastDue": 0, "red": 0, "yellow": 0}
    for t in ts:
        s, e = S.get(t["id"]), E.get(t["id"])
        is_parent = bool(kids.get(t["id"]))
        if is_parent:
            done, weight = prog(t)
            pct = round(done / weight, 3) if weight else 0
            status = "completed" if pct >= 1 else "in_progress" if pct > 0 else "not_started"
        else:
            pct, status = t["pct"], t["status"]
        total = cal.between(s, e) if s and e else 0
        elapsed = cal.between(s, min(e, today)) if s and e and today >= s else 0
        expected = 1.0 if e and today > e else (round(elapsed / total, 3) if total else (1.0 if s and today >= s else 0.0))
        variance = round(pct - expected, 3)
        remaining = cal.between(max(today, s), e) if s and e and status != "completed" else 0
        past_due = bool(e and today > e and status != "completed")
        if status == "completed":
            health = "blue"
        elif past_due:
            health = "red"
        elif (s and today >= s and pct == 0) or variance < -0.2:
            health = "yellow"
        else:
            health = "green"
        ahead = None
        if status != "completed" and s:
            days = (s - today).days
            for b in (7, 30, 60, 90):
                if days <= b:
                    ahead = b
                    break
        if is_parent:
            lfs = [late_finish.get(x["id"]) for x in _leaves_under(t, kids) if late_finish.get(x["id"])]
            slack_end = min(lfs) if lfs else e
            critical = any(late_finish.get(x["id"]) and E.get(x["id"]) and cal.between(E[x["id"]], late_finish[x["id"]]) <= 1
                           for x in _leaves_under(t, kids) if (x["status"] != "completed"))
        else:
            lf = late_finish.get(t["id"], e)
            slack_end = lf
            critical = bool(e and lf and status != "completed" and cal.between(e, lf) <= 1)
        float_days = max(0, cal.between(e, slack_end) - 1) if e and slack_end and slack_end >= e else 0
        if not is_parent:
            counts[status] += 1
            counts["pastDue"] += 1 if past_due else 0
            counts["red"] += 1 if health == "red" else 0
            counts["yellow"] += 1 if health == "yellow" else 0
        slip = None
        if t["baselineEnd"] and e:
            b = _d(t["baselineEnd"])
            slip = (cal.between(b, e) - 1) if e > b else -(cal.between(e, b) - 1) if e < b else 0
        out.append(dict(t, start=_s(s), end=_s(e), durationDays=(total if is_parent else t["durationDays"]), pct=pct,
                        status=status, expected=expected, variance=variance, remaining=remaining, pastDue=past_due,
                        health=health, lookahead=ahead, critical=critical, floatDays=float_days, isParent=is_parent,
                        slipDays=slip))
        if t["start"] != _s(s) or t["end"] != _s(e):
            db.ex("UPDATE task SET start_date=?, end_date=? WHERE id=?", _s(s), _s(e), t["id"])

    # WBS numbers from the tree order.
    wbs = {}

    def number(parent, prefix):
        for i, c in enumerate(kids.get(parent, []), 1):
            wbs[c["id"]] = "%s%d" % (prefix, i)
            number(c["id"], wbs[c["id"]] + ".")
    number(None, "")
    depth = {}
    for t in out:
        t["wbs"] = wbs.get(t["id"], "")
        t["level"] = t["wbs"].count(".")
        depth[t["id"]] = t["level"]
    out.sort(key=lambda t: [int(x) for x in t["wbs"].split(".") if x.isdigit()])

    leaves_out = [t for t in out if not t["isParent"]]
    weight = sum(max(1, t["durationDays"]) for t in leaves_out)
    pct_all = round(sum(t["pct"] * max(1, t["durationDays"]) for t in leaves_out) / weight, 3) if weight else 0
    starts = [_d(t["start"]) for t in out if t["start"]]
    ends = [_d(t["end"]) for t in out if t["end"]]
    health = "red" if counts["red"] else "yellow" if counts["yellow"] else "green"
    invoices = [{"id": t["id"], "title": t["title"], "wbs": t["wbs"], "end": t["end"], "status": t["status"],
                 "invoiceSent": t["invoiceSent"], "due": t["status"] == "completed" and not t["invoiceSent"]}
                for t in out if t["invoice"]]
    summary = {"pct": pct_all, "start": _s(min(starts)) if starts else None, "end": _s(max(ends)) if ends else None,
               "durationDays": cal.between(min(starts), max(ends)) if starts and ends else 0,
               "remainingDays": cal.between(max(today, min(starts)), max(ends)) if ends and starts else 0, "health": health,
               "completed": counts["completed"], "inProgress": counts["in_progress"], "notStarted": counts["not_started"],
               "pastDue": counts["pastDue"], "red": counts["red"], "yellow": counts["yellow"],
               "critical": sum(1 for t in leaves_out if t["critical"]), "invoicesDue": sum(1 for i in invoices if i["due"]),
               "clientOpen": sum(1 for t in leaves_out if t["side"] == "client" and t["status"] != "completed")}
    return {"projectId": project_id, "today": _s(today), "planStart": _s(plan_start), "summary": summary, "tasks": out,
            "invoices": invoices, "holidays": db.jload(p["holidays_json"], [])}


def _leaves_under(t, kids):
    out, todo = [], list(kids.get(t["id"]) or [])
    while todo:
        x = todo.pop()
        ch = kids.get(x["id"]) or []
        if ch:
            todo += ch
        else:
            out.append(x)
    return out


def _successors(t, succ, by, kids):
    """Leaves that depend on t, directly or through a dependency on one of t's ancestors."""
    out = list(succ.get(t["id"], []))
    x = by.get(t["parentId"])
    while x:
        # A dependency on a parent means 'after the whole parent', i.e. after its last child.
        out += succ.get(x["id"], [])
        x = by.get(x["parentId"])
    return out


# ---------------------------------------------------------------- templates

# The standard phase of a SimpleMDG implementation, condensed from the Centrica schedule
# and the PM Works kick-off deck. key, title, kind, side, role, days, deps, flags.
# '*' in a title is expanded once per stream (domain / object) when streams are given.
SMDG_PHASE = [
    ("prep", "PREPARATION", "phase", None, "", 0, [], {}),
    ("doc", "Project documentation (schedule, SIT/UAT/hypercare trackers, decision log, change request log)", "task", "laidon", "Project Manager", 1, [], {"parent": "prep"}),
    ("align", "Pre-kickoff alignment with client", "task", "laidon", "Project Manager", 1, [("doc", "FS")], {"parent": "prep"}),
    ("kick", "Project kick-off", "milestone", "laidon", "Project Manager, Client", 0, [("align", "FS")], {"parent": "prep"}),
    ("qa", "Technical Q&A form", "task", "client", "Client", 5, [("kick", "SS")], {"parent": "prep"}),
    ("pkg", "Technical onboarding package (access matrix, Cloud Connector, TR package, SAP config, email, storage, SSO, IAS guidelines)", "task", "laidon", "DevOps, ABAP Consultant", 10, [("kick", "FS")], {"parent": "prep", "loe": 160}),
    ("devsetup", "Client technical setup of DEV (SAP config, access, system user, import TR, Event Mesh, Cloud Connector, email, storage)", "task", "client", "Client IT", 10, [("pkg", "FS")], {"parent": "prep"}),
    ("devdeploy", "Deploy SimpleMDG DEV and hand over credentials", "task", "laidon", "DevOps", 2, [("devsetup", "FS")], {"parent": "prep", "loe": 16}),
    ("train", "Standard training (end-user E2E, admin settings)", "task", "laidon", "Laidon Trainer", 5, [("kick", "FS")], {"parent": "prep"}),
    ("expl", "EXPLORATION", "phase", None, "", 0, [], {}),
    ("reqtpl", "Send workshop agenda and requirement template", "task", "laidon", "Functional Consultant", 1, [("kick", "FS")], {"parent": "expl", "loe": 16}),
    ("reqfill", "Fill out the requirement template (homework before each workshop)", "task", "client", "Client", 5, [("reqtpl", "FS")], {"parent": "expl"}),
    ("ws", "Requirement workshop: *", "task", "laidon", "Functional Consultant, Client Team", 3, [("reqfill", "FS")], {"parent": "expl", "loe": 24}),
    ("fitgap", "Fit-to-gap workshops and gap estimates", "task", "laidon", "Functional Consultant", 10, [("ws", "FS")], {"parent": "expl", "loe": 40}),
    ("bp", "Blueprint preparation", "task", "laidon", "Functional Consultant", 4, [("fitgap", "FS")], {"parent": "expl", "loe": 32}),
    ("bprev", "Client review of the blueprint", "task", "client", "Client", 3, [("bp", "FS")], {"parent": "expl"}),
    ("bpfin", "Update and finalise the blueprint", "task", "laidon", "Functional Consultant", 2, [("bprev", "FS")], {"parent": "expl", "loe": 16}),
    ("bpsign", "Blueprint sign-off (business lead)", "milestone", "client", "Client Business Lead", 0, [("bpfin", "FS")], {"parent": "expl", "invoice": True}),
    ("real", "REALIZATION", "phase", None, "", 0, [], {}),
    ("dm", "Deploy data model: *", "task", "laidon", "NodeJS", 4, [("bpsign", "FF")], {"parent": "real"}),
    ("tpl", "Template and workflow configuration: *", "task", "laidon", "Functional Consultant", 10, [("bpsign", "FS"), ("dm", "FS")], {"parent": "real"}),
    ("gap", "Gap requirement development (if any: RA approval, product squad)", "task", "laidon", "Product team", 1, [("tpl", "FS")], {"parent": "real"}),
    ("ut", "Unit testing: *", "task", "laidon", "Functional Consultant", 5, [("tpl", "FS")], {"parent": "real"}),
    ("adv", "Advanced training", "task", "laidon", "Functional Consultant", 10, [("ut", "FS")], {"parent": "real"}),
    ("test", "TESTING", "phase", None, "", 0, [], {}),
    ("cases", "Prepare SIT and UAT test cases and user lists", "task", "client", "Client Team", 5, [("tpl", "SS")], {"parent": "test"}),
    ("qas", "QAS setup (client setup, TR DEV to QAS, deploy SimpleMDG to QAS, template migration, verification)", "task", "laidon", "DevOps, Functional Consultant", 10, [("ut", "FS")], {"parent": "test", "loe": 80}),
    ("sit", "SIT: *", "task", "client", "Client MDM, Functional Consultant", 15, [("qas", "FS"), ("cases", "FS")], {"parent": "test"}),
    ("sitsign", "SIT sign-off (business lead + PMO)", "milestone", "client", "Client", 0, [("sit", "FS")], {"parent": "test"}),
    ("uat", "UAT: *", "task", "client", "Client end users", 15, [("sitsign", "FS")], {"parent": "test"}),
    ("uatsign", "UAT sign-off (business lead + PMO)", "milestone", "client", "Client", 0, [("uat", "FS")], {"parent": "test", "invoice": True}),
    ("cut", "CUTOVER", "phase", None, "", 0, [], {}),
    ("prd", "PROD setup (client setup, TR QAS to PROD, deploy SimpleMDG to PROD) and cutover checklist", "task", "laidon", "DevOps", 10, [("sitsign", "FS")], {"parent": "cut", "loe": 80}),
    ("gonogo", "Go / No-Go decision", "milestone", "client", "All team", 0, [("uatsign", "FS"), ("prd", "FS")], {"parent": "cut"}),
    ("golive", "GO LIVE: *", "task", "laidon", "DevOps", 1, [("gonogo", "FS")], {"parent": "cut"}),
    ("hyper", "HYPERCARE", "phase", None, "", 0, [], {}),
    ("fix", "Review and fix issues (feedback tracker)", "task", "laidon", "Functional Consultant", 20, [("golive", "FS")], {"parent": "hyper"}),
    ("hypersign", "Hypercare sign-off (business lead + PMO)", "milestone", "client", "Client", 0, [("fix", "FS")], {"parent": "hyper"}),
    ("handover", "Handover to Customer Support", "task", "laidon", "Project Manager", 2, [("hypersign", "FS")], {"parent": "hyper"}),
]

TEMPLATES = {
    "smdg-phase": {"name": "SimpleMDG implementation phase", "rows": SMDG_PHASE,
                   "about": "Preparation, Exploration, Realization, Testing (SIT, UAT), Cutover, Go-live, Hypercare, as in the Centrica schedule."},
}


def templates():
    return [{"id": k, "name": v["name"], "about": v["about"]} for k, v in TEMPLATES.items()]


def generate(project_id, template_id, name, streams=None, start=None, after=None, skip_prep=False):
    """Add one phase from a template under a new top-level task. streams expands '*' rows per domain.
    after = an existing task id this phase starts after (FS); skip_prep leaves out PREPARATION
    (a later phase of the same program re-uses the first phase's preparation)."""
    tpl = TEMPLATES.get(template_id)
    if not tpl:
        raise ValueError("unknown plan template " + str(template_id))
    streams = [s.strip() for s in (streams or []) if str(s).strip()]
    root = add(project_id, {"title": name or tpl["name"], "kind": "phase", "pinnedStart": start,
                            "deps": [{"task": int(after), "type": "FS"}] if after else []})
    ids = {}  # template key -> list of created task ids
    phases = {}
    rows_ = [r for r in tpl["rows"] if not (skip_prep and (r[0] == "prep" or r[7].get("parent") == "prep"))]
    sort = 0
    for key, title, kind, side, role, days, deps, flags in rows_:
        sort += 10
        if kind == "phase":
            phases[key] = add(project_id, {"title": title, "kind": "phase", "parentId": root, "sort": sort})
            ids[key] = [phases[key]]
            continue
        parent = phases.get(flags.get("parent"), root)
        names = ([title.replace("*", s) for s in streams] if "*" in title and streams else [title.replace(": *", "").replace("*", "")])
        created = []
        for i, t in enumerate(names):
            body = {"title": t, "kind": kind, "side": side or "laidon", "role": role, "durationDays": days, "parentId": parent,
                    "sort": sort + i, "loeHours": flags.get("loe", 0), "invoice": flags.get("invoice", False),
                    "stream": streams[i] if "*" in title and streams else ""}
            deps_ = []
            for dk, dt in deps:
                src = ids.get(dk) or []
                # Per-stream rows depend on the same stream's row when both are expanded.
                if len(src) == len(names) and len(names) > 1:
                    deps_.append({"task": src[i], "type": dt})
                else:
                    deps_ += [{"task": x, "type": dt} for x in src]
            if not deps_ and deps and skip_prep and after:
                deps_ = [{"task": int(after), "type": "FS"}]
            body["deps"] = deps_
            created.append(add(project_id, body))
        ids[key] = created
        sort += len(names)
    return root


def generate_from_run(run_id):
    """One phase per agent run: a task per step on its main path, following the run live."""
    run = db.run_get(run_id)
    if not run:
        raise KeyError(run_id)
    if db.one("SELECT id FROM task WHERE run_id=? AND node_id=''", run_id):
        raise ValueError("this run is already in the plan")
    process = db.run_process(run) or {"nodes": []}
    root = add(run["project_id"], {"title": "Run #%d %s" % (run_id, run["title"]), "kind": "phase", "side": "agent",
                                   "runId": run_id, "pinnedStart": (run["created_at"] or "")[:10] or None, "owner": run["owner"]})
    prev = None
    for i, nd in enumerate(process["nodes"]):
        g = nd["group"]
        days = max(1, int(math.ceil((g.get("estimateMin") or 10) / 480.0)))
        tid = add(run["project_id"], {"title": g["name"], "kind": "task", "side": "agent", "parentId": root, "sort": (i + 1) * 10,
                                      "runId": run_id, "nodeId": nd["id"], "durationDays": days, "role": g.get("lane", ""),
                                      "deps": [{"task": prev, "type": "FS"}] if prev else []})
        prev = tid
    return root


# ---------------------------------------------------------------- reminders (called by gov.tick)

def client_reminders(notify):
    """Once a day per task: a client-owned task that is past due, or starts today and is not started."""
    today = date.today()
    for p in db.q("SELECT * FROM project"):
        if not db.one("SELECT id FROM task WHERE project_id=? LIMIT 1", p["id"]):
            continue
        view = schedule(p["id"], today)
        for t in view["tasks"]:
            if t["isParent"] or t["status"] == "completed":
                continue
            late = t["pastDue"]
            starting = t["side"] == "client" and t["start"] == _s(today) and t["status"] == "not_started"
            if not (late or starting) or (t.get("nudged") == _s(today)):
                continue
            r = db.one("SELECT nudged FROM task WHERE id=?", t["id"])
            if r and r["nudged"] == _s(today):
                continue
            db.ex("UPDATE task SET nudged=? WHERE id=?", _s(today), t["id"])
            who = p["client_contact"] if t["side"] == "client" else (t["owner"] or p["owner"])
            text = "%s task %s '%s' %s (due %s)." % (t["side"].capitalize(), t["wbs"], t["title"],
                                                     "is past due" if late else "starts today", t["end"])
            notify("plan", text, p["id"], recipient=who or p["owner"], level=2 if late else 1, kh_project=p["kh_project"])
        for inv in view["invoices"]:
            if inv["due"]:
                key = "invoice-%d" % inv["id"]
                if db.one("SELECT 1 FROM setting WHERE key=?", "_" + key):
                    continue
                db.ex("INSERT OR REPLACE INTO setting(key, value_json) VALUES (?,?)", "_" + key, json.dumps(db.now()))
                notify("invoice", "Milestone %s '%s' is complete: send the customer invoice." % (inv["wbs"], inv["title"]),
                       p["id"], recipient=p["owner"], level=2, kh_project=p["kh_project"])

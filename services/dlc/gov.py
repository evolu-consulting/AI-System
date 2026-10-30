"""The PM view of the SDLC: governance that runs over every step of every run.

The developer view (engine.py) walks a run's steps with agent groups. This
module is the project manager's half, taken from the PM App (M360) business:

- registers: RAIDEC (risk, action, issue, decision, escalation, change) plus
  defects and lessons, filled from what the agents report at STEP_DONE and from
  what people add; risk category from probability x impact; a risk owner is a
  person, never the PM agent; decisions start 'proposed' until a lead approves.
- scope: the items the intake step got signed off, each traced to a test.
- verification: the server re-runs the test command itself; an agent's
  "tests passed" is a claim, not evidence.
- health: R/A/G per run and project from status, waiting time, slip against
  the baseline, budget burn against earned progress, open escalations.
- the escalation ladder: nudge, then the owner, then escalate, for any step
  that waits on a person (the PM App's +1/+3/+5 days, in minutes here).
- notifications, users and roles, the audit trail, settings.
"""

import base64
import hashlib
import json
import logging
import os
import re
import secrets
import subprocess
import time
import urllib.error
import urllib.request
from datetime import datetime

import db
import kh

log = logging.getLogger("sdlc.gov")

# ---------------------------------------------------------------- settings

DEFAULTS = {
    # Escalation ladder for a step waiting on a person, in minutes: nudge the owner,
    # tell the project owner, escalate (register item + red health).
    "ladderMinutes": [60, 240, 1440],
    "maxRework": 2,              # how many times a failing step may send work back
    "maxConcurrent": 3,          # agent CLI calls running at once, across all projects
    "digestHour": 18,            # local hour for the daily project digest
    "testTimeoutSec": 600,
    "burnAmberPct": 10,          # earned-vs-burn variance: within 10% green, 10-20% amber, worse red
    "burnRedPct": 20,
    # Change requests are signed in this order before anything is built (PM Works CR flow).
    "crApprovers": ["steering committee", "client"],
    # Off: a step that waits for people is closed by any signed-in person; the step's sign-off titles are kept
    # but not enforced (DLC has one kind of user until people management comes). On: every title must sign.
    "signoffByTitle": False,
}


def settings():
    out = dict(DEFAULTS)
    for r in db.q("SELECT key, value_json FROM setting"):
        if r["key"] in DEFAULTS:
            out[r["key"]] = db.jload(r["value_json"], DEFAULTS[r["key"]])
    return out


def save_settings(body):
    for k, v in (body or {}).items():
        if k not in DEFAULTS:
            continue
        if k == "ladderMinutes":
            v = [max(1, int(x)) for x in v][:3]
            if len(v) != 3 or not (v[0] <= v[1] <= v[2]):
                raise ValueError("ladderMinutes needs three rising numbers")
        elif k == "crApprovers":
            v = [str(x).strip().lower() for x in (v or []) if str(x).strip()]
        elif isinstance(DEFAULTS[k], bool):
            v = bool(v)
        elif isinstance(DEFAULTS[k], int):
            v = int(v)
        db.ex("INSERT OR REPLACE INTO setting(key, value_json) VALUES (?,?)", k, json.dumps(v))
    return settings()


def _mark(key):
    r = db.one("SELECT value_json FROM setting WHERE key=?", "_" + key)
    return db.jload(r["value_json"], None) if r else None


def _set_mark(key, value):
    db.ex("INSERT OR REPLACE INTO setting(key, value_json) VALUES (?,?)", "_" + key, json.dumps(value))


# ---------------------------------------------------------------- users, roles, audit

ROLES = ("viewer", "member", "lead", "admin")
LOCAL = {"id": "local", "name": "local", "email": "", "role": "admin", "titles": ["*"]}


def rank(role):
    return ROLES.index(role) if role in ROLES else -1


def _hash(token):
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def open_mode():
    """No users yet: the tool is a single-person local tool and everyone is admin."""
    return not db.one("SELECT id FROM user_account WHERE disabled=0 LIMIT 1")


def user_by_token(token):
    if not token:
        return None
    r = db.one("SELECT * FROM user_account WHERE token_hash=? AND disabled=0", _hash(token))
    return user_public(r) if r else None


def _titles(text):
    return [t.strip().lower() for t in str(text or "").split(",") if t.strip()]


def user_public(r):
    return {"id": r["id"], "name": r["name"], "email": r["email"], "role": r["role"], "disabled": bool(r["disabled"]),
            "titles": _titles(r["titles"]), "createdAt": r["created_at"]}


def users():
    return [user_public(r) for r in db.q("SELECT * FROM user_account ORDER BY created_at")]


def save_user(uid, body):
    """Create (returns the token ONCE) or update a user. A token is never stored in clear."""
    role = body.get("role") or "member"
    if role not in ROLES:
        raise ValueError("role must be one of " + ", ".join(ROLES))
    if uid:
        r = db.one("SELECT * FROM user_account WHERE id=?", uid)
        if not r:
            raise KeyError(uid)
        titles = body["titles"] if "titles" in body else r["titles"]
        if isinstance(titles, list):
            titles = ", ".join(titles)
        db.ex("UPDATE user_account SET email=?, role=?, disabled=?, titles=? WHERE id=?",
              str(body.get("email", r["email"]) or ""), role, 1 if body.get("disabled") else 0, ", ".join(_titles(titles)), uid)
        out = user_public(db.one("SELECT * FROM user_account WHERE id=?", uid))
        if body.get("resetToken"):
            token = secrets.token_urlsafe(24)
            db.ex("UPDATE user_account SET token_hash=? WHERE id=?", _hash(token), uid)
            out["token"] = token
        return out
    name = str(body.get("name") or "").strip()
    if not name:
        raise ValueError("name is required")
    if db.one("SELECT id FROM user_account WHERE name=?", name):
        raise ValueError("a user named %s exists" % name)
    token = secrets.token_urlsafe(24)
    uid = "u-" + db.slugify(name, "user")
    n = 2
    while db.one("SELECT id FROM user_account WHERE id=?", uid):
        uid, n = "u-%s-%d" % (db.slugify(name, "user"), n), n + 1
    titles = body.get("titles") or ""
    if isinstance(titles, list):
        titles = ", ".join(titles)
    db.ex("INSERT INTO user_account(id, name, email, role, token_hash, created_at, titles) VALUES (?,?,?,?,?,?,?)",
          uid, name, str(body.get("email") or ""), role, _hash(token), db.now(), ", ".join(_titles(titles)))
    out = user_public(db.one("SELECT * FROM user_account WHERE id=?", uid))
    out["token"] = token
    return out


# ---------------------------------------------------------------- sign-offs

def signoffs(target):
    return [{"title": r["title"], "approver": r["approver"], "decision": r["decision"], "note": r["note"], "at": r["created_at"]}
            for r in db.q("SELECT * FROM approval WHERE target=? ORDER BY id", target)]


def holders(title):
    """Active users who hold a sign-off title (or every title, '*')."""
    out = []
    for r in db.q("SELECT * FROM user_account WHERE disabled=0"):
        t = _titles(r["titles"])
        if title in t or "*" in t:
            out.append(r["name"])
    return out


def may_sign(user, title):
    """Who may sign under a title: its holders; an admin or the open-mode local user always; and when nobody
    holds the title at all, any lead (so a missing title can never deadlock a run)."""
    if not user:
        return False
    t = user.get("titles") or []
    if "*" in t or title in t or user.get("role") == "admin":
        return True
    return rank(user.get("role")) >= rank("lead") and not holders(title)


def sign(target, title, user, note="", decision="approved"):
    db.ex("INSERT INTO approval(target, title, approver, decision, note, created_at) VALUES (?,?,?,?,?,?)",
          target, title, user["name"], decision, note or "", db.now())
    audit(user["name"], "sign %s as %s" % (target, title), target.split(":")[0], target.split(":")[1], {"decision": decision, "note": note})


def missing(target, required):
    done = {s["title"] for s in signoffs(target) if s["decision"] == "approved"}
    return [t for t in required if t not in done]


# ---------------------------------------------------------------- environments

def promote(project, env, what, by):
    """Record that `what` (a run's build) now runs in DEV, QAS or PRD."""
    envs = db.jload(project.get("envs_json"), [])
    name = env.upper()
    row = next((e for e in envs if e.get("name") == name), None)
    if not row:
        row = {"name": name, "url": ""}
        envs.append(row)
    row.update(version=what, promotedAt=db.now(), by=by)
    order = {"DEV": 0, "QAS": 1, "PRD": 2}
    envs.sort(key=lambda e: order.get(e.get("name"), 9))
    db.ex("UPDATE project SET envs_json=? WHERE id=?", json.dumps(envs), project["id"])
    audit(by, "promote to %s" % name, "project", project["id"], {"version": what})


def user_email(name):
    r = db.one("SELECT email FROM user_account WHERE name=?", name) if name else None
    return (r or {}).get("email") or ""


def audit(actor, action, entity="", entity_id="", detail=""):
    if not isinstance(detail, str):
        detail = json.dumps(detail, ensure_ascii=False)
    db.ex("INSERT INTO audit(ts, actor, action, entity, entity_id, detail) VALUES (?,?,?,?,?,?)",
          db.now(), actor or "system", action, entity, str(entity_id or ""), detail[:2000])


def audit_page(limit=200, entity=None):
    if entity:
        rows = db.q("SELECT * FROM audit WHERE entity=? ORDER BY id DESC LIMIT ?", entity, limit)
    else:
        rows = db.q("SELECT * FROM audit ORDER BY id DESC LIMIT ?", limit)
    return [{"id": r["id"], "ts": r["ts"], "actor": r["actor"], "action": r["action"], "entity": r["entity"],
             "entityId": r["entity_id"], "detail": r["detail"]} for r in rows]


# ---------------------------------------------------------------- notifications

def notify(kind, text, project_id=None, run_id=None, step_pos=None, recipient="", level=0, kh_project=None):
    """An in-app notification plus a KH message to the recipient's e-mail when there is one."""
    db.ex("INSERT INTO notification(ts, recipient, project_id, run_id, step_pos, kind, level, text) VALUES (?,?,?,?,?,?,?,?)",
          db.now(), recipient or "", project_id, run_id, step_pos, kind, level, text)
    if kh_project:
        email = user_email(recipient)
        kh.message(kh_project, "[SDLC %s] %s" % (kind, text), receiver=email or "all")


def notifications(user, limit=50, unread_only=False):
    name = (user or {}).get("name") or ""
    sql = "SELECT * FROM notification WHERE (recipient='' OR recipient=?)"
    if unread_only:
        sql += " AND read_at IS NULL"
    rows = db.q(sql + " ORDER BY id DESC LIMIT ?", name, limit)
    unread = db.one("SELECT COUNT(*) AS n FROM notification WHERE (recipient='' OR recipient=?) AND read_at IS NULL", name)["n"]
    return {"unread": unread, "items": [{"id": r["id"], "ts": r["ts"], "kind": r["kind"], "level": r["level"], "text": r["text"],
                                         "projectId": r["project_id"], "runId": r["run_id"], "stepPos": r["step_pos"],
                                         "read": bool(r["read_at"])} for r in rows]}


def mark_read(user, ids=None):
    name = (user or {}).get("name") or ""
    if ids:
        for i in ids:
            db.ex("UPDATE notification SET read_at=? WHERE id=? AND read_at IS NULL", db.now(), int(i))
    else:
        db.ex("UPDATE notification SET read_at=? WHERE (recipient='' OR recipient=?) AND read_at IS NULL", db.now(), name)


# ---------------------------------------------------------------- registers

KINDS = {"risk": "R", "action": "A", "issue": "I", "decision": "D", "escalation": "E", "change": "C",
         "defect": "DEF", "lesson": "L"}
STATUSES = ("open", "proposed", "approved", "rejected", "mitigated", "closed")


def risk_category(p, i):
    """Probability x impact (each 1-5) -> category 1 (review daily) .. 4 (review monthly)."""
    s = max(1, min(5, int(p or 1))) * max(1, min(5, int(i or 1)))
    return 1 if s >= 15 else 2 if s >= 8 else 3 if s >= 4 else 4


REVIEW_CADENCE = {1: "daily", 2: "every 2 days", 3: "weekly", 4: "monthly"}


def _next_ref(project_id, kind):
    prefix = KINDS[kind]
    rows = db.q("SELECT ref FROM register_item WHERE project_id=? AND kind=?", project_id, kind)
    n = 0
    for r in rows:
        m = re.match(r"^[A-Z]+-(\d+)$", r["ref"])
        if m:
            n = max(n, int(m.group(1)))
    return "%s-%d" % (prefix, n + 1)


def _person_owner(owner, project, run):
    """A risk or action is owned by a person. The PM agent (or any agent) is never the owner."""
    o = str(owner or "").strip()
    if not o or re.search(r"\bagent\b", o, re.I) or o.lower() in ("pm", "project manager"):
        return (run or {}).get("owner") or (project or {}).get("owner") or ""
    return o


def add_item(project_id, kind, title, detail="", run_id=None, step_run_id=None, owner="", status=None, probability=None,
             impact=None, mitigation="", severity="", due_at=None, link="", created_by=""):
    if kind not in KINDS:
        raise ValueError("kind must be one of " + ", ".join(KINDS))
    title = str(title or "").strip()
    if not title:
        raise ValueError("title is required")
    project = db.project_get(project_id)
    if not project:
        raise KeyError(project_id)
    run = db.run_get(run_id) if run_id else None
    category = None
    if kind == "risk":
        probability = max(1, min(5, int(probability or 3)))
        impact = max(1, min(5, int(impact or 3)))
        category = risk_category(probability, impact)
        if not str(mitigation or "").strip():
            mitigation = "(missing: a mitigation plan is mandatory)"
    if kind in ("risk", "action", "escalation"):
        owner = _person_owner(owner, project, run)
    status = status or ("proposed" if kind in ("decision", "change") else "open")
    ts = db.now()
    for _ in range(3):  # two writers may pick the same ref; the UNIQUE index decides, retry
        ref = _next_ref(project_id, kind)
        try:
            iid = db.ex("INSERT INTO register_item(project_id, run_id, step_run_id, kind, ref, title, detail, owner, status, probability, "
                        "impact, category, mitigation, severity, due_at, link, created_by, created_at, updated_at) "
                        "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                        project_id, run_id, step_run_id, kind, ref, title[:300], str(detail or "")[:4000], owner, status,
                        probability, impact, category, str(mitigation or "")[:2000], str(severity or ""), due_at,
                        str(link or "")[:500], created_by, ts, ts)
            return item_get(iid)
        except Exception as exc:  # noqa: BLE001
            if "UNIQUE" not in str(exc):
                raise
    raise RuntimeError("could not allocate a register reference")


def item_public(r):
    sig = signoffs("item:%d" % r["id"]) if r["kind"] == "change" else []
    return {"signoffs": sig, "id": r["id"], "projectId": r["project_id"], "runId": r["run_id"], "stepRunId": r["step_run_id"], "kind": r["kind"],
            "ref": r["ref"], "title": r["title"], "detail": r["detail"], "owner": r["owner"], "status": r["status"],
            "probability": r["probability"], "impact": r["impact"], "category": r["category"],
            "review": REVIEW_CADENCE.get(r["category"]) if r["category"] else None, "mitigation": r["mitigation"],
            "severity": r["severity"], "dueAt": r["due_at"], "approver": r["approver"], "approvedAt": r["approved_at"],
            "link": r["link"], "createdBy": r["created_by"], "createdAt": r["created_at"], "updatedAt": r["updated_at"]}


def item_get(iid):
    r = db.one("SELECT * FROM register_item WHERE id=?", iid)
    return item_public(r) if r else None


def items(project_id=None, kind=None, status=None, run_id=None, limit=500):
    sql, args = "SELECT * FROM register_item WHERE 1=1", []
    for col, val in (("project_id", project_id), ("kind", kind), ("run_id", run_id)):
        if val not in (None, ""):
            sql += " AND %s=?" % col
            args.append(val)
    if status == "active":
        sql += " AND status IN ('open','proposed','approved')"
    elif status:
        sql += " AND status=?"
        args.append(status)
    sql += " ORDER BY id DESC LIMIT ?"
    args.append(limit)
    return [item_public(r) for r in db.q(sql, *args)]


def update_item(iid, body, actor):
    r = db.one("SELECT * FROM register_item WHERE id=?", iid)
    if not r:
        raise KeyError(iid)
    sets = {}
    for key, col in (("title", "title"), ("detail", "detail"), ("owner", "owner"), ("mitigation", "mitigation"),
                     ("severity", "severity"), ("dueAt", "due_at"), ("link", "link")):
        if key in body:
            sets[col] = body[key]
    if "probability" in body or "impact" in body:
        p = int(body.get("probability", r["probability"]) or 3)
        i = int(body.get("impact", r["impact"]) or 3)
        sets.update(probability=p, impact=i, category=risk_category(p, i))
    if "status" in body:
        st = body["status"]
        if st not in STATUSES:
            raise ValueError("status must be one of " + ", ".join(STATUSES))
        sets["status"] = st
        if st in ("approved", "rejected"):
            sets.update(approver=actor, approved_at=db.now())
    if r["kind"] in ("risk", "action", "escalation") and "owner" in sets:
        project = db.project_get(r["project_id"])
        sets["owner"] = _person_owner(sets["owner"], project, db.run_get(r["run_id"]) if r["run_id"] else None)
    if not sets:
        return item_public(r)
    sets["updated_at"] = db.now()
    db.ex("UPDATE register_item SET %s WHERE id=?" % ", ".join("%s=?" % k for k in sets), *sets.values(), iid)
    return item_get(iid)


def _as_list(v):
    if v is None:
        return []
    return v if isinstance(v, list) else [v]


def _text(x, *keys):
    if isinstance(x, dict):
        for k in keys:
            if x.get(k):
                return str(x[k])
        return json.dumps(x)[:300]
    return str(x)


def _norm(text):
    return re.sub(r"[^a-z0-9]+", " ", str(text or "").lower()).strip()[:120]


def ingest(project, run, step, summary, by):
    """Turn what a step's lead reported at STEP_DONE into register items. Returns the new refs.

    Agents see the run's open items in their prompt but still repeat them step after step; an
    item whose kind and title match one already open in the same run is not filed again."""
    pid, rid, sid = project["id"], run["id"], step["id"]
    seen = {(r["kind"], _norm(r["title"])) for r in db.q(
        "SELECT kind, title FROM register_item WHERE run_id=? AND status IN ('open','proposed','approved')", rid)}
    refs = []

    def _add(pid_, kind, title, **kw):
        key = (kind, _norm(title))
        if key in seen:
            return {"ref": None}
        seen.add(key)
        return add_item(pid_, kind, title, **kw)

    for d in _as_list(summary.get("decisions")):
        refs.append(_add(pid, "decision", _text(d, "title", "decision", "text"),
                         detail=_text(d, "why", "detail") if isinstance(d, dict) else "", run_id=rid, step_run_id=sid,
                         created_by=by)["ref"])
    for x in _as_list(summary.get("risks")):
        x = x if isinstance(x, dict) else {"title": str(x)}
        refs.append(_add(pid, "risk", _text(x, "title", "risk"), detail=x.get("detail") or "", run_id=rid, step_run_id=sid,
                         owner=x.get("owner") or "", probability=x.get("probability"), impact=x.get("impact"),
                         mitigation=x.get("mitigation") or "", created_by=by)["ref"])
    for kind, key in (("action", "actions"), ("issue", "issues"), ("defect", "defects"), ("lesson", "lessons")):
        for x in _as_list(summary.get(key)):
            x = x if isinstance(x, dict) else {"title": str(x)}
            refs.append(_add(pid, kind, _text(x, "title", "text", kind), detail=x.get("detail") or "", run_id=rid,
                             step_run_id=sid, owner=x.get("owner") or "", severity=x.get("severity") or "",
                             due_at=x.get("due") or x.get("dueAt"), link=x.get("file") or x.get("link") or "",
                             created_by=by)["ref"])
    return [r for r in refs if r]


def approve_step_decisions(step_run_id, actor):
    db.ex("UPDATE register_item SET status='approved', approver=?, approved_at=?, updated_at=? "
          "WHERE step_run_id=? AND kind='decision' AND status='proposed'", actor, db.now(), db.now(), step_run_id)


# ---------------------------------------------------------------- scope

def scope_items(run_id):
    return [{"id": r["id"], "ref": r["ref"], "text": r["text"], "acceptance": r["acceptance"], "status": r["status"],
             "evidence": r["evidence"]} for r in db.q("SELECT * FROM scope_item WHERE run_id=? ORDER BY id", run_id)]


def add_scope(run_id, text, acceptance="", ref=None):
    rows = db.q("SELECT ref FROM scope_item WHERE run_id=?", run_id)
    if not ref or any(r["ref"] == ref for r in rows):
        n = 0
        for r in rows:
            m = re.match(r"^S(\d+)$", r["ref"])
            if m:
                n = max(n, int(m.group(1)))
        ref = "S%d" % (n + 1)
    db.ex("INSERT INTO scope_item(run_id, ref, text, acceptance, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
          run_id, ref, str(text)[:1000], str(acceptance or "")[:1000], "open", db.now(), db.now())
    return ref


def ingest_scope(run_id, summary):
    """The intake's signed-off scope: [{"id":"S1","text":..,"acceptance":..}]. A repeated intake replaces open items."""
    scope = _as_list(summary.get("scope"))
    if not scope:
        return []
    db.ex("DELETE FROM scope_item WHERE run_id=? AND status='open'", run_id)
    refs = []
    for s in scope:
        s = s if isinstance(s, dict) else {"text": str(s)}
        ref = str(s.get("id") or s.get("ref") or "").strip() or None
        refs.append(add_scope(run_id, _text(s, "text", "item", "title"), s.get("acceptance") or "", ref))
    return refs


def apply_trace(run_id, summary):
    """A test step's trace: [{"scope":"S1","test":"tests/test_x.py::t","passed":true}]. Returns unmet refs."""
    for t in _as_list(summary.get("trace")):
        if not isinstance(t, dict):
            continue
        ref = str(t.get("scope") or t.get("ref") or "").strip()
        if not ref:
            continue
        status = "met" if t.get("passed") else "not_met"
        db.ex("UPDATE scope_item SET status=?, evidence=?, updated_at=? WHERE run_id=? AND ref=? AND status!='dropped'",
              status, str(t.get("test") or "")[:500], db.now(), run_id, ref)
    return [s["ref"] for s in scope_items(run_id) if s["status"] in ("open", "not_met")]


def update_scope(run_id, ref, body):
    sets = {}
    for key in ("text", "acceptance", "status", "evidence"):
        if key in body:
            if key == "status" and body[key] not in ("open", "met", "not_met", "dropped"):
                raise ValueError("bad scope status")
            sets[key] = str(body[key])
    if sets:
        sets["updated_at"] = db.now()
        db.ex("UPDATE scope_item SET %s WHERE run_id=? AND ref=?" % ", ".join("%s=?" % k for k in sets), *sets.values(), run_id, ref)
    return scope_items(run_id)


# ---------------------------------------------------------------- verification

def verify_tests(project, summary, timeout):
    """Run the test command in the project folder. The project's own command wins over the agent's."""
    tests = summary.get("tests") if isinstance(summary.get("tests"), dict) else {}
    command = (project.get("test_command") or "").strip() or str(tests.get("command") or "").strip()
    if not command:
        return {"command": "", "ran": False, "passed": False, "exit": None,
                "output": "no test command: set one on the project or report tests.command"}
    t0 = time.time()
    try:
        p = subprocess.run(command, shell=True, cwd=project["folder"], capture_output=True, text=True, timeout=timeout,
                           encoding="utf-8", errors="replace", creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        out = ((p.stdout or "") + "\n" + (p.stderr or "")).strip()
        res = {"command": command, "ran": True, "passed": p.returncode == 0, "exit": p.returncode, "output": out[-3000:]}
    except subprocess.TimeoutExpired:
        res = {"command": command, "ran": True, "passed": False, "exit": None, "output": "timed out after %ds" % timeout}
    res["seconds"] = round(time.time() - t0, 1)
    res["claimed"] = tests.get("passed") if tests else None
    return res


# ---------------------------------------------------------------- health

ORDER = {"green": 0, "amber": 1, "red": 2}


def _worst(a, b):
    return a if ORDER[a] >= ORDER[b] else b


def run_health(run, spent=None, st=None):
    """R/A/G of one run (a run_public dict) with the reasons, plus earned-vs-burn."""
    st = st or settings()
    rag, why = "green", []
    status = run["status"]
    steps = run.get("steps") or []
    main = [s for s in steps if s["status"] != "skipped"]
    done = sum(1 for s in main if s["status"] in ("done", "rework"))
    earned = done / len(main) if main else 0
    spent = db.spent_run(run["id"]) if spent is None else spent
    burn = (spent / run["budgetUsd"]) if run.get("budgetUsd") else None
    if status == "cancelled":
        return {"rag": "green", "reasons": ["cancelled"], "earned": earned, "burn": burn, "spent": spent}
    if status == "failed":
        rag, why = "red", why + ["a step failed"]
    if status == "paused":
        rag = _worst(rag, "red" if run.get("statusReason") == "budget" else "amber")
        why.append("paused" + (" (budget reached)" if run.get("statusReason") == "budget" else ""))
    ladder = st["ladderMinutes"]
    for s in steps:
        if s["status"] in ("waiting_human", "awaiting_approval") and s.get("waitingSince"):
            m = db.minutes_since(s["waitingSince"])
            if m >= ladder[2]:
                rag = _worst(rag, "red")
                why.append("'%s' waited %d min for a person (escalated)" % (s["groupName"], m))
            elif m >= ladder[0]:
                rag = _worst(rag, "amber")
                why.append("'%s' waiting %d min for a person" % (s["groupName"], m))
    if status not in ("done",) and run.get("dueAt"):
        late = -db.minutes_since(run["dueAt"])  # positive = time left
        if late < 0:
            over = -late
            rag = _worst(rag, "red" if over > max(30, 0.25 * (run.get("estimateMin") or 60)) else "amber")
            why.append("past its due time by %d min" % over)
    if burn is not None:
        var = (earned - burn) * 100
        if burn >= 1 and status != "done":
            rag = _worst(rag, "red")
            why.append("budget spent (%.0f%%) before the work is done" % (burn * 100))
        elif var < -st["burnRedPct"]:
            rag = _worst(rag, "red")
            why.append("burn ahead of progress by %.0f points" % -var)
        elif var < -st["burnAmberPct"]:
            rag = _worst(rag, "amber")
            why.append("burn ahead of progress by %.0f points" % -var)
    if any(s.get("forced") for s in steps if s["status"] in ("done", "awaiting_approval")):
        rag = _worst(rag, "amber")
        why.append("a step summary was forced")
    esc = db.one("SELECT COUNT(*) AS n FROM register_item WHERE run_id=? AND kind='escalation' AND status='open'", run["id"])["n"]
    if esc:
        rag = _worst(rag, "red")
        why.append("%d open escalation(s)" % esc)
    hi = db.one("SELECT COUNT(*) AS n FROM register_item WHERE run_id=? AND kind='risk' AND category=1 AND status='open'", run["id"])["n"]
    if hi:
        rag = _worst(rag, "amber")
        why.append("%d category-1 risk(s) open" % hi)
    if status == "done":
        unmet = db.one("SELECT COUNT(*) AS n FROM scope_item WHERE run_id=? AND status IN ('open','not_met')", run["id"])["n"]
        if unmet:
            rag = _worst(rag, "amber")
            why.append("%d scope item(s) not traced to a passing test" % unmet)
    return {"rag": rag, "reasons": why, "earned": round(earned, 3), "burn": None if burn is None else round(burn, 3),
            "spent": round(spent, 4)}


def project_health(pub, st=None):
    st = st or settings()
    rag, why = "green", []
    runs = {}
    for r in pub["runs"]:
        h = run_health(r, st=st)
        runs[str(r["id"])] = h
        if r["status"] in ("done", "cancelled"):
            continue
        if ORDER[h["rag"]] > 0:
            why.append("#%d %s: %s" % (r["id"], r["title"], "; ".join(h["reasons"])))
        rag = _worst(rag, h["rag"])
    spent = db.spent_project(pub["id"])
    if pub.get("budgetUsd"):
        if spent >= pub["budgetUsd"]:
            rag = _worst(rag, "red")
            why.append("project budget spent ($%.2f of $%.2f)" % (spent, pub["budgetUsd"]))
        elif spent >= 0.8 * pub["budgetUsd"]:
            rag = _worst(rag, "amber")
            why.append("80%% of the project budget spent ($%.2f of $%.2f)" % (spent, pub["budgetUsd"]))
    return {"rag": rag, "reasons": why[:8], "runs": runs, "spent": round(spent, 4)}


def counts(project_id):
    rows = db.q("SELECT kind, COUNT(*) AS n FROM register_item WHERE project_id=? AND status IN ('open','proposed') GROUP BY kind",
                project_id)
    return {r["kind"]: r["n"] for r in rows}


def portfolio():
    st = settings()
    out = []
    for p in db.q("SELECT * FROM project ORDER BY created_at DESC"):
        pub = db.project_public(p)
        h = project_health(pub, st)
        waiting = sum(1 for r in pub["runs"] if r["status"] == "waiting_human")
        out.append({"id": p["id"], "name": p["name"], "owner": p["owner"], "rag": h["rag"], "reasons": h["reasons"],
                    "total": pub["total"], "completed": pub["completed"], "doing": pub["doing"], "failed": pub["failed"],
                    "waiting": waiting, "spent": h["spent"], "budgetUsd": p["budget_usd"], "open": counts(p["id"])})
    return out


# ---------------------------------------------------------------- lessons for prompts

def lessons_for(project_id, limit=6):
    own = db.q("SELECT ref, title, project_id FROM register_item WHERE kind='lesson' AND project_id=? ORDER BY id DESC LIMIT ?",
               project_id, limit)
    other = db.q("SELECT ref, title, project_id FROM register_item WHERE kind='lesson' AND project_id!=? ORDER BY id DESC LIMIT ?",
                 project_id, max(0, limit - len(own)))
    return own + other


def open_items_for_run(run_id, limit=12):
    return db.q("SELECT ref, kind, title, owner, status FROM register_item WHERE run_id=? AND status IN ('open','proposed') "
                "AND kind IN ('risk','action','issue','change','defect') ORDER BY id DESC LIMIT ?", run_id, limit)


# ---------------------------------------------------------------- attachments and Jira

MAX_ATTACH = 15 * 1024 * 1024


def save_attachment(run, project, name, data_b64, by):
    name = re.sub(r"[^A-Za-z0-9._ -]+", "_", os.path.basename(str(name or "file"))).strip() or "file"
    try:
        data = base64.b64decode(data_b64 or "", validate=False)
    except (ValueError, TypeError):
        raise ValueError("the file is not valid base64")
    if not data:
        raise ValueError("empty file")
    if len(data) > MAX_ATTACH:
        raise ValueError("file is larger than 15 MB")
    folder = os.path.join(project["folder"], ".sdlc", run["slug"], "attachments")
    os.makedirs(folder, exist_ok=True)
    path = os.path.join(folder, name)
    base, ext = os.path.splitext(path)
    n = 2
    while os.path.exists(path):
        path, n = "%s-%d%s" % (base, n, ext), n + 1
    with open(path, "wb") as f:
        f.write(data)
    db.ex("INSERT INTO attachment(run_id, name, path, size, created_by, created_at) VALUES (?,?,?,?,?,?)",
          run["id"], os.path.basename(path), path, len(data), by, db.now())
    return {"name": os.path.basename(path), "path": path, "size": len(data)}


def attachments(run_id):
    return [{"id": r["id"], "name": r["name"], "path": r["path"], "size": r["size"], "createdBy": r["created_by"],
             "createdAt": r["created_at"]} for r in db.q("SELECT * FROM attachment WHERE run_id=? ORDER BY id", run_id)]


def jira_fetch(base, key):
    """Read one Jira issue (read-only). Auth from JIRA_EMAIL + JIRA_TOKEN (cloud) or JIRA_PAT (server)."""
    base = (base or os.environ.get("JIRA_BASE") or "").rstrip("/")
    if not base:
        raise ValueError("no Jira base URL: set it on the project (Jira base) or in JIRA_BASE")
    if not re.match(r"^[A-Z][A-Z0-9_]+-\d+$", key or ""):
        raise ValueError("a Jira key looks like ABC-123")
    headers = {"Accept": "application/json"}
    if os.environ.get("JIRA_PAT"):
        headers["Authorization"] = "Bearer " + os.environ["JIRA_PAT"]
    elif os.environ.get("JIRA_EMAIL") and os.environ.get("JIRA_TOKEN"):
        raw = ("%s:%s" % (os.environ["JIRA_EMAIL"], os.environ["JIRA_TOKEN"])).encode()
        headers["Authorization"] = "Basic " + base64.b64encode(raw).decode()
    else:
        raise ValueError("no Jira credentials: set JIRA_EMAIL and JIRA_TOKEN (or JIRA_PAT) for the server")
    url = "%s/rest/api/2/issue/%s?fields=summary,description,status,priority,issuetype" % (base, key)
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=20) as r:
            data = json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        raise ValueError("Jira answered %s for %s" % (exc.code, key))
    except (urllib.error.URLError, OSError) as exc:
        raise ValueError("Jira is unreachable: %s" % exc)
    f = data.get("fields") or {}
    return {"key": key, "url": "%s/browse/%s" % (base, key), "summary": f.get("summary") or "",
            "description": f.get("description") or "", "status": (f.get("status") or {}).get("name") or "",
            "priority": (f.get("priority") or {}).get("name") or "", "type": (f.get("issuetype") or {}).get("name") or ""}


# ---------------------------------------------------------------- the ticker: ladder, slip, digest

def tick(wake):
    """Called every minute by engine's ticker thread. Never raises."""
    st = settings()
    try:
        _ladder(st)
    except Exception:  # noqa: BLE001
        log.exception("ladder tick failed")
    try:
        _slip()
    except Exception:  # noqa: BLE001
        log.exception("slip tick failed")
    try:
        _digest(st)
    except Exception:  # noqa: BLE001
        log.exception("digest tick failed")
    try:
        import plan
        plan.client_reminders(notify)
    except Exception:  # noqa: BLE001
        log.exception("plan reminders failed")


LEVEL_TEXT = {1: "nudge", 2: "owner told", 3: "escalated"}


def _ladder(st):
    ladder = st["ladderMinutes"]
    rows = db.q("SELECT s.*, r.title, r.owner AS run_owner, r.project_id, r.id AS rid FROM step_run s JOIN run r ON r.id=s.run_id "
                "WHERE s.status IN ('waiting_human','awaiting_approval') AND s.waiting_since IS NOT NULL AND r.status='waiting_human'")
    for s in rows:
        waited = db.minutes_since(s["waiting_since"])
        level = sum(1 for m in ladder if waited >= m)
        if level <= s["nudge_level"]:
            continue
        project = db.project_get(s["project_id"])
        what = "approval" if s["status"] == "awaiting_approval" else "an answer"
        text = "Run #%d '%s', step %d '%s' has waited %d min for %s." % (s["rid"], s["title"], s["position"], s["group_name"],
                                                                         waited, what)
        if level >= 1 and s["nudge_level"] < 1:
            notify("waiting", text, project["id"], s["rid"], s["position"], recipient=s["run_owner"], level=1,
                   kh_project=project["kh_project"])
        if level >= 2 and s["nudge_level"] < 2:
            notify("waiting", text + " (owner of the project told)", project["id"], s["rid"], s["position"],
                   recipient=project["owner"] or s["run_owner"], level=2, kh_project=project["kh_project"])
        if level >= 3 and s["nudge_level"] < 3:
            item = add_item(project["id"], "escalation", "Step '%s' of run #%d stalled waiting for %s" % (s["group_name"], s["rid"], what),
                            detail=text, run_id=s["rid"], step_run_id=s["id"], owner=project["owner"] or s["run_owner"],
                            created_by="SDLC")
            notify("escalation", "%s escalated: %s" % (item["ref"], text), project["id"], s["rid"], s["position"], level=3,
                   kh_project=project["kh_project"])
            kh.add_log(project["kh_project"], db.run_get(s["rid"])["slug"], "[sdlc] %s ESCALATION %s: %s" % (
                time.strftime("%Y-%m-%d"), item["ref"], text))
        db.ex("UPDATE step_run SET nudge_level=? WHERE id=?", level, s["id"])
        db.add_message(s["id"], "system", "SDLC", "Reminder (%s): %s" % (LEVEL_TEXT[level], text))


def _slip():
    for r in db.q("SELECT * FROM run WHERE status IN ('pending','running','waiting_human') AND due_at IS NOT NULL"):
        if db.minutes_since(r["due_at"]) <= 0:
            continue
        key = "slip-%d" % r["id"]
        if _mark(key):
            continue
        _set_mark(key, db.now())
        project = db.project_get(r["project_id"])
        notify("slip", "Run #%d '%s' passed its due time (%s)." % (r["id"], r["title"], r["due_at"]), project["id"], r["id"],
               recipient=r["owner"], level=1, kh_project=project["kh_project"])


def _digest(st):
    """Once a day after digestHour: one line per project that moved in the last 24 h (the cadence check-in)."""
    today = datetime.now().strftime("%Y-%m-%d")
    if datetime.now().hour < int(st["digestHour"]) or _mark("digest") == today:
        return
    _set_mark("digest", today)
    since = db.ts_plus(-24 * 60)
    for p in db.q("SELECT * FROM project"):
        moved = db.q("SELECT s.group_name, r.title, s.status FROM step_run s JOIN run r ON r.id=s.run_id "
                     "WHERE r.project_id=? AND s.finished_at>=?", p["id"], since)
        waiting = db.q("SELECT id, title FROM run WHERE project_id=? AND status='waiting_human'", p["id"])
        opened = db.q("SELECT ref, title FROM register_item WHERE project_id=? AND created_at>=? AND kind IN ('risk','issue','escalation','defect')",
                      p["id"], since)
        if not moved and not waiting and not opened:
            continue
        pub = db.project_public(p)
        h = project_health(pub, st)
        text = "Daily digest %s, %s: health %s; %d step(s) finished; %d run(s) waiting for a person; new: %s." % (
            today, p["name"], h["rag"].upper(), len(moved), len(waiting), ", ".join(o["ref"] for o in opened) or "none")
        notify("digest", text, p["id"], recipient=p["owner"], kh_project=p["kh_project"])
        kh.add_log(p["kh_project"], "daily-digest", "[sdlc] " + text)

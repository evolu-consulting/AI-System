"""SQLite store for the SDLC tool: admin config plus runtime state.

WAL plus a long busy timeout, the same choice Slaves/Workflow made after a
'database is locked' killed a handler: readers never block on the engine's
writers and a writer waits rather than dying.

A PROCESS IS FROZEN PER RUN. create_run() copies the workflow version, every
group's settings and every agent's model/args/prompt into run.process_json, and
the engine reads the step's group from there. Editing the admin config later
changes new runs only (the PM App rule: editing a template never changes the
projects already created from it). Agent secrets (env) are not copied; they are
read live so a rotated token still works.
"""

import json
import os
import re
import sqlite3
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
DB = os.environ.get("SDLC_DB") or os.path.join(HERE, "sdlc.db")
SCHEMA = os.path.join(HERE, "schema.sql")

ACTIVE_RUN = ("pending", "running", "waiting_human", "paused")


def now():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_ts(text):
    try:
        return datetime.strptime(text, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    except (TypeError, ValueError):
        return None


def ts_plus(minutes, base=None):
    t = parse_ts(base) if base else datetime.now(timezone.utc)
    return (t + timedelta(minutes=minutes)).strftime("%Y-%m-%dT%H:%M:%SZ")


def minutes_since(text):
    t = parse_ts(text)
    if not t:
        return 0
    return (datetime.now(timezone.utc) - t).total_seconds() / 60


def con():
    c = sqlite3.connect(DB, timeout=30, isolation_level=None)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA journal_mode=WAL")
    c.execute("PRAGMA busy_timeout=30000")
    return c


# Columns added after the first release: (table, column, declaration).
MIGRATIONS = [
    ("agent", "deleted_at", "TEXT"),
    ("grp", "lane", "TEXT NOT NULL DEFAULT 'dev'"),
    ("grp", "role", "TEXT NOT NULL DEFAULT 'work'"),
    ("grp", "approval", "INTEGER NOT NULL DEFAULT 0"),
    ("grp", "verify_tests", "INTEGER NOT NULL DEFAULT 0"),
    ("grp", "estimate_min", "INTEGER NOT NULL DEFAULT 10"),
    ("grp", "deleted_at", "TEXT"),
    ("workflow", "version", "INTEGER NOT NULL DEFAULT 1"),
    ("workflow", "deleted_at", "TEXT"),
    ("project", "owner", "TEXT NOT NULL DEFAULT ''"),
    ("project", "budget_usd", "REAL NOT NULL DEFAULT 0"),
    ("project", "test_command", "TEXT NOT NULL DEFAULT ''"),
    ("project", "jira_base", "TEXT NOT NULL DEFAULT ''"),
    ("project", "template_id", "TEXT NOT NULL DEFAULT ''"),
    ("run", "owner", "TEXT NOT NULL DEFAULT ''"),
    ("run", "created_by", "TEXT NOT NULL DEFAULT ''"),
    ("run", "priority", "INTEGER NOT NULL DEFAULT 3"),
    ("run", "due_at", "TEXT"),
    ("run", "estimate_min", "INTEGER NOT NULL DEFAULT 0"),
    ("run", "budget_usd", "REAL NOT NULL DEFAULT 0"),
    ("run", "external_key", "TEXT NOT NULL DEFAULT ''"),
    ("run", "epic", "TEXT NOT NULL DEFAULT ''"),
    ("run", "depends_on", "INTEGER"),
    ("run", "process_json", "TEXT"),
    ("run", "status_reason", "TEXT NOT NULL DEFAULT ''"),
    ("run", "rerun_from_node", "TEXT"),
    ("step_run", "node_id", "TEXT NOT NULL DEFAULT ''"),
    ("step_run", "attempt", "INTEGER NOT NULL DEFAULT 1"),
    ("step_run", "lane", "TEXT NOT NULL DEFAULT 'dev'"),
    ("step_run", "role", "TEXT NOT NULL DEFAULT 'work'"),
    ("step_run", "waiting_since", "TEXT"),
    ("step_run", "nudge_level", "INTEGER NOT NULL DEFAULT 0"),
    ("step_run", "verify_json", "TEXT"),
    ("step_run", "verdict", "TEXT"),
    ("step_run", "approved_by", "TEXT"),
    ("step_run", "approved_at", "TEXT"),
    ("step_run", "approval_note", "TEXT"),
    ("grp", "approvers_json", "TEXT NOT NULL DEFAULT '[]'"),
    ("grp", "env", "TEXT NOT NULL DEFAULT ''"),
    ("project", "client_contact", "TEXT NOT NULL DEFAULT ''"),
    ("project", "holidays_json", "TEXT NOT NULL DEFAULT '[]'"),
    ("project", "envs_json", "TEXT NOT NULL DEFAULT '[]'"),
    ("user_account", "titles", "TEXT NOT NULL DEFAULT ''"),
]


def migrate(c):
    for table, col, decl in MIGRATIONS:
        cols = {r[1] for r in c.execute("PRAGMA table_info(%s)" % table)}
        if cols and col not in cols:
            c.execute("ALTER TABLE %s ADD COLUMN %s %s" % (table, col, decl))


def init_db():
    with open(SCHEMA, encoding="utf-8") as f:
        sql = f.read()
    c = con()
    try:
        # Tables first (a new index may name a column that only migrate() adds).
        tables = ";".join(s for s in sql.split(";") if "CREATE INDEX" not in s)
        c.executescript(tables)
        migrate(c)
        c.executescript(";".join(s for s in sql.split(";") if "CREATE INDEX" in s) + ";")
    finally:
        c.close()


def slugify(text, fallback="item"):
    s = re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-")
    return s[:40].strip("-") or fallback


def q(sql, *args):
    c = con()
    try:
        return [dict(r) for r in c.execute(sql, args).fetchall()]
    finally:
        c.close()


def one(sql, *args):
    rows = q(sql, *args)
    return rows[0] if rows else None


def ex(sql, *args):
    c = con()
    try:
        cur = c.execute(sql, args)
        return cur.lastrowid
    finally:
        c.close()


def jload(text, default):
    if text is None or text == "":
        return default
    try:
        return json.loads(text)
    except (TypeError, ValueError):
        return default


# ---------------------------------------------------------------- agents

def mask(value):
    v = str(value or "")
    if not v:
        return ""
    return "*****" + v[-3:] if len(v) > 6 else "*****"


def agent_public(row):
    if not row:
        return None
    env = jload(row["env_json"], {})
    return {
        "id": row["id"],
        "name": row["name"],
        "llmType": row["llm_type"],
        "model": row["model"],
        "args": jload(row["args_json"], []),
        "env": [{"name": k, "hint": mask(v)} for k, v in env.items()],
        "tools": jload(row["tools_json"], None),
        "rolePrompt": row["role_prompt"],
        "updatedAt": row["updated_at"],
    }


def agents():
    return [agent_public(r) for r in q("SELECT * FROM agent WHERE deleted_at IS NULL ORDER BY rowid")]


def agent_row(aid):
    return one("SELECT * FROM agent WHERE id=? AND deleted_at IS NULL", aid)


def save_agent(aid, body):
    """Upsert. Env values that come back empty or as the mask keep the stored value."""
    existing = agent_row(aid) if aid else None
    if not aid:
        base = "a-" + slugify(body.get("name"), "agent")
        aid, n = base, 2
        while one("SELECT id FROM agent WHERE id=?", aid):
            aid, n = "%s-%d" % (base, n), n + 1
    old_env = jload(existing["env_json"], {}) if existing else {}
    env = {}
    for item in body.get("env") or []:
        name = str(item.get("name") or "").strip()
        if not name:
            continue
        val = item.get("value")
        if val is None or val == "" or str(val).startswith("*****"):
            if name in old_env:
                env[name] = old_env[name]
            continue
        env[name] = str(val)
    tools = body.get("tools")
    ts = now()
    vals = (
        str(body.get("name") or (existing or {}).get("name") or "Agent"),
        str(body.get("llmType") or "claude-cli"),
        str(body.get("model") or "sonnet"),
        json.dumps([str(a) for a in (body.get("args") or [])]),
        json.dumps(env),
        None if tools is None else json.dumps(list(tools)),
        str(body.get("rolePrompt") or ""),
    )
    if existing:
        ex("UPDATE agent SET name=?, llm_type=?, model=?, args_json=?, env_json=?, tools_json=?, role_prompt=?, updated_at=? WHERE id=?",
           *vals, ts, aid)
    else:
        ex("DELETE FROM agent WHERE id=? AND deleted_at IS NOT NULL", aid)
        ex("INSERT INTO agent(name, llm_type, model, args_json, env_json, tools_json, role_prompt, created_at, updated_at, id) VALUES (?,?,?,?,?,?,?,?,?,?)",
           *vals, ts, ts, aid)
    return agent_public(agent_row(aid))


def delete_agent(aid):
    ex("DELETE FROM group_agent WHERE agent_id=?", aid)
    ex("UPDATE agent SET deleted_at=? WHERE id=?", now(), aid)


# ---------------------------------------------------------------- groups

LANES = ("pm", "dev")
ROLES = ("intake", "plan", "blueprint", "work", "review", "test", "uat", "cutover", "release", "hypercare", "close")
ENVS = ("", "dev", "qas", "prd")


def group_public(row):
    if not row:
        return None
    ids = [r["agent_id"] for r in q("SELECT agent_id FROM group_agent WHERE group_id=? ORDER BY position", row["id"])]
    return {
        "id": row["id"], "name": row["name"], "slug": row["slug"], "goal": row["goal"],
        "workspace": row["workspace"], "humanGate": bool(row["human_gate"]),
        "maxRounds": row["max_rounds"], "agentIds": ids, "updatedAt": row["updated_at"],
        "lane": row["lane"], "role": row["role"], "approval": bool(row["approval"]),
        "verifyTests": bool(row["verify_tests"]), "estimateMin": row["estimate_min"],
        "approvers": jload(row["approvers_json"], []), "env": row["env"],
    }


def groups():
    return [group_public(r) for r in q("SELECT * FROM grp WHERE deleted_at IS NULL ORDER BY rowid")]


def group_get(gid):
    return group_public(one("SELECT * FROM grp WHERE id=? AND deleted_at IS NULL", gid))


def save_group(gid, body):
    existing = one("SELECT * FROM grp WHERE id=? AND deleted_at IS NULL", gid) if gid else None
    name = str(body.get("name") or (existing or {}).get("name") or "Group")
    if not gid:
        base = "g-" + slugify(name, "group")
        gid, n = base, 2
        while one("SELECT id FROM grp WHERE id=?", gid):
            gid, n = "%s-%d" % (base, n), n + 1
    slug = (existing or {}).get("slug") or slugify(name, gid)
    if not existing:
        base, n = slug, 2
        while one("SELECT id FROM grp WHERE slug=?", slug):
            slug, n = "%s-%d" % (base, n), n + 1
    old = group_public(existing) if existing else {}

    def pick(key, default):
        return body[key] if key in body else old.get(key, default)

    lane = pick("lane", "dev")
    role = pick("role", "work")
    if lane not in LANES:
        raise ValueError("lane must be one of " + ", ".join(LANES))
    if role not in ROLES:
        raise ValueError("role must be one of " + ", ".join(ROLES))
    env = pick("env", "") or ""
    if env not in ENVS:
        raise ValueError("env must be dev, qas or prd")
    approvers = [str(a).strip().lower() for a in (pick("approvers", []) or []) if str(a).strip()]
    ts = now()
    vals = (name, str(pick("goal", "")),
            str(pick("workspace", "") or "{project_folder}\\.sdlc\\{run_slug}\\{group_slug}"),
            1 if pick("humanGate", False) else 0, int(pick("maxRounds", 2) or 2),
            lane, role, 1 if pick("approval", False) else 0, 1 if pick("verifyTests", False) else 0,
            max(1, int(pick("estimateMin", 10) or 10)))
    vals = vals + (json.dumps(approvers), env)
    if existing:
        ex("UPDATE grp SET name=?, goal=?, workspace=?, human_gate=?, max_rounds=?, lane=?, role=?, approval=?, "
           "verify_tests=?, estimate_min=?, approvers_json=?, env=?, updated_at=? WHERE id=?", *vals, ts, gid)
    else:
        ex("INSERT INTO grp(name, goal, workspace, human_gate, max_rounds, lane, role, approval, verify_tests, estimate_min, "
           "approvers_json, env, created_at, updated_at, id, slug) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", *vals, ts, ts, gid, slug)
    if "agentIds" in body:
        ex("DELETE FROM group_agent WHERE group_id=?", gid)
        for i, aid in enumerate(body.get("agentIds") or []):
            if agent_row(aid):
                ex("INSERT OR IGNORE INTO group_agent(group_id, agent_id, position) VALUES (?,?,?)", gid, aid, i)
    return group_get(gid)


def delete_group(gid):
    ex("UPDATE grp SET deleted_at=?, slug=slug || '~' || ? WHERE id=?", now(), str(int(datetime.now().timestamp())), gid)


# ---------------------------------------------------------------- workflows

def workflow_public(row):
    if not row:
        return None
    return {"id": row["id"], "name": row["name"], "kind": row["kind"], "version": row["version"],
            "doc": jload(row["doc_json"], {"nodes": [], "edges": []}), "updatedAt": row["updated_at"]}


def workflows():
    return [workflow_public(r) for r in q("SELECT * FROM workflow WHERE deleted_at IS NULL ORDER BY rowid")]


def workflow_get(wid):
    return workflow_public(one("SELECT * FROM workflow WHERE id=? AND deleted_at IS NULL", wid))


def workflow_versions(wid):
    return [{"version": r["version"], "name": r["name"], "createdAt": r["created_at"], "createdBy": r["created_by"]}
            for r in q("SELECT * FROM workflow_version WHERE workflow_id=? ORDER BY version DESC", wid)]


def process_of(doc, groups_by_id=None):
    """The steps of a workflow document, or raise ValueError.

    Arrows of kind "next" (the default) must form ONE straight main path: a
    single start, at most one next-arrow in and out per step. Arrows of kind
    "rework" go BACK from a step to an earlier one on that path: when that
    step's verdict is fail (review rejects, tests fail, UAT refuses) the run
    re-does the steps from the target through the failing one. A step has at
    most one rework arrow.

    Returns {"order": [node ids on the main path], "nodes": {id: node}, "rework": {from: to}}.
    """
    nodes = {n["id"]: n for n in (doc.get("nodes") or [])}
    if not nodes:
        raise ValueError("the workflow has no steps")
    out, inc, rework = {}, {}, {}
    for e in doc.get("edges") or []:
        s, t = e.get("source"), e.get("target")
        if s not in nodes or t not in nodes:
            continue
        if (e.get("kind") or "next") == "rework":
            if s in rework:
                raise ValueError("a step has two rework arrows; keep one")
            rework[s] = t
            continue
        if s in out:
            raise ValueError("a step has two outgoing arrows; the main path is one straight chain (use a rework arrow to go back)")
        if t in inc:
            raise ValueError("a step has two incoming arrows; the main path is one straight chain (use a rework arrow to go back)")
        out[s], inc[t] = t, s
    roots = [nid for nid in nodes if nid not in inc]
    if len(roots) != 1:
        raise ValueError("connect every step into one chain (found %d starting steps)" % len(roots))
    order, cur, seen = [], roots[0], set()
    while cur and cur not in seen:
        seen.add(cur)
        order.append(cur)
        cur = out.get(cur)
    if len(order) != len(nodes):
        raise ValueError("connect every step into one chain")
    for s, t in rework.items():
        if order.index(t) >= order.index(s):
            raise ValueError("a rework arrow must go back to an earlier step")
    # Separation of duty: a review step must not be led by the agent that led the work it reviews.
    if groups_by_id is not None:
        last_work_lead = None
        for nid in order:
            g = groups_by_id.get(nodes[nid]["groupId"])
            if not g:
                continue
            lead = (g.get("agentIds") or [None])[0]
            if g.get("role") == "review" and lead and lead == last_work_lead:
                raise ValueError("'%s' reviews work led by the same agent; a reviewer must be a different agent" % g["name"])
            if g.get("role") == "work":
                last_work_lead = lead
    return {"order": order, "nodes": nodes, "rework": rework}


def chain(doc):
    """The ordered group ids of the main path (kept for callers that only need the order)."""
    p = process_of(doc)
    return [p["nodes"][n]["groupId"] for n in p["order"]]


def save_workflow(wid, body, actor=""):
    existing = one("SELECT * FROM workflow WHERE id=? AND deleted_at IS NULL", wid) if wid else None
    name = str(body.get("name") or (existing or {}).get("name") or "Workflow")
    doc = body.get("doc") or {"nodes": [], "edges": []}
    if doc.get("nodes"):
        process_of(doc, {g["id"]: g for g in groups()})
    if not wid:
        base = "wf-" + slugify(name, "workflow")
        wid, n = base, 2
        while one("SELECT id FROM workflow WHERE id=?", wid):
            wid, n = "%s-%d" % (base, n), n + 1
    ts = now()
    kind = "bugfix" if body.get("kind") == "bugfix" else "feature"
    if existing:
        version = (existing["version"] or 1) + 1
        ex("UPDATE workflow SET name=?, kind=?, doc_json=?, updated_at=?, version=? WHERE id=?",
           name, kind, json.dumps(doc), ts, version, wid)
    else:
        version = 1
        ex("DELETE FROM workflow WHERE id=? AND deleted_at IS NOT NULL", wid)
        ex("INSERT INTO workflow(id, name, kind, doc_json, created_at, updated_at, version) VALUES (?,?,?,?,?,?,?)",
           wid, name, kind, json.dumps(doc), ts, ts, version)
    ex("INSERT OR REPLACE INTO workflow_version(workflow_id, version, name, kind, doc_json, created_at, created_by) VALUES (?,?,?,?,?,?,?)",
       wid, version, name, kind, json.dumps(doc), ts, actor)
    return workflow_get(wid)


def delete_workflow(wid):
    ex("UPDATE workflow SET deleted_at=? WHERE id=?", now(), wid)


# ---------------------------------------------------------------- templates

def template_public(r):
    return {"id": r["id"], "name": r["name"], "description": r["description"], "workflowId": r["workflow_id"],
            "testCommand": r["test_command"], "budgetUsd": r["budget_usd"], "updatedAt": r["updated_at"]}


def templates():
    return [template_public(r) for r in q("SELECT * FROM template ORDER BY rowid")]


def template_get(tid):
    r = one("SELECT * FROM template WHERE id=?", tid)
    return template_public(r) if r else None


def save_template(tid, body):
    existing = one("SELECT * FROM template WHERE id=?", tid) if tid else None
    name = str(body.get("name") or (existing or {}).get("name") or "Template")
    if not tid:
        base = "tpl-" + slugify(name, "template")
        tid, n = base, 2
        while one("SELECT id FROM template WHERE id=?", tid):
            tid, n = "%s-%d" % (base, n), n + 1
    ts = now()
    vals = (name, str(body.get("description") or ""), str(body.get("workflowId") or "wf-new-system"),
            str(body.get("testCommand") or ""), float(body.get("budgetUsd") or 0))
    if existing:
        ex("UPDATE template SET name=?, description=?, workflow_id=?, test_command=?, budget_usd=?, updated_at=? WHERE id=?",
           *vals, ts, tid)
    else:
        ex("INSERT INTO template(name, description, workflow_id, test_command, budget_usd, created_at, updated_at, id) "
           "VALUES (?,?,?,?,?,?,?,?)", *vals, ts, ts, tid)
    return template_get(tid)


def delete_template(tid):
    ex("DELETE FROM template WHERE id=?", tid)


# ---------------------------------------------------------------- projects / runs

def project_get(pid):
    return one("SELECT * FROM project WHERE id=?", pid)


def create_project(name, folder, owner="", budget_usd=0, test_command="", jira_base="", template_id=""):
    slug = slugify(name, "project")
    base, n = slug, 2
    while one("SELECT id FROM project WHERE slug=?", slug):
        slug, n = "%s-%d" % (base, n), n + 1
    pid = "p-" + slug
    ex("INSERT INTO project(id, name, slug, folder, kh_project, created_at, owner, budget_usd, test_command, jira_base, template_id) "
       "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
       pid, name, slug, folder, "sdlc-" + slug, now(), owner, float(budget_usd or 0), test_command, jira_base, template_id)
    return project_get(pid)


def update_project(pid, body):
    p = project_get(pid)
    if not p:
        raise KeyError(pid)
    fields = {"name": "name", "owner": "owner", "budgetUsd": "budget_usd", "testCommand": "test_command", "jiraBase": "jira_base",
              "clientContact": "client_contact", "holidays": "holidays_json", "envs": "envs_json"}
    for key, col in fields.items():
        if key in body:
            if col == "budget_usd":
                val = float(body[key] or 0)
            elif col.endswith("_json"):
                val = json.dumps(body[key] or [])
            else:
                val = str(body[key] or "").strip()
            if col == "name" and not val:
                raise ValueError("name is required")
            ex("UPDATE project SET %s=? WHERE id=?" % col, val, pid)
    return project_get(pid)


def snapshot(wf):
    """Freeze the process a run will follow: the workflow version, each step's group and its agents."""
    gs = {g["id"]: g for g in groups()}
    proc = process_of(wf["doc"], gs)
    nodes = []
    for nid in proc["order"]:
        gid = proc["nodes"][nid]["groupId"]
        g = gs.get(gid)
        if not g:
            raise ValueError("workflow step points at a deleted group " + gid)
        agents_ = [agent_public(agent_row(a)) for a in g["agentIds"] if agent_row(a)]
        for a in agents_:
            a.pop("env", None)
        nodes.append({"id": nid, "group": g, "agents": agents_})
    return {"workflowId": wf["id"], "workflowName": wf["name"], "version": wf.get("version") or 1,
            "kind": wf["kind"], "nodes": nodes, "rework": proc["rework"]}


def proc_node(process, node_id):
    for n in (process or {}).get("nodes") or []:
        if n["id"] == node_id:
            return n
    return None


def create_run(project_id, workflow_id, title, owner="", created_by="", priority=3, due_at=None, budget_usd=0,
               external_key="", epic="", depends_on=None, process=None):
    wf = workflow_get(workflow_id)
    if not wf:
        raise ValueError("unknown workflow " + str(workflow_id))
    process = process or snapshot(wf)
    if depends_on and not run_get(int(depends_on)):
        raise ValueError("depends on an unknown run #%s" % depends_on)
    base = slugify(title, "run")
    slug, n = base, 2
    while one("SELECT id FROM run WHERE project_id=? AND slug=?", project_id, slug):
        slug, n = "%s-%d" % (base, n), n + 1
    estimate = sum(int(nd["group"].get("estimateMin") or 10) for nd in process["nodes"])
    # Baseline: the estimate plus half again for waiting on people; an explicit due date wins.
    due = due_at or ts_plus(int(estimate * 1.5))
    rid = ex("INSERT INTO run(project_id, workflow_id, workflow_name, kind, title, slug, status, current_pos, created_at, owner, "
             "created_by, priority, due_at, estimate_min, budget_usd, external_key, epic, depends_on, process_json) "
             "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
             project_id, workflow_id, wf["name"], wf["kind"], title, slug, "pending", 1, now(), owner, created_by,
             max(1, min(5, int(priority or 3))), due, estimate, float(budget_usd or 0), external_key, epic,
             int(depends_on) if depends_on else None, json.dumps(process))
    for i, nd in enumerate(process["nodes"], 1):
        g = nd["group"]
        ex("INSERT INTO step_run(run_id, position, group_id, group_name, group_slug, status, node_id, lane, role) VALUES (?,?,?,?,?,?,?,?,?)",
           rid, i, g["id"], g["name"], g["slug"], "pending", nd["id"], g.get("lane") or "dev", g.get("role") or "work")
    return rid


def run_get(rid):
    return one("SELECT * FROM run WHERE id=?", rid)


def run_process(run):
    return jload(run.get("process_json"), None) if run else None


def steps_of(rid):
    return q("SELECT * FROM step_run WHERE run_id=? ORDER BY position", rid)


def insert_rework(rid, from_node, through_node, after_pos, reason):
    """Re-do the main-path steps from_node..through_node right after position after_pos.

    Later steps shift down so positions stay unique and in order. Returns the
    position of the first new step. The reason is the first line the re-done
    step sees, so the agents know what failed.
    """
    run = run_get(rid)
    process = run_process(run)
    order = [n["id"] for n in process["nodes"]]
    i0, i1 = order.index(from_node), order.index(through_node)
    block = process["nodes"][i0:i1 + 1]
    k = len(block)
    c = con()
    try:
        c.execute("BEGIN IMMEDIATE")
        # Two passes so UNIQUE(run_id, position) never sees a clash mid-update.
        c.execute("UPDATE step_run SET position=-(position+?) WHERE run_id=? AND position>?", (k, rid, after_pos))
        c.execute("UPDATE step_run SET position=-position WHERE run_id=? AND position<0", (rid,))
        ids = []
        for j, nd in enumerate(block):
            g = nd["group"]
            attempt = (c.execute("SELECT COALESCE(MAX(attempt),0) FROM step_run WHERE run_id=? AND node_id=?",
                                 (rid, nd["id"])).fetchone()[0]) + 1
            cur = c.execute("INSERT INTO step_run(run_id, position, group_id, group_name, group_slug, status, node_id, lane, role, attempt) "
                            "VALUES (?,?,?,?,?,?,?,?,?,?)",
                            (rid, after_pos + 1 + j, g["id"], g["name"], g["slug"], "pending", nd["id"],
                             g.get("lane") or "dev", g.get("role") or "work", attempt))
            ids.append(cur.lastrowid)
        c.execute("COMMIT")
    except Exception:
        c.execute("ROLLBACK")
        raise
    finally:
        c.close()
    add_message(ids[0], "system", "SDLC", "Rework: " + reason)
    return after_pos + 1


def append_rerun(rid, from_node, reason):
    """Re-run a finished run from from_node to the end of its main path."""
    process = run_process(run_get(rid))
    last = one("SELECT MAX(position) AS p FROM step_run WHERE run_id=?", rid)["p"] or 0
    return insert_rework(rid, from_node, process["nodes"][-1]["id"], last, reason)


def step_public(s):
    return {"id": s["id"], "position": s["position"], "groupId": s["group_id"], "groupName": s["group_name"],
            "groupSlug": s["group_slug"], "status": s["status"], "startedAt": s["started_at"],
            "finishedAt": s["finished_at"], "summary": jload(s["summary_json"], None),
            "forced": bool(s["forced"]), "error": s["error"], "nodeId": s["node_id"], "attempt": s["attempt"],
            "lane": s["lane"], "role": s["role"], "waitingSince": s["waiting_since"], "nudgeLevel": s["nudge_level"],
            "verify": jload(s["verify_json"], None), "verdict": s["verdict"], "approvedBy": s["approved_by"],
            "approvedAt": s["approved_at"], "approvalNote": s["approval_note"]}


def run_public(r, with_steps=True):
    process = run_process(r)
    out = {"id": r["id"], "projectId": r["project_id"], "workflowId": r["workflow_id"],
           "workflowName": r["workflow_name"], "kind": r["kind"], "title": r["title"], "slug": r["slug"],
           "status": r["status"], "currentPos": r["current_pos"], "createdAt": r["created_at"],
           "finishedAt": r["finished_at"], "owner": r["owner"], "createdBy": r["created_by"], "priority": r["priority"],
           "dueAt": r["due_at"], "estimateMin": r["estimate_min"], "budgetUsd": r["budget_usd"],
           "externalKey": r["external_key"], "epic": r["epic"], "dependsOn": r["depends_on"],
           "statusReason": r["status_reason"], "workflowVersion": (process or {}).get("version"),
           "rework": (process or {}).get("rework") or {}}
    if with_steps:
        out["steps"] = [step_public(s) for s in steps_of(r["id"])]
    return out


def project_public(p, with_runs=True):
    runs = [run_public(r) for r in q("SELECT * FROM run WHERE project_id=? ORDER BY id", p["id"])] if with_runs else []
    counts = {k: 0 for k in ("done", "failed", "cancelled", "doing")}
    for r in runs:
        counts[r["status"] if r["status"] in ("done", "failed", "cancelled") else "doing"] += 1
    return {"id": p["id"], "name": p["name"], "slug": p["slug"], "folder": p["folder"],
            "khProject": p["kh_project"], "createdAt": p["created_at"], "owner": p["owner"], "budgetUsd": p["budget_usd"],
            "testCommand": p["test_command"], "jiraBase": p["jira_base"], "templateId": p["template_id"],
            "clientContact": p["client_contact"], "holidays": jload(p["holidays_json"], []), "envs": jload(p["envs_json"], []),
            "total": len(runs) - counts["cancelled"], "completed": counts["done"], "doing": counts["doing"],
            "failed": counts["failed"], "cancelled": counts["cancelled"], "runs": runs}


def projects_page(page, per):
    total = one("SELECT COUNT(*) AS n FROM project")["n"]
    pages = max(1, (total + per - 1) // per)
    page = min(max(1, page), pages)
    rows = q("SELECT * FROM project ORDER BY created_at DESC LIMIT ? OFFSET ?", per, (page - 1) * per)
    return {"items": [project_public(p) for p in rows], "page": page, "pages": pages, "per": per, "total": total}


def messages(step_run_id, after=0):
    return [{"seq": m["seq"], "senderKind": m["sender_kind"], "senderName": m["sender_name"],
             "agentId": m["agent_id"], "content": m["content"], "createdAt": m["created_at"]}
            for m in q("SELECT * FROM message WHERE step_run_id=? AND seq>? ORDER BY seq", step_run_id, after)]


def add_message(step_run_id, kind, name, content, agent_id=None):
    c = con()
    try:
        c.execute("BEGIN IMMEDIATE")
        seq = (c.execute("SELECT COALESCE(MAX(seq),0) FROM message WHERE step_run_id=?", (step_run_id,)).fetchone()[0]) + 1
        c.execute("INSERT INTO message(step_run_id, seq, sender_kind, sender_name, agent_id, content, created_at) VALUES (?,?,?,?,?,?,?)",
                  (step_run_id, seq, kind, name, agent_id, content, now()))
        c.execute("COMMIT")
        return seq
    except Exception:
        c.execute("ROLLBACK")
        raise
    finally:
        c.close()


# ---------------------------------------------------------------- token usage

def usage_start(run_id, step_run_id, agent_id, model):
    ts = now()
    return ex("INSERT INTO llm_call(run_id, step_run_id, agent_id, model, started_at, updated_at) VALUES (?,?,?,?,?,?)",
              run_id, step_run_id, agent_id, model or "", ts, ts)


def usage_set(call_id, t):
    """t is llm.UsageMeter.totals(): the call's running total, so this overwrites, never adds."""
    ex("UPDATE llm_call SET model=?, input_tokens=?, output_tokens=?, cache_write_tokens=?, cache_read_tokens=?, "
       "cost_usd=?, final=?, updated_at=? WHERE id=?",
       t.get("model") or "", int(t["input"]), int(t["output"]), int(t["cacheWrite"]), int(t["cacheRead"]),
       float(t["costUsd"]), 1 if t.get("final") else 0, now(), call_id)


USAGE_SUM = ("COALESCE(SUM(c.input_tokens),0) AS i, COALESCE(SUM(c.output_tokens),0) AS o, "
             "COALESCE(SUM(c.cache_write_tokens),0) AS w, COALESCE(SUM(c.cache_read_tokens),0) AS r, "
             "COALESCE(SUM(c.cost_usd),0) AS usd, COUNT(c.id) AS calls")


def _usage(row):
    tokens = row["i"] + row["o"] + row["w"] + row["r"]
    return {"tokens": tokens, "input": row["i"], "output": row["o"], "cacheWrite": row["w"], "cacheRead": row["r"],
            "costUsd": round(row["usd"], 4), "calls": row["calls"]}


def usage(project_ids):
    """Token and cost totals per project and per run, for the given projects."""
    out = {"projects": {}, "runs": {}}
    for pid in project_ids:
        if not project_get(pid):
            continue
        out["projects"][pid] = _usage(one("SELECT %s FROM llm_call c JOIN run r ON r.id=c.run_id WHERE r.project_id=?" % USAGE_SUM, pid))
        for row in q("SELECT r.id AS rid, %s FROM run r LEFT JOIN llm_call c ON c.run_id=r.id WHERE r.project_id=? GROUP BY r.id" % USAGE_SUM, pid):
            out["runs"][str(row["rid"])] = _usage(row)
    return out


def spent_run(rid):
    return one("SELECT COALESCE(SUM(cost_usd),0) AS usd FROM llm_call WHERE run_id=?", rid)["usd"]


def spent_project(pid):
    return one("SELECT COALESCE(SUM(c.cost_usd),0) AS usd FROM llm_call c JOIN run r ON r.id=c.run_id WHERE r.project_id=?", pid)["usd"]

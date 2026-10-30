"""SQLite (or HANA, see app/sqldb.py) store for the policy action / sub-action table.

Lives in the SAME database as hook_rules (config.HOOKS_DB_PATH) - KH's own deterministic
store - because the table's consumer is the UserPromptSubmit hook. Chroma's sqlite file is
deliberately not used: that schema belongs to a third-party library.

Two tables, both namespaced and independent of hook_rules:

    policy_actions(project, action, description, source_policy, priority, updated_at)
        PRIMARY KEY (project, action)
    policy_rules(project, action, sub_action, seq, clauses, content, updated_at)
        PRIMARY KEY (project, action, sub_action)

`project` (fen 2026-08-21) scopes a policy the same way the rest of v6.4 does. A rule that
belongs to one codebase carries that project's id; a rule that belongs to no project in
particular, or applies to all of them, carries the literal sentinel **'every project'**
(EVERY below). Reads resolve the tiers in _scope: the caller's PERSONAL project, then the
project, then EVERY; the most specific row WINS for the same (action, sub_action) - identical
precedence to the vector policy tier, so a project or one person can override one step of a
common action without copying the rest.

`description` is the when-to-use line an agent READS to choose a label (it is never
embedded - that is the whole point). `seq` orders the sub-actions of one action into the
sequence the work is actually performed in. `clauses` records which numbered clauses of the
source policy body a row carries, so a migration can be proved lossless.

Unknown labels are a LOUD failure everywhere: the API answers 404 UNKNOWN-ACTION / NO-RULE
rather than serving the nearest neighbour. 'No action fits' is a valid answer.
"""
from __future__ import annotations

import threading
import time
from typing import Any

from app import sqldb

_LOCK = threading.Lock()

#: Sentinel project for rules that belong to no single project, or to all of them.
EVERY = "every project"


def _conn():
    return sqldb.connect()


def _scope(project: str | None) -> list[str]:
    """Projects a read consults, most specific first: the caller's personal project, then the project, then EVERY.

    The personal tier (fen 2026-10-27, kernel rule 10): a person's own rule (project = their personal project id,
    which only they may write) wins over the project and the common tier for the same (action, sub_action); where
    they have none, the common rows apply. Only the signed-in caller's own tier is read, never someone else's."""
    from app import personal
    tiers = [personal.own_id(), project if project and project != EVERY else None, EVERY]
    return list(dict.fromkeys(t for t in tiers if t))


def init() -> None:
    """Create both tables if absent, then migrate a pre-`project` table in place.

    Safe on every startup; never drops data. The v6.5.0 tables had PRIMARY KEY (action,
    sub_action) with no project column; SQLite cannot alter a primary key, so the migration
    rebuilds each table and copies every existing row in as an 'every project' row - which is
    what those rows were, since both seeded families came from the orchestrator-common tier.
    """
    with _LOCK, _conn() as c:
        sqldb.create_table(
            c, "policy_actions",
            """
            CREATE TABLE IF NOT EXISTS policy_actions (
                project       TEXT NOT NULL DEFAULT 'every project',
                action        TEXT NOT NULL,
                description   TEXT NOT NULL,
                source_policy TEXT NOT NULL DEFAULT '',
                priority      INTEGER NOT NULL DEFAULT 100,
                updated_at    TEXT NOT NULL,
                PRIMARY KEY (project, action)
            )
            """,
            """
            CREATE COLUMN TABLE policy_actions (
                project       NVARCHAR(256) NOT NULL DEFAULT 'every project',
                action        NVARCHAR(256) NOT NULL,
                description   NCLOB         NOT NULL,
                source_policy NVARCHAR(256) NOT NULL DEFAULT '',
                priority      INTEGER       NOT NULL DEFAULT 100,
                updated_at    NVARCHAR(32)  NOT NULL,
                PRIMARY KEY (project, action)
            )
            """,
        )
        sqldb.create_table(
            c, "policy_rules",
            """
            CREATE TABLE IF NOT EXISTS policy_rules (
                project    TEXT NOT NULL DEFAULT 'every project',
                action     TEXT NOT NULL,
                sub_action TEXT NOT NULL,
                seq        INTEGER NOT NULL DEFAULT 0,
                clauses    TEXT NOT NULL DEFAULT '',
                content    TEXT NOT NULL,
                updated_at TEXT NOT NULL DEFAULT '',
                PRIMARY KEY (project, action, sub_action)
            )
            """,
            """
            CREATE COLUMN TABLE policy_rules (
                project    NVARCHAR(256) NOT NULL DEFAULT 'every project',
                action     NVARCHAR(256) NOT NULL,
                sub_action NVARCHAR(256) NOT NULL,
                seq        INTEGER       NOT NULL DEFAULT 0,
                clauses    NVARCHAR(256) NOT NULL DEFAULT '',
                content    NCLOB         NOT NULL,
                updated_at NVARCHAR(32)  NOT NULL DEFAULT '',
                PRIMARY KEY (project, action, sub_action)
            )
            """,
        )
        _migrate_add_project(c)
        sqldb.create_index(c, "ix_policy_rules_action", "policy_rules", "project, action, seq")
        # How often each plan is fetched (2026-10-04): the lint report lists actions nobody loads.
        sqldb.create_table(
            c, "policy_usage",
            """
            CREATE TABLE IF NOT EXISTS policy_usage (
                project    TEXT NOT NULL,
                action     TEXT NOT NULL,
                fetches    INTEGER NOT NULL DEFAULT 0,
                last_fetch TEXT NOT NULL DEFAULT '',
                PRIMARY KEY (project, action)
            )
            """,
            """
            CREATE COLUMN TABLE policy_usage (
                project    NVARCHAR(256) NOT NULL,
                action     NVARCHAR(256) NOT NULL,
                fetches    INTEGER       NOT NULL DEFAULT 0,
                last_fetch NVARCHAR(32)  NOT NULL DEFAULT '',
                PRIMARY KEY (project, action)
            )
            """,
        )


def _columns(c, table: str) -> list[str]:
    return [r[1] for r in c.execute("PRAGMA table_info(%s)" % table)]


def _migrate_add_project(c) -> None:
    """Rebuild either table if it predates the project column, copying rows as EVERY.

    SQLite only: a HANA table is always created with the project column, so there is
    no pre-project table to migrate there.
    """
    if sqldb.is_hana():
        return
    for table, cols, pk in (
        ("policy_actions",
         "project, action, description, source_policy, priority, updated_at",
         "PRIMARY KEY (project, action)"),
        ("policy_rules",
         "project, action, sub_action, seq, clauses, content, updated_at",
         "PRIMARY KEY (project, action, sub_action)"),
    ):
        if "project" in _columns(c, table):
            continue
        old_cols = [x for x in _columns(c, table) if x != "project"]
        c.execute("ALTER TABLE %s RENAME TO %s_pre_project" % (table, table))
        if table == "policy_actions":
            c.execute("""CREATE TABLE policy_actions (
                           project       TEXT NOT NULL DEFAULT 'every project',
                           action        TEXT NOT NULL,
                           description   TEXT NOT NULL,
                           source_policy TEXT NOT NULL DEFAULT '',
                           priority      INTEGER NOT NULL DEFAULT 100,
                           updated_at    TEXT NOT NULL,
                           PRIMARY KEY (project, action))""")
        else:
            c.execute("""CREATE TABLE policy_rules (
                           project    TEXT NOT NULL DEFAULT 'every project',
                           action     TEXT NOT NULL,
                           sub_action TEXT NOT NULL,
                           seq        INTEGER NOT NULL DEFAULT 0,
                           clauses    TEXT NOT NULL DEFAULT '',
                           content    TEXT NOT NULL,
                           updated_at TEXT NOT NULL DEFAULT '',
                           PRIMARY KEY (project, action, sub_action))""")
        c.execute("INSERT INTO %s (project, %s) SELECT ?, %s FROM %s_pre_project"
                  % (table, ", ".join(old_cols), ", ".join(old_cols), table),
                  (EVERY,))
        c.execute("DROP TABLE %s_pre_project" % table)


def _now() -> str:
    return time.strftime("%Y-%m-%d %H:%M:%S")


# --------------------------------------------------------------------------- reads

def list_actions(project: str | None = None) -> list[dict[str, Any]]:
    """Actions visible to a project: its own, plus every-project ones it does not override."""
    scope = _scope(project)
    seen: dict[str, dict[str, Any]] = {}
    with _conn() as c:
        for p in scope:                              # most specific first wins
            for r in c.execute("SELECT * FROM policy_actions WHERE project=? "
                               "ORDER BY priority DESC, action", (p,)):
                seen.setdefault(r["action"], dict(r))
    return sorted(seen.values(), key=lambda a: (-a["priority"], a["action"]))


def action_names(project: str | None = None) -> list[str]:
    return sorted({a["action"] for a in list_actions(project)})


def sub_actions(action: str, project: str | None = None) -> list[dict[str, Any]]:
    return [{k: r[k] for k in ("sub_action", "seq", "clauses", "project")}
            for r in plan(action, project)]


def get_rule(action: str, sub_action: str, project: str | None = None) -> dict[str, Any] | None:
    """One rule. A project-specific row shadows the every-project row of the same key."""
    with _conn() as c:
        for p in _scope(project):
            r = c.execute("SELECT * FROM policy_rules WHERE project=? AND action=? "
                          "AND sub_action=?", (p, action, sub_action)).fetchone()
            if r:
                return dict(r)
    return None


def plan(action: str, project: str | None = None) -> list[dict[str, Any]]:
    """Every rule for an action, in step order, with per-project rows overriding common ones."""
    merged: dict[str, dict[str, Any]] = {}
    with _conn() as c:
        for p in _scope(project):
            for r in c.execute("SELECT * FROM policy_rules WHERE project=? AND action=? "
                               "ORDER BY seq, sub_action", (p, action)):
                merged.setdefault(r["sub_action"], dict(r))
    return sorted(merged.values(), key=lambda r: (r["seq"], r["sub_action"]))


def has_action(action: str, project: str | None = None) -> bool:
    with _conn() as c:
        for p in _scope(project):
            if c.execute("SELECT 1 FROM policy_actions WHERE project=? AND action=?",
                         (p, action)).fetchone():
                return True
    return False


def menu(project: str | None = None) -> list[dict[str, Any]]:
    """The menu an agent picks from: each action, its when-to-use line, its sub-actions."""
    out = []
    for a in list_actions(project):
        a = dict(a)
        a["sub_actions"] = [s["sub_action"] for s in sub_actions(a["action"], project)]
        out.append(a)
    return out


def menu_text(project: str | None = None) -> str:
    """The menu as plain text, ready to inject into a hook."""
    lines = []
    for a in menu(project):
        lines.append("  - ACTION '%s' [project: %s] - when: %s"
                     % (a["action"], a["project"], a["description"]))
        lines.append("    sub-actions in order: %s" % " -> ".join(a["sub_actions"]))
    lines.append("  - If no action fits, answer none and proceed. Never invent a label.")
    return "\n".join(lines)


def projects() -> list[dict[str, Any]]:
    """Which projects own rows, and how many - EVERY included."""
    with _conn() as c:
        return [dict(r) for r in c.execute(
            "SELECT project, count(*) AS rules FROM policy_rules GROUP BY project "
            "ORDER BY project")]


def stats() -> dict[str, Any]:
    with _conn() as c:
        return {
            "db": sqldb.location(),
            "actions": c.execute("SELECT count(*) FROM policy_actions").fetchone()[0],
            "rules": c.execute("SELECT count(*) FROM policy_rules").fetchone()[0],
            "every_project_sentinel": EVERY,
        }


# -------------------------------------------------------------------------- writes

def set_action(action: str, description: str, source_policy: str = "",
               priority: int = 100, project: str | None = None) -> dict[str, Any]:
    proj = project or EVERY
    with _LOCK, _conn() as c:
        sqldb.upsert(c, "policy_actions", ("project", "action"), {
            "project": proj, "action": action, "description": description,
            "source_policy": source_policy, "priority": int(priority), "updated_at": _now(),
        })
        return dict(c.execute("SELECT * FROM policy_actions WHERE project=? AND action=?",
                              (proj, action)).fetchone())


def set_rule(action: str, sub_action: str, content: str, seq: int = 0,
             clauses: str = "", project: str | None = None) -> dict[str, Any]:
    """Upsert one rule. The action must exist for this project or as an every-project action.

    A project may add a step to a common action without redeclaring the action itself - that
    is the point of the two-tier read - so the check accepts either tier.
    """
    proj = project or EVERY
    if not has_action(action, proj):
        raise KeyError(action)
    with _LOCK, _conn() as c:
        sqldb.upsert(c, "policy_rules", ("project", "action", "sub_action"), {
            "project": proj, "action": action, "sub_action": sub_action,
            "seq": int(seq), "clauses": clauses, "content": content, "updated_at": _now(),
        })
        return dict(c.execute(
            "SELECT * FROM policy_rules WHERE project=? AND action=? AND sub_action=?",
            (proj, action, sub_action)).fetchone())


def record_fetch(action: str, project: str | None = None) -> None:
    """Count one /policy/plan read of ``action`` (best effort: a failed count never fails the read)."""
    proj = project or EVERY
    try:
        with _LOCK, _conn() as c:
            row = c.execute("SELECT fetches FROM policy_usage WHERE project=? AND action=?",
                            (proj, action)).fetchone()
            n = (row[0] if row else 0) + 1
            sqldb.upsert(c, "policy_usage", ("project", "action"),
                         {"project": proj, "action": action, "fetches": n, "last_fetch": _now()})
    except Exception:  # noqa: BLE001 - usage is telemetry
        pass


def usage() -> dict[tuple[str, str], dict[str, Any]]:
    """(project, action) -> {fetches, last_fetch}; the project is the one the reader passed."""
    with _conn() as c:
        return {(r["project"], r["action"]): {"fetches": r["fetches"], "last_fetch": r["last_fetch"]}
                for r in (dict(x) for x in c.execute("SELECT * FROM policy_usage"))}


def all_rows() -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Every action and every rule, all projects - for the lint report."""
    with _conn() as c:
        return ([dict(r) for r in c.execute("SELECT * FROM policy_actions")],
                [dict(r) for r in c.execute("SELECT * FROM policy_rules")])


def clear() -> dict[str, int]:
    """Wipe both tables (every project tier included). Used by a replace-mode bulk seed."""
    with _LOCK, _conn() as c:
        rules = c.execute("DELETE FROM policy_rules").rowcount
        actions = c.execute("DELETE FROM policy_actions").rowcount
    return {"actions": actions, "rules": rules}


def delete_project_rows(project: str) -> dict[str, int]:
    """Drop every action and rule of one project (the project was deleted). Never the common tier."""
    if not project or project == EVERY:
        return {"actions": 0, "rules": 0}
    with _LOCK, _conn() as c:
        rules = c.execute("DELETE FROM policy_rules WHERE project=?", (project,)).rowcount
        actions = c.execute("DELETE FROM policy_actions WHERE project=?", (project,)).rowcount
    return {"actions": actions, "rules": rules}


def delete_rule(action: str, sub_action: str, project: str | None = None) -> int:
    proj = project or EVERY
    with _LOCK, _conn() as c:
        return c.execute("DELETE FROM policy_rules WHERE project=? AND action=? "
                         "AND sub_action=?", (proj, action, sub_action)).rowcount


def delete_action(action: str, cascade: bool = False,
                  project: str | None = None) -> dict[str, int]:
    """Delete an action from ONE project tier. Refuses while it still owns rules there."""
    proj = project or EVERY
    with _LOCK, _conn() as c:
        n_rules = c.execute("SELECT count(*) FROM policy_rules WHERE project=? AND action=?",
                            (proj, action)).fetchone()[0]
        if n_rules and not cascade:
            raise ValueError("action %r in project %r still has %d rules - pass cascade=true"
                             % (action, proj, n_rules))
        removed_rules = c.execute("DELETE FROM policy_rules WHERE project=? AND action=?",
                                  (proj, action)).rowcount
        removed = c.execute("DELETE FROM policy_actions WHERE project=? AND action=?",
                            (proj, action)).rowcount
    return {"actions": removed, "rules": removed_rules, "project": proj}

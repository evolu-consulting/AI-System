"""Policy action-table API - exact policy routing, no embedding involved.

    GET  /policy/actions?project=            -> the menu (JSON: actions + sub-actions)
    (every `project` parameter accepts an id, an alias or a keyword - see _canon)
    GET  /policy/actions/raw?project=        -> the menu as text/plain, for hook inject
    GET  /policy/plan?action=&project=       -> every rule of one action, in order
    GET  /policy/rule?action=&sub_action=&project=  -> one rule
    GET  /policy/actions/projects            -> which projects own rows, and how many
    POST /policy/action/set  {action, description, project?, source_policy?, priority?}
    POST /policy/rule/set    {action, sub_action, content, project?, seq?, clauses?}
    POST /policy/rule/delete {action, sub_action, project?}
    POST /policy/action/delete {action, project?, cascade?}
    POST /policy/actions/bulk {actions:[...], rules:[...], replace?}   (seed/migrate)

`project` scopes a policy as everywhere else in v6.4. Omit it and the caller sees only the
every-project tier; pass one and the read consults that project FIRST, falling back to
'every project' per (action, sub_action) - so a project can override a single step of a
common action without copying the rest. Writes default to 'every project'.

An unknown label is a 404 carrying UNKNOWN-ACTION plus the list of known labels - never a
nearest-neighbour guess. 'No action fits' is a legitimate answer for the caller.

Sits beside app/policy.py (the semantic tier). Same URL family, different mechanism:
/policy/match guesses by cosine similarity, these routes look a rule up by primary key.
Since 2026-08-21 the semantic route is retired for ROUTING (fen's call) and these routes are
the only policy consulted to decide a deliverable; /policy/match remains a live endpoint.
"""
from __future__ import annotations

import logging

from fastapi import HTTPException, Query
from fastapi.responses import PlainTextResponse

from app import config
from app import projects
from app.policy_actions import lint, store

logger = logging.getLogger(__name__)

PROJECT_Q = Query(None, description="active project id, alias or keyword; omit for the "
                                    "'every project' tier only")


def _canon(project: str | None) -> str | None:
    """Resolve whatever the caller passed into a real project id.

    An agent repeats fen's words, and fen says "con ticketing", not "ticketing-system". The
    manifest already holds exact aliases + keywords per project, so resolution is a literal,
    accent-insensitive lookup (app.projects.canonical_or_none) with no embedder in the path.
    An unknown string is passed through verbatim, so a scope can be written before its project
    is registered - it simply matches nothing until then.
    """
    if not project:
        return None
    # A tier that already owns rows is that tier, even when no project of that id exists any more
    # (a deleted project's leftovers): matching it to a look-alike project by alias would read, write
    # or delete another project's policy (seen 2026-10-13: 'kh-vis-probe' -> 'kh-investigate').
    if project.strip() in {r["project"] for r in store.projects()}:
        return project.strip()
    return projects.canonical_or_none(project) or project.strip()


def _unknown_action(action: str, project: str | None) -> HTTPException:
    return HTTPException(404, {
        "error": "UNKNOWN-ACTION",
        "action": action,
        "project": project or store.EVERY,
        "known_actions": store.action_names(project),
        "hint": "pick a label from GET /policy/actions, or answer none - never guess",
    })


def _only_visible(rows: list[dict], allowed: set[str]) -> list[dict]:
    """Rows whose project the caller may read (sign-in on)."""
    return [r for r in rows if r.get("project") in allowed]


def attach(app) -> None:
    TAG = ["Policy · action table"]
    store.init()

    @app.get("/policy/actions", tags=TAG,
             summary="The action menu an agent picks from (exact routing, no embedding)")
    async def policy_actions(project: str | None = PROJECT_Q):
        proj = _canon(project)
        m = store.menu(proj)
        return {"count": len(m), "project": proj or store.EVERY,
                "requested_project": project, "actions": m, "table": store.stats()}

    @app.get("/policy/lint", tags=TAG,
             summary="Policy and hook budgets, overlapping when-lines, actions nobody fetches")
    async def policy_lint():
        from app.hooks import store as hook_store
        return lint.report(hook_store.list_rules())

    @app.get("/policy/actions/raw", response_class=PlainTextResponse, tags=TAG,
             summary="The action menu as text/plain, for direct injection into a hook")
    async def policy_actions_raw(project: str | None = PROJECT_Q):
        return store.menu_text(_canon(project))

    @app.get("/policy/actions/projects", tags=TAG,
             summary="Which projects own rules in the table, and how many")
    async def policy_actions_projects():
        from app import auth
        rows = store.projects()
        allowed = auth.visible_projects()
        if allowed is not None:
            rows = _only_visible(rows, allowed | {store.EVERY})
        return {"every_project_sentinel": store.EVERY, "projects": rows}

    @app.get("/policy/plan", tags=TAG,
             summary="Every rule of one action, in the order the steps are performed")
    async def policy_plan(action: str = Query(..., description="a label from /policy/actions"),
                          project: str | None = PROJECT_Q):
        proj = _canon(project)
        if not store.has_action(action, proj):
            raise _unknown_action(action, proj)
        rules = store.plan(action, proj)
        store.record_fetch(action, proj)
        return {"action": action, "project": proj or store.EVERY,
                "requested_project": project, "count": len(rules), "rules": rules}

    @app.get("/policy/rule", tags=TAG, summary="One rule, by (action, sub_action)")
    async def policy_rule(action: str = Query(...), sub_action: str = Query(...),
                          project: str | None = PROJECT_Q):
        proj = _canon(project)
        if not store.has_action(action, proj):
            raise _unknown_action(action, proj)
        rule = store.get_rule(action, sub_action, proj)
        if not rule:
            raise HTTPException(404, {
                "error": "NO-RULE",
                "action": action,
                "sub_action": sub_action,
                "project": proj or store.EVERY,
                "sub_actions_of_action": [s["sub_action"]
                                          for s in store.sub_actions(action, proj)],
            })
        return rule

    @app.post("/policy/action/set", tags=TAG, summary="Create or update an action (the menu entry)")
    async def policy_action_set(body: dict):
        action = (body.get("action") or "").strip()
        description = (body.get("description") or "").strip()
        if not action or not description:
            raise HTTPException(400, "action and description required")
        project = _canon(body.get("project"))
        check = lint.check_action(action, description, project)
        refused = lint.gate(check, body)
        if refused:
            raise HTTPException(422, refused)
        row = store.set_action(action, description,
                               source_policy=(body.get("source_policy") or "").strip(),
                               priority=int(body.get("priority", 100)),
                               project=project)
        return {**row, "warnings": check["warnings"]}

    @app.post("/policy/rule/set", tags=TAG, summary="Create or update one (action, sub_action) rule")
    async def policy_rule_set(body: dict):
        action = (body.get("action") or "").strip()
        sub_action = (body.get("sub_action") or "").strip()
        content = body.get("content")
        project = _canon(body.get("project"))
        if not action or not sub_action or not content:
            raise HTTPException(400, "action, sub_action and content required")
        if not store.has_action(action, project):
            raise _unknown_action(action, project)
        check = lint.check_rule(action, sub_action, content, project)
        refused = lint.gate(check, body)
        if refused:
            raise HTTPException(422, refused)
        try:
            row = store.set_rule(action, sub_action, content,
                                 seq=int(body.get("seq", 0)),
                                 clauses=(body.get("clauses") or "").strip(),
                                 project=project)
        except KeyError:
            raise _unknown_action(action, project)
        return {**row, "warnings": check["warnings"]}

    @app.post("/policy/rule/delete", tags=TAG, summary="Delete one rule")
    async def policy_rule_delete(body: dict):
        action = (body.get("action") or "").strip()
        sub_action = (body.get("sub_action") or "").strip()
        if not action or not sub_action:
            raise HTTPException(400, "action and sub_action required")
        return {"deleted": store.delete_rule(action, sub_action,
                                             project=_canon(body.get("project")))}

    @app.post("/policy/action/delete", tags=TAG,
              summary="Delete an action from one project tier (refuses while it owns rules)")
    async def policy_action_delete(body: dict):
        action = (body.get("action") or "").strip()
        if not action:
            raise HTTPException(400, "action required")
        try:
            return store.delete_action(action, cascade=bool(body.get("cascade", False)),
                                       project=_canon(body.get("project")))
        except ValueError as e:
            raise HTTPException(409, str(e))

    @app.post("/policy/actions/bulk", tags=TAG,
              summary="Seed or migrate the whole table in one call")
    async def policy_actions_bulk(body: dict):
        """Upsert many actions + rules at once. replace=true clears the table first.

        Each row may carry its own `project` (default 'every project'). Rules whose
        (project, action) is neither declared in this payload nor already present - in that
        project or in the every-project tier - are rejected as a whole: a partial seed would
        leave the table claiming coverage it does not have.
        """
        actions = body.get("actions") or []
        rules = body.get("rules") or []
        if not actions and not rules:
            raise HTTPException(400, "actions and/or rules required")

        def proj(row):
            return _canon(row.get("project")) or store.EVERY

        declared = {(proj(a), (a.get("action") or "").strip()) for a in actions}
        orphans = sorted(
            "%s/%s" % (p, a) for p, a in
            {(proj(r), (r.get("action") or "").strip()) for r in rules}
            if (p, a) not in declared
            and (store.EVERY, a) not in declared
            and not store.has_action(a, p))
        if orphans:
            raise HTTPException(400, {"error": "UNDECLARED-ACTION", "actions": orphans})

        if bool(body.get("replace", False)):
            store.clear()

        n_a = n_r = 0
        for a in actions:
            store.set_action((a.get("action") or "").strip(),
                             (a.get("description") or "").strip(),
                             source_policy=(a.get("source_policy") or "").strip(),
                             priority=int(a.get("priority", 100)),
                             project=proj(a))
            n_a += 1
        for r in rules:
            store.set_rule((r.get("action") or "").strip(),
                           (r.get("sub_action") or "").strip(),
                           r.get("content") or "",
                           seq=int(r.get("seq", 0)),
                           clauses=(r.get("clauses") or "").strip(),
                           project=proj(r))
            n_r += 1
        logger.info("policy action table bulk upsert - %d actions, %d rules", n_a, n_r)
        return {"actions_upserted": n_a, "rules_upserted": n_r, "table": store.stats()}

    logger.info("Policy action-table routes attached (/policy/actions|plan|rule, db=%s)",
                config.HOOKS_DB_PATH)

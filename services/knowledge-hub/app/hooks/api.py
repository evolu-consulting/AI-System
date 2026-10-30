"""Hook-rules API (additive) — serve FULL plain-text Claude hook policies by type.

Claude Code hooks fetch their governing rules from here at fire time:

    GET  /hooks/get?hook_type=UserPromptSubmit   -> {hook_type, count, content, rules}
    GET  /hooks/raw?hook_type=UserPromptSubmit    -> text/plain (raw, for direct inject)
    POST /hooks/set   {hook_type, content, name?, enabled?, position?}
    GET  /hooks/list  [?hook_type=]
    POST /hooks/delete {id} | {hook_type, name}

Deterministic by design: no embeddings, no regex, no truncation. Editing a rule
is one write; every session/turn then loads the same authoritative full text.
The Claude side hardcodes only WHICH type to fetch — the content lives here.
See app/hooks/store.py.
"""
from __future__ import annotations

import logging

from fastapi import HTTPException, Query
from fastapi.responses import PlainTextResponse

from app import config
from app.hooks import store
from app.policy_actions import lint
# Imported at MODULE level on purpose, not inside the route. PyInstaller resolves
# hidden imports by static analysis, and a module reached only from inside a
# function body can be left out of the frozen bundle - the route would then 500
# in the built exe while working perfectly from source.
from app.hooks import turn as turn_mod

logger = logging.getLogger(__name__)


def attach(app) -> None:
    TAG = ["Hooks · rules"]
    store.init()

    @app.get("/hooks/get", tags=TAG,
             summary="Full rule text for a hook type (JSON: content + per-rule breakdown)")
    async def hooks_get(hook_type: str = Query(..., description="e.g. UserPromptSubmit, SessionStart, PreToolUse, Stop")):
        rules = store.get_rules(hook_type, enabled_only=True)
        return {
            "hook_type": hook_type,
            "count": len(rules),
            "content": lint.render("\n\n".join(r["content"] for r in rules)),
            "rules": rules,
        }

    @app.get("/hooks/raw", response_class=PlainTextResponse, tags=TAG,
             summary="Full rule text for a hook type (text/plain, for direct injection)")
    async def hooks_raw(hook_type: str = Query(...)):
        return lint.render(store.get_text(hook_type))

    @app.post("/hooks/set", tags=TAG,
              summary="Create or replace a rule for a hook type (keyed by hook_type+name)")
    async def hooks_set(body: dict):
        hook_type = (body.get("hook_type") or "").strip()
        content = body.get("content")
        if not hook_type or not content:
            raise HTTPException(400, "hook_type and content required")
        name = (body.get("name") or "default").strip()
        if bool(body.get("enabled", True)):
            check = lint.check_hook(hook_type, name, content, store.get_rules(hook_type, enabled_only=True))
            refused = lint.gate(check, body)
            if refused:
                raise HTTPException(422, refused)
        return store.set_rule(
            hook_type=hook_type,
            content=content,
            name=(body.get("name") or "default").strip(),
            enabled=bool(body.get("enabled", True)),
            position=int(body.get("position", 0)),
        )

    @app.get("/hooks/list", tags=TAG, summary="List rules (optionally filtered by hook type)")
    async def hooks_list(hook_type: str | None = Query(None)):
        rules = store.list_rules(hook_type)
        return {"count": len(rules), "rules": rules}

    @app.post("/hooks/turn_mutated", tags=TAG,
              summary="Did the ending turn change anything? (lets the Stop hook skip read-only turns)")
    async def hooks_turn_mutated(body: dict):
        """Answer the ONE question the Stop hook needs, so it can exit 0 instead of 2.

        Body: ``{transcript_path, prompt_id?}`` — both come straight from the Stop
        hook's own stdin payload (field names verified against a live payload on
        2026-09-07, alongside session_id, permission_mode, effort and
        last_assistant_message).

        Returns ``{mutated, reason, tool_count, how, evidence}``.

        FAIL-SAFE CONTRACT, and the caller must honour its half. This route answers
        ``mutated: true`` on any doubt at all — unreadable transcript, unparseable
        row, unrecognised tool, unclassifiable shell command. The hook must do the
        same for its own failures: if KH is unreachable or the response cannot be
        parsed, treat the turn as MUTATED and exit 2. A read-only verdict is only
        ever safe when it was positively established, because the cost is not
        symmetric — a wrong 'mutated' wastes one model round, a wrong 'read-only'
        silently discards the work log for work that really happened.
        """
        return turn_mod.turn_mutated((body.get("transcript_path") or "").strip(),
                                     (body.get("prompt_id") or "").strip())

    @app.post("/hooks/delete", tags=TAG, summary="Delete a rule by id, or by hook_type+name")
    async def hooks_delete(body: dict):
        try:
            n = store.delete_rule(
                rule_id=body.get("id"),
                hook_type=(body.get("hook_type") or None),
                name=(body.get("name") or None),
            )
        except ValueError as e:
            raise HTTPException(400, str(e))
        return {"deleted": n}

    logger.info("Hook-rules routes attached (/hooks/get|raw|set|list|delete) db=%s",
                config.HOOKS_DB_PATH)

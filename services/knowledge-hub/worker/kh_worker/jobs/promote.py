"""The promote job (kernel rule 10; KH app/promote.py): personal rules many people share -> common-tier proposals.

One call a night: ``GET /promote/next`` gives every person's personalization rows and every project's feedback
rows (owners as aliases), the common tier with its step text and the proposals already made. The model looks
for one rule that several owners keep asking for and writes it as a new text for one step of a common action;
``POST /promote/submit`` checks each proposal (target, at least KH_PROMOTE_MIN_PEOPLE owners, leak gate) and
stores it as proposed in the orchestrator. The worker never approves one: a common rule changes every user's
plan, so a maintainer approves it on ``/distill/pending?project=orchestrator``.

Failures. Two attempts: a model error or an answer that fails the schema check is retried with the reason;
items KH refuses are repaired once with KH's reasons. Dry mode: KH writes nothing; the items and verdicts go to
``kh_people`` as a ``worker.run`` event.
"""
from __future__ import annotations

import json
import logging
from typing import Any

from ..llm import LLMError
from . import data_block, load_prompt, short

log = logging.getLogger("kh_worker.jobs.promote")

ATTEMPTS = 2
TITLE_MAX = 120
TEXT_MAX = 600
INSTRUCTION = ("Review these {n} personal and project feedback rows for rules that belong in the common tier, "
               "following the system prompt. Answer with one JSON object.")


def output_schema(nxt: dict) -> dict:
    actions = sorted({a.get("action") for a in nxt.get("common") or [] if a.get("action")}) or ["-"]
    s = {"type": "string"}
    item = {"type": "object",
            "properties": {"title": s, "text": s, "target_action": {"type": "string", "enum": actions},
                           "target_sub_action": s, "sources": {"type": "array", "items": s}, "why": s},
            "required": ["title", "text", "target_action", "target_sub_action", "sources", "why"],
            "additionalProperties": False}
    return {"type": "object", "properties": {"items": {"type": "array", "items": item}},
            "required": ["items"], "additionalProperties": False}


def check_output(out: Any, nxt: dict) -> tuple[list[dict], list[str]]:
    """Normalise the answer and list what KH would surely refuse."""
    if not isinstance(out, dict) or not isinstance(out.get("items"), list):
        return [], ["the answer must be an object with an 'items' list"]
    rows = {r.get("id"): r for r in nxt.get("rows") or []}
    actions = {a.get("action") for a in nxt.get("common") or []}
    need = int((nxt.get("rules") or {}).get("min_people") or 2)
    items, problems = [], []
    for n, raw in enumerate(out["items"]):
        if not isinstance(raw, dict):
            problems.append(f"item {n}: must be an object")
            continue
        it = {k: (v.strip() if isinstance(v, str) else v) for k, v in raw.items()}
        it["sources"] = list(dict.fromkeys(s for s in it.get("sources") or [] if isinstance(s, str) and s))
        why = []
        if not it.get("title") or len(it["title"]) > TITLE_MAX:
            why.append(f"title is required, at most {TITLE_MAX} characters")
        if not it.get("text") or len(it["text"]) > TEXT_MAX:
            why.append(f"text is required, at most {TEXT_MAX} characters")
        if it.get("target_action") not in actions or not it.get("target_sub_action"):
            why.append("target_action must be a common action, with a target_sub_action")
        unknown = [s for s in it["sources"] if s not in rows]
        if unknown:
            why.append(f"unknown source ids {unknown[:5]}")
        owners = {rows[s].get("owner") for s in it["sources"] if s in rows}
        if len(owners) < need:
            why.append(f"sources come from {len(owners)} owner(s); at least {need} are needed")
        if why:
            problems.append(f"item {n} ('{str(it.get('title') or '')[:60]}'): " + "; ".join(why))
        items.append(it)
    return items, problems


def build_user(nxt: dict) -> str:
    data = {k: nxt.get(k) for k in ("rows", "common", "kernel", "proposals", "rules")}
    return f"{INSTRUCTION.format(n=len(nxt.get('rows') or []))}\n\n{data_block('promote', data)}\n"


def _ask(ctx, system: str, user: str, schema: dict, nxt: dict, state: dict) -> list[dict] | None:
    state["attempts"] += 1
    try:
        res = ctx.llm.complete(system, user, schema, max_tokens=ctx.max_tokens)
    except LLMError as exc:
        state["error"] = f"model: {short(exc)}"
        return None
    state["model"] = res.model
    items, problems = check_output(res.json, nxt)
    if problems:
        state["problems"] = problems
        state["error"] = "schema: " + "; ".join(problems)[:300]
        return None
    return items


def run(ctx) -> dict:
    nxt = ctx.kh.promote_next()
    out: dict[str, Any] = {"rows": len(nxt.get("rows") or []), "items": 0, "results": {}}
    if not nxt.get("rows"):
        out["status"] = "ok"
        return out
    system = load_prompt("promote")
    user = build_user(nxt)
    schema = output_schema(nxt)
    state = {"attempts": 0, "model": "", "problems": [], "error": ""}
    items = None
    while items is None and state["attempts"] < ATTEMPTS:
        if ctx.should_stop():
            out["status"] = "lease_lost"
            return out
        note = ""
        if state["problems"]:
            note = ("\n\nYour previous answer was refused before it reached KH:\n- " + "\n- ".join(state["problems"][:20])
                    + "\nAnswer again with the whole JSON object, corrected.")
        items = _ask(ctx, system, user + note, schema, nxt, state)
    if items is None:
        out.update(status="partial", error=state["error"])
        return out
    body = {"items": [{k: v for k, v in it.items() if k != "why"} for it in items],
            "distilled_by": f"worker:{state['model'] or ctx.llm.model}"}
    resp = ctx.kh.promote_submit(body) if items else {"results": []}
    rejected = [(items[r["n"]], r.get("reason") or "rejected") for r in resp.get("results") or []
                if r.get("result") == "rejected" and isinstance(r.get("n"), int) and r["n"] < len(items)]
    if rejected and not ctx.should_stop():               # one repair with KH's reasons
        lines = [f"- {why}: {json.dumps(it, ensure_ascii=False)}" for it, why in rejected[:20]]
        fixed = _ask(ctx, system, user + "\n\nKH refused these items; the others are stored:\n" + "\n".join(lines)
                     + "\nReturn only corrected versions (an empty 'items' list when one cannot be fixed without "
                       "breaking a rule).", schema, nxt, state)
        if fixed:
            body2 = {"items": [{k: v for k, v in it.items() if k != "why"} for it in fixed],
                     "distilled_by": body["distilled_by"]}
            resp2 = ctx.kh.promote_submit(body2)
            resp = {**resp, "results": (resp.get("results") or []) + (resp2.get("results") or [])}
            items = items + fixed
    for r in resp.get("results") or []:
        k = r.get("result") or "unknown"
        out["results"][k] = out["results"].get(k, 0) + 1
    out["items"] = len(items)
    try:
        ctx.kh.append_event("worker.run", {"job": "promote", "model": state["model"] or ctx.llm.model,
                                           "dry_run": bool(ctx.dry or resp.get("dry_run")), "items": items,
                                           "results": resp.get("results") or []},
                            event_id=f"worker.run:{ctx.kh.run_id}:promote")
    except Exception as exc:  # noqa: BLE001 - the comparison log must not stop the run
        log.warning("promote: worker.run event not written: %s", exc)
    out["status"] = "ok"
    return out

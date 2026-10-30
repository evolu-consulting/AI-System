"""The distil job (design docs/roadmap-e-to-5-design.md 3.3; the loop of docs/distill-design.md, "The command").

For each project: ``GET /distill/next`` -> the model writes items -> ``POST /distill/submit``, until KH has
nothing left past the cursor, a cap stops the run, or the lease is lost. The output schema is the submit body;
the worker adds ``project``, ``batch_id``, ``distilled_by = worker:<model>`` and the batch's ``cost_usd``.

Failures. A batch gets two attempts in all. A model error (transport, refusal, bad JSON) or an answer that
fails the worker's own schema check uses one and is retried with the reason. When KH refuses some items of a
real submit (the batch stays open), the second attempt repairs only those and resends them on the same
``batch_id``. A batch that fails twice is left unsubmitted: KH keeps it, the cursor does not move, the next run
retries it, and this run moves on to the next project (another ``next`` would serve the same logs again).

Dry mode (``ctx.dry``, the default). The client sends every submit with ``dry_run: true``; KH returns the
verdicts, writes nothing and releases the batch, so the cursor never moves and the next ``next`` would serve
the same logs: one batch per project per run. The items and verdicts go to ``kh_people`` as a ``worker.run``
event per batch (KH redacts stored events), for the worker-vs-manual comparison (G2).
"""
from __future__ import annotations

import json
import logging
from typing import Any

from ..budget import BudgetExceeded
from ..khclient import BudgetRefused, KHError
from ..llm import LLMError
from . import data_block, env_int, load_prompt, short

log = logging.getLogger("kh_worker.jobs.distil")

KINDS = ("lesson", "fact", "procedure", "habit", "policy_proposal")      # `pattern` is counted in code by KH
NONE_KEY = "-"
TITLE_MAX = 120
TEXT_MAX = 600
ATTEMPTS = 2
MAX_BATCHES = 50          # per project per run (KH_WORKER_DISTIL_MAX_BATCHES); the run cap usually stops first

INSTRUCTION = ("Distil this batch of project '{project}' (batch {batch_id}, {n} logs) into items, following "
               "the system prompt. Answer with one JSON object.")


# ---------------------------------------------------------------------------------------------- schema
def output_schema(catalog: dict | None) -> dict:
    """The submit body the model writes (items, contexts, signal_words), with the kinds and actions of this
    batch's catalog as closed lists. Lengths are checked in code: structured output does not enforce them."""
    catalog = catalog or {}
    kinds = [k for k in (catalog.get("kinds") or KINDS) if isinstance(k, str) and k != "pattern"] or list(KINDS)
    actions = [NONE_KEY] + sorted({a for a in catalog.get("actions") or [] if isinstance(a, str) and a
                                   and a != NONE_KEY})
    s = {"type": "string"}
    item = {"type": "object",
            "properties": {"kind": {"type": "string", "enum": kinds}, "title": s, "text": s,
                           "action": {"type": "string", "enum": actions}, "context": s,
                           "entities": {"type": "array", "items": s}, "sources": {"type": "array", "items": s},
                           "updates": s, "contradicts": s, "target_action": s, "target_sub_action": s,
                           "share": {"type": "boolean"}},
            "required": ["kind", "title", "text", "action", "context", "entities", "sources"],
            "additionalProperties": False}
    ctx = {"type": "object", "properties": {"tag": s, "description": s}, "required": ["tag", "description"],
           "additionalProperties": False}
    return {"type": "object",
            "properties": {"items": {"type": "array", "items": item},
                           "contexts": {"type": "array", "items": ctx},
                           "signal_words": {"type": "array", "items": s}},
            "required": ["items", "contexts", "signal_words"], "additionalProperties": False}


def _tag(raw: Any) -> str:
    return " ".join(str(raw or "").lower().split()).replace(" ", "-")


def neighbour_ids(neighbours: list) -> set[str]:
    return {str(n).split(" ", 1)[0] for n in neighbours or [] if str(n).strip()}


def check_output(out: Any, nxt: dict) -> tuple[dict, list[str]]:
    """Normalise the model's answer into submit fields and list what KH would surely refuse.

    Returns ``({items, contexts, signal_words}, problems)``. Only problems that are certain are listed (KH
    stays the judge of leaks, duplicates and older sources)."""
    if not isinstance(out, dict) or not isinstance(out.get("items"), list):
        return {}, ["the answer must be an object with an 'items' list"]
    catalog = nxt.get("catalog") or {}
    actions = {a for a in catalog.get("actions") or [] if isinstance(a, str)} | {NONE_KEY}
    tags = {_tag(c.get("tag") if isinstance(c, dict) else c) for c in catalog.get("contexts") or []}
    contexts = []
    for c in out.get("contexts") or []:
        if isinstance(c, dict) and _tag(c.get("tag")):
            contexts.append({"tag": _tag(c["tag"]), "description": str(c.get("description") or "")[:512]})
            tags.add(_tag(c["tag"]))
    words = [w.strip() for w in out.get("signal_words") or [] if isinstance(w, str) and w.strip()]
    neigh = neighbour_ids(nxt.get("neighbours") or [])
    problems: list[str] = []
    items = []
    for n, raw in enumerate(out["items"]):
        if not isinstance(raw, dict):
            problems.append(f"item {n}: must be an object")
            continue
        it = {k: (v.strip() if isinstance(v, str) else v) for k, v in raw.items()}
        for k in ("updates", "contradicts", "target_action", "target_sub_action"):
            if not it.get(k):
                it.pop(k, None)
        it["action"] = it.get("action") or NONE_KEY
        it["context"] = it.get("context") or NONE_KEY
        it["entities"] = [e for e in it.get("entities") or [] if isinstance(e, str) and e.strip()]
        it["sources"] = list(dict.fromkeys(s for s in it.get("sources") or [] if isinstance(s, str) and s))
        it["share"] = it.get("share") is True and it.get("kind") != "policy_proposal"
        why = []
        if it.get("kind") not in KINDS:
            why.append(f"kind must be one of {', '.join(KINDS)}")
        if not it.get("title") or len(it["title"]) > TITLE_MAX:
            why.append(f"title is required, at most {TITLE_MAX} characters (has {len(it.get('title') or '')})")
        if not it.get("text") or len(it["text"]) > TEXT_MAX:
            why.append(f"text is required, at most {TEXT_MAX} characters (has {len(it.get('text') or '')})")
        if it["action"] not in actions:
            why.append(f"unknown action '{it['action']}'")
        ctxv = it["context"]
        if ctxv != NONE_KEY and not ctxv.startswith("ent__") and _tag(ctxv) not in tags:
            why.append(f"unknown context '{ctxv}' (add it under 'contexts' first)")
        if not it["sources"]:
            why.append("sources must list at least one log id")
        if it.get("kind") == "policy_proposal" and (it.get("target_action") not in actions - {NONE_KEY}
                                                   or not it.get("target_sub_action")):
            why.append("a policy_proposal needs a catalog target_action and a target_sub_action")
        for rel in ("updates", "contradicts"):
            if it.get(rel) and it[rel] not in neigh:
                why.append(f"'{rel}' must be the id of a neighbour, not '{it[rel]}'")
        if it.get("updates") and it.get("contradicts"):
            why.append("set 'updates' or 'contradicts', not both")
        if why:
            problems.append(f"item {n} ('{str(it.get('title') or '')[:60]}'): " + "; ".join(why))
        items.append(it)
    return {"items": items, "contexts": contexts, "signal_words": words}, problems


# ---------------------------------------------------------------------------------------------- prompt
def build_user(nxt: dict, project: str) -> str:
    data = {k: nxt.get(k) for k in ("project", "batch_id", "logs", "neighbours", "catalog", "people", "rules")}
    data["project"] = data.get("project") or project
    head = INSTRUCTION.format(project=project, batch_id=nxt.get("batch_id"), n=len(nxt.get("logs") or []))
    return f"{head}\n\n{data_block('distil-batch', data)}\n"


def _retry_note(problems: list[str]) -> str:
    return ("\n\nYour previous answer was refused before it reached KH:\n- " + "\n- ".join(problems[:20])
            + "\nAnswer again with the whole JSON object, corrected.")


def _repair_note(rejected: list[tuple[dict, str]]) -> str:
    lines = [f"- {reason}: {json.dumps(item, ensure_ascii=False)}" for item, reason in rejected[:20]]
    return ("\n\nKH refused these items of your answer; the others are stored:\n" + "\n".join(lines)
            + "\nReturn only corrected versions of the refused items (an empty 'items' list when one cannot be "
              "fixed without breaking a rule). Do not repeat the stored items.")


# ---------------------------------------------------------------------------------------------- the loop
class _Stop(Exception):
    def __init__(self, reason: str):
        self.reason = reason


def _billed_since(ctx, n0: int) -> float:
    return sum(e["usd"] for e in ctx.llm.log[n0:] if e.get("billed"))


def _ask(ctx, system: str, user: str, schema: dict, nxt: dict, state: dict) -> tuple[dict | None, str]:
    """One attempt. Returns (fields, model) or (None, reason); the attempt and its cost are counted."""
    if ctx.should_stop():
        raise _Stop("lease_lost")
    state["attempts"] += 1
    n0 = len(ctx.llm.log)
    try:
        res = ctx.llm.complete(system, user, schema, max_tokens=ctx.max_tokens)
    except LLMError as exc:
        state["cost"] += _billed_since(ctx, n0)
        return None, f"model: {short(exc)}"
    state["cost"] += _billed_since(ctx, n0)
    fields, problems = check_output(res.json, nxt)
    if problems:
        state["problems"] = problems
        return None, "schema: " + "; ".join(problems)[:300]
    state["model"] = res.model
    return fields, res.model


def _submit(ctx, project: str, nxt: dict, fields: dict, state: dict) -> dict:
    items = [{k: v for k, v in it.items() if k != "share"} for it in fields.get("items") or []]  # KH's own field set
    body = {"project": project, "batch_id": nxt["batch_id"], **fields, "items": items,
            "distilled_by": f"worker:{state['model'] or ctx.llm.model}",
            "cost_usd": round(max(0.0, state["cost"] - state["cost_sent"]), 6)}
    resp = ctx.kh.distill_submit(body)
    state["cost_sent"] = state["cost"]
    return resp


def _event(ctx, project: str, nxt: dict, fields: dict, resp: dict, state: dict) -> None:
    try:
        ctx.kh.append_event("worker.run", {
            "job": "distil", "project": project, "batch_id": nxt.get("batch_id"),
            "log_ids": [lg.get("id") for lg in nxt.get("logs") or []], "model": state["model"] or ctx.llm.model,
            "dry_run": bool(resp.get("dry_run", True)), "cost_usd": round(state["cost"], 6),
            "items": fields.get("items") or [], "contexts": fields.get("contexts") or [],
            "signal_words": fields.get("signal_words") or [], "results": resp.get("results") or []},
            project=project, event_id=f"worker.run:{ctx.kh.run_id}:{nxt.get('batch_id')}")
    except Exception as exc:  # noqa: BLE001 - the comparison log must not stop the run
        log.warning("distil %s: worker.run event for %s not written: %s", project, nxt.get("batch_id"), exc)


def _tally(res: dict, resp: dict, fields: dict | None = None) -> None:
    items = (fields or {}).get("items") or []
    for r in resp.get("results") or []:
        k = r.get("result") or "unknown"
        res["results"][k] = res["results"].get(k, 0) + 1
        n = r.get("n")
        # What KH stored as a new proposed item; a policy proposal is never approved by the worker (approving
        # it rewrites a live policy rule), so it always waits for a person.
        if k == "accepted" and r.get("id") and isinstance(n, int) and n < len(items) \
                and items[n].get("kind") != "policy_proposal":
            res.setdefault("accepted_ids", []).append(r["id"])
            if items[n].get("share"):
                res.setdefault("share_ids", []).append(r["id"])


def approve_own(ctx, project: str, res: dict) -> None:
    """KH_WORKER_AUTO_APPROVE: approve the items this run stored for ``project`` (the policy's 'review' step:
    the distiller approves what it wrote, and shares to lesson-learned the items the model marked ``share``: they
    read the same in any project). Contested items and policy proposals stay for the owner."""
    ids = res.pop("accepted_ids", [])
    share = [i for i in res.pop("share_ids", []) if i in ids]
    if not ids or ctx.dry or not getattr(ctx.cfg, "auto_approve", False):
        return
    approve = getattr(ctx.kh, "distill_approve", None)
    if approve is None:
        res["approve_error"] = "this identity cannot approve (KH_WORKER_AUTH=person only)"
        return
    try:
        out = approve(project, ids, share)
    except KHError as exc:
        res["approve_error"] = short(exc)
        log.warning("distil %s: approve failed: %s", project, exc)
        return
    res["approved"] = sum(1 for r in out.get("results") or [] if r.get("result") == "active")
    res["shared"] = sum(1 for r in out.get("results") or [] if str(r.get("shared", "")).startswith("dk_"))
    refused = [r.get("shared") for r in out.get("results") or [] if str(r.get("shared", "")).startswith("refused")]
    if refused:
        res["share_refused"] = len(refused)


def do_batch(ctx, project: str, nxt: dict, res: dict) -> str:
    """Distil and submit one batch. Returns ``submitted``, ``partial`` (items still refused) or ``failed``."""
    system = load_prompt("distil")
    user = build_user(nxt, project)
    schema = output_schema(nxt.get("catalog"))
    state = {"attempts": 0, "cost": 0.0, "cost_sent": 0.0, "model": "", "problems": []}
    if not nxt.get("logs"):
        fields = {"items": [], "contexts": [], "signal_words": []}     # rows without signal: just move the cursor
    else:
        fields, why = None, ""
        while fields is None and state["attempts"] < ATTEMPTS:
            fields, why = _ask(ctx, system, user + (_retry_note(state["problems"]) if state["problems"] else ""),
                               schema, nxt, state)
        if fields is None:
            res["failed"] += 1
            res["last_error"] = why
            log.warning("distil %s: batch %s left for the next run (%s)", project, nxt.get("batch_id"), why)
            return "failed"
    if ctx.should_stop():
        raise _Stop("lease_lost")
    resp = _submit(ctx, project, nxt, fields, state)
    res["submitted"] += 1
    res["items"] += len(fields["items"])
    _tally(res, resp, None if (ctx.dry or resp.get("dry_run")) else fields)
    if ctx.dry or resp.get("dry_run"):
        _event(ctx, project, nxt, fields, resp, state)
        return "submitted"
    rejected = [(fields["items"][r["n"]], r.get("reason") or "rejected") for r in resp.get("results") or []
                if r.get("result") == "rejected" and isinstance(r.get("n"), int) and r["n"] < len(fields["items"])]
    if not rejected or not resp.get("batch_open"):
        return "submitted"
    if state["attempts"] >= ATTEMPTS:
        res["last_error"] = f"{len(rejected)} item(s) refused by KH, no attempt left"
        return "partial"
    state["problems"] = []
    fixed, why = _ask(ctx, system, user + _repair_note(rejected), schema, nxt, state)
    if fixed is None or not fixed["items"]:
        res["last_error"] = why or "refused items could not be fixed"
        return "partial"
    if ctx.should_stop():
        raise _Stop("lease_lost")
    resp2 = _submit(ctx, project, nxt, fixed, state)
    res["resent"] += len(fixed["items"])
    _tally(res, resp2, fixed)
    return "submitted" if not any(r.get("result") == "rejected" for r in resp2.get("results") or []) else "partial"


def run_project(ctx, project: str, res: dict, max_batches: int) -> str:
    """Loop one project. Returns why it stopped: done, dry_one_batch, batch_failed, repeat, max_batches."""
    served: set = set()
    for _ in range(max_batches):
        if ctx.should_stop():
            raise _Stop("lease_lost")
        nxt = ctx.kh.distill_next(project)
        if not nxt.get("batch_id"):
            return "done"
        logs = tuple(lg.get("id") for lg in nxt.get("logs") or [])
        if logs and logs in served:
            return "repeat"                     # KH served logs we already handled this run: do not loop
        served.add(logs)
        res["batches"] += 1
        outcome = do_batch(ctx, project, nxt, res)
        if outcome == "failed":
            return "batch_failed"
        if ctx.dry:
            return "dry_one_batch"
        if nxt.get("done") or not nxt.get("remaining_after"):
            # KH said nothing is left after this batch; one more `next` confirms it cheaply next run
            return "done"
    return "max_batches"


def run(ctx) -> dict:
    max_batches = env_int("KH_WORKER_DISTIL_MAX_BATCHES", MAX_BATCHES)
    out: dict[str, Any] = {"projects": {}}
    status = "ok"
    for project in ctx.projects:
        if ctx.should_stop():
            status = "lease_lost"
            break
        res = out["projects"][project] = {"batches": 0, "submitted": 0, "failed": 0, "items": 0, "resent": 0,
                                          "results": {}}
        try:
            try:
                res["stopped"] = run_project(ctx, project, res, max_batches)
            finally:
                approve_own(ctx, project, res)      # also what was stored before a cap or an error stopped it
        except _Stop as stop:
            res["stopped"] = status = stop.reason
            break
        except BudgetExceeded as exc:
            res["stopped"] = status = "budget"
            out["cap"] = exc.cap
            out["error"] = str(exc)
            break
        except BudgetRefused as exc:
            res["stopped"] = status = "kh_budget"
            out["error"] = str(exc)
            break
        except KHError as exc:
            res["stopped"] = "error"
            res["error"] = short(exc)
            log.warning("distil %s: %s", project, exc)
    for k in ("batches", "submitted", "failed", "items"):
        out[k] = sum(p[k] for p in out["projects"].values())
    if status == "ok" and any(p.get("stopped") in ("error", "batch_failed") for p in out["projects"].values()):
        status = "partial"
    out["status"] = status
    return out

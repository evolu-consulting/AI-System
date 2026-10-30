"""Promote: the nightly review of personal rules for the common layer (fen 2026-10-27, kernel rule 10).

Two layers. The common layer is the kernel and the 'every project' policy tier; only maintainers write it. The
personal layer is each person's own rules: their personalization rows and their personal policy tier
(app/policy_actions/store.py). Feedback a member gives about how the LLM works lands in their personal layer,
or, about one project, in that project's knowledge as a row of kind ``feedback``.

Each night the worker (kh_worker job ``promote``) reads those rows with ``GET /promote/next``, looks for rules
several people keep asking for, and hands back proposals to change one step of a common action with
``POST /promote/submit``. A proposal is a distil item of kind ``policy_proposal`` with ``tier: common`` in the
orchestrator project: it waits on ``/distill/pending?project=orchestrator`` and only a maintainer's
``/distill/approve`` writes it, into the 'every project' tier (``distill.approve``). The kernel itself is never
changed by a proposal: its budget is a few characters, so a kernel change stays a maintainer's edit.

Privacy. Personal rows leave their project only here, only to the worker and maintainers, with the owner
replaced by a stable alias (``person-<hash>``); a proposal must be general (the distil leak gate) and must be
backed by at least ``KH_PROMOTE_MIN_PEOPLE`` distinct people, so one person's rule is never promoted alone.
"""
from __future__ import annotations

import hashlib
import json
import logging

from fastapi import HTTPException, Request

from app import config, distill, personal, vector_store as vs

logger = logging.getLogger(__name__)

ENABLED = config._env("KH_PROMOTE", "off").strip().lower() in ("1", "on", "true", "yes")
MIN_PEOPLE = int(config._env("KH_PROMOTE_MIN_PEOPLE", "2") or 2)
MAX_ROWS = int(config._env("KH_PROMOTE_MAX_ROWS", "400") or 400)
TEXT_MAX = 600
TIER = "common"


def alias(project: str) -> str:
    """A stable alias of a row's owner: the person behind a personal project, or the shared project itself."""
    if personal.is_personal(project):
        return "person-" + hashlib.sha256(project.encode()).hexdigest()[:8]
    return f"project:{project}"


def _rows_of(name: str, where: dict | None) -> list[tuple[str, str, dict]]:
    if name not in vs.existing_collection_names():
        return []
    got = vs.get_or_create(name).get(where=where, include=["metadatas", "documents"]) if where else \
        vs.get_or_create(name).get(include=["metadatas", "documents"])
    out = []
    for i, vid in enumerate(got.get("ids") or []):
        meta = (got.get("metadatas") or [{}])[i] or {}
        text = " ".join(((got.get("documents") or [""])[i] or "").split())
        if text and str(meta.get("status") or "active") == "active" and not meta.get("guard_tool"):
            out.append((vid, text, meta))
    return out


def feedback_rows() -> list[dict]:
    """Every person's personalization rows and every project's ``feedback`` rows, newest first."""
    from app.projects import list_projects
    rows = []
    for pid in list_projects():
        if personal.is_personal(pid):
            found = _rows_of(vs.part_collection_name("personalization", pid), None)
            layer = "personal"
        else:
            found = _rows_of(vs.part_collection_name("knowledge", pid), {"kind": {"$eq": "feedback"}})
            layer = "project"
        for vid, text, meta in found:
            rows.append({"id": vid, "owner": alias(pid), "layer": layer, "text": text[:1500],
                         "ts": str(meta.get("ts") or meta.get("created_at") or "")})
    rows.sort(key=lambda r: r["ts"], reverse=True)
    return rows[:MAX_ROWS]


def common_policies() -> list[dict]:
    """The common tier as the worker sees it: each action, its when-line and its steps with their text."""
    from app.policy_actions import store
    out = []
    with store._conn() as c:
        acts = [dict(r) for r in c.execute("SELECT action, description FROM policy_actions WHERE project=? "
                                           "ORDER BY action", (store.EVERY,))]
        for a in acts:
            a["steps"] = [{"sub_action": r["sub_action"], "seq": r["seq"], "content": r["content"]}
                          for r in c.execute("SELECT sub_action, seq, content FROM policy_rules WHERE project=? "
                                             "AND action=? ORDER BY seq, sub_action", (store.EVERY, a["action"]))]
            out.append(a)
    return out


def proposals() -> list[dict]:
    """Promotion proposals already made, any status, so the worker does not repeat itself."""
    from app.projects import ORCHESTRATOR_ID
    return [{"id": i["id"], "status": i["status"], "title": i["title"], "text": i["text"]}
            for i in distill.items(ORCHESTRATOR_ID, None, {"tier": {"$eq": TIER}})]


def serve_next() -> dict:
    from app.hooks import store as hooks_store
    kernel = ""
    try:
        kernel = hooks_store.get_text("SessionStart")
    except Exception as exc:  # noqa: BLE001 - the worker can still propose policy steps without it
        logger.warning("promote: kernel unreadable: %s", exc)
    return {"rows": feedback_rows(), "common": common_policies(), "kernel": kernel, "proposals": proposals(),
            "rules": {"min_people": MIN_PEOPLE, "text_max": TEXT_MAX, "tier": "every project"}}


def submit(body: dict, encode, dry_run: bool = False) -> dict:
    """Check and store promotion proposals. Each item: title, text, target_action, target_sub_action, sources."""
    from app.projects import ORCHESTRATOR_ID, list_projects
    rows = {r["id"]: r for r in feedback_rows()}
    common = common_policies()
    actions = {a["action"] for a in common}
    seqs = {(a["action"], st["sub_action"]): st["seq"] for a in common for st in a["steps"]}
    names = distill._names(list(list_projects()), ("person", "org")) | distill._project_names()
    live = distill.items(ORCHESTRATOR_ID, ("proposed", "contested"), {"tier": {"$eq": TIER}})
    results = []
    for n, raw in enumerate(body.get("items") or []):
        def refuse(reason):
            results.append({"n": n, "result": "rejected", "reason": reason})
        if not isinstance(raw, dict):
            refuse("item must be an object")
            continue
        title, text = str(raw.get("title") or "").strip(), str(raw.get("text") or "").strip()
        ta, tsa = str(raw.get("target_action") or "").strip(), str(raw.get("target_sub_action") or "").strip()
        sources = [s for s in dict.fromkeys(raw.get("sources") or []) if isinstance(s, str)]
        if not title or len(title) > config.DISTILL_TITLE_CHARS:
            refuse(f"title is required, at most {config.DISTILL_TITLE_CHARS} characters")
            continue
        if not text or len(text) > TEXT_MAX:
            refuse(f"text is required, at most {TEXT_MAX} characters")
            continue
        if ta not in actions or not tsa:
            refuse("target_action must be an action of the common tier, with a target_sub_action")
            continue
        unknown = [s for s in sources if s not in rows]
        if not sources or unknown:
            refuse(f"sources must be row ids from /promote/next (unknown: {', '.join(unknown[:5])})")
            continue
        people = {rows[s]["owner"] for s in sources}
        if len(people) < MIN_PEOPLE:
            refuse(f"backed by {len(people)} owner(s); a common rule needs at least {MIN_PEOPLE}")
            continue
        leak = distill._leak(f"{title}\n{text}", names)
        if leak:
            refuse(f"leak gate: '{leak}' (a common rule names no person, project or host)")
            continue
        vec = encode(f"{title}. {text}")
        same = distill._closest(live, vec, encode)
        now = distill._now()
        item = {"kind": "policy_proposal", "action": ta, "context": distill.NONE_KEY, "entities": [],
                "title": title, "text": text, "sources": sources, "distilled_by": str(body.get("distilled_by") or ""),
                "distilled_at": now, "first_seen": now, "last_confirmed": now, "status": "proposed",
                "target_action": ta, "target_sub_action": tsa, "tier": TIER, "people": len(people),
                "seq": int(seqs.get((ta, tsa)) or raw.get("seq") or 99)}
        if same is not None:
            item.update(id=same["id"], dkey=distill._meta_of(ORCHESTRATOR_ID, same["id"]).get("dkey"),
                        sources=list(dict.fromkeys(same["sources"] + sources))[-50:],
                        first_seen=same.get("first_seen") or now)
            result = "merged"
        else:
            key = distill.dkey(ORCHESTRATOR_ID, "policy_proposal", ta, tsa, TIER)
            taken = {i["id"] for i in distill.items(ORCHESTRATOR_ID, None, {"dkey": {"$eq": key}})}
            new_id, k = key, len(taken) + 1
            while new_id in taken:
                new_id, k = f"{key}_{k}", k + 1
            item.update(id=new_id, dkey=key)
            result = "accepted"
        if not dry_run:
            distill._write(ORCHESTRATOR_ID, item, encode)
            live = [i for i in live if i["id"] != item["id"]] + [{**item, "evidence_count": len(item["sources"])}]
        results.append({"n": n, "result": result, "id": item["id"], "people": len(people)})
    return {"dry_run": dry_run, "results": results}


def attach(app) -> None:
    from app import auth
    TAG = ["Promote"]

    def _encoder(request: Request):
        model = request.app.state.model
        return lambda t: model.encode(t, normalize_embeddings=True).tolist()

    def _on() -> None:
        if not ENABLED:
            raise HTTPException(403, "promote is off (KH_PROMOTE=off)")

    @app.get("/promote/next", tags=TAG, summary="Personal and project feedback rows, the common tier, past proposals")
    def promote_next() -> dict:
        _on()
        if distill.is_worker(auth.current()):
            with distill.as_worker_system():
                return serve_next()
        return serve_next()

    @app.post("/promote/submit", tags=TAG, summary="Propose changes to the common tier, for a maintainer to approve")
    def promote_submit(body: dict, request: Request) -> dict:
        _on()
        worker = distill.is_worker(auth.current())
        forced = worker and distill.worker_forced_dry()
        with distill.as_worker_system() if worker else distill._same():
            out = submit(body, _encoder(request), dry_run=forced or body.get("dry_run") is True)
        if forced:
            out["forced_dry"] = "KH_DISTILL_WORKER=dry"
        return out

    logger.info("Promote routes attached (/promote/next, /promote/submit), %s", "on" if ENABLED else "off")

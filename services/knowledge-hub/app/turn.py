"""Turn context: everything the model fetched before every piece of work, in ONE call (roadmap item B).

The per-request hook used to tell the model to make 3-5 KH calls before it acted: which project
(/orchestrator/project_match), which action (/policy/actions), the project's findings
(/findings/list), the people and systems named (/entities/match) and the KH lessons near the
question (/vector/query on project lesson-learned). Each one is a model turn, and the tier 2 bench of
2026-10-02 measured a turn at about 10-15k input tokens. The UserPromptSubmit hook of kh-helper now
calls

    GET /turn/context?text=<the person's prompt>

and injects the answer, so the model starts with all of it and calls only /policy/plan, for the
label it picks.

When the caller already knows the action (and optionally a context tag or entity ids), the
distilled items under that key are added too (roadmap D slice 2, the same SELECT as /context/step);
the hook does not send them today, so the block is unchanged for it.

Every part is filtered by what the caller may read: a project the caller cannot read is neither
named as the match nor used for actions, findings or entities. Every part is bounded (config
TURN_*), and a part that fails is left out rather than failing the prompt.
"""
from __future__ import annotations

import asyncio
import logging

from fastapi import Query, Request

from app import auth, config
from app import distill as kh_distill
from app import entities as kh_entities
from app import feedback as kh_feedback
from app import personal as kh_personal
from app import projects as kh_projects
from app.policy_actions import store as policy_store
from app.retriever import query_quick_knowledge

logger = logging.getLogger(__name__)


def _short(text: str, limit: int) -> str:
    """The first sentence or line of ``text``, cut to ``limit`` characters."""
    text = " ".join((text or "").split())
    for stop in (". ", "\n"):
        cut = text.find(stop)
        if 0 < cut < limit:
            return text[:cut + 1].strip()
    return text if len(text) <= limit else text[:limit - 3].rstrip() + "..."


def project_part(text: str, visible: set[str] | None) -> dict:
    """The project match, as /orchestrator/project_match answers it, limited to readable projects."""
    hits = [h for h in kh_projects.match_projects(text) if visible is None or h["project"] in visible]
    # the same rule as projects.resolve_project_name, applied after the visibility filter
    weak_only = bool(hits) and hits[0].get("weak", False)
    tie = len(hits) > 1 and hits[1]["term_length"] == hits[0]["term_length"] \
        and hits[1]["matched_on"] == hits[0]["matched_on"]
    best = hits[0]["project"] if hits and not weak_only and not tie else None
    ambiguous = bool(hits) and not weak_only and tie
    return {"best": best, "ambiguous": ambiguous, "weak_only": weak_only,
            "matches": [{"project": h["project"], "term": h["matched_term"], "on": h["matched_on"]}
                        for h in hits[:4]]}


def session_part(p: dict) -> None:
    """Replace the prompt's match with the session's bound project (app/session_project.py), binding an unbound
    session when the prompt names a project by id or alias. Without a session id nothing changes."""
    from app import session_project
    principal, actor = auth.current(), auth.current_actor()
    if principal is None or not actor:
        return
    owner = principal.personal_project
    bound = session_project.get(owner, actor)
    if bound is None:
        detected = session_project.detect(p["matches"])
        if detected and principal.can(detected, "project.log"):
            bound = session_project.bind(owner, actor, detected, session_project.DETECTED)
    if bound is None:
        p["session"] = None
        return
    from app.eventing.emit import emit
    emit("kh.session.turn", {"project": bound["project"], "source": bound["source"]}, project=bound["project"])
    named = p["best"] if p["best"] and p["best"] != bound["project"] else None
    p.update({"best": bound["project"], "ambiguous": False, "weak_only": False,
              "session": {**bound, "prompt_names": named}})


def actions_part(project: str | None) -> list[dict]:
    return [{"action": a["action"], "project": a["project"],
             "when": _short(a.get("description") or "", config.TURN_WHEN_CHARS)}
            for a in policy_store.menu(project)]


def findings_part(project: str | None) -> list[str]:
    if not project:
        return []
    rows = kh_feedback.list_findings(project)[:config.TURN_FINDING_LIMIT]
    return [_short(r.get("desc") or r.get("text") or r.get("issue_id") or "", 240) for r in rows]


def entities_part(text: str, project: str | None, visible: set[str] | None) -> list[str]:
    scope = [project] if project else [p for p in kh_projects.list_projects() if visible is None or p in visible]
    return [kh_entities.line_of(c) for c in kh_entities.match(text, scope, config.TURN_ENTITY_LIMIT)]


async def lessons_part(text: str, model, withheld: list | None = None) -> list[dict]:
    from app.caps import learn
    project = config.TURN_LESSON_PROJECT
    if not project or not auth.may(project, "project.read"):
        return []
    hits = await query_quick_knowledge(text, config.TURN_LESSON_K, model, scope="knowledge", project=project)
    hits = learn.withhold(hits, lambda h: h.get("vector_id"), withheld)       # trial lessons: 50/50 (S11)
    from app.caps import improve
    floor = improve.param("KH_TURN_LESSON_FLOOR", config.TURN_LESSON_FLOOR)    # S14 read path
    out = []
    for h in hits:
        if h["score"] < floor or not auth.row_visible(h.get("metadata"), h.get("vector_id")):
            continue
        out.append({"id": h["vector_id"], "score": round(h["score"], 3),
                    "title": _short(h.get("source_text") or "", 200)})
    return out


async def my_lessons_part(text: str, model) -> list[dict]:
    """The caller's own lessons near the prompt (scope PERSONAL_LESSON_SCOPE of their personal project)."""
    own = kh_personal.own_id()
    if not own or not config.PERSONAL_LESSON_SCOPE:
        return []
    hits = await query_quick_knowledge(text, config.TURN_LESSON_K, model, scope=config.PERSONAL_LESSON_SCOPE,
                                       project=own)
    from app.caps import improve
    floor = improve.param("KH_TURN_LESSON_FLOOR", config.TURN_LESSON_FLOOR)
    return [{"id": h["vector_id"], "score": round(h["score"], 3), "project": own,
             "title": _short(h.get("source_text") or "", 200)}
            for h in hits if h["score"] >= floor and auth.row_visible(h.get("metadata"), h.get("vector_id"))]


async def near_part(text: str, project: str | None, model, withheld: list | None = None) -> list[str]:
    """The matched project's live distilled items closest to the prompt, one short line each."""
    from app.caps import learn
    if not project or config.TURN_DISTILLED_K <= 0 or not auth.may(project, "project.read"):
        return []
    hits = await query_quick_knowledge(text, config.TURN_DISTILLED_K * 2, model, scope="knowledge", project=project,
                                       where={"topic": {"$eq": kh_distill.TOPIC}})
    hits = learn.withhold(hits, lambda h: h.get("vector_id"), withheld)       # trial lessons: 50/50 (S11)
    out = []
    for h in hits:
        if h["score"] < config.TURN_DISTILLED_FLOOR or not auth.row_visible(h.get("metadata"), h.get("vector_id")):
            continue
        body = " ".join((h.get("source_text") or "").split())   # the whole item, not its first sentence
        if len(body) > config.TURN_DISTILLED_CHARS:
            body = body[:config.TURN_DISTILLED_CHARS - 3].rstrip() + "..."
        out.append(f"{h['vector_id']} ({round(h['score'], 3)}): {body}")
        if len(out) >= config.TURN_DISTILLED_K:
            break
    return out


def distilled_part(project: str | None, action: str | None, context: str | None,
                   entities: list[str] | None, text: str | None = None, model=None,
                   withheld: list | None = None) -> list[str]:
    """Live distilled items by key, one line each: the project's first, then the shared lessons.
    ``withheld`` (when given) receives the ids distill.served withheld (slice S11)."""
    from app.caps import outcomes
    if not (action or context):
        return []
    principal = auth.current()
    with_sources = principal is not None and principal.is_maintainer
    lanes = [p for p in dict.fromkeys([project, config.TURN_LESSON_PROJECT]) if p and auth.may(p, "project.read")]
    results = {}
    for lane in lanes:
        results[lane], held = outcomes.split_served(
            kh_distill.served(lane, action, context, entities, config.STEP_KEY_LIMIT, text, model))
        if withheld is not None:
            withheld.extend(held)
    return [kh_distill.line_of(it, with_sources=with_sources)
            for found, _ in kh_distill.exact_first(results).values() for it in found]


def render(ctx: dict) -> str:
    """The block the hook injects. Short, and it says what NOT to fetch again."""
    p = ctx["project"]
    session = p.get("session")
    if session:
        project_line = (f"{session['project']} - BOUND TO THIS SESSION ({session['source']} {session['bound_at']}); "
                        "this session's worklogs go there. Keep it; only when the person asks to work on another "
                        "project, PUT /session/project {\"project\":\"<id>\"}")
        if session.get("prompt_names"):
            project_line += f" (this message also names '{session['prompt_names']}': switch only if they ask)"
    elif p["best"]:
        m = p["matches"][0]
        project_line = f"{p['best']} (matched '{m['term']}' on {m['on']})"
    elif p["ambiguous"]:
        project_line = "AMBIGUOUS between " + ", ".join(m["project"] for m in p["matches"]) + " - ask which one"
    else:
        project_line = ("none matched literally - map by meaning, or stay project-less for small talk; "
                        "a log or finding of project-less work goes to your personal project")
    if "session" in p and not session:
        project_line += ("; THIS SESSION HAS NO PROJECT YET: once the work clearly belongs to one, bind it with "
                         "PUT /session/project {\"project\":\"<id>\"} (a keyword match alone is not enough)")
    pid = p["best"]
    lines = ["KH TURN CONTEXT - computed by the hook for this message. It already answers "
             "/orchestrator/project_match, /policy/actions, /findings/list, /entities/match and the "
             "lesson query; do NOT call those again this turn.",
             f"PROJECT: {project_line}"]
    lines.append(f"ACTIONS{' for ' + pid if pid else ''} (pick a label or none; if one fits, "
                 f"GET /policy/plan?action=<label>{'&project=' + pid if pid else ''} and follow it):")
    lines += [f"  - '{a['action']}': {a['when']}" for a in ctx["actions"]]
    if pid:
        lines.append("FINDINGS (" + pid + "): " + ("none" if not ctx["findings"] else ""))
        lines += [f"  - {f}" for f in ctx["findings"]]
    if ctx["entities"]:
        lines.append("PEOPLE AND THINGS NAMED:")
        lines += [f"  - {e}" for e in ctx["entities"]]
    if ctx.get("near"):
        lines.append(f"PROJECT KNOWLEDGE near this message (distilled from {pid}'s logs; whole row: POST "
                     "/vector/scroll {\"ids\":[...],\"scope\":\"knowledge\",\"project\":\"" + (pid or "") + "\"}):")
        lines += [f"  - {n}" for n in ctx["near"]]
    if ctx.get("distilled"):
        lines.append("DISTILLED ITEMS for the action/context given (settled knowledge; [contested] = not settled):")
        lines += [f"  - {d}" for d in ctx["distilled"]]
    if ctx.get("my_lessons"):
        own = ctx["my_lessons"][0]["project"]
        lines.append("YOUR OWN LESSONS near this message (they win over KH LESSONS on overlap; whole row: POST "
                     "/vector/scroll {\"ids\":[...],\"scope\":\"" + config.PERSONAL_LESSON_SCOPE + "\",\"project\":\""
                     + own + "\"}):")
        lines += [f"  - {x['id']} ({x['score']}): {x['title']}" for x in ctx["my_lessons"]]
    if ctx.get("repeats"):
        lines.append("REPEATED ACROSS DAYS (counted by learn-back from your work logs; if this message is one of "
                     "them, follow 'suggest a tool' once):")
        lines += [f"  - {r}" for r in ctx["repeats"]]
    if ctx["lessons"]:
        lines.append("KH LESSONS near this message (read a whole row with POST /vector/scroll "
                     "{\"ids\":[...],\"scope\":\"knowledge\",\"project\":\"" + config.TURN_LESSON_PROJECT + "\"}):")
        lines += [f"  - {x['id']} ({x['score']}): {x['title']}" for x in ctx["lessons"]]
    else:
        lines.append("KH LESSONS: none above the floor for the raw message.")
    return "\n".join(lines)


def served_ids(ctx: dict) -> list[str]:
    """The ids a turn context served: distilled and near lines start with the item id; lessons carry it."""
    ids = [line.split(" ", 1)[0] for line in (ctx.get("distilled") or []) + (ctx.get("near") or []) if line]
    return ids + [x["id"] for x in (ctx.get("my_lessons") or []) + (ctx.get("lessons") or []) if x.get("id")]


async def build(text: str, model, action: str | None = None, context: str | None = None,
                entities: list[str] | None = None, withheld: list | None = None) -> dict:
    text = (text or "")[:config.TURN_TEXT_CHARS]
    visible = auth.visible_projects("project.read")
    ctx: dict = {"project": {"best": None, "ambiguous": False, "weak_only": False, "matches": []},
                 "actions": [], "findings": [], "entities": [], "lessons": [], "my_lessons": [], "distilled": [],
                 "near": []}
    parts = (("project", lambda: project_part(text, visible)),
             ("actions", lambda: actions_part(ctx["project"]["best"])),
             ("findings", lambda: findings_part(ctx["project"]["best"])),
             ("entities", lambda: entities_part(text, ctx["project"]["best"], visible)))
    for name, fn in parts:
        try:
            ctx[name] = fn()
        except Exception as exc:              # one broken part must not cost the prompt the rest
            logger.warning("turn context: %s failed: %s", name, exc)
        if name == "project":
            try:
                session_part(ctx["project"])
            except Exception as exc:
                logger.warning("turn context: session binding failed: %s", exc)
    try:                                      # a store read: off the event loop (the 2026-10-09 incident)
        ctx["distilled"] = await asyncio.to_thread(distilled_part, ctx["project"]["best"], action, context,
                                                   entities, text, model, withheld)
    except Exception as exc:
        logger.warning("turn context: distilled failed: %s", exc)
    try:
        ctx["near"] = await near_part(text, ctx["project"]["best"], model, withheld)
    except Exception as exc:
        logger.warning("turn context: near failed: %s", exc)
    try:
        ctx["lessons"] = await lessons_part(text, model, withheld)
    except Exception as exc:
        logger.warning("turn context: lessons failed: %s", exc)
    try:
        ctx["my_lessons"] = await my_lessons_part(text, model)
    except Exception as exc:
        logger.warning("turn context: own lessons failed: %s", exc)
    try:
        from app import usage
        ctx["repeats"] = await asyncio.to_thread(usage.turn_lines, text)
    except Exception as exc:
        logger.warning("turn context: repeats failed: %s", exc)
    ctx["text"] = render(ctx)
    return ctx


def attach(app) -> None:
    TAG = ["Turn"]

    @app.get("/turn/context", tags=TAG,
             summary="Project, action menu, findings, entities and lessons for one prompt, in one call")
    async def turn_context(request: Request, text: str = Query(..., description="the person's prompt"),
                           action: str | None = Query(None, max_length=120,
                                                      description="action label, to add distilled items by key"),
                           context: str | None = Query(None, max_length=120, description="context tag or entity id"),
                           entities: list[str] | None = Query(None, description="entity ids; items naming them first")
                           ) -> dict:
        from app.caps import outcomes
        withheld: list = []
        ctx = await build(text, request.app.state.model, action, context, entities, withheld)
        # serve_id + kh.served only with KH_CAP_OUTCOMES on; otherwise the answer is unchanged
        outcomes.note_served(request, ctx, "turn", ctx["project"]["best"], action, context, served_ids(ctx), withheld)
        return ctx

    logger.info("Turn routes attached (/turn/context)")

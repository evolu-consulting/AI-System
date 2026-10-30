"""Human question / answer store (plan blocks 7 + 8, design r5h, I01, I07, N3, R14).

Design rules this module enforces in code:
  * a question is ONE decision with 2-4 options, a recommended option, the impact of every option
    and evidence (quotes); a question missing a field is refused (SCHEMA_INVALID, I07).
  * all questions of a run are batched into ONE round (one human.question event); at most
    human_max_open (3) are open at a time, the rest are held and released as answers arrive (I07).
  * a question whose fingerprint was already answered (this run, or an addendum of the same base
    pack) is not asked again; the earlier answer is reused.
  * deadline human_due_workdays (2 working days); a reminder goes to the owner after
    human_remind_workdays, then to the lead at the deadline. The line NEVER picks a default:
    the question stays open and the run / F-items stay parked (R14).
  * when every question of the run is answered the answers become a versioned addendum vN.k that
    re-freezes the pack (addendum.make_addendum) and the run is unparked.

With human_mode="ask" (the default) the line itself never answers. Only answer_question() (called by the
server route, or by the dry fixture mode LINE_DRY_HUMAN=auto for e2e runs) records an answer. The run stays
parked meanwhile, so the person may close the board and come back: GET /api/runs/{id}/questions lists what
still waits. With human_mode="decide" (owner decision 2026-10-11: human questions off) decide_all() lets the
strong model pick an option for every question, and each question with its decision and reason is written
to the project worklog (rag.write_worklog) and as a human.decided event, so a person can check it later.

Server routes (wired by the integrator in server.py):
  GET  /api/runs/{id}/questions  -> api_questions(store, run)
       200 {"run", "parked": bool, "park": {...}|null, "questions": [question rows, open first]}
  POST /api/runs/{id}/answers    -> api_answers(store, run, body, cfg=cfg)
       body {"qid": "Q1", "option": "accept", "text"?: "...", "who": "name"}
         or {"answers": [{"qid", "option", "text"?}...], "who": "name"}
       200 {"results": [...], "remaining": n, "addendum": "v1.1"|null, "resume": bool}
       400 SCHEMA_INVALID (bad option / missing who) | 404 NOT_FOUND | 409 STATE_CONFLICT (answered)
       When "resume" is true the server calls the driver's resume(run).
"""

from __future__ import annotations

import json
import os
from typing import Any, Dict, List, Mapping, Optional, Sequence, Tuple

from .. import codes
from ..codes import LineError
from ._common import (E_ADDENDUM, E_PARK, E_QUESTION, HUMAN_ANSWERED, HUMAN_DECIDED, HUMAN_QUESTION, HUMAN_REMINDER,
                      RUN_PARKED,
                      RUN_UNPARKED, add_workdays, clock_ms, emit, fingerprint, local_id, merge, put, rid, rows, s,
                      setting)

OPEN, HELD, ANSWERED = "open", "held", "answered"
OTHER = "other"          # free-text option every question accepts (needs text)
#: entity -> state its rows take when the question about them is answered
REF_STATE = {"assumption": "answered", "conflict": "resolved", "fgraph_gap": "answered"}


# ------------------------------------------------------------------ schema (I07)


def validate_question(q: Mapping[str, Any]) -> List[str]:
    """Errors of a question draft; [] = valid."""
    errs = []
    if not s(q.get("decision")):
        errs.append("decision")
    if s(q.get("kind")) not in ("assumption", "conflict", "unscanned", "dependency"):
        errs.append("kind")
    opts = q.get("options") or []
    if not isinstance(opts, list) or not 2 <= len(opts) <= 4:
        errs.append("options (2-4)")
        opts = []
    ids = []
    for i, o in enumerate(opts):
        if not isinstance(o, Mapping) or not s(o.get("id")) or not s(o.get("text")) or not s(o.get("impact")):
            errs.append("options[%d] (id, text, impact)" % i)
        else:
            ids.append(s(o.get("id")))
    if len(set(ids)) != len(ids) or OTHER in ids:
        errs.append("options ids (unique, not '%s')" % OTHER)
    if s(q.get("recommended")) not in ids:
        errs.append("recommended")
    ev = q.get("evidence") or []
    if not isinstance(ev, list) or not ev or not all(isinstance(e, Mapping) and s(e.get("quote"))
                                                     and s(e.get("span_id")) for e in ev):
        errs.append("evidence")
    return errs


# ------------------------------------------------------------------ park


def park(store: Any, run: str, *, f_items: Sequence[str], questions: Sequence[str], scope: str = "run",
         pack_version: str = "", reason: str = "", cfg: Any = None, clock: Any = None) -> Dict[str, Any]:
    cur = store.get(E_PARK, run) or {}
    row = {"id": run, "run": run, "parked": True, "scope": scope,
           "f_items": sorted(set(cur.get("f_items") or []) | set(f_items)) if cur.get("parked") else sorted(set(f_items)),
           "questions": sorted(set(cur.get("questions") or []) | set(questions)) if cur.get("parked") else sorted(set(questions)),
           "pack_version": pack_version or cur.get("pack_version", ""), "reason": reason or cur.get("reason", ""),
           "since_ms": cur.get("since_ms") if cur.get("parked") else clock_ms(store, clock)}
    merge(store, E_PARK, run, row, run=run)
    emit(store, RUN_PARKED, run, {"scope": scope, "f_items": row["f_items"], "questions": row["questions"],
                                  "reason": row["reason"]}, cfg, row["pack_version"])
    return row


def unpark(store: Any, run: str, *, addendum: str = "", version: str = "", cfg: Any = None,
           clock: Any = None) -> Dict[str, Any]:
    row = merge(store, E_PARK, run, {"id": run, "run": run, "parked": False, "unparked_ms": clock_ms(store, clock),
                                     "addendum": addendum, "pack_version": version or (store.get(E_PARK, run) or {}).get("pack_version", "")},
                run=run)
    emit(store, RUN_UNPARKED, run, {"addendum": addendum, "version": version}, cfg, version)
    return row


def park_state(store: Any, run: str) -> Optional[Dict[str, Any]]:
    return store.get(E_PARK, run)


def is_parked(store: Any, run: str) -> bool:
    return bool((store.get(E_PARK, run) or {}).get("parked"))


def parked_f_items(store: Any, run: str) -> List[str]:
    row = store.get(E_PARK, run) or {}
    return list(row.get("f_items") or []) if row.get("parked") else []


# ------------------------------------------------------------------ questions


def questions(store: Any, run: str, state: Optional[str] = None) -> List[Dict[str, Any]]:
    out = [r for r in rows(store, E_QUESTION, run) if state is None or r.get("state") == state]
    return sorted(out, key=lambda r: int(local_id(r["id"])[1:] or 0) if local_id(r["id"])[1:].isdigit() else 0)


def _answered_index(store: Any, run: str, base_version: str) -> Dict[str, Dict[str, Any]]:
    """fingerprint -> {"answer", "qid", "source"} from this run's answered questions and from the
    addenda of the same base pack (any run)."""
    idx: Dict[str, Dict[str, Any]] = {}
    if base_version:
        for a in store.query(E_ADDENDUM):
            if a.get("base_version") != base_version:
                continue
            for c in a.get("clauses") or []:
                if c.get("fingerprint") and c.get("answer"):
                    idx[c["fingerprint"]] = {"answer": c["answer"], "qid": c.get("qid", ""), "source": a.get("label", "")}
    for q in rows(store, E_QUESTION, run):
        if q.get("state") == ANSWERED and q.get("fingerprint"):
            idx[q["fingerprint"]] = {"answer": q.get("answer"), "qid": local_id(q["id"]), "source": "run"}
    return idx


def question_fingerprint(q: Mapping[str, Any]) -> str:
    return s(q.get("fingerprint")) or fingerprint(q.get("kind"), q.get("decision"),
                                                 *[e.get("quote", "") for e in q.get("evidence") or []])


def _set_refs(store: Any, run: str, refs: Sequence[Mapping[str, Any]], updates: Mapping[str, Any],
              answered: bool = False) -> None:
    for ref in refs or []:
        ent, rid_ = s(ref.get("entity")), s(ref.get("id"))
        if not ent or not rid_ or store.get(ent, rid_) is None:
            continue
        upd = dict(updates)
        if answered and ent in REF_STATE and "state" not in upd:
            upd["state"] = REF_STATE[ent]
        merge(store, ent, rid_, upd, run=run)


def ask_round(store: Any, run: str, drafts: Sequence[Mapping[str, Any]], *, cfg: Any = None, clock: Any = None,
              pack_version: str = "", base_version: str = "", env: Optional[Mapping[str, str]] = None) -> Dict[str, Any]:
    """Batch drafts into ONE round. Returns {"round", "asked": [qid], "held": [qid], "reused": [{...}],
    "duplicates": [qid], "rejected": [{"draft", "errors"}], "pending": n}.

    A draft: {"kind", "decision", "options": [{"id","text","impact"}], "recommended",
              "evidence": [{"span_id","quote"}], "f_items": [..], "refs": [{"entity","id"}], "fingerprint"?}
    Reused answers (already answered before) are applied to the draft's refs right away."""
    now = clock_ms(store, clock)
    existing = rows(store, E_QUESTION, run)
    by_fp = {q.get("fingerprint"): q for q in existing if q.get("state") in (OPEN, HELD)}
    answered = _answered_index(store, run, base_version)
    n = max([int(local_id(q["id"])[1:]) for q in existing if local_id(q["id"])[1:].isdigit()] or [0])
    round_no = max([int(q.get("round") or 0) for q in existing] or [0]) + 1
    cap = int(setting(cfg, "human_max_open", env) or 0)
    open_now = sum(1 for q in existing if q.get("state") == OPEN)
    due_days = float(setting(cfg, "human_due_workdays", env))
    remind_days = float(setting(cfg, "human_remind_workdays", env))
    out: Dict[str, Any] = {"round": round_no, "asked": [], "held": [], "reused": [], "duplicates": [], "rejected": []}
    for d in drafts:
        errs = validate_question(d)
        if errs:
            out["rejected"].append({"draft": dict(d), "errors": errs})
            continue
        fp = question_fingerprint(d)
        if fp in answered:
            hit = answered[fp]
            _set_refs(store, run, d.get("refs") or [], {"answer": hit["answer"], "answered_by_question": hit["qid"],
                                                        "answer_source": hit["source"]}, answered=True)
            out["reused"].append({"fingerprint": fp, "qid": hit["qid"], "source": hit["source"]})
            continue
        if fp in by_fp:
            out["duplicates"].append(local_id(by_fp[fp]["id"]))
            continue
        n += 1
        qid = "Q%d" % n
        state = OPEN if (cap <= 0 or open_now < cap) else HELD
        if state == OPEN:
            open_now += 1
        row = {"id": rid(run, qid), "qid": qid, "run": run, "round": round_no, "kind": s(d.get("kind")),
               "decision": s(d.get("decision")), "options": [dict(o) for o in d.get("options") or []],
               "recommended": s(d.get("recommended")), "evidence": [dict(e) for e in d.get("evidence") or []],
               "f_items": sorted(set(d.get("f_items") or [])), "refs": [dict(r) for r in d.get("refs") or []],
               "fingerprint": fp, "state": state, "pack_version": pack_version, "base_version": base_version or pack_version,
               "created_ms": now, "asked_ms": now if state == OPEN else 0,
               "remind_ms": add_workdays(now, remind_days) if state == OPEN else 0,
               "due_ms": add_workdays(now, due_days) if state == OPEN else 0,
               "reminded": [], "answer": None}
        put(store, E_QUESTION, row["id"], row, run=run)
        by_fp[fp] = row
        _set_refs(store, run, row["refs"], {"question": qid})
        out["asked" if state == OPEN else "held"].append(qid)
    if out["asked"] or out["held"]:
        due = [r["due_ms"] for r in questions(store, run, OPEN) if r.get("due_ms")]
        emit(store, HUMAN_QUESTION, run, {"round": round_no, "questions": out["asked"], "held": out["held"],
                                          "due_ms": min(due) if due else 0}, cfg, pack_version)
    out["pending"] = len(pending(store, run))
    return out


def pending(store: Any, run: str) -> List[Dict[str, Any]]:
    return [q for q in questions(store, run) if q.get("state") in (OPEN, HELD)]


def _release_held(store: Any, run: str, cfg: Any, clock: Any, env: Optional[Mapping[str, str]]) -> List[str]:
    cap = int(setting(cfg, "human_max_open", env) or 0)
    qs = questions(store, run)
    open_now = sum(1 for q in qs if q.get("state") == OPEN)
    now = clock_ms(store, clock)
    released = []
    for q in qs:
        if q.get("state") != HELD:
            continue
        if cap > 0 and open_now >= cap:
            break
        merge(store, E_QUESTION, q["id"], {"state": OPEN, "asked_ms": now,
                                           "remind_ms": add_workdays(now, float(setting(cfg, "human_remind_workdays", env))),
                                           "due_ms": add_workdays(now, float(setting(cfg, "human_due_workdays", env)))}, run=run)
        open_now += 1
        released.append(q["qid"] if q.get("qid") else local_id(q["id"]))
    if released:
        due = [r["due_ms"] for r in questions(store, run, OPEN) if r.get("due_ms")]
        emit(store, HUMAN_QUESTION, run, {"round": max(int(q.get("round") or 0) for q in qs), "questions": released,
                                          "held": [local_id(q["id"]) for q in questions(store, run, HELD)],
                                          "due_ms": min(due) if due else 0, "released": True}, cfg)
    return released


def _norm_answer(q: Mapping[str, Any], answer: Any) -> Dict[str, str]:
    if isinstance(answer, Mapping):
        option, text = s(answer.get("option")), s(answer.get("text"))
    else:
        option, text = s(answer), ""
    ids = {s(o.get("id")): o for o in q.get("options") or []}
    if option not in ids and option != OTHER:
        raise LineError(codes.SCHEMA_INVALID, "option %r is not one of %s (or '%s' with text)" % (option, sorted(ids), OTHER),
                        {"qid": q.get("qid"), "option": option, "options": sorted(ids)})
    if option == OTHER and not text:
        raise LineError(codes.SCHEMA_INVALID, "option '%s' needs text" % OTHER, {"qid": q.get("qid")})
    chosen = s(ids[option].get("text")) if option in ids else text
    return {"option": option, "option_text": chosen, "text": text}


def answer_question(store: Any, run: str, qid: str, answer: Any, who: str, *, cfg: Any = None, clock: Any = None,
                    env: Optional[Mapping[str, str]] = None, finalize: bool = True) -> Dict[str, Any]:
    """Record a human answer. answer = option id, or {"option", "text"} ("other" needs text).
    Returns {"qid", "answer", "remaining", "released": [qid], "addendum": label|None, "version": str|None,
    "resume": bool}. When the last pending question of the run is answered (and finalize), the round's
    answers become addendum vN.k (pack re-frozen, F-items marked stale) and the run is unparked."""
    if not s(who):
        raise LineError(codes.SCHEMA_INVALID, "who is required", {"qid": qid})
    qid = local_id(s(qid))
    row_id = rid(run, qid)
    q = store.get(E_QUESTION, row_id)
    if q is None:
        raise LineError(codes.NOT_FOUND, "question %s of run %s" % (qid, run), {"run": run, "qid": qid})
    if q.get("state") == ANSWERED:
        raise LineError(codes.STATE_CONFLICT, "question %s is already answered" % qid,
                        {"run": run, "qid": qid, "answer": q.get("answer")})
    ans = _norm_answer(q, answer)
    ans.update({"who": s(who), "ts_ms": clock_ms(store, clock)})
    merge(store, E_QUESTION, row_id, {"state": ANSWERED, "answer": ans}, run=run)
    _set_refs(store, run, q.get("refs") or [], {"answer": ans, "question": qid}, answered=True)
    rest = pending(store, run)
    emit(store, HUMAN_ANSWERED, run, {"qid": qid, "option": ans["option"], "who": ans["who"],
                                      "remaining": len(rest)}, cfg, q.get("pack_version", ""))
    released = _release_held(store, run, cfg, clock, env)
    out: Dict[str, Any] = {"qid": qid, "answer": ans, "remaining": len(pending(store, run)), "released": released,
                           "addendum": None, "version": None, "resume": False}
    if finalize and out["remaining"] == 0:
        out.update(close_round(store, run, cfg=cfg, clock=clock, env=env))
    return out


def close_round(store: Any, run: str, *, cfg: Any = None, clock: Any = None,
                env: Optional[Mapping[str, str]] = None) -> Dict[str, Any]:
    """All questions answered: answers not yet in an addendum -> addendum vN.k; unpark."""
    from .addendum import make_addendum   # local import: addendum imports this module's helpers
    todo = [q for q in questions(store, run, ANSWERED) if not q.get("addendum")]
    res: Dict[str, Any] = {"addendum": None, "version": None, "resume": False}
    if todo:
        add = make_addendum(store, run, todo, cfg=cfg, clock=clock, env=env)
        res.update({"addendum": add["label"], "version": add["version"]})
    if is_parked(store, run):
        unpark(store, run, addendum=res["addendum"] or "", version=res["version"] or "", cfg=cfg, clock=clock)
        res["resume"] = True
    return res


# ------------------------------------------------------------------ reminders / timeouts (R14)


def check_timeouts(store: Any, run: Optional[str] = None, *, cfg: Any = None, clock: Any = None,
                   env: Optional[Mapping[str, str]] = None) -> List[Dict[str, Any]]:
    """Reminders for open questions: owner after remind_ms, lead at due_ms (once each). Never answers.
    run=None scans every run. Returns the reminders emitted."""
    now = clock_ms(store, clock)
    out = []
    for q in store.query(E_QUESTION, run=run):
        if q.get("state") != OPEN:
            continue
        done = list(q.get("reminded") or [])
        for to, at in (("owner", q.get("remind_ms") or 0), ("lead", q.get("due_ms") or 0)):
            if at and now >= at and to not in done:
                done.append(to)
                rem = {"qid": local_id(q["id"]), "to": to, "due_ms": q.get("due_ms") or 0, "overdue": to == "lead"}
                emit(store, HUMAN_REMINDER, q["run"], rem, cfg, q.get("pack_version", ""))
                out.append(dict(rem, run=q["run"]))
        if len(done) != len(q.get("reminded") or []):
            merge(store, E_QUESTION, q["id"], {"reminded": done}, run=q["run"])
    return out


# ------------------------------------------------------------------ dry fixture mode (LINE_DRY_HUMAN=auto)


def dry_mode(cfg: Any = None, env: Optional[Mapping[str, str]] = None) -> str:
    return s(setting(cfg, "dry_human", env)).lower()


def _dry_fixture(cfg: Any) -> Dict[str, Any]:
    """<dry pack>/dry/human/answers.json: {"Q1": "accept" | {"option","text"}, "<fingerprint>": ...}."""
    dry_pack = s(getattr(cfg, "dry_pack", ""))
    if not dry_pack:
        return {}
    try:
        from ..llm.fake import resolve_pack
        path = os.path.join(resolve_pack(dry_pack), "dry", "human", "answers.json")
    except LineError:
        return {}
    if not os.path.isfile(path):
        return {}
    try:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def dry_answer_all(store: Any, run: str, *, cfg: Any = None, clock: Any = None,
                   env: Optional[Mapping[str, str]] = None) -> List[Dict[str, Any]]:
    """Answer every pending question as 'dry-auto': fixture answer by qid or fingerprint, else the
    recommended option. Only for dry e2e runs (LINE_DRY_HUMAN=auto)."""
    fx = _dry_fixture(cfg)
    results = []
    for _ in range(1000):
        qs = questions(store, run, OPEN) or questions(store, run, HELD)
        if not qs:
            break
        q = qs[0]
        qid = local_id(q["id"])
        ans = fx.get(qid, fx.get(q.get("fingerprint", ""), q.get("recommended")))
        results.append(answer_question(store, run, qid, ans, "dry-auto", cfg=cfg, clock=clock, env=env))
    return results


# ------------------------------------------------------------------ human questions off (human_mode=decide)

DECIDE_ROLE = "human_decider"
DECIDE_SCHEMA: Dict[str, Any] = {
    "type": "object", "required": ["option", "reason"],
    "properties": {"option": {"type": "string"}, "text": {"type": "string"}, "reason": {"type": "string"}},
}
WORKLOG_SUBJECT = "human questions off"


def human_mode(cfg: Any = None, env: Optional[Mapping[str, str]] = None) -> str:
    m = s(setting(cfg, "human_mode", env)).lower()
    return m if m in ("ask", "decide") else "ask"


def _decide_prompt(q: Mapping[str, Any], context: Sequence[Mapping[str, Any]]) -> str:
    lines = ["You decide one open question about a specification, in place of a person, because human questions",
             "are switched off for this run. Pick the option that best fits the quoted specification and the",
             "project knowledge below. Prefer the safest option when the evidence is thin. Answer with the option id;",
             "use option 'other' with a text only when no option fits.",
             "",
             "DECISION: " + s(q.get("decision")),
             "KIND: " + s(q.get("kind")),
             "OPTIONS:"]
    for o in q.get("options") or []:
        lines.append("- %s: %s (impact: %s)" % (s(o.get("id")), s(o.get("text")), s(o.get("impact"))))
    lines.append("RECOMMENDED: " + s(q.get("recommended")))
    lines.append("EVIDENCE:")
    for e in q.get("evidence") or []:
        lines.append('- [%s] "%s"' % (s(e.get("span_id")), s(e.get("quote"))))
    if context:
        lines.append("PROJECT KNOWLEDGE:")
        for c in context:
            lines.append("- " + s(c.get("text"))[:600])
    return "\n".join(lines)


def _context(rag: Any, q: Mapping[str, Any]) -> List[Dict[str, Any]]:
    """Findings and lessons near the decision (read only; a broken read decides without them)."""
    if rag is None or not hasattr(rag, "retrieve"):
        return []
    try:
        query = ("%s: %s" % (s(q.get("kind")), s(q.get("decision"))))[:2000]
        return list(rag.retrieve("decider", "understand", ["*"], 3000, query=query) or [])[:5]
    except Exception:  # noqa: BLE001 - context is optional
        return []


def _worklog(rag: Any, run: str, q: Mapping[str, Any], ans: Mapping[str, Any], reason: str, model: str,
             fallback: bool) -> bool:
    """One line per decision in the project worklog: the question, the options, what was chosen and why."""
    if rag is None or not hasattr(rag, "write_worklog"):
        return False
    opts = "; ".join("%s=%s" % (s(o.get("id")), s(o.get("text"))) for o in q.get("options") or [])
    quotes = " | ".join(s(e.get("quote"))[:200] for e in q.get("evidence") or [])
    text = ("Run %s, question %s (%s), human questions off: decided by %s without a person. Decision: %s. "
            "Options: %s. Chosen: %s (%s)%s. Reason: %s. Evidence: %s. F-items: %s." % (
                run, local_id(s(q.get("id"))), s(q.get("kind")), model, s(q.get("decision")), opts,
                ans.get("option"), ans.get("option_text"),
                " - the model answer was invalid, so the recommended option was taken" if fallback else "",
                reason, quotes, ", ".join(q.get("f_items") or []) or "-"))
    try:
        rag.write_worklog(WORKLOG_SUBJECT, text, "hq-%s-%s" % (run, local_id(s(q.get("id")))))
        return True
    except Exception:  # noqa: BLE001 - the decision stands; the event keeps the record
        return False


def decide_all(store: Any, run: str, llm: Any, *, rag: Any = None, cfg: Any = None, clock: Any = None,
               env: Optional[Mapping[str, str]] = None) -> List[Dict[str, Any]]:
    """human_mode=decide: the strong model answers every pending question itself (who = "model:<id>"),
    each decision is written to the project worklog and as a human.decided event. An answer that names no
    valid option falls back to the recommended option, marked as such. The last answer closes the round."""
    model = s(setting(cfg, "human_decide_model", env)) or s(getattr(cfg, "judge_model", "")) or None
    results = []
    for _ in range(1000):
        qs = questions(store, run, OPEN) or questions(store, run, HELD)
        if not qs:
            break
        q = qs[0]
        qid = local_id(q["id"])
        reason, fallback, ans = "", False, None
        try:
            res = llm.complete(DECIDE_ROLE, _decide_prompt(q, _context(rag, q)), DECIDE_SCHEMA, key=qid,
                               model=model, run=run)
            data = res.data or {}
            ans = {"option": s(data.get("option")), "text": s(data.get("text"))}
            reason = s(data.get("reason"))
            _norm_answer(q, ans)
        except LineError:
            fallback, ans = True, {"option": s(q.get("recommended")), "text": ""}
            reason = reason or "no valid model answer"
        who = "model:%s" % (model or "default")
        out = answer_question(store, run, qid, ans, who, cfg=cfg, clock=clock, env=env)
        logged = _worklog(rag, run, q, out["answer"], reason, who, fallback)
        emit(store, HUMAN_DECIDED, run, {"qid": qid, "option": out["answer"]["option"], "reason": reason[:500],
                                         "model": who, "fallback": fallback, "worklog": logged}, cfg,
             q.get("pack_version", ""))
        results.append(dict(out, reason=reason, fallback=fallback, worklog=logged))
    return results


# ------------------------------------------------------------------ API helpers for server.py


def api_questions(store: Any, run: str) -> Dict[str, Any]:
    order = {OPEN: 0, HELD: 1, ANSWERED: 2}
    qs = sorted(questions(store, run), key=lambda q: order.get(q.get("state"), 3))
    return {"run": run, "parked": is_parked(store, run), "park": park_state(store, run), "questions": qs}


def api_answers(store: Any, run: str, body: Mapping[str, Any], *, cfg: Any = None, clock: Any = None,
                env: Optional[Mapping[str, str]] = None) -> Tuple[int, Dict[str, Any]]:
    """POST body -> (http status, json). Every answer is applied in order; the round closes once."""
    if not isinstance(body, Mapping):
        return 400, {"error": {"code": codes.SCHEMA_INVALID, "message": "body is not an object"}}
    who = s(body.get("who"))
    items = body.get("answers")
    if items is None:
        items = [body]
    if not isinstance(items, list) or not items:
        return 400, {"error": {"code": codes.SCHEMA_INVALID, "message": "no answers"}}
    results = []
    status_of = {codes.SCHEMA_INVALID: 400, codes.NOT_FOUND: 404, codes.STATE_CONFLICT: 409}
    for i, it in enumerate(items):
        if not isinstance(it, Mapping):
            return 400, {"error": {"code": codes.SCHEMA_INVALID, "message": "answers[%d] is not an object" % i}}
        try:
            results.append(answer_question(store, run, s(it.get("qid")), {"option": it.get("option"), "text": it.get("text")},
                                           s(it.get("who")) or who, cfg=cfg, clock=clock, env=env, finalize=False))
        except LineError as e:
            return status_of.get(e.code, 400), {"error": e.to_dict(), "results": results}
    rest = pending(store, run)
    out: Dict[str, Any] = {"results": results, "remaining": len(rest), "addendum": None, "version": None, "resume": False}
    if not rest:
        out.update(close_round(store, run, cfg=cfg, clock=clock, env=env))
    return 200, out


__all__ = ["validate_question", "ask_round", "answer_question", "close_round", "pending", "questions",
           "check_timeouts", "dry_mode", "dry_answer_all", "park", "unpark", "is_parked", "park_state",
           "parked_f_items", "api_questions", "api_answers", "question_fingerprint", "OPEN", "HELD", "ANSWERED", "OTHER",
           "human_mode", "decide_all", "DECIDE_ROLE", "WORKLOG_SUBJECT"]

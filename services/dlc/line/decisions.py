"""The decision ledger: every choice a person (or the auto-approve check) makes at a gate, kept in three places so
nothing a person taught the system lives only in the run's detail:

  disk      <pack>/history/ in the run's pack folder, written when the decision is taken:
                decisions.jsonl                     one entry per decision, appended (the record)
                history.md                          the same entries for people, rewritten on each append
                <gate>-r<round>-<artifact>.md       each document as the person saw it when deciding (the spec's
                                                    history: what was sent back, what was approved)
            the build step copies history.md into the change (<persist.dir>/changes/<run>/decisions.md), so the
            living spec carries the decisions that shaped it
  store     one knowledge row per person's decision in the run's project (kind gate-decision): the decision, each
            point the agents decided alone with the person's answer (agreed / changed), the note, the gate chat of
            that round and the documents' brief; written when the decision is taken and again at run end (sync, same
            ids), so a store that was down then still gets them
  retro     retro_facts(): this run's decisions per gate with their signal; earlier(): the same agents' decisions in
            earlier runs of the project. Approved as proposed = positive (the way of working to keep); sent back,
            points changed, corrections asked in the chat, a final "hold" = negative (to correct, and to retire when
            people keep rejecting it)

An automatic decision is recorded on disk but is never a signal and never goes to the store as a person's decision.

    record(pack, entry) / entries(pack) / render(entries)
    entry(...) -> the entry of a decision (code, no model)
    to_kh(cfg, project, run, entry) / push(...) on a thread / sync(cfg, store, run)
    retro_facts(store, run) / earlier(cfg, project, personas, run)
Never raises from record(), to_kh() or sync(): the gate's own record (run detail, precedents) stands without them.
"""

from __future__ import annotations

import json
import os
import re
import threading
import time
from typing import Any, Dict, List, Optional

DIR = "history"
LEDGER = "decisions.jsonl"
READABLE = "history.md"
FILE = "decisions.md"       # the history's name in the change (<persist.dir>/changes/<run>/)
KIND = "gate-decision"
MAX_TEXT = 2000             # a note, an answer or a chat message as kept in an entry
MAX_ROW = 6000              # a store row (the store embeds the head and chunks the rest)
MAX_EARLIER = 8             # earlier decisions per persona shown to the retro
POSITIVE, NEGATIVE, MIXED, AUTO, NEUTRAL = "positive", "negative", "mixed", "auto", "neutral"

_LOCK = threading.Lock()


def folder(pack: str) -> str:
    return os.path.join(pack, DIR)


def _iso(ms: Any) -> str:
    try:
        return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(int(ms) / 1000.0))
    except (TypeError, ValueError):
        return ""


def _safe(name: str) -> str:
    return re.sub(r"[^\w.\-]+", "_", str(name))[:60] or "x"


# ------------------------------------------------------------------ building an entry (code)

def personas_of(r: Any, gd: Dict[str, Any]) -> List[str]:
    """The personas whose work a gate decides on: the agents of its draft step, or the build agent for a review."""
    from . import personas, solo
    step = next((s for s in r.steps() if s.get("id") == gd.get("_step")), {})
    roles = [str(a.get("role") or "") for a in step.get("agents") or []]
    if not roles and step.get("kind") == "review":
        build = next((s for s in r.steps() if s.get("kind") == "build"), {})
        roles = [str(build.get("role") or solo.ROLE)]
    return list(dict.fromkeys(p for role in roles if role for p in personas.for_role(role)))


def _points(asks: List[Dict[str, Any]], answers: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Each point the agents decided alone, with the person's answer: agreed (as proposed) or changed (their words)."""
    by = {(str(a.get("artifact") or ""), str(a.get("id") or "")): a for a in answers or []}
    out = []
    for a in asks:
        key = (str(a.get("artifact") or ""), str(a.get("id") or ""))
        ans = by.get(key)
        if ans is None:
            continue
        changed = not ans.get("ok") or bool(str(ans.get("text") or "").strip())
        out.append({"artifact": key[0], "id": key[1], "question": str(a.get("question") or "")[:400],
                    "status": str(a.get("status") or ""), "proposed": str(a.get("answer") or "")[:600],
                    "answer": "changed" if changed else "agreed",
                    "text": str(ans.get("text") or "").strip()[:MAX_TEXT]})
    return out


def _chat(msgs: List[Dict[str, Any]], rnd: int) -> List[Dict[str, Any]]:
    """The gate chat of one round: the person's messages and the agents' answers (with the documents they edited)."""
    out = []
    for m in msgs or []:
        if int(m.get("round") or 0) != rnd or m.get("state") in ("thinking",):
            continue
        row = {"who": m.get("who"), "by": m.get("by") or m.get("role") or "", "text": str(m.get("text") or "")[:MAX_TEXT],
               "ms": m.get("ms")}
        if m.get("edited"):
            row["edited"] = list(m["edited"])
        if m.get("state") == "failed":
            row["failed"] = True
        out.append(row)
    return out


def corrections(chat: List[Dict[str, Any]]) -> int:
    """Person's messages in a chat that made the agents change their documents: a reminder the draft was off."""
    n = 0
    for i, m in enumerate(chat):
        if m.get("who") == "person" and any(x.get("who") == "agent" and x.get("edited") for x in chat[i + 1:i + 2]):
            n += 1
    return n


def signal(e: Dict[str, Any]) -> str:
    """positive: approved as proposed; negative: sent back, or a pass that does not deliver (a final hold); mixed:
    approved after the person changed points or had the agents correct the documents in the chat."""
    if e.get("auto"):
        return AUTO
    if not e.get("personas"):
        return NEUTRAL
    if not e.get("passed") or e.get("held"):
        return NEGATIVE
    if e.get("changed") or e.get("chat_corrections"):
        return MIXED
    return POSITIVE


def entry(run: str, r: Any, gd: Dict[str, Any], d: Dict[str, Any], st: Dict[str, Any], pack: str,
          asks: Optional[List[Dict[str, Any]]] = None, auto: bool = False) -> Dict[str, Any]:
    """The ledger entry of decision `d` taken at gate `gd` (st = the run's gated state, documents as decided on).
    Writes the documents' snapshots into the pack's history folder."""
    from . import gatechat
    from .process import brief as BR
    gate = str(gd.get("name") or d.get("gate") or "")
    rnd = int(d.get("round") or 0)
    names = [n for n in gd.get("show") or [] if not str(n).startswith("@")]
    docs = {n: str((st.get(n) or {}).get("doc") or "") for n in names}
    snaps = {}
    try:
        if not (pack and os.path.isdir(pack)):      # the run's pack folder holds the history; never make one
            raise OSError(pack)
        os.makedirs(folder(pack), exist_ok=True)
        for n, text in docs.items():
            if text.strip():
                rel = "%s-r%d-%s.md" % (_safe(gate), rnd, _safe(n))
                with open(os.path.join(folder(pack), rel), "w", encoding="utf-8", newline="\n") as fh:
                    fh.write(text.rstrip() + "\n")
                snaps[n] = DIR + "/" + rel
    except OSError:
        pass
    glances = {}
    for n, text in docs.items():
        g = BR.glance(text, r.artifact(n)) if text else None
        if g:
            glances[n] = g
    points = _points(asks or [], d.get("answers") or [])
    chat = _chat(gatechat.messages(st, gate), rnd) if gd.get("chat") else []
    passed = str(d.get("decision") or "") in (gd.get("pass") or [])
    e = {"run": run, "gate": gate, "title": str(gd.get("title") or gate), "step": gd.get("step"), "round": rnd,
         "decision": d.get("decision"), "passed": passed,
         "held": passed and bool(gd.get("deliver")) and d.get("decision") not in (gd.get("deliver") or []),
         "revise": d.get("decision") in (gd.get("revise") or []), "target": d.get("target") or "",
         "by": d.get("by") or "", "ms": d.get("ms") or 0, "ts": _iso(d.get("ms")), "auto": bool(auto or d.get("auto")),
         "note": str(d.get("note") or "")[:MAX_TEXT * 2], "files": [f.get("name") for f in d.get("files") or []],
         "points": points, "agreed": sum(1 for p in points if p["answer"] == "agreed"),
         "changed": sum(1 for p in points if p["answer"] == "changed"), "chat": chat,
         "chat_corrections": corrections(chat), "documents": snaps, "glance": glances,
         "personas": personas_of(r, gd) if gate != "needs" else [], "process": r.ref() if hasattr(r, "ref") else ""}
    if d.get("precedents"):
        e["precedents"] = list(d["precedents"])
    e["signal"] = signal(e)
    return e


# ------------------------------------------------------------------ disk

def record(pack: str, e: Dict[str, Any]) -> bool:
    """Append the entry to <pack>/history/decisions.jsonl and rewrite history.md. -> written"""
    if not (pack and os.path.isdir(pack)):          # the run's pack folder holds the history; never make one
        return False
    try:
        with _LOCK:
            os.makedirs(folder(pack), exist_ok=True)
            with open(os.path.join(folder(pack), LEDGER), "a", encoding="utf-8", newline="\n") as fh:
                fh.write(json.dumps(e, ensure_ascii=False, sort_keys=True) + "\n")
            with open(os.path.join(folder(pack), READABLE), "w", encoding="utf-8", newline="\n") as fh:
                fh.write(render(entries(pack)))
        return True
    except OSError:
        return False


def entries(pack: str) -> List[Dict[str, Any]]:
    out = []
    try:
        with open(os.path.join(folder(pack), LEDGER), encoding="utf-8") as fh:
            for ln in fh:
                try:
                    out.append(json.loads(ln))
                except ValueError:
                    continue
    except OSError:
        pass
    return out


def render(rows: List[Dict[str, Any]]) -> str:
    """The ledger for people (and for the living spec)."""
    if not rows:
        return ""
    out = ["# Decisions at the gates, run %s" % rows[0].get("run"), "",
           "Every decision taken at a gate of this run, oldest first. Signal: positive = approved as the agents "
           "proposed; mixed = approved after a person changed points or had the documents corrected; negative = sent "
           "back, or held at the final review.", ""]
    for e in rows:
        out.append("## %s, round %s: %s by %s (%s)" % (e.get("title") or e.get("gate"), e.get("round"),
                                                      str(e.get("decision") or "").upper(), e.get("by") or "-",
                                                      e.get("ts") or "-"))
        out.append("")
        out.append("- gate `%s`, signal **%s**%s" % (e.get("gate"), e.get("signal"),
                                                    ", target %s" % e["target"] if e.get("target") else ""))
        if e.get("personas"):
            out.append("- agents: %s" % ", ".join(e["personas"]))
        if e.get("precedents"):
            out.append("- auto-approved on precedents: %s" % ", ".join(e["precedents"]))
        for n, rel in sorted((e.get("documents") or {}).items()):
            out.append("- %s as decided on: `%s`" % (n, rel))
        if e.get("files"):
            out.append("- files the person attached: %s" % ", ".join(e["files"]))
        if e.get("points"):
            out += ["", "| point | question | agents proposed | person |", "|---|---|---|---|"]
            for p in e["points"]:
                person = "agreed" if p["answer"] == "agreed" else "CHANGED: " + p["text"]
                out.append("| %s %s | %s | %s | %s |" % (p["artifact"], p["id"], _cell(p["question"]),
                                                        _cell(p["proposed"]), _cell(person)))
        if str(e.get("note") or "").strip():
            out += ["", "Note:", "", _quote(e["note"])]
        if e.get("chat"):
            out += ["", "Chat at the gate:", ""]
            for m in e["chat"]:
                who = "person (%s)" % m.get("by") if m.get("who") == "person" else "agent (%s)" % m.get("by")
                edited = " [changed %s]" % ", ".join(m["edited"]) if m.get("edited") else ""
                out.append("- **%s**%s: %s" % (who, edited, _cell(m.get("text") or "")))
        out.append("")
    return "\n".join(out)


def _cell(text: str) -> str:
    return re.sub(r"\s+", " ", str(text or "")).replace("|", "\\|")[:600]


def _quote(text: str) -> str:
    return "\n".join("> " + ln for ln in str(text).splitlines())


# ------------------------------------------------------------------ the knowledge store

def _kh(cfg: Any, method: str, path: str, body: Any = None) -> Dict[str, Any]:
    from .understand import sizer
    return sizer._kh(cfg, method, path, body)


def _kh_on(cfg: Any) -> bool:
    try:
        from .understand import sizer
        return sizer._kh_on(cfg)
    except Exception:   # noqa: BLE001
        return False


def row_id(e: Dict[str, Any]) -> str:
    return "gd_%s_%s_r%s" % (str(e.get("run") or "").lower().replace("-", "_"), _safe(e.get("gate")).lower(),
                             e.get("round"))


def text_of(e: Dict[str, Any], project: str) -> str:
    lines = ["GATE DECISION (project %s, run %s, gate %s '%s', round %s): %s by %s at %s. SIGNAL: %s. Agents: %s." % (
        project, e.get("run"), e.get("gate"), e.get("title"), e.get("round"), str(e.get("decision") or "").upper(),
        e.get("by") or "-", e.get("ts") or "-", e.get("signal"), ", ".join(e.get("personas") or []) or "-")]
    for p in e.get("points") or []:
        lines.append("POINT %s %s (%s): %s | agents proposed: %s | person: %s" % (
            p["artifact"], p["id"], p["status"], p["question"][:200], p["proposed"][:200],
            "agreed" if p["answer"] == "agreed" else "CHANGED -> " + p["text"][:400]))
    if str(e.get("note") or "").strip():
        lines.append("PERSON'S NOTE: " + str(e["note"])[:1500])
    for m in e.get("chat") or []:
        lines.append("CHAT %s: %s%s" % ("PERSON" if m.get("who") == "person" else "AGENT",
                                        str(m.get("text") or "")[:500],
                                        " [changed %s]" % ", ".join(m["edited"]) if m.get("edited") else ""))
    for n, g in (e.get("glance") or {}).items():
        lines.append("%s AT A GLANCE: will do %s; will not do %s" % (
            n.upper(), "; ".join(g.get("will_do") or [])[:400], "; ".join(g.get("will_not") or [])[:300]))
    return "\n".join(lines)[:MAX_ROW]


def to_kh(cfg: Any, project: str, run: str, e: Dict[str, Any]) -> bool:
    """One knowledge row in the run's project for a person's decision (an auto decision is not one). -> written"""
    if e.get("auto") or e.get("signal") == NEUTRAL or not project or not _kh_on(cfg):
        return False
    meta = {"scope": "knowledge", "project": project, "kind": KIND, "topic": KIND,
            "subject": "gate decision %s %s r%s" % (run, e.get("gate"), e.get("round")), "run": run,
            "gate": e.get("gate"), "round": e.get("round"), "decision": e.get("decision"), "signal": e.get("signal"),
            "personas": ",".join(e.get("personas") or []), "by": e.get("by") or "", "ts": e.get("ts") or "",
            "agreed": e.get("agreed", 0), "changed": e.get("changed", 0),
            "chat_corrections": e.get("chat_corrections", 0), "process": e.get("process") or ""}
    try:
        _kh(cfg, "POST", "/vector/add", {"id": row_id(e), "text": text_of(e, project), "scope": "knowledge",
                                         "metadata": meta})
        return True
    except Exception:   # noqa: BLE001 - sync() at run end writes it again
        return False


_PUSHES: List[threading.Thread] = []


def push(cfg: Any, project: str, run: str, e: Dict[str, Any]) -> Any:
    """to_kh() on a thread, so a person's click never waits for the store. -> "queued", or False when the entry
    does not go to the store (an auto or neutral decision, no project, store off)."""
    if e.get("auto") or e.get("signal") == NEUTRAL or not project or not _kh_on(cfg):
        return False
    t = threading.Thread(target=to_kh, args=(cfg, project, run, e), name="decision-to-kh", daemon=True)
    _PUSHES[:] = [x for x in _PUSHES if x.is_alive()] + [t]
    t.start()
    return "queued"


def flush(timeout: float = 30.0) -> None:
    """Wait for the queued writes (tests, shutdown)."""
    for t in list(_PUSHES):
        t.join(timeout)


def project_of(cfg: Any, detail: Dict[str, Any]) -> str:
    from .understand import sizer
    return sizer.cases_project(cfg, detail)


def sync(cfg: Any, store: Any, run: str) -> int:
    """Write every person's decision of the run to the store again (same ids: a store that was down gets them now)."""
    from .contracts import E_RUN
    try:
        row = store.get(E_RUN, run) or {}
        project = project_of(cfg, row.get("detail") or {})
        return sum(1 for e in entries(str(row.get("pack_path") or "")) if to_kh(cfg, project, run, e))
    except Exception:   # noqa: BLE001
        return 0


# ------------------------------------------------------------------ people's side (API)

def view(store: Any, run: str, doc: str = "") -> Optional[Dict[str, Any]]:
    """GET /api/runs/{run}/decisions: the run's decisions (entries, the readable history, counts per persona), or
    with doc=<path of a document in the history> that document as the person saw it. None = no such run;
    KeyError = no such document."""
    from .contracts import E_RUN
    row = store.get(E_RUN, run)
    if row is None:
        return None
    pack = str(row.get("pack_path") or "")
    if doc:
        rel = os.path.normpath(doc.replace("\\", "/")).replace("\\", "/")
        if not rel.startswith(DIR + "/") or ".." in rel.split("/") or not rel.endswith(".md"):
            raise KeyError(doc)
        try:
            with open(os.path.join(pack, *rel.split("/")), encoding="utf-8") as fh:
                return {"run": run, "path": rel, "text": fh.read()}
        except OSError:
            raise KeyError(doc) from None
    rows = entries(pack)
    return {"run": run, "entries": rows, "markdown": render(rows), "signal": counts(retro_facts(store, run))}


# ------------------------------------------------------------------ the retro's side

def retro_facts(store: Any, run: str) -> List[Dict[str, Any]]:
    """This run's decisions for the retro (code): per decision its signal, the personas it judges, the points the
    person changed with their words, the note and the corrections asked in the chat."""
    from .contracts import E_RUN
    row = store.get(E_RUN, run) or {}
    out = []
    for e in entries(str(row.get("pack_path") or "")):
        if e.get("signal") in (AUTO, NEUTRAL):
            continue
        out.append({"gate": e.get("gate"), "round": e.get("round"), "decision": e.get("decision"),
                    "signal": e.get("signal"), "personas": e.get("personas") or [], "by": e.get("by"),
                    "agreed": [p["artifact"] + " " + p["id"] for p in e.get("points") or [] if p["answer"] == "agreed"],
                    "changed": [{"point": p["artifact"] + " " + p["id"], "question": p["question"][:200],
                                 "agents_proposed": p["proposed"][:300], "person": p["text"][:500]}
                                for p in e.get("points") or [] if p["answer"] == "changed"],
                    "note": str(e.get("note") or "")[:1200],
                    "chat_corrections": [m["text"][:400] for i, m in enumerate(e.get("chat") or [])
                                         if m.get("who") == "person" and any(
                                             x.get("who") == "agent" and x.get("edited")
                                             for x in (e.get("chat") or [])[i + 1:i + 2])]})
    return out


def counts(rows: List[Dict[str, Any]]) -> Dict[str, Dict[str, int]]:
    """{persona: {positive, mixed, negative, points_agreed, points_changed, chat_corrections}} over decisions."""
    out: Dict[str, Dict[str, int]] = {}
    for e in rows:
        for p in e.get("personas") or []:
            c = out.setdefault(p, {POSITIVE: 0, MIXED: 0, NEGATIVE: 0, "points_agreed": 0, "points_changed": 0,
                                   "chat_corrections": 0})
            sig = e.get("signal")
            if sig in (POSITIVE, MIXED, NEGATIVE):
                c[sig] += 1
            c["points_agreed"] += len(e.get("agreed") or [])
            c["points_changed"] += len(e.get("changed") or [])
            c["chat_corrections"] += len(e.get("chat_corrections") or [])
    return out


def earlier(cfg: Any, project: str, personas: List[str], run: str) -> Dict[str, Any]:
    """The same agents' decisions in earlier runs of the project (store rows of kind gate-decision): counts per signal and
    the latest negative and mixed ones with what the person said, so the retro sees a way of working people keep
    rejecting. {} when the store is off or holds none."""
    if not (project and personas and _kh_on(cfg)):
        return {}
    try:
        hits = _kh(cfg, "POST", "/vector/scroll", {"scope": "knowledge", "project": project,
                                                   "filter": {"kind": KIND}, "limit": 500}).get("hits") or []
    except Exception:   # noqa: BLE001
        return {}
    out: Dict[str, Any] = {}
    for p in personas:
        mine = []
        for h in hits:
            m = h.get("metadata") or {}
            if m.get("kind") != KIND or m.get("run") == run or p not in str(m.get("personas") or "").split(","):
                continue
            mine.append((str(m.get("ts") or ""), m, str(h.get("source_text") or "")))
        if not mine:
            continue
        mine.sort(key=lambda x: x[0])
        c = {POSITIVE: 0, MIXED: 0, NEGATIVE: 0}
        for _, m, _t in mine:
            if m.get("signal") in c:
                c[m["signal"]] += 1
        bad = [{"run": m.get("run"), "gate": m.get("gate"), "decision": m.get("decision"), "signal": m.get("signal"),
                "said": t[:700]} for _, m, t in mine if m.get("signal") in (NEGATIVE, MIXED)][-MAX_EARLIER:]
        out[p] = dict(c, runs=len({m.get("run") for _, m, _t in mine}), latest_not_approved_as_proposed=bad)
    return out


__all__ = ["record", "entries", "render", "entry", "signal", "to_kh", "push", "flush", "sync", "view", "retro_facts",
           "counts", "earlier", "personas_of", "KIND", "DIR", "FILE"]

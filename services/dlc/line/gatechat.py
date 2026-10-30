"""A person talks with the agents of a draft step while its gate waits (the gate says "chat": true in the process
definition). The agents answer from their documents, the request and a read-only checkout of main; when the person
asks for a change, they change their documents right away and say what they changed. The decision (approve, send
back) stays the gate's own; the frontend renders it inside the chat.

    messages(gated_state, gate)               the conversation of a gate, oldest first
    post(store, cfg, run, gate, body, actor, roles, start)
                                              POST /api/runs/{run}/gates/{gate}/chat {"message", "who"?}: the
                                              person's message and an agent reply "thinking"; start(fn) runs the
                                              answer (a thread in the server)
    answer(store, cfg, run, gate, mid, make_pipe)
                                              the agent's answer to the message `mid`; edits are applied only while
                                              the gate is still open and undecided (else kept in the chat, unused)

DETAIL_LOCK serialises the read-modify-write of a run's detail between a decision (line.gates.decide) and a chat
answer, so neither loses the other's write.
"""

from __future__ import annotations

import os
import re
import shutil
import threading
import uuid
from typing import Any, Callable, Dict, List, Optional

from .contracts import E_RUN, now_ms
from .statemachine import update_row

DETAIL_LOCK = threading.RLock()
MAX_MESSAGE = 8000
MAX_KEPT = 200
HISTORY = 12                                  # earlier messages the agent reads
PROMPT = "gate_chat"
DOC_RX = re.compile(r"^=== DOCUMENT ([\w.-]+) ===[ \t]*\n(.*?)\n=== END ===[ \t]*$", re.M | re.S)


def messages(st: Dict[str, Any], gate: str) -> List[Dict[str, Any]]:
    return list((st.get("chat") or {}).get(gate) or [])


def _ctx(store: Any, run: str):
    from . import gates
    row = store.get(E_RUN, run) or {}
    if not row:
        raise KeyError(run)
    detail = dict(row.get("detail") or {})
    r = gates._resolved_of(detail)
    st = dict(detail.get("gated") or {})
    return row, detail, r, st


def _step(r: Any, gd: Dict[str, Any]) -> Dict[str, Any]:
    return next((s for s in r.steps() if s.get("id") == gd.get("_step")), {})


def post(store: Any, cfg: Any, run: str, gate: str, body: Dict[str, Any], actor: str = "",
         roles: Optional[List[str]] = None, start: Optional[Callable[[Callable[[], None]], None]] = None
         ) -> Dict[str, Any]:
    from . import gates
    text = str((body or {}).get("message") or "").strip()
    if not text:
        raise ValueError("message is empty")
    if len(text) > MAX_MESSAGE:
        raise ValueError("message is longer than %d characters" % MAX_MESSAGE)
    with DETAIL_LOCK:
        row, detail, r, st = _ctx(store, run)
        g = detail.get("gate") or {}
        if g.get("name") != gate:
            raise ValueError("gate %s is not open on run %s (open: %s)" % (gate, run, g.get("name") or "none"))
        gd = gates._gate_def(r, st, gate)
        if not gd.get("chat"):
            raise ValueError("gate %s has no chat (the process definition says chat: true to allow it)" % gate)
        approvers = list(gd.get("approvers") or [])
        if approvers and roles is not None and not set(approvers) & set(roles):
            raise PermissionError("gate %s is decided by %s" % (gate, " or ".join(approvers)))
        if (st.get("pending") or {}).get(gate):
            raise ValueError("a decision was already taken at gate %s; the run goes on" % gate)
        msgs = messages(st, gate)
        if any(m.get("state") == "thinking" for m in msgs):
            raise ValueError("the agent is still answering the last message")
        step = _step(r, gd)
        agents = list(step.get("agents") or [])
        role = str(agents[0]["role"]) if agents else "agent"
        rnd = int(g.get("round") or 1)
        mine = {"id": uuid.uuid4().hex[:12], "who": "person", "by": str((body or {}).get("who") or actor or
                                                                          "a person")[:120],
                "text": text, "ms": now_ms(), "round": rnd}
        reply = {"id": uuid.uuid4().hex[:12], "who": "agent", "role": role, "state": "thinking", "text": "",
                 "ms": now_ms(), "round": rnd, "reply_to": mine["id"]}
        chat = dict(st.get("chat") or {})
        chat[gate] = (msgs + [mine, reply])[-MAX_KEPT:]
        st["chat"] = chat
        detail["gated"] = st
        update_row(store, E_RUN, run, {"detail": detail})
    if start is not None:
        start(lambda: answer(store, cfg, run, gate, reply["id"]))
    return {"gate": gate, "messages": chat[gate]}


def _set(store: Any, run: str, gate: str, mid: str, apply: Optional[Dict[str, str]], **kv: Any) -> Dict[str, Any]:
    """Write the reply `mid` (and the edited documents when the gate is still open and undecided)."""
    with DETAIL_LOCK:
        row, detail, r, st = _ctx(store, run)
        open_ = (detail.get("gate") or {}).get("name") == gate and not (st.get("pending") or {}).get(gate)
        msgs = messages(st, gate)
        for m in msgs:
            if m.get("id") == mid:
                m.update(kv)
                if apply and not open_:
                    m["edited"] = []
                    m["text"] = (m.get("text") or "") + "\n\n(The decision was taken before this answer: the " \
                                                        "document changes above were not applied.)"
                elif apply:
                    for name, doc in apply.items():
                        cur = dict(st.get(name) or {})
                        cur.update(doc=doc, chat_edit_ms=now_ms())
                        st[name] = cur
                    m["edited"] = sorted(apply)
        chat = dict(st.get("chat") or {})
        chat[gate] = msgs
        st["chat"] = chat
        detail["gated"] = st
        update_row(store, E_RUN, run, {"detail": detail})
        return next((m for m in msgs if m.get("id") == mid), {})


def _pipe(store: Any, cfg: Any, run: str) -> Any:
    """A pipeline object for the parked run, as the driver builds one for a retro (its LLM, budget, workdir)."""
    from .pipeline import Pipeline
    from .ragmap import run_cfg
    row = store.get(E_RUN, run) or {}
    p = Pipeline(store, run_cfg(cfg, str((row.get("detail") or {}).get("rag_project") or "")))
    p.run = run
    p._setup(row)
    p.repo = str((row.get("detail") or {}).get("target") or "")
    return p


def _checkout(pipe: Any) -> str:
    from . import changequeue as Q
    from .ship._util import git
    wt = os.path.join(pipe.workdir, "gate-chat")
    with Q.repo_lock(pipe.repo):
        git(pipe.repo, "worktree", "prune", check=False)
        if os.path.isdir(wt):
            git(pipe.repo, "worktree", "remove", "--force", wt, check=False)
            shutil.rmtree(wt, ignore_errors=True)
        git(pipe.repo, "worktree", "add", "-q", "--detach", wt, "main")
    return wt


def _drop(pipe: Any, wt: str) -> None:
    from . import changequeue as Q
    from .ship._util import git
    with Q.repo_lock(pipe.repo):
        git(pipe.repo, "worktree", "remove", "--force", wt, check=False)
    shutil.rmtree(wt, ignore_errors=True)


def _template(r: Any) -> str:
    """The definition's chat prompt; a run that froze its definition before chat existed reads the seed's."""
    try:
        return r.prompt(PROMPT)
    except ValueError:
        from .process.definition import SEED
        with open(os.path.join(SEED, "prompts", PROMPT + ".md"), encoding="utf-8") as fh:
            return fh.read()


def _conversation(msgs: List[Dict[str, Any]], mid: str) -> str:
    done = [m for m in msgs if m.get("id") != mid and m.get("state") not in ("thinking", "failed")]
    lines = []
    for m in done[-HISTORY:]:
        who = "PERSON (%s)" % m.get("by") if m.get("who") == "person" else "YOU"
        lines.append("%s: %s" % (who, str(m.get("text") or "")[:3000]))
    return "\n".join(lines) or "(none: this is the first message)"


def answer(store: Any, cfg: Any, run: str, gate: str, mid: str, make_pipe: Optional[Callable[..., Any]] = None
           ) -> Dict[str, Any]:
    """The agent's answer to reply slot `mid`. Never raises: a failure is written into the reply."""
    from . import gates
    from .process import artifacts as A
    from .process import checks as C
    try:
        row, detail, r, st = _ctx(store, run)
        gd = gates._gate_def(r, st, gate)
        step = _step(r, gd)
        agents = list(step.get("agents") or [])
        names = [a["artifact"] for a in agents]
        msgs = messages(st, gate)
        me = next(m for m in msgs if m.get("id") == mid)
        asked = next((m for m in msgs if m.get("id") == me.get("reply_to")), {})
        pipe = (make_pipe or _pipe)(store, cfg, run)
        wt = _checkout(pipe)
        try:
            values = gates._values(pipe, r, wt)
            docs = "\n\n".join("=== DOCUMENT %s (%s) ===\n%s\n=== END ===" % (
                n, r.artifact(n).get("title") or n, str((st.get(n) or {}).get("doc") or "")) for n in names)
            prompt = C.render(_template(r), dict(values, docs=docs, names=", ".join(names),
                                                       step=str(gd.get("title") or gate),
                                                       conversation=_conversation(msgs, mid),
                                                       message=str(asked.get("text") or "")))
            res = pipe.llm.agentic(str(me.get("role") or "agent"), wt, prompt,
                                   int(getattr(cfg, "gate_plan_turns", 60) or 60),
                                   float(getattr(cfg, "gate_plan_usd", 1.5) or 1.5),
                                   key="gate-chat-%s-%s" % (gate, mid), run=run)
        finally:
            _drop(pipe, wt)
            try:
                pipe._charge_stage()                   # the answer is paid from the run's budget
            except Exception:   # noqa: BLE001
                pass
        out = str(getattr(res, "text", "") or "")
        edits: Dict[str, str] = {}
        for m in DOC_RX.finditer(out):
            if m.group(1) in names and m.group(2).strip():
                edits[m.group(1)] = A.document(m.group(2), r.artifact(m.group(1)))
        said = DOC_RX.sub("", out)
        said = re.sub(r"\n\s*SUBMIT\s*$", "", said.strip()).strip()
        if not said:
            said = "Done: I changed %s." % ", ".join(sorted(edits)) if edits else "(no answer)"
        return _set(store, run, gate, mid, edits or None, state="done", text=said,
                    usd=round(float(getattr(res, "usd", 0) or 0), 4), ms_done=now_ms())
    except Exception as e:   # noqa: BLE001 - a failed answer is shown in the chat; the gate still waits
        return _set(store, run, gate, mid, None, state="failed", text="The agent could not answer: %s" % e,
                    ms_done=now_ms())


__all__ = ["DETAIL_LOCK", "messages", "post", "answer"]

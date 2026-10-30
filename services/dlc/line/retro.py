"""The calibration retro: after EVERY finished run (green or escalated), compare what the agents predicted with what
actually happened, and feed the difference back into the knowledge store, so the next run starts wiser.

    facts(pipe)      code, not the model: the sizer's prediction, the merged change's real footprint (files, lines),
                     build rounds, reviewer misses, escalation, cost, and people's gate decisions with their signal
                     per persona, this run's and the same personas' in earlier runs (line.decisions)
    run(pipe)        one retro model call (role retro) with the facts, the sizer persona's rules, the persona's open
                     findings and the retro's own persona rules -> JSON verdict; then apply():
    apply(...)       * the run's sizing case gets the ACTUAL outcome and the lesson (what precedents show next time)
                     * findings in the persona project of the agent that was off (kind persona-finding), counted:
                       seen / confirmed / contradicted; an existing finding is confirmed, not repeated
                     * a finding confirmed PROMOTE_AT times (more confirmations than contradictions) that proposes a
                       rule change is applied to that persona's policy (rewrite, add or retire a rule), unless the
                       rule is PROTECTED; every change is kept as a history row in the persona project

The retro never grades itself (its own persona, agent-retro, holds how to do a retro); it runs on its own model
role, never the agent it judges. Failed runs still get the older agentic retro (agent_memory.retro_after_failure)
for their root cause. Off with LINE_RETRO=0 (or LINE_AGENT_LEARN=0). Never raises.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import time
import urllib.parse
from typing import Any, Dict, List, Optional

ROLE = "retro"
PERSONA = "agent-retro"
SIZER_PERSONA_DEFAULT = "agent-sizer"
FINDING_KIND = "persona-finding"
HISTORY_KIND = "persona-change"
VERDICT_KIND = "retro-verdict"
SIZER_ACTION = "size a request"
RETRO_ACTION = "run a retro"
PROMOTE_AT = 2
HUMAN_REVIEW = "human_review"       # a person's final review of a gated run (line.gates): decision + solutions
RULE_MAX_CHARS = 1150       # the store lints policy rules at 1200 characters (one imperative step)
#: persona rules a retro may never change on its own (a person does)
PROTECTED = frozenset({"two axes", "level", "report"})
#: the retro's own rules it may never change on its own
SELF_PROTECTED = frozenset({"facts only"})
LOCKFILES = ("package-lock.json", "yarn.lock", "pnpm-lock.yaml", "poetry.lock", "Pipfile.lock")

PROMPT = """You are the calibration retro of an automated delivery line. A run has finished. Compare what the
agents predicted with what actually happened and say what the agents should learn. Use only the facts below.

HOW YOU WORK (your own persona agent-retro, action 'run a retro'; each rule with its name; follow it):
{retro_rules}

YOUR EARLIER VERDICTS, next to the size the code measured afterwards (check yourself: a verdict that disagrees with
the measured footprint, or calls a run 'right' although a cheaper level would clearly have done the same work, is
your own mistake; find which of YOUR rules caused it):
{verdicts}

OPEN FINDINGS ABOUT YOUR OWN WORK (persona agent-retro):
{self_findings}

ALREADY FIXED IN YOUR PERSONA (do not open these again):
{self_fixed}

AUDIT YOUR OWN RULES every time: a rule of yours that contradicts another of your rules, or that would make you
ignore the measured facts (e.g. call a run 'right' whatever its footprint), is a self-finding with a rule change,
even when you did not follow it this time.
A rule change you propose must make the rule agree with the measured facts; do not keep the part of a rule that the
facts contradict.

RUN FACTS (gathered by code):
{facts}

THE SIZER'S CURRENT RULES (persona {persona}; each with its name):
{rules}

OPEN FINDINGS ALREADY IN THE SIZER'S PERSONA (id, counts, title):
{findings}

THE OTHER AGENTS THAT WORKED IN THIS RUN (their outcome is under "agents" in the run facts, one entry per model
role: its calls and cost from the ledger, what it recorded, and the personas it works by; an entry named
"<role>@<run>" is a claim made on the failed run this one retried, judged by this run's result). Below, each persona
with its rules and open findings. Judge each one only from its own outcome: a first gate red, extra rounds, a QAS failure,
a reviewer miss that was false or a pass that QAS contradicted, a supervisor hint after which the same failure came
back, an explanation the retry contradicted, a lesson the judge approved with no case or rejected for a fixable
reason; for any other agent: a BLOCKED or failed outcome, or a recorded result that shows it did not do what it was
asked (e.g. conflicts left unresolved). A BLOCKED stop (blocked_kind, blocked_reason; on a retried run under
"<role>@<run>") is judged on what the agent said is missing: unjustified when the retry finished the work without
anyone supplying it. An agent with no rules yet still gets findings; a finding confirmed twice may
add its first rule (op add). An agent whose outcome was clean gets no finding.
{agents}

When the run facts hold "human_review", a PERSON reviewed this run's result: "solutions" are their corrected
solutions to the findings. Each correction outranks the agents' own record: make it a finding (action new, or confirm
an existing one) on the persona of the agent whose work it corrects (Spec Agent: agent-spec-analyst, Domain Agent:
agent-domain-agent, QC Agent: agent-test-author, the build: agent-solo), with the person's words as the evidence and,
when it states how the agent must work from now on, a rule change.

When the run facts hold "human_decisions", they are the decisions PEOPLE took at the gates of this run, one per gate
and round, each with the personas whose work it decided on and its signal; "human_signal" counts them per persona and
"earlier_human_decisions" holds the same personas' decisions in earlier runs of this project. They outrank every
other fact about how these agents should work:
- signal "positive" (approved as the agents proposed, every point agreed): the way of working that produced it is
  right. Keep it: contradict an open finding of that persona that would change it, and never propose a rule change
  against it. A practice approved as proposed in several runs may become a rule (op add) through a finding that says
  so, confirmed like any other.
- signal "negative" (sent back, or held at the final review) or "mixed" (approved only after the person changed
  points or had the documents corrected in the chat): every changed point ("changed": what the agents proposed and the
  person's words), the note and every chat correction shows what the agent got wrong. Make it a finding on that persona
  (confirm an existing one about the same problem rather than opening a new one), with the person's words as the
  evidence and the rule change that makes the agent do what the person asked.
- when earlier_human_decisions shows people rejecting or correcting the same way of working in other runs too, confirm
  the existing finding and propose op "rewrite" of the rule that causes it, or op "retire" when that way of working
  must stop: a practice people keep rejecting or reminding about must not stay a rule.

Answer with ONE JSON object and nothing after it:
{{"verdict": "right|over|under", "actual_size": "S|M|L", "why": "<one sentence with the numbers>",
  "case_lesson": "<one or two sentences a later sizer should read next to this request>",
  "findings": [{{"persona": "<agent-... the finding is about; {persona} when empty>",
    "action": "new|confirm|contradict", "id": "<existing id for confirm/contradict, else empty>",
    "title": "<the problem as a later agent of that persona would meet it>", "evidence": "<run facts that show it>",
    "cause": "<which rule or habit caused it>",
    "rule_change": {{"op": "rewrite|add|retire|none", "sub_action": "<rule name>", "content": "<new rule text, at most 900 characters, one imperative rule>"}}}}],
  "self_findings": [<same shape as findings, about YOUR OWN rules in agent-retro>]}}
Return an empty findings list when every agent did its part and no rule misled it, and an empty self_findings list
when your earlier verdicts agree with the measured facts."""


def enabled(cfg: Any) -> bool:
    if os.environ.get("LINE_RETRO", "1").strip() == "0" or os.environ.get("LINE_AGENT_LEARN", "1").strip() == "0":
        return False
    from .understand import sizer
    return sizer._kh_on(cfg)


def _kh(cfg: Any, method: str, path: str, body: Any = None) -> Dict[str, Any]:
    from .understand import sizer
    return sizer._kh(cfg, method, path, body)


# ------------------------------------------------------------------ facts (code)

def size_of(files: int, lines: int) -> str:
    """The footprint size of a merged change: S under 500 changed lines and at most 12 files, M under 1500 lines and
    at most 30 files, else L (lockfiles left out)."""
    if lines < 500 and files <= 12:
        return "S"
    if lines < 1500 and files <= 30:
        return "M"
    return "L"


def footprint(repo: str, sha: str) -> Dict[str, Any]:
    """Files and lines a commit changed (git show --numstat), lockfiles left out; {} when unknown."""
    if not (repo and sha):
        return {}
    from .ship._util import git
    cp = git(repo, "show", "--numstat", "--format=", sha, check=False)
    files = added = deleted = tests = 0
    for line in (cp.stdout or "").splitlines():
        parts = line.split("\t")
        if len(parts) != 3 or parts[2].rsplit("/", 1)[-1] in LOCKFILES:
            continue
        a = int(parts[0]) if parts[0].isdigit() else 0
        d = int(parts[1]) if parts[1].isdigit() else 0
        files, added, deleted = files + 1, added + a, deleted + d
        if re.search(r"(^|/)tests?/|\.test\.|_test\.|test_", parts[2]):
            tests += a
    if not files:
        return {}
    return {"files": files, "added": added, "deleted": deleted, "test_lines_added": tests,
            "size": size_of(files, added + deleted)}


def facts(pipe: Any) -> Dict[str, Any]:
    from .contracts import E_RUN
    row = pipe.store.get(E_RUN, pipe.run) or {}
    detail = row.get("detail") or {}
    sizing = detail.get("sizing") or {}
    solo = detail.get("solo") or {}
    sha = str(solo.get("merged") or solo.get("built") or detail.get("merged_sha") or "")   # built: QAS may have failed
    attempts = solo.get("attempts") or []
    out = {
        "run": pipe.run, "state": row.get("state"), "flow": detail.get("flow"),
        "escalation": (detail.get("escalation") or {}).get("code") or "",
        "predicted": {"level": sizing.get("level"), "lane": sizing.get("lane"), "by": sizing.get("by"),
                      "requirement_size": sizing.get("requirement_size"), "app_size": sizing.get("app_size"),
                      "measure": sizing.get("measure") or "",
                      "reasons": (sizing.get("reasons") or [])[:4]},
        "actual": footprint(getattr(pipe, "repo", "") or "", sha),
        "build_rounds": len(attempts), "review_misses": sum(len(a.get("review") or []) for a in attempts),
        "spent_usd": round(float(detail.get("spent_usd") or 0), 2),
        "decisions": len(solo.get("decisions") or []),
    }
    out["agents"] = agent_facts(pipe, row, detail)
    review = (detail.get("outcomes") or {}).get(HUMAN_REVIEW)
    if review:                               # the gated flow's final review (line.gates step 13): a person's verdict
        out["human_review"] = review
    from . import decisions                  # every person's decision at the gates (line.decisions): the signal
    taken = decisions.retro_facts(pipe.store, pipe.run)
    if taken:
        out["human_decisions"] = taken
        out["human_signal"] = decisions.counts(taken)
        from .understand import sizer
        past = decisions.earlier(getattr(pipe, "cfg", None), sizer.cases_project(getattr(pipe, "cfg", None), detail),
                                 sorted(out["human_signal"]), pipe.run)
        if past:
            out["earlier_human_decisions"] = past
    return out


def agent_facts(pipe: Any, row: Dict[str, Any], detail: Dict[str, Any]) -> Dict[str, Any]:
    """Every agent that worked on the run, from line.outcomes (the ledger plus what each agent recorded, and the
    claims a retried run's agents made), with the personas it works by. The same for every role: a new agent is
    judged with no code here. Roles whose personas this instance does not look after (Config.retro_personas) and
    the self-managed roles (sizer, retro) are left out."""
    from . import outcomes, personas
    cfg = getattr(pipe, "cfg", None)
    out: Dict[str, Any] = {}
    for key, facts in outcomes.read(pipe.store, pipe.run).items():
        if key == HUMAN_REVIEW:
            continue
        role = str(facts.get("role") or key)
        mine = [p for p in personas.for_role(role) if personas.selected(cfg, p)]
        if mine:
            out[key] = dict(facts, personas=mine)
    return out


# ------------------------------------------------------------------ the store side

def persona_rules(cfg: Any, persona: str, action: str = SIZER_ACTION) -> List[Dict[str, Any]]:
    q = urllib.parse.urlencode({"action": action, "project": persona})
    rules = _kh(cfg, "GET", "/policy/plan?" + q).get("rules") or []
    return sorted([r for r in rules if r.get("project") == persona], key=lambda r: int(r.get("seq") or 0))


def own_rules(cfg: Any) -> str:
    q = urllib.parse.urlencode({"action": RETRO_ACTION, "project": PERSONA})
    try:
        rules = [r for r in _kh(cfg, "GET", "/policy/plan?" + q).get("rules") or [] if r.get("project") == PERSONA]
    except Exception:   # noqa: BLE001
        rules = []
    rules = sorted(rules, key=lambda r: int(r.get("seq") or 0))
    return "\n".join("- %s: %s" % (r.get("sub_action"), r.get("content")) for r in rules) or "- (none yet)"


def earlier_verdicts(cfg: Any, limit: int = 6) -> List[Dict[str, Any]]:
    """The retro's last verdicts, only those after its latest change to its own persona (older ones were made
    under rules it has since fixed)."""
    hits = _kh(cfg, "POST", "/vector/scroll", {"scope": "knowledge", "project": PERSONA,
                                               "filter": {"kind": VERDICT_KIND}, "limit": 500}).get("hits") or []
    metas = [h.get("metadata") or {} for h in hits]
    changed = max([str(m.get("ts") or "") for m in metas if m.get("kind") == HISTORY_KIND] + [""])
    rows = sorted((m for m in metas if m.get("kind") == VERDICT_KIND and str(m.get("ts") or "") > changed),
                  key=lambda m: str(m.get("ts") or ""))
    return rows[-limit:]


def _record_verdict(cfg: Any, run: str, verdict: Dict[str, Any], fx: Dict[str, Any]) -> None:
    act = fx.get("actual") or {}
    pred = fx.get("predicted") or {}
    ts = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    meta = {"scope": "knowledge", "project": PERSONA, "kind": VERDICT_KIND, "topic": VERDICT_KIND,
            "subject": "retro verdict %s" % run, "run": run, "ts": ts, "verdict": str(verdict.get("verdict") or ""),
            "said_actual_size": str(verdict.get("actual_size") or ""), "measured_size": str(act.get("size") or ""),
            "level": pred.get("level"), "rounds": fx.get("build_rounds"), "review_misses": fx.get("review_misses"),
            "files": act.get("files"), "lines": (act.get("added") or 0) + (act.get("deleted") or 0)}
    text = ("RETRO VERDICT run %s: sizing %s, said actual %s, measured %s (%s files, %s lines), level %s, %s round(s)"
            % (run, meta["verdict"], meta["said_actual_size"], meta["measured_size"], meta["files"], meta["lines"],
               meta["level"], meta["rounds"]))
    _kh(cfg, "POST", "/vector/add", {"id": "rv_" + run.lower().replace("-", "_"), "scope": "knowledge",
                                     "metadata": meta, "text": text})


def acting_personas(agents: Dict[str, Any]) -> List[str]:
    return list(dict.fromkeys(p for a in agents.values() for p in a.get("personas") or []))


def agents_text(cfg: Any, agents: Dict[str, Any]) -> str:
    """Each acting persona's rules and open findings for the retro prompt (sizer and retro are listed elsewhere)."""
    from . import personas
    out = []
    for persona in acting_personas(agents):
        try:
            rules = persona_rules(cfg, persona, personas.action_of(persona))
            open_f = [f for f in findings(cfg, persona) if f["status"] == "open"][:8]
        except Exception:   # noqa: BLE001
            rules, open_f = [], []
        out.append("== %s (action '%s')\nrules:\n%s\nopen findings:\n%s" % (
            persona, personas.action_of(persona),
            "\n".join("- %s: %s" % (r.get("sub_action"), r.get("content")) for r in rules) or "- (none yet)",
            "\n".join("- %s (seen %d, confirmed %d, contradicted %d): %s" % (
                f["id"], f["seen"], f["confirmed"], f["contradicted"], f["title"]) for f in open_f) or "- (none)"))
    return "\n\n".join(out) or "(none: only the sizer has a measurable outcome in this run)"


def findings(cfg: Any, persona: str) -> List[Dict[str, Any]]:
    """The persona's findings (kind persona-finding), open ones first, most confirmed first."""
    hits = _kh(cfg, "POST", "/vector/scroll", {"scope": "knowledge", "project": persona,
                                               "filter": {"kind": FINDING_KIND}, "limit": 500}).get("hits") or []
    out = []
    for h in hits:
        m = h.get("metadata") or {}
        if m.get("kind") != FINDING_KIND:      # the store may ignore the filter: check the kind here
            continue
        out.append({"id": h.get("vector_id"), "title": m.get("title") or "", "seen": int(m.get("seen") or 0),
                    "confirmed": int(m.get("confirmed") or 0), "contradicted": int(m.get("contradicted") or 0),
                    "status": m.get("status") or "open", "rule_change": m.get("rule_change") or "",
                    "metadata": m, "text": h.get("source_text") or ""})
    return sorted(out, key=lambda f: (f["status"] != "open", -f["confirmed"]))


def _finding_id(title: str) -> str:
    return "pf_" + hashlib.sha1(title.strip().lower().encode("utf-8")).hexdigest()[:12]


def _put_finding(cfg: Any, persona: str, fid: str, meta: Dict[str, Any], text: str) -> None:
    meta = dict(meta, scope="knowledge", project=persona, kind=FINDING_KIND, topic=FINDING_KIND,
                subject="finding " + str(meta.get("title") or fid)[:80])
    meta = {k: v for k, v in meta.items() if k not in ("source_text", "emb_dim", "emb_model", "emb_ver", "author")}
    _kh(cfg, "POST", "/vector/add", {"id": fid, "text": text, "scope": "knowledge", "metadata": meta})


def _history(cfg: Any, persona: str, what: str, run: str) -> None:
    ts = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    _kh(cfg, "POST", "/vector/add", {"text": "PERSONA CHANGE %s by the retro after run %s: %s" % (ts, run, what),
                                     "scope": "knowledge", "metadata": {"scope": "knowledge", "project": persona,
                                     "kind": HISTORY_KIND, "topic": HISTORY_KIND, "subject": "persona change",
                                     "run": run, "ts": ts}})


def _change_rule(cfg: Any, persona: str, change: Dict[str, Any], rules: List[Dict[str, Any]],
                 action: str = SIZER_ACTION, protected: frozenset = PROTECTED) -> str:
    op, sub = str(change.get("op") or "none"), str(change.get("sub_action") or "").strip()
    if op == "none" or not sub:
        return ""
    if sub in protected:
        return "skipped: rule %r is protected, a person decides" % sub
    if op != "retire" and len(str(change.get("content") or "")) > RULE_MAX_CHARS:
        return "skipped: proposed rule %r is %d characters, the store takes %d" % (
            sub, len(str(change.get("content") or "")), RULE_MAX_CHARS)
    have = {r.get("sub_action"): r for r in rules}
    if op == "retire":
        if sub not in have:
            return ""
        _kh(cfg, "POST", "/policy/rule/delete", {"project": persona, "action": action, "sub_action": sub})
        return "retired rule %r (was: %s)" % (sub, str(have[sub].get("content") or "")[:300])
    content = str(change.get("content") or "").strip()
    if not content:
        return ""
    seq = int(have[sub].get("seq") or 0) if sub in have else max([int(r.get("seq") or 0) for r in rules] + [0]) + 1
    _kh(cfg, "POST", "/policy/rule/set", {"project": persona, "action": action, "sub_action": sub,
                                          "seq": seq, "content": content})
    return "%s rule %r: %s" % ("rewrote" if sub in have else "added", sub, content[:300])


def _case_update(cfg: Any, project: str, run: str, verdict: Dict[str, Any], fx: Dict[str, Any]) -> None:
    cid = "sz_" + run.lower().replace("-", "_")
    rows = _kh(cfg, "POST", "/vector/scroll", {"ids": [cid], "scope": "knowledge", "project": project}).get("hits") or []
    if not rows:
        return
    row = rows[0]
    act = fx.get("actual") or {}
    lesson = str(verdict.get("case_lesson") or "").strip()
    head = "ACTUAL %s (%s files, +%s/-%s, %s round(s)); sizer was %s. LESSON: %s" % (
        verdict.get("actual_size") or act.get("size") or "?", act.get("files", "?"), act.get("added", "?"),
        act.get("deleted", "?"), fx.get("build_rounds", "?"), verdict.get("verdict") or "?", lesson)
    meta = {k: v for k, v in (row.get("metadata") or {}).items()
            if k not in ("source_text", "emb_dim", "emb_model", "emb_ver", "author")}
    meta.update(actual_size=verdict.get("actual_size") or act.get("size") or "", actual_files=act.get("files"),
                actual_lines_added=act.get("added"), actual_lines_deleted=act.get("deleted"),
                actual_rounds=fx.get("build_rounds"), sizing_verdict=verdict.get("verdict") or "", lesson=lesson,
                summary=(head + " | sizer said: " + str(meta.get("summary") or ""))[:600])
    text = str(row.get("source_text") or "").split("\nACTUAL OUTCOME:")[0] + "\nACTUAL OUTCOME: " + head
    _kh(cfg, "POST", "/vector/add", {"id": cid, "text": text, "scope": "knowledge", "metadata": meta})


def parse(text: str) -> Dict[str, Any]:
    dec = json.JSONDecoder()
    for i in reversed([m.start() for m in re.finditer(r"\{", text or "")]):
        try:
            data, _ = dec.raw_decode(text, i)
        except ValueError:
            continue
        if isinstance(data, dict) and "verdict" in data:
            return data
    return {}


def _apply_findings(cfg: Any, pipe: Any, items: List[Any], persona: str, action_name: str,
                    protected: frozenset) -> Dict[str, List[Any]]:
    out: Dict[str, List[Any]] = {"findings": [], "changes": []}
    known = {f["id"]: f for f in findings(cfg, persona)}
    rules = persona_rules(cfg, persona, action_name)
    for f in items or []:
        if not isinstance(f, dict) or not str(f.get("title") or "").strip():
            continue
        action = str(f.get("action") or "new")
        fid = str(f.get("id") or "") if action in ("confirm", "contradict") and f.get("id") in known else ""
        fid = fid or _finding_id(persona + ":" + str(f["title"]))
        old = known.get(fid)
        meta = dict((old or {}).get("metadata") or {})
        seen = int(meta.get("seen") or 0) + 1
        confirmed = int(meta.get("confirmed") or 0) + (0 if action == "contradict" else 1)
        contradicted = int(meta.get("contradicted") or 0) + (1 if action == "contradict" else 0)
        change = f.get("rule_change") if isinstance(f.get("rule_change"), dict) else {}
        if (not change or change.get("op") in (None, "none")) and meta.get("rule_change"):
            try:
                change = json.loads(meta["rule_change"])
            except ValueError:
                change = {}
        runs = [r for r in str(meta.get("runs") or "").split(",") if r] + [pipe.run]
        meta.update(title=str(f["title"])[:200], seen=seen, confirmed=confirmed, contradicted=contradicted,
                    runs=",".join(dict.fromkeys(runs)), status=meta.get("status") or "open",
                    rule_change=json.dumps(change) if change else "", action_name=action_name,
                    ts=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
        text = ("FINDING (%s persona): %s\nEVIDENCE (%s): %s\nCAUSE: %s\nPROPOSED RULE CHANGE: %s\n"
                "COUNTS: seen %d, confirmed %d, contradicted %d" % (
                    persona, meta["title"], pipe.run, str(f.get("evidence") or "")[:600], str(f.get("cause") or "")[:400],
                    json.dumps(change)[:600] if change else "none", seen, confirmed, contradicted))
        if old and old.get("text"):
            text = old["text"].split("\nCOUNTS:")[0] + "\nEVIDENCE (%s): %s" % (pipe.run, str(f.get("evidence") or "")[:400]) \
                + "\nCOUNTS: seen %d, confirmed %d, contradicted %d" % (seen, confirmed, contradicted)
        if meta["status"] == "open" and change and confirmed >= PROMOTE_AT and confirmed > contradicted:
            try:
                what = _change_rule(cfg, persona, change, rules, action_name, protected)
            except Exception as e:   # noqa: BLE001 - a refused rule change never loses the run's findings
                what = "skipped: the store refused the rule change: %s" % str(e)[:200]
            if what and not what.startswith("skipped"):
                meta["status"] = "applied"
                _history(cfg, persona, "%s (finding %s, confirmed %d)" % (what, fid, confirmed), pipe.run)
                out["changes"].append("%s: %s" % (persona, what))
            elif what:
                out["changes"].append("%s: %s" % (persona, what))
        _put_finding(cfg, persona, fid, meta, text)
        out["findings"].append({"persona": persona, "id": fid, "action": action, "confirmed": confirmed, "status": meta["status"]})
    return out


def apply(cfg: Any, pipe: Any, verdict: Dict[str, Any], fx: Dict[str, Any], persona: str,
          case_project: str) -> Dict[str, Any]:
    out: Dict[str, Any] = {"verdict": verdict.get("verdict"), "findings": [], "changes": []}
    try:
        _case_update(cfg, case_project, pipe.run, verdict, fx)
        out["case"] = "updated"
    except Exception as e:   # noqa: BLE001
        out["case"] = "not updated: %s" % e
    from . import personas
    acting = set(acting_personas(fx.get("agents") or {}))
    acting |= {p for p in (fx.get("human_signal") or {}) if personas.selected(cfg, p)}   # people judged their work
    if personas.selected(cfg, persona):
        acting.add(persona)
    groups: Dict[str, List[Any]] = {}
    for f in verdict.get("findings") or []:
        if not isinstance(f, dict):
            continue
        who = str(f.get("persona") or "").strip() or persona
        if who not in acting:     # only an agent of this run that this instance looks after
            out.setdefault("dropped", []).append("%s: not in this run" % who)
            continue
        groups.setdefault(who, []).append(f)
    jobs = [(items, who, SIZER_ACTION if who == persona else personas.action_of(who),
             PROTECTED if who == persona else personas.protected(who)) for who, items in groups.items()]
    jobs.append((verdict.get("self_findings") or [], PERSONA, RETRO_ACTION, SELF_PROTECTED))
    for items, who, act, prot in jobs:
        if not items:
            continue
        got = _apply_findings(cfg, pipe, items, who, act, prot)
        out["findings"] += got["findings"]
        out["changes"] += got["changes"]
    if (fx.get("predicted") or {}).get("level") is None and fx.get("human_decisions"):
        return out                        # a run stopped at a gate before sizing: no sizing verdict to keep
    try:
        _record_verdict(cfg, pipe.run, verdict, fx)
    except Exception as e:   # noqa: BLE001
        out["verdict_record"] = str(e)[:200]
    return out


def run(pipe: Any) -> Dict[str, Any]:
    """After a finished run: the calibration retro (see module doc). -> what it did. Never raises."""
    cfg = getattr(pipe, "cfg", None)
    try:
        if not enabled(cfg) or not hasattr(pipe, "llm"):
            return {"started": False}
        from .contracts import E_RUN
        from .understand import sizer
        row = pipe.store.get(E_RUN, pipe.run) or {}
        detail = row.get("detail") or {}
        if row.get("state") not in ("green", "escalated"):
            return {"started": False}
        from . import decisions                # a run stopped at a gate before sizing still has people's decisions
        if not detail.get("sizing") and not decisions.retro_facts(pipe.store, pipe.run):
            return {"started": False}
        persona = str(getattr(cfg, "sizer_persona", "") or SIZER_PERSONA_DEFAULT)
        fx = facts(pipe)
        rules = persona_rules(cfg, persona)
        open_f = [f for f in findings(cfg, persona) if f["status"] == "open"][:15]
        mine = findings(cfg, PERSONA)
        self_f = [f for f in mine if f["status"] == "open"][:10]
        self_fixed = "\n".join("- %s: %s" % (f["id"], f["title"]) for f in mine if f["status"] == "applied")
        agents = agents_text(cfg, fx.get("agents") or {})
        past = earlier_verdicts(cfg)
        verdicts = "\n".join(
            "- run %s: you said sizing %s, actual %s; the code measured %s (%s files, %s lines); level %s, %s round(s), "
            "%s reviewer miss(es)" % (v.get("run"), v.get("verdict"), v.get("said_actual_size"), v.get("measured_size"),
                                      v.get("files"), v.get("lines"), v.get("level"), v.get("rounds"),
                                      v.get("review_misses")) for v in past) or "- (none yet)"
        prompt = PROMPT.format(
            retro_rules=own_rules(cfg), verdicts=verdicts, self_fixed=self_fixed or "- (none)",
            self_findings="\n".join("- %s (seen %d, confirmed %d, contradicted %d): %s" % (
                f["id"], f["seen"], f["confirmed"], f["contradicted"], f["title"]) for f in self_f) or "- (none)", facts=json.dumps(fx, indent=1, ensure_ascii=False), persona=persona,
            rules="\n".join("- %s: %s" % (r.get("sub_action"), r.get("content")) for r in rules) or "- (none)",
            findings="\n".join("- %s (seen %d, confirmed %d, contradicted %d): %s" % (
                f["id"], f["seen"], f["confirmed"], f["contradicted"], f["title"]) for f in open_f) or "- (none)",
            agents=agents)
        res = pipe.llm.complete(ROLE, prompt, key="calibration-retro", run=pipe.run)
        verdict = parse(str(getattr(res, "text", "") or ""))
        if not verdict:
            pipe.log("%s: retro: no verdict in the answer" % pipe.run)
            return {"started": True, "error": "no verdict"}
        out = apply(cfg, pipe, verdict, fx, persona, sizer.cases_project(cfg, detail))
        out["usd"] = round(float(getattr(res, "usd", 0) or 0), 4)
        pipe.log("%s: retro: sizing %s (actual %s); findings %s; persona changes %s" % (
            pipe.run, verdict.get("verdict"), verdict.get("actual_size"),
            ", ".join("%s %s %s(c%d)" % (f["persona"], f["action"], f["id"], f["confirmed"])
                      for f in out["findings"]) or "none",
            "; ".join(out["changes"]) or "none"))
        try:
            pipe._set_detail(retro=out)
        except Exception:   # noqa: BLE001
            pass
        return out
    except Exception as e:   # noqa: BLE001 - learning never breaks a finished run
        try:
            pipe.log("%s: retro failed: %s" % (pipe.run, e))
        except Exception:   # noqa: BLE001
            pass
        return {"started": True, "error": str(e)[:300]}


def findings_text(cfg: Any, persona: str = "") -> str:
    """The persona's open findings for the sizer's prompt (not yet rules: weigh them, do not obey them blindly)."""
    try:
        persona = persona or str(getattr(cfg, "sizer_persona", "") or SIZER_PERSONA_DEFAULT)
        open_f = [f for f in findings(cfg, persona) if f["status"] == "open"][:8]
    except Exception:   # noqa: BLE001
        return ""
    if not open_f:
        return ""
    lines = ["FINDINGS FROM EARLIER RUNS (your retro's notes, not yet rules; weigh them):"]
    lines += ["  [%s] confirmed %d, contradicted %d: %s" % (f["id"], f["confirmed"], f["contradicted"], f["title"])
              for f in open_f]
    return "\n".join(lines) + "\n"


__all__ = ["ROLE", "PERSONA", "FINDING_KIND", "PROMOTE_AT", "PROTECTED", "enabled", "size_of", "footprint", "facts",
           "findings", "apply", "parse", "run", "findings_text"]

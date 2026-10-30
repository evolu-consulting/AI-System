"""The change sizer: a fast agent that puts every request on one of four levels, and so on its lane.

Every run used to pay the same fixed analysis before any code was written (NotesApp bench, finding 11), and a New
System always took the whole team even when it was a one-screen app. The sizer looks at the request (and the
repository and what the project already knows, when there is code) and picks a level, for any flow:

  level  who builds it                                          lane
  1      one agent, small caps                                  solo (line.solo), no review
  2      one agent, then an independent reviewer of the diff    solo (line.solo), review
  3      the team: analyst, one reader, test author, planner,   small
         builders in parallel
  4      the whole team: two readers, feature graph             full

Simple first: when unsure between two levels it takes the lower one, because a run that fails for a major reason is
run again one level up (line.reopen sets detail.level; a minor failure keeps the level). The gates never depend on the level: the whole suite and a clean QAS
export (solo), or locked acceptance tests, verifier, merge queue and QAS (team). With the solo lane off
(Config.solo = 0) levels 1 / 2 take the team's trivial / small lanes.

The agent (role change_sizer, a fast mid-size model by Config.role_models) answers one JSON object:
    {"level": 1-4, "risk": "low|medium|high", "files": [...], "reasons": [...], "evidence": [...]}
With delivered code it may look (read-only tools Read / Glob / Grep plus the run's dlc mcp tools); on an empty
repository (a New System) it reads the request only, in one call without tools.

Code decides around it, never the model alone:
  * a person's level (POST /api/runs "level") or lane wins, no model call
  * LINE_LANES=0 or the fake model (auto): level 2 when the solo lane is on, else 4, no model call
  * no answer or an unparseable one: level 2; risk high or more files than Config.unit_max_files: at least 3
Once per run (detail.sizing); a resumed run keeps its level.
"""

from __future__ import annotations

import json
import os
import re
import time
from typing import Any, Dict, List, Optional

from ..contracts import E_RUN, now_ms

ROLE = "change_sizer"
LANES = ("trivial", "small", "full")          # the team's lanes (a person may still pick one)
SOLO = "solo"
LEVELS = (1, 2, 3, 4)
LEVEL_LANE = {1: SOLO, 2: SOLO, 3: "small", 4: "full"}
LANE_LEVEL = {SOLO: 2, "trivial": 3, "small": 3, "full": 4}
UNSURE_LEVEL = 2
CASE_KIND = "sizing-case"
CASE_FLOOR = 0.7
SHARED_FLOOR = 0.8          # a case from another system must be closer (bench cases leaked into a real run)
SMALL_MAX_FITEMS = 3
MAX_SPEC = 20_000
_URL = re.compile(r"https?://\S+", re.I)

#: the sizing rubric as RAG System policy rules (action ACTION): seeded into the engine's store by agent_memory.seed, edited
#: there without a new build (a project may override it); BUILTIN below is only the fallback without a store
ACTION = "size a request"
RULES = [
    ("level 1", "One agent, quick. New system: a toy or one-screen app or script, a handful of features, one data store, "
                "no sign-in, no integration. Enhancement: one small local change (a text, a style, a field, a config "
                "value). Bug fix: one obvious cause in one place."),
    ("level 2", "One agent plus an independent reviewer. New system: a small app (a few screens or endpoints, one data "
                "store, no roles, no external system). Enhancement: one feature or one feature area of a small app, even "
                "with its own new table, fields, endpoints and many rules (validation, search, merge). Bug fix: a "
                "contained bug that needs some investigation across a few files."),
    ("level 3", "A team (analyst, test author, planner, several builders). New system: several modules, sign-in and "
                "roles, an external integration, or more than about eight features. Enhancement: several unrelated "
                "features at once in a larger codebase, or a migration of existing data or a schema change other parts "
                "depend on. Bug fix: cross-cutting, data repair, timing or concurrency."),
    ("level 4", "The whole team with two independent readers. New system: several services, many integrations, "
                "security or compliance critical. Enhancement: a cross-cutting refactor, security, or a migration of "
                "live data. Bug fix: an incident with data loss or a security hole."),
    ("size of the code, not of the spec", "Judge the size of the CODEBASE and of the change, not the length of the "
                "spec: a long list of rules for one feature of a small app is level 2; many files of a small app are "
                "still level 2. Only a change across a large part of a large codebase needs the team."),
    ("precedents", "Similar earlier requests and how their level went are listed when the store has them: a level "
                   "that went green for a similar request is the strongest signal; a level that failed is a reason "
                   "to choose differently (a team run that failed where one agent went green means: one agent)."),
    ("when unsure", "Choose the LOWER level: a run that fails is retried one level up automatically."),
]
BUILTIN = "\n".join("  %s: %s" % r for r in RULES)

PROMPT = """You size a request for an automated delivery line. You only look; you change nothing.
Put it on ONE of four levels. The level decides who builds it; the same automatic checks run on every level.

{rubric}
{precedents}
THE REQUEST ({flow}):
-----
{spec}
-----
{look}
Also name the request's context, each value ONE TO THREE GENERIC WORDS (it decides which earlier solutions apply):
domain (e.g. note taking, invoicing), app (e.g. web crud, cli tool, sap fiori), audience (e.g. single user, internal
staff, public customers), scale (e.g. small, large), constraints (up to five, e.g. no auth, sqlite, node).

Your final message is ONE JSON object, then a last line SUBMIT:
{{"level": 1, "requirement_size": "S|M|L|XL", "app_size": "S|M|L", "risk": "low|medium|high",
  "measure": "<a measurable target the change must reach (users, latency, throughput, cost), else empty>",
  "files": ["<files the change will touch, if known>"],
  "reasons": ["<short reason>", "..."], "evidence": ["<ids of knowledge, finding or log items you used>"],
  "context": {{"domain": "...", "app": "...", "audience": "...", "scale": "...", "constraints": ["..."]}}}}
SUBMIT
"""

LOOK_CODE = """Repository (read only, absolute paths): {repo}
Acceptance tests already in the repository (earlier runs): {tests}
{graph}
Do this, briefly (at most {turns} tool turns):
1. code_graph first when it is listed: query the feature the request names. Otherwise Glob / Grep for it. Read only
   the lines you need.
2. step_context once with the request's intent: earlier findings, lessons and decisions about this part of the
   project (a finding saying a similar change went wrong is a reason for a higher level).
3. Decide.
"""

LOOK_EMPTY = """The repository is empty: this is new work. Size it from the request alone.
"""


def enabled(cfg: Any) -> bool:
    mode = str(getattr(cfg, "lanes", "auto") or "auto").strip().lower()
    if mode in ("0", "off", "false", "no"):
        return False
    if mode in ("1", "on", "true", "yes"):
        return True
    return str(getattr(cfg, "llm", "fake")) != "fake"


def lane_of(pipe: Any) -> str:
    """The run's lane: solo, trivial, small or full (full when it was never sized)."""
    detail = (pipe.store.get(E_RUN, pipe.run) or {}).get("detail") or {}
    lane = str((detail.get("sizing") or {}).get("lane") or "full")
    return lane if lane in LANES or lane == SOLO else "full"


def level_of(pipe: Any) -> int:
    """The run's level 1-4 (4 when it was never sized)."""
    detail = (pipe.store.get(E_RUN, pipe.run) or {}).get("detail") or {}
    sizing = detail.get("sizing") or {}
    try:
        lvl = int(sizing.get("level") or 0)
    except (TypeError, ValueError):
        lvl = 0
    return lvl if lvl in LEVELS else LANE_LEVEL.get(str(sizing.get("lane") or "full"), 4)


def lane_for(level: int, cfg: Any) -> str:
    """The lane a level takes: solo for 1 / 2 while the solo lane is on, else the team's trivial / small lanes."""
    from .. import solo
    lane = LEVEL_LANE[level]
    if lane == SOLO and not solo.enabled(cfg):
        return "trivial" if level == 1 else "small"
    if lane != SOLO and solo.enabled(cfg) and solo.lead_on(cfg):
        return SOLO                         # levels 3-4: one lead agent that delegates parallel parts (solo.LEAD_ROLE)
    return lane


def needs_analyst(pipe: Any, spec: str) -> bool:
    """trivial: the analyst runs only when the request links something it must open."""
    return lane_of(pipe) != "trivial" or bool(_URL.search(spec or ""))


def two_readers(pipe: Any) -> bool:
    return lane_of(pipe) == "full"


def feature_graph(pipe: Any, f_items: int) -> bool:
    return lane_of(pipe) == "full" or f_items > SMALL_MAX_FITEMS


def _locked_tests(repo: str) -> List[str]:
    base = os.path.join(repo or "", "tests", "acceptance")
    out: List[str] = []
    for root, _dirs, files in os.walk(base):
        for f in sorted(files):
            if f.endswith((".py", ".js", ".ts")) and f != "__init__.py":
                out.append(os.path.relpath(os.path.join(root, f), repo).replace("\\", "/"))
    return out[:40]


def _has_code(repo: str) -> bool:
    """More than the line's initial commit (README + .gitignore): there is code to size against."""
    from ..ship._util import git
    if not repo or not os.path.isdir(os.path.join(repo, ".git")):
        return False
    cp = git(repo, "rev-list", "--count", "HEAD", check=False)
    return cp.returncode == 0 and (cp.stdout or "0").strip().isdigit() and int(cp.stdout.strip()) > 1


def parse(text: str) -> Optional[Dict[str, Any]]:
    """The last JSON object with a "level" in the agent's answer, or None."""
    text = text or ""
    dec = json.JSONDecoder()
    for i in reversed([m.start() for m in re.finditer(r"\{", text)]):
        try:
            data, _end = dec.raw_decode(text, i)
        except ValueError:
            continue
        if isinstance(data, dict) and "level" in data:
            return data
    return None


def decide(data: Optional[Dict[str, Any]], cfg: Any, repo: str = "") -> Dict[str, Any]:
    """Code's guard over the model's answer, only what is safety: no answer is level 2 (a failure goes up a level),
    high risk is at least level 3. Everything else is knowledge in the rubric (RAG System policy) and the precedents: a
    file-count guard here overrode correct answers twice on the bench (a small app's feature touches most files)."""
    if not data:
        return {"level": UNSURE_LEVEL, "why": "no usable answer"}
    try:
        level = int(str(data.get("level")).strip())
    except (TypeError, ValueError):
        level = 0
    risk = str(data.get("risk") or "").strip().lower()
    files = [str(f) for f in data.get("files") or [] if str(f).strip()]
    out: Dict[str, Any] = {"level": level if level in LEVELS else UNSURE_LEVEL, "risk": risk or "?",
                           "files": files[:20], "reasons": [str(r)[:200] for r in (data.get("reasons") or [])][:6],
                           "evidence": [str(e)[:60] for e in (data.get("evidence") or [])][:12]}
    for key, allowed in (("requirement_size", ("S", "M", "L", "XL")), ("app_size", ("S", "M", "L"))):
        val = str(data.get(key) or "").strip().upper()
        if val in allowed:
            out[key] = val
    measure = str(data.get("measure") or "").strip()
    if measure and measure.lower() not in ("none", "n/a", "-", "empty"):
        out["measure"] = measure[:300]           # green tests do not prove it: shown on the run (learning.md 2)
    ctx = data.get("context")
    if isinstance(ctx, dict):                             # the request's context (line.specdesign)
        out["context"] = {str(k)[:20]: ([str(x)[:60] for x in v][:6] if isinstance(v, list) else str(v)[:60])
                          for k, v in list(ctx.items())[:8]}
    if level not in LEVELS:
        out["why"] = "unknown level %r" % data.get("level")
    elif risk == "high" and level < 3:
        out.update(level=3, why="risk high")
    return out


# ------------------------------------------------------------------ knowledge from the store (RAG System)

def _kh_on(cfg: Any) -> bool:
    from .. import specdesign
    return specdesign._store_wired(cfg) or bool(specdesign._helper(cfg))


def _kh(cfg: Any, method: str, path: str, body: Any = None) -> Dict[str, Any]:
    from .. import specdesign
    return specdesign.call(cfg, method, path, body)


def _plan(cfg: Any, project: str) -> List[Dict[str, Any]]:
    import urllib.parse
    q = urllib.parse.urlencode({"action": ACTION, "project": project})
    return sorted(_kh(cfg, "GET", "/policy/plan?" + q).get("rules") or [], key=lambda r: int(r.get("seq") or 0))


def rubric(cfg: Any, project: str = "") -> Dict[str, Any]:
    """The sizing rules from the store, else BUILTIN. Three layers, the nearer one wins per rule (sub_action): the
    run project's own rules, then the sizer's persona project (Config.sizer_persona: how this role sizes, replacing
    the every-project rules once it has any), then every project. -> {"text", "source": "kh" | "builtin"}."""
    if _kh_on(cfg):
        try:
            persona = str(getattr(cfg, "sizer_persona", "") or "")
            base = _plan(cfg, project or "every project")
            own = [r for r in base if project and r.get("project") == project]
            rules = [r for r in base if r.get("project") in (None, "", "every project")]
            if persona:
                mine = [r for r in _plan(cfg, persona) if r.get("project") == persona]
                rules = mine or rules
            subs = {r.get("sub_action") for r in own}
            rules = [r for r in rules if r.get("sub_action") not in subs] + own
            if rules:
                return {"text": "\n".join("  %s: %s" % (r.get("sub_action"), r.get("content")) for r in rules),
                        "source": "kh"}
        except Exception:   # noqa: BLE001 - the built-in rubric still sizes
            pass
    return {"text": BUILTIN, "source": "builtin"}


def cases_project(cfg: Any, detail: Dict[str, Any]) -> str:
    return str(detail.get("rag_project") or detail.get("project") or getattr(cfg, "spec_design_project", "") or
               "lesson-learned")


def precedents(cfg: Any, spec: str, project: str, k: int = 6) -> List[Dict[str, Any]]:
    """Earlier sizing cases nearest this request (kind CASE_KIND, score >= CASE_FLOOR): their level and how it went.
    The project's own cases first, then the shared store's (a new project still learns from the others)."""
    if not _kh_on(cfg) or not (spec or "").strip():
        return []
    out: List[Dict[str, Any]] = []
    shared = str(getattr(cfg, "spec_design_project", "") or "lesson-learned")
    persona = str(getattr(cfg, "sizer_persona", "") or "")
    for proj in dict.fromkeys([p for p in (project, persona, shared) if p]):
        floor = SHARED_FLOOR if proj == shared and proj not in (project, persona) else CASE_FLOOR
        try:
            hits = _kh(cfg, "POST", "/vector/query", {"text": spec[:2000], "scope": "knowledge", "project": proj,
                                                      "k": k * 2, "max_chars": 1200}).get("hits") or []
            for h in hits:
                if float(h.get("score") or 0) < floor or len(out) >= k or \
                        any(c["id"] == h.get("vector_id") for c in out):
                    continue
                row = (_kh(cfg, "POST", "/vector/scroll", {"ids": [h.get("vector_id")], "scope": "knowledge",
                                                           "project": proj}).get("hits") or [{}])[0]
                meta = row.get("metadata") or {}
                if meta.get("kind") == CASE_KIND:
                    out.append({"id": h.get("vector_id"), "score": round(float(h.get("score") or 0), 3),
                                "level": meta.get("level"), "lane": meta.get("lane"), "outcome": meta.get("outcome"),
                                "usd": meta.get("usd"), "summary": str(meta.get("summary") or "")[:300]})
        except Exception:   # noqa: BLE001 - a store that does not answer: fewer precedents
            continue
    return out


def precedents_text(cases: List[Dict[str, Any]]) -> str:
    if not cases:
        return ""
    lines = ["SIMILAR EARLIER REQUESTS (precedents from the store; how their level went):"]
    for c in cases:
        lines.append("  [%s] level %s (%s): %s, $%s - %s" % (c["id"], c["level"], c["lane"], c["outcome"],
                                                          c["usd"], c["summary"]))
    return "\n".join(lines) + "\n"


def record_case(pipe: Any) -> Optional[str]:
    """After a run ended: its sizing and how it went, as a precedent for the next request. Never raises."""
    cfg = pipe.cfg
    try:
        row = pipe.store.get(E_RUN, pipe.run) or {}
        detail = row.get("detail") or {}
        sizing = detail.get("sizing") or {}
        if not sizing or not _kh_on(cfg) or row.get("state") not in ("green", "escalated"):
            return None
        with open(os.path.join(pipe.pack, "spec.md"), encoding="utf-8") as fh:
            spec = fh.read()
        outcome = "green" if row["state"] == "green" else "escalated %s" % ((detail.get("escalation") or {})
                                                                            .get("code") or "")
        usd = round(float(detail.get("spent_usd") or 0), 2)
        summary = "; ".join(sizing.get("reasons") or [])[:600]
        text = ("SIZING CASE (%s): level %s, lane %s, %s, $%.2f.\nREQUEST: %s\nWHY THIS LEVEL: %s"
                % (detail.get("flow") or "change", sizing.get("level"), sizing.get("lane"), outcome, usd,
                   spec[:1500], summary))
        project = cases_project(cfg, detail)
        meta = {"scope": "knowledge", "project": project, "kind": CASE_KIND, "topic": CASE_KIND,
                "subject": "sizing case %s" % pipe.run, "run": pipe.run, "level": sizing.get("level"),
                "lane": sizing.get("lane"), "by": sizing.get("by"), "outcome": outcome, "usd": usd,
                "flow": detail.get("flow") or "", "summary": summary[:300],
                "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
        res = _kh(cfg, "POST", "/vector/add", {"id": "sz_" + pipe.run.lower().replace("-", "_"), "text": text,
                                               "scope": "knowledge", "metadata": meta})
        pipe.log("%s: sizing case recorded in %s (level %s, %s)" % (pipe.run, project, sizing.get("level"), outcome))
        return str(res.get("vector_id") or "")
    except Exception as e:   # noqa: BLE001 - a precedent helps the next run; it never touches this one
        pipe.log("%s: sizing case not recorded: %s" % (pipe.run, e))
        return None


def _save(pipe: Any, result: Dict[str, Any]) -> Dict[str, Any]:
    from ..statemachine import update_row
    detail = dict((pipe.store.get(E_RUN, pipe.run) or {}).get("detail") or {})
    detail["sizing"] = result
    update_row(pipe.store, E_RUN, pipe.run, {"detail": detail})
    pipe.log("%s: level %s, lane %s (%s)%s" % (pipe.run, result.get("level"), result.get("lane"), result.get("by"),
                                                "; requirement %s, app %s" % (result.get("requirement_size"),
                                                                             result.get("app_size"))
                                                if result.get("requirement_size") else ""))
    if result.get("measure"):
        pipe.log("%s: needs a measurement the gates cannot prove: %s" % (pipe.run, result["measure"]))
    return result


def _leveled(result: Dict[str, Any], cfg: Any, capped: bool = True) -> Dict[str, Any]:
    """lane for the level; levels picked automatically (sizer, retry) are capped at Config.max_level."""
    cap = max(1, min(4, int(getattr(cfg, "max_level", 4) or 4)))
    if capped and int(result["level"]) > cap:
        result = dict(result, level=cap, capped_from=int(result["level"]))
    return dict(result, lane=lane_for(int(result["level"]), cfg))


def run(pipe: Any) -> Dict[str, Any]:
    """Size the run once, before anything is read or built. Returns detail.sizing {level, lane, by, ...}."""
    store, run_id, cfg = pipe.store, pipe.run, pipe.cfg
    detail = (store.get(E_RUN, run_id) or {}).get("detail") or {}
    if detail.get("sizing"):
        return detail["sizing"]
    base: Dict[str, Any] = {"ms": now_ms()}
    lane = str(detail.get("lane") or "").strip().lower()
    try:
        asked = int(str(detail.get("level") or "0").strip())
    except ValueError:
        asked = 0
    if asked in LEVELS:                                   # a person, or a retry one level up
        by = str(detail.get("level_by") or "person")
        return _save(pipe, _leveled(dict(base, level=asked, by=by), cfg, capped=(by != "person")))
    if lane in LANES or lane == SOLO:
        return _save(pipe, dict(base, level=LANE_LEVEL[lane], lane=lane, by="person"))
    if detail.get("no_solo"):                             # a retry of a solo run made before levels existed
        return _save(pipe, _leveled(dict(base, level=3, by="retry"), cfg))
    if not enabled(cfg):
        from .. import solo
        return _save(pipe, _leveled(dict(base, level=UNSURE_LEVEL if solo.enabled(cfg) else 4, by="off"), cfg))
    flow = str(detail.get("flow") or "").strip().lower()
    repo = getattr(pipe, "repo", "") or ""
    try:
        with open(os.path.join(pipe.pack, "spec.md"), encoding="utf-8") as fh:
            spec = fh.read()
    except OSError:
        return _save(pipe, _leveled(dict(base, level=4, by="rule", why="no spec.md"), cfg))
    turns = int(getattr(cfg, "sizer_max_turns", 12) or 12)
    has_code = _has_code(repo)
    if has_code:
        from .. import codegraph
        hubs = codegraph.summary(cfg, run_id, top=12)
        tests = _locked_tests(repo)
        look = LOOK_CODE.format(repo=repo, turns=turns, tests=", ".join(tests) if tests else "(none)",
                                graph=("The repository's most connected code (code_graph hubs):\n" + hubs + "\n")
                                if hubs else "")
    else:
        look = LOOK_EMPTY
    rules = rubric(cfg, str(detail.get("rag_project") or detail.get("project") or ""))
    cases = precedents(cfg, spec, cases_project(cfg, detail))
    from .. import personas, retro             # the role's persona (seeded once) and the retro's open findings
    personas.seed(cfg)
    prompt = PROMPT.format(flow=flow or "change", spec=spec[:MAX_SPEC], look=look, rubric=rules["text"],
                           precedents=precedents_text(cases) + retro.findings_text(cfg))
    result: Dict[str, Any] = dict(base, by="agent", rubric=rules["source"],
                                  precedents=[{"id": c["id"], "level": c["level"], "outcome": c["outcome"]}
                                              for c in cases])
    data = None
    try:
        if has_code:
            work = os.path.join(getattr(cfg, "workroot", "") or os.path.dirname(pipe.pack), "sizer", run_id)
            os.makedirs(work, exist_ok=True)
            res = pipe.llm.agentic(ROLE, work, prompt, turns, float(getattr(cfg, "sizer_max_usd", 0.5) or 0.5),
                                   key="sizer", run=run_id)
        else:                                             # nothing to look at: one answer, no tools
            res = pipe.llm.complete(ROLE, prompt, key="sizer", run=run_id)
        result["usd"] = round(float(getattr(res, "usd", 0) or 0), 4)
        data = parse(str(getattr(res, "text", "") or ""))
    except Exception as e:   # noqa: BLE001 - sizing saves money; it never stops the run
        result["error"] = str(e)[:300]
    result.update(decide(data, cfg, repo))
    return _save(pipe, _leveled(result, cfg))


__all__ = ["ROLE", "ACTION", "RULES", "BUILTIN", "rubric", "precedents", "record_case", "LANES", "SOLO", "LEVELS", "LEVEL_LANE", "SMALL_MAX_FITEMS", "enabled", "lane_of", "level_of",
           "lane_for", "needs_analyst", "two_readers", "feature_graph", "parse", "decide", "run"]

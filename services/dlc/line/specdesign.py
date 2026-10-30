"""The spec-design library: what one request's analysis learned, reused by the next (case-based reasoning).

Every run used to analyse its request from nothing. The shared RAG System project 'lesson-learned' keeps, next to the lessons
(kind lesson), reusable spec traits (kind spec-trait); one store, so a trait a lesson already covers is never stored
twice (a separate 'spec-design' project duplicated the lessons and was folded in on 2026-10-17). One card is one
PROBLEM (a kind of requirement, ambiguity, contradiction, trap or constraint that specs have) with several SOLUTION
VARIANTS, each tagged with the context it worked in: the same problem in another project, domain, stack or audience
may need another answer, so a card never forces one solution. Recall returns lessons too (shown as they are), and a
trait whose problem a lesson already states (score >= SAME_SCORE) is "covered": not stored.

  context   context_of(pipe)        this request's tags: domain / app / audience / scale / constraint from the change
                                    sizer (detail.sizing.context), stack from the repository, flow, project
  retrieve  recall(cfg, spec)       the cards nearest the request by meaning (score >= RECALL_FLOOR, at most
                                    RECALL_K), once per run (detail.spec_design.recalled)
  reuse     block(cards, ctx)       a prompt block for the solo agent: each card with its variants, the variant
                                    whose context is closest to this request first; reuse one that fits and say so
                                    under DECISIONS ("reused sd_..."), decide anew where none fits
  retain    retain(pipe, ...)       after a green run a curator (role spec_curator, one call without tools) turns the
                                    request + the decisions into at most MAX_TRAITS generic problems with this run's
                                    solution; a problem already stored (the id the run saw, or a new wording scoring
                                    >= SAME_SCORE against a card) gets the solution as a variant: the variant with
                                    the same context (tag overlap >= SAME_CONTEXT) counts a use, any other context
                                    is a new variant; a new problem is a new card

Problems and solutions are generic (no project, file or person names); the project id lives only in a variant's
context tags, where it makes the project's own earlier answer come first. The store is reached through the engine's
knowledge store when it is wired (ragmap), else through a person's own RAG System helper named in Config.kh_helper (a
development setup). Off (no store, no helper, Config.spec_design = 0): every function is a no-op; nothing here ever
stops a run.

Card row (POST /vector/add, scope knowledge, project lesson-learned, id sd_<12 hex>):
  text      SPEC TRAIT: <problem> / APPLIES WHEN: <when> / SOLUTIONS: one line per variant "[tags] solution"
  metadata  kind spec-trait, subject, problem, applies_when, variants [{context, solution, uses, runs, updated}],
            uses (all variants), updated
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
import time
from typing import Any, Dict, List, Optional, Tuple

from .contracts import E_RUN

PROJECT = "lesson-learned"                # one store with the lessons (Rowan: two stores duplicated each other)
ROLE = "spec_curator"
KIND = "spec-trait"
CONTEXT_KEYS = ("domain", "app", "stack", "audience", "scale", "constraint", "flow", "project")
RECALL_K = 6
RECALL_FLOOR = 0.62
SAME_SCORE = 0.88
SAME_CONTEXT = 0.6
MAX_TRAITS = 5
MAX_VARIANTS = 8
RUNS_KEPT = 8
QUERY_CHARS = 2000
CARD_CHARS = 1500
LESSON_CHARS = 700
_TIMEOUT_S = 60
#: a Claude Code session's markers (CLAUDECODE, CLAUDE_PID, CLAUDE_CONFIG_DIR, CLAUDE_CODE_*): not the engine's
_SESSION_VARS = frozenset({"CLAUDECODE", "CLAUDE_PID", "CLAUDE_CONFIG_DIR", "CLAUDE_CODE_ENTRYPOINT",
                           "CLAUDE_CODE_SSE_PORT"})

CURATE = """You keep a shared library of reusable spec traits for an automated delivery line. One request was just
delivered (its checks are green). Turn what its analysis learned into at most {max_traits} GENERIC problems, each
with the solution THIS run used, so a future, different request with the same problem can reuse it.

  problem       a kind of requirement, ambiguity, contradiction, trap or constraint that specs have
                (e.g. "a filter spec says both 'any of the selected values' and 'narrows as more are selected'")
  applies_when  how to recognise it in a spec
  solution      the design answer this run chose and why (e.g. "OR by default plus a match-all switch; recorded")
No project, product, file, person or company names in problem, applies_when or solution: the run's context is kept
next to the solution separately. Skip what any engineer does anyway; keep what needed a decision or caught a trap.

This run's context: {context}

Problems already in the library that the run saw (use the same id when a problem is the same one, even if this run
solved it differently: the library keeps one solution per context):
{known}

THE REQUEST ({flow}):
-----
{spec}
-----

WHAT THE AGENT DECIDED (its DECISIONS):
{decisions}

Answer ONE JSON object only:
{{"traits": [{{"id": "<a known id, or new>", "problem": "...", "applies_when": "...", "solution": "..."}}]}}
"""

BLOCK_HEAD = """## Known spec traits and lessons (the shared lesson-learned store)
Problems earlier requests had, each with the solutions that worked and the context each worked in, and lessons that
apply. This request's context: {context}
Where a problem fits this request, take the solution whose context is closest (listed first) and write "reused <id>"
under DECISIONS; when its context differs in a way that matters (another audience, scale, stack, constraint), adapt
it or decide anew and say why. A card is advice, never a rule.
"""


# ------------------------------------------------------------------ the store

def enabled(cfg: Any) -> bool:
    mode = str(getattr(cfg, "spec_design", "auto") or "auto").strip().lower()
    if mode in ("0", "off", "false", "no"):
        return False
    if str(getattr(cfg, "llm", "fake")) == "fake" and mode not in ("1", "on", "true", "yes"):
        return False
    return _store_wired(cfg) or bool(_helper(cfg))


def _store_wired(cfg: Any) -> bool:
    try:
        from .ragmap import enabled as rag_on
        return bool(rag_on(cfg))
    except Exception:   # noqa: BLE001
        return False


def _helper(cfg: Any) -> str:
    """The RAG System helper's python named in the config (a person's own sign-in; never guessed from a profile)."""
    path = str(getattr(cfg, "kh_helper", "") or "").strip()
    return path if path and os.path.isfile(path) else ""


def _project(cfg: Any) -> str:
    return str(getattr(cfg, "spec_design_project", "") or PROJECT)


def call(cfg: Any, method: str, path: str, body: Any = None) -> Dict[str, Any]:
    """One RAG System request through the engine's store, else the configured helper. Raises RuntimeError."""
    if _store_wired(cfg):
        from .agent_memory import _call
        return _call(cfg, method, path, body)
    py = _helper(cfg)
    if not py:
        raise RuntimeError("no knowledge store and no RAG System helper configured")
    argv = [py, "-m", "kh_helper.cli", "call", method, path] + ([json.dumps(body)] if body is not None else [])
    # the engine is its own program, not a Claude Code session: its helper is an install signed in for the engine
    # (owner "other"), so a Claude Code session never uses it and the engine never uses a person's Claude Code
    # sign-in (RAG System refuses both, bench run 5). An engine started from a Claude Code shell inherits that session's
    # markers; they are not the engine's and are left out of the helper's environment.
    env = {k: v for k, v in os.environ.items() if k not in _SESSION_VARS}
    env.update(MSYS_NO_PATHCONV="1", PYTHONIOENCODING="utf-8")
    cp = subprocess.run(argv, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=_TIMEOUT_S,
                        env=env)
    if cp.returncode != 0:
        raise RuntimeError("RAG System helper exited %s: %s" % (cp.returncode, (cp.stderr or cp.stdout).strip()[-300:]))
    try:
        out = json.loads(cp.stdout or "{}")
    except ValueError as e:
        raise RuntimeError("RAG System helper answered no JSON: %s" % (cp.stdout or "")[:200]) from e
    return out if isinstance(out, dict) else {"result": out}


# ------------------------------------------------------------------ context

TAG_WORDS = 3
_STOP = {"a", "an", "the", "of", "for", "and", "or", "with", "by", "from", "only", "app"}


def _tag(key: str, value: Any) -> str:
    """'key:value' with a short generic value: lower case, at most TAG_WORDS words, filler words dropped (the sizer
    wrote 'developers running a bug-fix exercise locally' in bench run 5; no other request would ever match that)."""
    if key in ("project", "flow"):                        # ids, kept as they are ("notes-a" is not "notes")
        v = re.sub(r"[^a-z0-9_.-]+", "-", str(value or "").strip().lower()).strip("-")[:48]
        return "%s:%s" % (key, v) if v else ""
    words = [w for w in re.split(r"[^a-z0-9+#.]+", str(value or "").strip().lower()) if w and w not in _STOP]
    v = "-".join(words[:TAG_WORDS])[:32].strip("-")
    return "%s:%s" % (key, v) if v else ""


def tags_from(ctx: Dict[str, Any]) -> List[str]:
    """{"domain": "notes", "constraint": ["no sign-in"], ...} -> sorted unique "key:value" tags of CONTEXT_KEYS."""
    out = set()
    for key in CONTEXT_KEYS:
        vals = ctx.get(key) if key != "constraint" else (ctx.get("constraint") or ctx.get("constraints"))
        for v in (vals if isinstance(vals, list) else [vals]):
            t = _tag(key, v)
            if t:
                out.add(t)
    return sorted(out)


def _stack(repo: str) -> str:
    from . import stacks
    try:
        if not repo or not os.path.isdir(repo):
            return ""
        root = stacks.for_repo(repo)
        nested = [stacks.for_repo(d).name for d in stacks.nested_apps(repo)] if root.is_python else []
        return "+".join(sorted(set(nested))) if nested else root.name
    except Exception:   # noqa: BLE001
        return ""


def context_of(pipe: Any) -> List[str]:
    """This request's context tags: the sizer's reading of the spec, the repository's stack, flow, project."""
    detail = (pipe.store.get(E_RUN, pipe.run) or {}).get("detail") or {}
    ctx = dict((detail.get("sizing") or {}).get("context") or {})
    ctx.setdefault("stack", _stack(getattr(pipe, "repo", "") or ""))
    ctx["flow"] = detail.get("flow") or ""
    ctx["project"] = detail.get("project") or detail.get("rag_project") or ""
    return tags_from(ctx)


def _by_key(tags: List[str]) -> Dict[str, set]:
    out: Dict[str, set] = {}
    for t in tags or []:
        key, _, val = str(t).partition(":")
        words = [val] if key in ("project", "flow") else [w for w in val.split("-") if w]   # ids match whole
        out.setdefault(key, set()).update(words)
    return out


def overlap(a: List[str], b: List[str]) -> float:
    """How alike two contexts are, 0..1: per key, the share of words the two values have in common (Jaccard), averaged
    over the keys either side names. 'audience:internal-staff' and 'audience:internal-users' count half alike; a key
    only one side names counts 0."""
    ka, kb = _by_key(a), _by_key(b)
    keys = set(ka) | set(kb)
    if not keys:
        return 0.0
    total = 0.0
    for k in keys:
        wa, wb = ka.get(k, set()), kb.get(k, set())
        total += len(wa & wb) / len(wa | wb) if wa | wb else 0.0
    return total / len(keys)


# ------------------------------------------------------------------ cards

def card_text(problem: str, applies_when: str, variants: List[Dict[str, Any]]) -> str:
    lines = ["SPEC TRAIT: " + problem.strip()]
    if applies_when.strip():
        lines.append("APPLIES WHEN: " + applies_when.strip())
    lines.append("SOLUTIONS:")
    for v in variants:
        lines.append("- [%s] %s (used %d)" % (", ".join(v.get("context") or []) or "any context",
                                               str(v.get("solution") or "").strip(), int(v.get("uses") or 1)))
    return "\n".join(lines)


def new_id(problem: str) -> str:
    return "sd_" + hashlib.sha1(problem.strip().lower().encode("utf-8")).hexdigest()[:12]


def _query(cfg: Any, text: str, k: int) -> List[Dict[str, Any]]:
    j = call(cfg, "POST", "/vector/query", {"text": text[:QUERY_CHARS], "scope": "knowledge",
                                            "project": _project(cfg), "k": k, "max_chars": CARD_CHARS})
    hits = j.get("hits") or (j.get("body") or {}).get("hits") or []
    return [h for h in hits if isinstance(h, dict)]


def _read(cfg: Any, cid: str) -> Optional[Dict[str, Any]]:
    j = call(cfg, "POST", "/vector/scroll", {"ids": [cid], "scope": "knowledge", "project": _project(cfg)})
    hits = j.get("hits") or (j.get("body") or {}).get("hits") or []
    return hits[0] if hits else None


def _put(cfg: Any, cid: str, meta: Dict[str, Any]) -> None:
    meta = dict(meta, scope="knowledge", project=_project(cfg), kind=KIND, topic=KIND,
                uses=sum(int(v.get("uses") or 1) for v in meta.get("variants") or []))
    text = card_text(str(meta.get("problem") or ""), str(meta.get("applies_when") or ""), meta.get("variants") or [])
    call(cfg, "POST", "/vector/add", {"id": cid, "text": text, "scope": "knowledge", "metadata": meta})


def recall(cfg: Any, spec: str, k: int = 0, floor: Optional[float] = None) -> List[Dict[str, Any]]:
    """The cards nearest the request: [{"id", "score", "problem", "applies_when", "variants"}]. [] when off/on error."""
    if not enabled(cfg) or not (spec or "").strip():
        return []
    k, floor = k or RECALL_K, RECALL_FLOOR if floor is None else floor
    out = []
    try:
        for h in _query(cfg, spec, k):
            score = float(h.get("score") or 0)
            cid = str(h.get("vector_id") or h.get("id") or "")
            if score < floor or not cid:
                continue
            row = _read(cfg, cid) or {}
            meta = dict(row.get("metadata") or {})
            if meta.get("kind") != KIND:                  # a lesson of the same store: shown as it is
                out.append({"id": cid, "score": round(score, 3),
                            "lesson": str(row.get("source_text") or h.get("source_text") or "")[:LESSON_CHARS]})
                continue
            out.append({"id": cid, "score": round(score, 3),
                        "problem": str(meta.get("problem") or h.get("source_text") or "")[:600],
                        "applies_when": str(meta.get("applies_when") or "")[:400],
                        "variants": list(meta.get("variants") or [])[:MAX_VARIANTS]})
    except Exception:   # noqa: BLE001 - the library helps; it never stops a run
        return out
    return out


def block(cards: List[Dict[str, Any]], ctx: List[str]) -> str:
    """The prompt block: each card with its variants, the closest context first."""
    if not cards:
        return ""
    lines = [BLOCK_HEAD.format(context=", ".join(ctx) or "(unknown)")]
    for c in cards:
        if c.get("lesson"):
            lines.append("[%s] LESSON: %s" % (c["id"], c["lesson"].replace("\n", " / ")))
            continue
        lines.append("[%s] PROBLEM: %s" % (c["id"], c["problem"]))
        if c.get("applies_when"):
            lines.append("    applies when: %s" % c["applies_when"])
        for v in sorted(c.get("variants") or [], key=lambda v: -overlap(v.get("context") or [], ctx))[:4]:
            lines.append("    - context [%s] (match %.0f%%, used %d): %s"
                         % (", ".join(v.get("context") or []) or "any", 100 * overlap(v.get("context") or [], ctx),
                            int(v.get("uses") or 1), str(v.get("solution") or "")[:500]))
    return "\n".join(lines) + "\n"


def for_run(pipe: Any, spec: str) -> List[Dict[str, Any]]:
    """recall() once per run: kept in detail.spec_design.recalled, reused by every later prompt of the run."""
    row = pipe.store.get(E_RUN, pipe.run) or {}
    sd = dict((row.get("detail") or {}).get("spec_design") or {})
    if "recalled" in sd:
        return list(sd["recalled"])
    cards = recall(pipe.cfg, spec)
    if enabled(pipe.cfg):
        sd["recalled"] = cards
        sd["context"] = context_of(pipe)
        pipe._set_detail(spec_design=sd)
        pipe.log("%s: spec-design: %d card(s) recalled for [%s]" % (pipe.run, len(cards), ", ".join(sd["context"])))
    return cards


def prompt_block(pipe: Any, spec: str) -> str:
    """The block for an agent of this run ('' when the library is off or has nothing near)."""
    cards = for_run(pipe, spec)
    return block(cards, context_of(pipe)) if cards else ""


def reused_ids(decisions: List[str]) -> List[str]:
    return sorted({m for d in decisions or [] for m in re.findall(r"\bsd_[0-9a-f]{12}\b", d)})


# ------------------------------------------------------------------ retain

def parse_traits(text: str) -> List[Dict[str, Any]]:
    dec = json.JSONDecoder()
    for i in reversed([m.start() for m in re.finditer(r"\{", text or "")]):
        try:
            data, _end = dec.raw_decode(text, i)
        except ValueError:
            continue
        if isinstance(data, dict) and isinstance(data.get("traits"), list):
            return [t for t in data["traits"] if isinstance(t, dict) and str(t.get("problem") or "").strip()
                    and str(t.get("solution") or "").strip()][:MAX_TRAITS]
    return []


def add_variant(variants: List[Dict[str, Any]], ctx: List[str], solution: str, run: str, now: str
                ) -> Tuple[List[Dict[str, Any]], str]:
    """Same context (overlap >= SAME_CONTEXT): a use of that variant (its solution refreshed); else a new variant
    (the least used goes when MAX_VARIANTS is reached). -> (variants, "used" | "variant")."""
    out = [dict(v) for v in variants or []]
    best = max(range(len(out)), key=lambda i: overlap(out[i].get("context") or [], ctx)) if out else -1
    if best >= 0 and overlap(out[best].get("context") or [], ctx) >= SAME_CONTEXT:
        v = out[best]
        v.update(uses=int(v.get("uses") or 1) + 1, runs=(list(v.get("runs") or []) + [run])[-RUNS_KEPT:],
                 solution=solution or v.get("solution"), updated=now)
        return out, "used"
    out.append({"context": ctx, "solution": solution, "uses": 1, "runs": [run], "updated": now})
    if len(out) > MAX_VARIANTS:
        out.remove(min(out[:-1], key=lambda v: (int(v.get("uses") or 1), str(v.get("updated") or ""))))
    return out, "variant"


def store_trait(cfg: Any, t: Dict[str, Any], ctx: List[str], run: str, known: List[str]) -> Dict[str, Any]:
    """The run's solution of one problem into the library. -> {"id", "action": used | variant | added | covered}."""
    problem = str(t["problem"]).strip()[:600]
    when = str(t.get("applies_when") or "").strip()[:400]
    solution = str(t["solution"]).strip()[:900]
    cid = str(t.get("id") or "").strip()
    if cid not in known:
        cid = ""
    if not cid:                                           # the same problem in other words: the stored card wins
        hits = _query(cfg, "SPEC TRAIT: %s\nAPPLIES WHEN: %s" % (problem, when), 1)
        if hits and float(hits[0].get("score") or 0) >= SAME_SCORE:
            cid = str(hits[0].get("vector_id") or "")
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    row = _read(cfg, cid) if cid else None
    if row and (row.get("metadata") or {}).get("kind") != KIND:
        return {"id": cid, "action": "covered"}           # a lesson already says it: nothing stored twice
    if row:
        meta = dict(row.get("metadata") or {})
        variants, action = add_variant(list(meta.get("variants") or []), ctx, solution, run, now)
        _put(cfg, cid, dict(meta, variants=variants, updated=now))
        return {"id": cid, "action": action}
    cid = cid or new_id(problem)
    _put(cfg, cid, {"subject": problem[:80], "problem": problem, "applies_when": when, "created": now, "updated": now,
                    "variants": [{"context": ctx, "solution": solution, "uses": 1, "runs": [run], "updated": now}]})
    return {"id": cid, "action": "added"}


def retain(pipe: Any, spec: str, decisions: List[str], flow: str = "") -> Dict[str, Any]:
    """After a green run: the curator's problems + this run's solutions into the library. Never raises."""
    cfg = pipe.cfg
    if not enabled(cfg):
        return {}
    recalled = for_run(pipe, spec)
    ctx = context_of(pipe)
    known = [c["id"] for c in recalled]
    out: Dict[str, Any] = {"context": ctx, "cards": []}
    try:
        prompt = CURATE.format(max_traits=MAX_TRAITS, flow=flow or "change", spec=spec[:12_000],
                               context=", ".join(ctx) or "(unknown)",
                               decisions="\n".join("- " + d for d in decisions) or "(none recorded)",
                               known="\n".join("[%s] %s" % (c["id"], c.get("problem") or "lesson: " + c.get(
                                   "lesson", "")[:300].replace("\n", " / ")) for c in recalled) or "(none)")
        res = pipe.llm.complete(ROLE, prompt, key="spec-design", run=pipe.run)
        out["usd"] = round(float(getattr(res, "usd", 0) or 0), 4)
        for t in parse_traits(str(getattr(res, "text", "") or "")):
            out["cards"].append(store_trait(cfg, t, ctx, pipe.run, known))
    except Exception as e:   # noqa: BLE001 - learning never costs the green run
        out["error"] = str(e)[:300]
    finally:
        try:
            pipe._charge_stage()
        except Exception:   # noqa: BLE001
            pass
    out["reused"] = [i for i in reused_ids(decisions) if i in known]
    sd = dict(((pipe.store.get(E_RUN, pipe.run) or {}).get("detail") or {}).get("spec_design") or {})
    sd["retained"] = out
    pipe._set_detail(spec_design=sd)
    pipe.log("%s: spec-design: %s" % (pipe.run, ", ".join("%s %s" % (c["action"], c["id"]) for c in out["cards"])
                                      or out.get("error") or "nothing new"))
    return out


__all__ = ["PROJECT", "ROLE", "CONTEXT_KEYS", "enabled", "call", "tags_from", "context_of", "overlap", "card_text",
           "new_id", "recall", "block", "for_run", "prompt_block", "reused_ids", "parse_traits", "add_variant",
           "store_trait", "retain"]

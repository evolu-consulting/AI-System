"""Block 8: contradiction detection (design r5c, r5h; R10, R12, R13).

detect_conflicts(pack, digest, llm, store=, run=, rag=) -> dict

  1. Extract (model, role "conflicts", fixture key "extract"): every rule of the FIRST reading /
     the reconciled digest becomes a claim (entity, attribute, trigger, condition, outcome, range?,
     f_item, span_id, quote, supersedes?) plus entity links. Code keeps only claims and links whose
     quote is a literal substring of the named span (as the reader quote check); a `supersedes`
     sentence must itself be literal in the same span and contain an explicit replace word.
     The confirmation re-read (reader B) never runs this: a digest with variant "B" is refused.
  2. Graph (code): entity names are normalised (lower case, singular, aliases) and joined to the
     system rule graph: the local record rule_graph/<name> (rules locked by earlier runs) and, when
     the RAG System offers the "records" capability and uplus_graph_mirror is on, its record
     "rules_graph"/<name> (generic put_record / get_record; degraded = local only).
  3. Multi-hop pairs (code): from each new claim, a breadth-first walk of at most uplus_max_hops (3)
     links collects rules on reachable entities that touch the same attribute, whose triggers are
     not different operations, and whose outcomes differ. Only these pairs go to the model:
       definite   same entity, same condition, and different numbers / exit codes or disjoint ranges
       suspect    everything else that matched
  4. Judge (model, fixture key "judge"): contradiction / compatible / refinement + 2-4 options.
     A definite pair stays a conflict whatever the model says (judge_disagrees is recorded); a suspect
     pair without a verdict is kept as a conflict (never silently cleared).
  5. Decide WHO decides: a contradiction is never settled by the line. It becomes a Conflict record
     (both quotes, entity, hop path, options) and a human question; the run parks (waiting_human).
     The only exception is the design's explicit-replacement rule (r5c, R13): a NEW claim whose spec
     sentence explicitly replaces an OLD system rule, outside money / permission / deletion /
     external interface, retires that old rule (state "superseded"); this is the spec's decision,
     recorded on the record, and is switched off with uplus_spec_supersede=false. Two parts of
     the new spec that contradict each other always go to a person.
  6. Coverage (R10): with a system graph present, % of touched entities that already have a rule;
     < 80% -> label UNSCANNED (never "clean"); uplus_unscanned_asks=true also asks the person.

commit_rules(store, run, rag=) writes the run's claims into the system graph (completion gate R12),
and retires rules superseded by the spec. Call it when the run is green.
"""

from __future__ import annotations

import json
import re
from collections import deque
from typing import Any, Dict, List, Mapping, Optional, Sequence, Set, Tuple

from .. import codes
from ..codes import LineError
from ..contracts import Digest, LlmPort, PackVersion
from ..understand._common import numbers as _numbers
from ..understand.readers import render_spans
from ._common import (CONFLICTS_CHECKED, E_CONFLICT, E_RULE_GRAPH, SPEC_CONFLICT, UNSCANNED, clock_ms, emit,
                      fingerprint, local_id, merge, norm, put, quote_ok, rid, rows, s, sensitive_categories, setting)
from ._prompts import load_part

ROLE = "conflicts"
KEY_EXTRACT = "extract"
KEY_JUDGE = "judge"
RAG_RECORD_TYPE = "rules_graph"
COVERAGE_MIN = 0.8
MAX_JUDGE_PAIRS = 40
VERDICTS = ("contradiction", "compatible", "refinement")

_SUPERSEDE_RE = re.compile(r"\b(replace[sd]?|replacing|supersede[sd]?|overrides?|overridden|instead of|no longer|"
                           r"is removed|are removed|abolish(?:es|ed)?|retire[sd]?)\b", re.I)
_STOP = frozenset("the a an of to is are be and or for in on with by as at it its that this when if then".split())

_CLAIM = {
    "type": "object",
    "required": ["entity", "attribute", "outcome", "span_id", "quote"],
    "properties": {k: {"type": "string"} for k in ("id", "entity", "attribute", "trigger", "condition", "outcome",
                                                   "f_item", "span_id", "quote", "supersedes")},
}
_CLAIM["properties"]["aliases"] = {"type": "array", "items": {"type": "string"}}
_CLAIM["properties"]["range"] = {"type": ["object", "null"]}
CLAIMS_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "required": ["claims"],
    "properties": {
        "claims": {"type": "array", "items": _CLAIM},
        "links": {"type": "array", "items": {"type": "object", "required": ["from", "to"],
                                             "properties": {k: {"type": "string"} for k in
                                                            ("from", "to", "relation", "span_id", "quote")}}},
    },
}
JUDGE_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "required": ["verdicts"],
    "properties": {"verdicts": {"type": "array", "items": {
        "type": "object", "required": ["pair", "verdict"],
        "properties": {"pair": {"type": "string"}, "verdict": {"type": "string"}, "reason": {"type": "string"},
                       "recommended": {"type": "string"},
                       "options": {"type": "array", "items": {"type": "object"}}}}}},
}


# ------------------------------------------------------------------ names


def _singular(t: str) -> str:
    if len(t) > 3 and t.endswith("ies"):
        return t[:-3] + "y"
    if len(t) > 3 and t.endswith("s") and not t.endswith("ss"):
        return t[:-1]
    return t


_CAMEL = re.compile(r"(?<=[a-z0-9])(?=[A-Z])")


def canon_name(name: str) -> str:
    """'SalesOrders' / 'sales orders' -> 'sale order' (camel case split, lower case, singular)."""
    return " ".join(_singular(t) for t in norm(_CAMEL.sub(" ", name or "")).split())


def tokens(text: str) -> Set[str]:
    return {_singular(t) for t in norm(text).split() if t not in _STOP}


def _jacc(a: Set[str], b: Set[str]) -> float:
    return len(a & b) / len(a | b) if (a or b) else 1.0


# ------------------------------------------------------------------ graph


class RuleGraph:
    """Small local system graph: entities (canonical name -> aliases), links, rules."""

    def __init__(self, name: str = "system", nodes: Optional[Dict[str, Any]] = None,
                 edges: Optional[List[List[str]]] = None, rules: Optional[List[Dict[str, Any]]] = None):
        self.name = name
        self.nodes: Dict[str, Dict[str, Any]] = dict(nodes or {})
        self.edges: List[List[str]] = [list(e) for e in edges or []]
        self.rules: List[Dict[str, Any]] = [dict(r) for r in rules or []]
        self._alias: Dict[str, str] = {}
        for c, n in self.nodes.items():
            for a in [c] + list(n.get("aliases") or []):
                self._alias[canon_name(a)] = c

    def canon(self, name: str) -> str:
        c = canon_name(name)
        return self._alias.get(c, c)

    def add_entity(self, name: str, aliases: Sequence[str] = ()) -> str:
        c = self.canon(name)
        if not c:
            return c
        node = self.nodes.setdefault(c, {"name": name, "aliases": []})
        for a in aliases:
            ca = canon_name(a)
            if ca and ca != c and ca not in self._alias:
                node["aliases"].append(a)
                self._alias[ca] = c
        self._alias.setdefault(c, c)
        return c

    def add_edge(self, a: str, b: str, relation: str = "", source: str = "") -> None:
        ca, cb = self.add_entity(a), self.add_entity(b)
        if ca and cb and ca != cb and not any(e[0] == ca and e[1] == cb for e in self.edges):
            self.edges.append([ca, cb, relation, source])

    def add_rule(self, rule: Mapping[str, Any]) -> None:
        r = dict(rule)
        r["canon"] = self.add_entity(r.get("entity", ""))
        self.rules = [x for x in self.rules if x.get("id") != r.get("id")] + [r]

    def active_rules(self) -> List[Dict[str, Any]]:
        return [r for r in self.rules if r.get("state", "active") == "active"]

    def neighbours(self, entity: str, hops: int) -> Dict[str, List[str]]:
        """canonical entity -> path from `entity` (itself: [entity]); undirected, <= hops links."""
        start = self.canon(entity)
        adj: Dict[str, Set[str]] = {}
        for e in self.edges:
            adj.setdefault(e[0], set()).add(e[1])
            adj.setdefault(e[1], set()).add(e[0])
        seen = {start: [start]}
        q = deque([start])
        while q:
            cur = q.popleft()
            if len(seen[cur]) - 1 >= hops:
                continue
            for nxt in sorted(adj.get(cur, ())):
                if nxt not in seen:
                    seen[nxt] = seen[cur] + [nxt]
                    q.append(nxt)
        return seen

    def to_dict(self) -> Dict[str, Any]:
        return {"id": self.name, "name": self.name, "nodes": self.nodes, "edges": self.edges, "rules": self.rules}

    @classmethod
    def from_dict(cls, d: Mapping[str, Any], name: str = "system") -> "RuleGraph":
        return cls(s(d.get("name")) or name, d.get("nodes") or {}, d.get("edges") or [], d.get("rules") or [])

    def merge_from(self, other: "RuleGraph") -> None:
        for c, n in other.nodes.items():
            self.add_entity(n.get("name") or c, n.get("aliases") or [])
        for e in other.edges:
            self.add_edge(e[0], e[1], e[2] if len(e) > 2 else "", e[3] if len(e) > 3 else "")
        known = {r.get("id") for r in self.rules}
        for r in other.rules:
            if r.get("id") not in known:
                self.add_rule(r)


def _mirror_on(rag: Any, cfg: Any) -> bool:
    if rag is None or not setting(cfg, "uplus_graph_mirror"):
        return False
    try:
        return bool(rag.capabilities().has("records"))
    except LineError:
        return False


def load_graph(store: Any, name: str = "system", rag: Any = None, cfg: Any = None) -> Tuple[RuleGraph, Dict[str, Any]]:
    """Local rule graph, merged with the RAG System's mirror when available. Returns (graph, info)."""
    info = {"local": False, "remote": False, "degraded": ""}
    row = store.get(E_RULE_GRAPH, name) if store is not None else None
    g = RuleGraph.from_dict(row, name) if row else RuleGraph(name)
    info["local"] = bool(row)
    if _mirror_on(rag, cfg):
        try:
            got = rag.get_record(RAG_RECORD_TYPE, name)
            if got:
                g.merge_from(RuleGraph.from_dict(got[0], name))
                info["remote"] = True
        except LineError as e:
            info["degraded"] = e.code
    return g, info


def save_graph(store: Any, graph: RuleGraph, rag: Any = None, cfg: Any = None, run: str = "") -> Dict[str, Any]:
    body = graph.to_dict()
    info = {"mirrored": False, "degraded": ""}
    if store is not None:
        put(store, E_RULE_GRAPH, graph.name, body, run="")
    if _mirror_on(rag, cfg):
        try:
            for attempt in range(2):     # If-Match on the current etag; one retry after a concurrent write
                cur = rag.get_record(RAG_RECORD_TYPE, graph.name)
                if cur:
                    graph.merge_from(RuleGraph.from_dict(cur[0], graph.name))
                    body = graph.to_dict()
                try:
                    rag.put_record(RAG_RECORD_TYPE, graph.name, body, if_match=cur[1] if cur else None,
                                   idem_key="%s:%s:%s" % (RAG_RECORD_TYPE, graph.name,
                                                          fingerprint(json.dumps(body, sort_keys=True))))
                    info["mirrored"] = True
                    break
                except LineError as e:
                    if e.code != codes.VERSION_CONFLICT or attempt:
                        raise
            if store is not None:
                put(store, E_RULE_GRAPH, graph.name, body, run="")
        except LineError as e:
            info["degraded"] = e.code
            if store is not None and run:
                emit(store, codes.RAG_DEGRADED_KIND, run, {"capability": "records", "error": e.code,
                                                           "message": e.message}, cfg)
    return info


# ------------------------------------------------------------------ extraction


def _digest_text(digest: Digest) -> str:
    out = []
    for f in digest.f_items:
        out.append("- %s %s" % (f.id, f.title))
        out.extend("    - %s: %s (%s)" % (c.id, c.text or c.then, c.span_id) for c in f.criteria)
    out.extend("- rule: %s (%s)" % (r.text, r.span_id) for r in digest.rules)
    out.extend("- number: %s = %s (%s)" % (n.text, n.value, n.span_id) for n in digest.numbers)
    return "\n".join(out)


def _range(v: Any) -> Optional[Dict[str, Any]]:
    if not isinstance(v, Mapping):
        return None
    try:
        lo = float(v["min"]) if v.get("min") is not None else None
        hi = float(v["max"]) if v.get("max") is not None else None
    except (TypeError, ValueError):
        return None
    if lo is None and hi is None:
        return None
    return {"min": lo, "max": hi, "unit": norm(s(v.get("unit")))}


def validate_claims(data: Mapping[str, Any], pack: PackVersion, f_ids: Sequence[str] = ()) -> Dict[str, Any]:
    spans = {sp.id: sp for sp in pack.spans}
    claims, links, dropped = [], [], []
    for i, c in enumerate(data.get("claims") or []):
        if not isinstance(c, Mapping):
            continue
        sid, quote = s(c.get("span_id")), s(c.get("quote"))
        why = quote_ok(spans, sid, quote)
        if not why and not (s(c.get("entity")) and s(c.get("attribute")) and s(c.get("outcome"))):
            why = "missing_field"
        if why:
            dropped.append({"code": codes.QUOTE_UNMATCHED if why != "missing_field" else codes.SCHEMA_INVALID,
                            "kind": "claim", "id": s(c.get("id")), "span_id": sid, "quote": quote, "reason": why})
            continue
        sup = s(c.get("supersedes"))
        if sup and (sup not in spans[sid].text or not _SUPERSEDE_RE.search(sup)):
            dropped.append({"code": codes.QUOTE_UNMATCHED, "kind": "supersedes", "id": s(c.get("id")), "span_id": sid,
                            "quote": sup, "reason": "not_in_span" if sup not in spans[sid].text else "no_replace_word"})
            sup = ""
        fid = s(c.get("f_item"))
        claims.append({"id": "C%d" % (len(claims) + 1), "model_id": s(c.get("id")), "entity": s(c.get("entity")),
                       "aliases": [s(a) for a in c.get("aliases") or [] if s(a)], "attribute": s(c.get("attribute")),
                       "trigger": s(c.get("trigger")), "condition": s(c.get("condition")), "outcome": s(c.get("outcome")),
                       "range": _range(c.get("range")), "f_item": fid if (not f_ids or fid in f_ids) else "",
                       "span_id": sid, "quote": quote, "supersedes": sup, "source": "spec"})
    for l in data.get("links") or []:
        if not isinstance(l, Mapping):
            continue
        sid, quote = s(l.get("span_id")), s(l.get("quote"))
        why = quote_ok(spans, sid, quote) or ("" if s(l.get("from")) and s(l.get("to")) else "missing_field")
        if why:
            dropped.append({"code": codes.QUOTE_UNMATCHED, "kind": "link", "span_id": sid, "quote": quote, "reason": why})
            continue
        links.append({"from": s(l.get("from")), "to": s(l.get("to")), "relation": s(l.get("relation")),
                      "span_id": sid, "quote": quote})
    return {"claims": claims, "links": links, "dropped": dropped}


def _complete(llm: LlmPort, prompt: str, schema: Mapping[str, Any], key: str, run: str, model: Optional[str]) -> Tuple[Mapping[str, Any], float]:
    res = llm.complete(ROLE, prompt, schema, key=key, model=model, run=run)
    data = res.data
    if data is None and res.text:
        try:
            data = json.loads(res.text)
        except ValueError:
            data = None
    if not isinstance(data, Mapping):
        raise LineError(codes.SCHEMA_INVALID, "conflicts answer (%s) is not a JSON object" % key, {"role": ROLE, "key": key})
    return data, float(res.usd or 0.0)


def extract_claims(pack: PackVersion, digest: Digest, llm: LlmPort, *, run: str = "", model: Optional[str] = None) -> Dict[str, Any]:
    prompt = "\n\n".join([load_part("conflicts", "extract"), "## Digest (first reading)\n" + _digest_text(digest),
                          "## Spec spans (%d)\n%s" % (len(pack.spans), render_spans(pack.spans))])
    data, usd = _complete(llm, prompt, CLAIMS_SCHEMA, KEY_EXTRACT, run, model)
    out = validate_claims(data, pack, [f.id for f in digest.f_items])
    out["usd"] = usd
    return out


# ------------------------------------------------------------------ pair finding (code)


def _attr_match(a: Mapping[str, Any], b: Mapping[str, Any]) -> bool:
    ta, tb = tokens(a.get("attribute", "")), tokens(b.get("attribute", ""))
    return bool(ta and tb) and (ta == tb or _jacc(ta, tb) >= 0.5)


def _trigger_disjoint(a: Mapping[str, Any], b: Mapping[str, Any]) -> bool:
    ta, tb = canon_name(a.get("trigger", "")), canon_name(b.get("trigger", ""))
    return bool(ta and tb and ta != tb)


def _same_condition(a: Mapping[str, Any], b: Mapping[str, Any]) -> bool:
    return tokens(a.get("condition", "")) == tokens(b.get("condition", ""))


def _ranges_disjoint(a: Mapping[str, Any], b: Mapping[str, Any]) -> bool:
    ra, rb = a.get("range"), b.get("range")
    if not ra or not rb or (ra.get("unit") and rb.get("unit") and ra["unit"] != rb["unit"]):
        return False
    lo_a, hi_a = ra.get("min"), ra.get("max")
    lo_b, hi_b = rb.get("min"), rb.get("max")
    return (hi_a is not None and lo_b is not None and hi_a < lo_b) or (hi_b is not None and lo_a is not None and hi_b < lo_a)


def _agree(a: Mapping[str, Any], b: Mapping[str, Any]) -> bool:
    na, nb = _numbers(a.get("outcome", "")), _numbers(b.get("outcome", ""))
    return na == nb and _jacc(tokens(a.get("outcome", "")), tokens(b.get("outcome", ""))) >= 0.6 and not _ranges_disjoint(a, b)


def _definite(a: Mapping[str, Any], b: Mapping[str, Any], graph: RuleGraph) -> bool:
    if graph.canon(a["entity"]) != graph.canon(b["entity"]) or not _same_condition(a, b):
        return False
    if _ranges_disjoint(a, b):
        return True
    na, nb = _numbers(a.get("outcome", "")), _numbers(b.get("outcome", ""))
    return bool(na and nb and na != nb)


def find_pairs(claims: Sequence[Mapping[str, Any]], graph: RuleGraph, prior: Sequence[Mapping[str, Any]],
               hops: int = 3) -> List[Dict[str, Any]]:
    """Candidate pairs (code only). Each: {"pid", "a", "b", "kind", "detection", "path"}."""
    pool = [dict(c, _new=True) for c in claims] + [dict(r, _new=False) for r in prior]
    by_entity: Dict[str, List[Dict[str, Any]]] = {}
    for r in pool:
        by_entity.setdefault(graph.canon(r.get("entity", "")), []).append(r)
    seen: Set[Tuple[str, str]] = set()
    pairs = []
    for c in claims:
        reach = graph.neighbours(c["entity"], hops)
        for ent, path in reach.items():
            for r in by_entity.get(ent, []):
                if r.get("id") == c["id"] and r["_new"]:
                    continue
                key = tuple(sorted(["n:" + c["id"], ("n:" if r["_new"] else "o:") + str(r.get("id"))]))
                if key in seen:
                    continue
                if r.get("span_id") == c["span_id"] and r.get("quote") == c["quote"]:
                    continue
                if not _attr_match(c, r) or _trigger_disjoint(c, r) or _agree(c, r):
                    continue
                seen.add(key)
                b = {k: v for k, v in r.items() if k != "_new"}
                pairs.append({"pid": "P%d" % (len(pairs) + 1), "a": dict(c), "b": b,
                              "kind": "within_spec" if r["_new"] else "vs_system",
                              "detection": "definite" if _definite(c, r, graph) else "suspect", "path": path})
    return pairs


# ------------------------------------------------------------------ judge + records


def _valid_options(opts: Any) -> List[Dict[str, str]]:
    if not isinstance(opts, list) or not 2 <= len(opts) <= 4:
        return []
    out = []
    for o in opts:
        if not isinstance(o, Mapping) or not (s(o.get("id")) and s(o.get("text")) and s(o.get("impact"))):
            return []
        out.append({"id": s(o.get("id")), "text": s(o.get("text")), "impact": s(o.get("impact"))})
    ids = [o["id"] for o in out]
    return out if len(set(ids)) == len(ids) and "other" not in ids else []


def default_options(p: Mapping[str, Any]) -> List[Dict[str, str]]:
    a, b = p["a"], p["b"]
    fa, fb = a.get("f_item") or "the new spec", b.get("f_item") or ("the old rule" if p["kind"] == "vs_system" else "the spec")
    if p["kind"] == "vs_system":
        return [{"id": "new_replaces", "text": "The new rule replaces the old one: %s" % a["outcome"],
                 "impact": "The old rule is retired; locked tests of the old rule change."},
                {"id": "keep_old", "text": "Keep the old rule: %s" % b.get("outcome", ""),
                 "impact": "The new requirement of %s changes to fit the old rule." % fa},
                {"id": "both_with_step", "text": "Keep both and add an explicit step or exception that the answer states",
                 "impact": "%s gets an extra case; both rules keep their tests." % fa}]
    return [{"id": "keep_a", "text": "%s holds: %s" % (a["span_id"], a["outcome"]),
             "impact": "Criteria and tests of %s follow it; the other statement is dropped." % fb},
            {"id": "keep_b", "text": "%s holds: %s" % (b.get("span_id", ""), b.get("outcome", "")),
             "impact": "Criteria and tests of %s follow it; the other statement is dropped." % fa}]


def judge_pairs(pairs: Sequence[Mapping[str, Any]], llm: LlmPort, *, run: str = "", model: Optional[str] = None) -> Tuple[Dict[str, Dict[str, Any]], float]:
    if not pairs:
        return {}, 0.0
    lines = []
    for p in pairs:
        a, b = p["a"], p["b"]
        lines.append("### %s (%s, path: %s)\nA [%s]: %s | %s | trigger: %s | condition: %s | outcome: %s\n  quote: \"%s\"\n"
                     "B [%s]: %s | %s | trigger: %s | condition: %s | outcome: %s\n  quote: \"%s\"" % (
                         p["pid"], p["kind"], " -> ".join(p["path"]),
                         a["span_id"], a["entity"], a["attribute"], a.get("trigger", ""), a.get("condition", ""), a["outcome"], a["quote"],
                         b.get("span_id", ""), b.get("entity", ""), b.get("attribute", ""), b.get("trigger", ""),
                         b.get("condition", ""), b.get("outcome", ""), b.get("quote", "")))
    prompt = "\n\n".join([load_part("conflicts", "judge"), "## Pairs (%d)\n%s" % (len(pairs), "\n\n".join(lines))])
    data, usd = _complete(llm, prompt, JUDGE_SCHEMA, KEY_JUDGE, run, model)
    out = {}
    for v in data.get("verdicts") or []:
        if isinstance(v, Mapping) and s(v.get("pair")):
            out[s(v.get("pair"))] = dict(v)
    return out, usd


def _side(c: Mapping[str, Any]) -> Dict[str, Any]:
    return {k: c.get(k) for k in ("id", "entity", "attribute", "trigger", "condition", "outcome", "range", "f_item",
                                  "span_id", "quote", "source", "supersedes", "tests") if c.get(k) not in (None, "", [])}


def _names_old(sup: str, old: Mapping[str, Any]) -> bool:
    ts = tokens(sup)
    at = tokens(old.get("attribute", "")) | tokens(old.get("outcome", ""))
    return bool(ts and at) and len(ts & at) >= max(1, (len(tokens(old.get("attribute", ""))) + 1) // 2)


def detect_conflicts(pack: PackVersion, digest: Digest, llm: LlmPort, *, store: Any = None, run: str = "", rag: Any = None,
                     cfg: Any = None, clock: Any = None, model: Optional[str] = None) -> Dict[str, Any]:
    """Returns {"claims", "pairs", "conflicts": [rows], "questions": [drafts], "label", "coverage",
    "superseded", "cleared", "dropped", "usd", "summary"}."""
    if digest.variant == "B":
        raise ValueError("contradiction detection runs on the first reading / reconciled digest, never on the "
                         "confirmation re-read (variant B)")
    ext = extract_claims(pack, digest, llm, run=run, model=model)
    claims = ext["claims"]
    gname = s(setting(cfg, "uplus_graph")) or "system"
    graph, ginfo = load_graph(store, gname, rag, cfg)
    prior = [r for r in graph.active_rules() if not s(r.get("id")).startswith(run + ":")] if run else graph.active_rules()
    work = RuleGraph.from_dict(graph.to_dict(), gname)
    for c in claims:
        work.add_entity(c["entity"], c.get("aliases") or [])
    for l in ext["links"]:
        work.add_edge(l["from"], l["to"], l["relation"], l["span_id"])
    pairs = find_pairs(claims, work, prior, int(setting(cfg, "uplus_max_hops")))
    to_judge = pairs[:MAX_JUDGE_PAIRS]
    judged = {p["pid"] for p in to_judge}
    verdicts, usd_j = judge_pairs(to_judge, llm, run=run, model=model)

    existing = rows(store, E_CONFLICT, run) if store is not None and run else []
    by_fp = {r.get("fingerprint"): r for r in existing}
    n = max([int(local_id(r["id"])[1:]) for r in existing if local_id(r["id"])[1:].isdigit()] or [0])
    now = clock_ms(store, clock)
    allow_sup = bool(setting(cfg, "uplus_spec_supersede"))
    conflicts, cleared, superseded = [], [], []
    for p in pairs:
        v = verdicts.get(p["pid"]) if p["pid"] in judged else None
        verdict = s((v or {}).get("verdict")).lower()
        verdict = verdict if verdict in VERDICTS else ""
        if p["detection"] != "definite" and verdict in ("compatible", "refinement"):
            cleared.append({"pid": p["pid"], "verdict": verdict, "reason": s((v or {}).get("reason")),
                            "a": p["a"]["id"], "b": p["b"].get("id")})
            continue
        a, b = p["a"], p["b"]
        fp = fingerprint("conflict", *sorted([a["quote"], s(b.get("quote"))]))
        prev = by_fp.get(fp)
        if prev is not None:      # same pair seen before (re-run after an addendum): keep its record and state
            if prev not in conflicts:
                conflicts.append(prev)
            if prev.get("state") == "superseded" and (prev.get("resolution") or {}).get("retire_rule"):
                superseded.append(prev["resolution"]["retire_rule"])
            continue
        cats = sorted(set(sensitive_categories(a["quote"], a["outcome"], s(b.get("quote")), s(b.get("outcome")),
                                               a["attribute"])))
        opts = _valid_options((v or {}).get("options")) or default_options(p)
        rec = s((v or {}).get("recommended"))
        rec = rec if rec in [o["id"] for o in opts] else opts[0]["id"]
        state, resolution = "open", None
        if p["kind"] == "vs_system" and allow_sup and a.get("supersedes") and not cats and _names_old(a["supersedes"], b):
            state = "superseded"
            resolution = {"by": "spec", "quote": a["supersedes"], "span_id": a["span_id"], "retire_rule": b.get("id"),
                          "tests_to_change": list(b.get("tests") or [])}
            superseded.append(b.get("id"))
        f_items = sorted({x for x in (a.get("f_item"), b.get("f_item") if p["kind"] == "within_spec" else "") if x})
        n += 1
        xid = "X%d" % n
        row = {"id": rid(run, xid) if run else xid, "xid": xid, "run": run, "code": SPEC_CONFLICT, "kind": p["kind"],
               "entity": work.canon(a["entity"]), "attribute": a["attribute"], "a": _side(a), "b": _side(b),
               "path": p["path"], "hops": len(p["path"]) - 1, "detection": p["detection"],
               "verdict": verdict or ("unjudged" if p["pid"] not in judged else "none"), "reason": s((v or {}).get("reason")),
               "judge_disagrees": p["detection"] == "definite" and verdict in ("compatible", "refinement"),
               "options": opts, "recommended": rec, "f_items": f_items, "categories": cats, "fingerprint": fp,
               "state": state, "resolution": resolution, "question": "", "answer": None, "created_ms": now}
        if store is not None and run:
            put(store, E_CONFLICT, row["id"], row, run=run)
        by_fp[fp] = row
        conflicts.append(row)

    # coverage of the system graph (R10)
    touched = sorted({work.canon(c["entity"]) for c in claims})
    prior_ents = {work.canon(r.get("entity", "")) for r in prior}
    if not prior:
        coverage, unscanned = None, []
    else:
        unscanned = [e for e in touched if e not in prior_ents]
        coverage = round((len(touched) - len(unscanned)) / len(touched), 4) if touched else 1.0
    open_c = [c for c in conflicts if c.get("state") == "open"]
    if open_c:
        label = "conflicts"
    elif coverage is not None and coverage < COVERAGE_MIN:
        label = UNSCANNED.lower()
    elif not prior:
        label = "greenfield"
    else:
        label = "clean"
    drafts = [conflict_question(c) for c in open_c if not c.get("question")]
    if label == "unscanned" and setting(cfg, "uplus_unscanned_asks"):
        ev = [{"span_id": c["span_id"], "quote": c["quote"]} for c in claims if work.canon(c["entity"]) in unscanned][:3]
        if ev:
            drafts.append({"kind": "unscanned",
                           "decision": "No old rule is recorded for: %s (coverage %.0f%% < 80%%). Proceed as if these "
                                       "entities had no earlier behaviour?" % (", ".join(unscanned), 100 * (coverage or 0)),
                           "options": [{"id": "proceed", "text": "Proceed: treat them as new",
                                        "impact": "A clash with unrecorded old behaviour shows up only as red old tests."},
                                       {"id": "hold", "text": "Hold: record the old rules first",
                                        "impact": "The run waits until the rules are recorded."}],
                           "recommended": "proceed", "evidence": ev,
                           "f_items": sorted({c["f_item"] for c in claims if c.get("f_item") and work.canon(c["entity"]) in unscanned}),
                           "refs": [], "fingerprint": fingerprint("unscanned", *unscanned)})
    if store is not None and run:
        put(store, E_RULE_GRAPH, rid(run, "claims"), {"id": rid(run, "claims"), "run": run, "graph": gname,
                                                     "claims": claims, "links": ext["links"],
                                                     "superseded": superseded, "pack_version": pack.version}, run=run)
    summary = {"claims": len(claims), "links": len(ext["links"]), "pairs": len(pairs), "judged": len(to_judge),
               "conflicts": [local_id(c["id"]) for c in open_c], "superseded": superseded, "cleared": len(cleared),
               "label": label, "coverage": coverage, "unscanned": unscanned, "dropped": len(ext["dropped"]),
               "graph": {"name": gname, "rules": len(prior), **ginfo}}
    if store is not None and run:
        emit(store, CONFLICTS_CHECKED, run, summary, cfg, pack.version)
    return {"claims": claims, "links": ext["links"], "pairs": pairs, "conflicts": conflicts, "questions": drafts,
            "label": label, "coverage": coverage, "superseded": superseded, "cleared": cleared,
            "dropped": ext["dropped"], "usd": round(ext["usd"] + usd_j, 6), "summary": summary}


def conflict_question(c: Mapping[str, Any]) -> Dict[str, Any]:
    a, b = c["a"], c["b"]
    where = "the new spec" if c["kind"] == "within_spec" else "the running system"
    return {
        "kind": "conflict",
        "decision": "Conflicting requirements on %s / %s (%s, %s): A says \"%s\"; B (%s) says \"%s\". Which rule holds?" % (
            c["entity"], c["attribute"], c["detection"], " -> ".join(c.get("path") or []), a.get("quote", ""), where,
            b.get("quote", "")),
        "options": [dict(o) for o in c["options"]], "recommended": c["recommended"],
        "evidence": [{"span_id": a.get("span_id", ""), "quote": a.get("quote", "")},
                     {"span_id": b.get("span_id", "") or "system", "quote": b.get("quote", "") or b.get("outcome", "")}],
        "f_items": list(c.get("f_items") or []), "refs": [{"entity": E_CONFLICT, "id": c["id"]}],
        "fingerprint": c["fingerprint"],
    }


# ------------------------------------------------------------------ completion gate (R12)


def commit_rules(store: Any, run: str, *, rag: Any = None, cfg: Any = None, clock: Any = None) -> Dict[str, Any]:
    """Write the run's claims into the system rule graph as active, verified rules; retire the old rules
    the spec superseded and those a person retired (answer 'new_replaces'). Idempotent."""
    row = store.get(E_RULE_GRAPH, rid(run, "claims"))
    if not row:
        return {"written": 0, "retired": []}
    gname = s(row.get("graph")) or s(setting(cfg, "uplus_graph")) or "system"
    graph, _ = load_graph(store, gname, rag, cfg)
    now = clock_ms(store, clock)
    retire = set(row.get("superseded") or [])
    for x in rows(store, E_CONFLICT, run):
        ans = x.get("answer") or {}
        if x.get("kind") == "vs_system" and ans.get("option") == "new_replaces" and (x.get("b") or {}).get("id"):
            retire.add(x["b"]["id"])
    for l in row.get("links") or []:
        graph.add_edge(l["from"], l["to"], l.get("relation", ""), "run:" + run)
    for c in row.get("claims") or []:
        graph.add_entity(c["entity"], c.get("aliases") or [])
        graph.add_rule(dict({k: v for k, v in c.items() if k != "source"}, id=rid(run, c["id"]), source="run:" + run,
                            state="active", verified=True, pack_version=row.get("pack_version", ""), ts_ms=now))
    retired = []
    for r in graph.rules:
        if r.get("id") in retire and r.get("state", "active") == "active":
            r["state"] = "superseded"
            r["superseded_by"] = run
            retired.append(r["id"])
    info = save_graph(store, graph, rag, cfg, run)
    return {"written": len(row.get("claims") or []), "retired": retired, "graph": gname, **info}


__all__ = ["detect_conflicts", "extract_claims", "validate_claims", "find_pairs", "judge_pairs", "commit_rules",
           "conflict_question", "default_options", "RuleGraph", "load_graph", "save_graph", "canon_name",
           "CLAIMS_SCHEMA", "JUDGE_SCHEMA", "ROLE", "KEY_EXTRACT", "KEY_JUDGE", "RAG_RECORD_TYPE"]

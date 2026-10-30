"""Check mechanisms. A definition attaches checks to its steps; the code here only knows HOW to check, never which
sections, which rules or which ids must hold: all of that comes in the check's parameters.

Every check returns findings: {"check", "severity": "block" | "warn", "artifact", "text"}.
    block  the agent that wrote the artifact gets the findings and writes it again (Definition.retries times),
           then whatever is left goes to the gate like a warning
    warn   shown at the gate (document "@checks") and recorded; nothing stops

    sections   {"artifact", "sections": [titles]}        the document has these headings
    coverage   {"from", "to": [artifacts]}               every item `from` DEFINES (its "items" pattern) is
                                                         referred to (their "refs" pattern) by each `to` artifact
    judge      {"artifact", "rules"?: {...}}             a clean-context agent judges the artifact against the
                                                         project's own rules: files of the target repository
                                                         (rules.files) and / or what the knowledge store answers
                                                         (rules.store.query); runs only when there are rules
    count      {"artifact", "pattern", "section"?,     how many times a pattern occurs (e.g. open questions)
                "max"? / "min"?, "message"?}           against a limit; {n} in the message is the count
    in_diff    {"artifact", "pattern_from", "paths"?}    every id the artifact defines with that pattern appears
                                                         in the change (lines added in files whose path contains
                                                         `paths`), e.g. each test case id in a test name

    run(name, params, ctx) -> [finding]
"""

from __future__ import annotations

import re
from typing import Any, Callable, Dict, List

from . import artifacts as A

MAX_RULES = 20_000


class Ctx:
    """What a check may look at. docs: artifact -> text; definition: the Resolved; the rest is filled when known."""

    def __init__(self, definition: Any, docs: Dict[str, str], pipe: Any = None, wt: str = "", diff: str = "",
                 gate: str = "", rules_reader: Callable[[str], str] = None):
        self.definition, self.docs, self.pipe, self.wt, self.diff, self.gate = definition, docs, pipe, wt, diff, gate
        self.rules_reader = rules_reader


def _f(check: str, severity: str, artifact: str, text: str) -> Dict[str, Any]:
    return {"check": check, "severity": "block" if severity == "block" else "warn", "artifact": artifact,
            "text": text[:600]}


def sections(p: Dict[str, Any], ctx: Ctx) -> List[Dict[str, Any]]:
    art = p["artifact"]
    have = [s.lower() for s in A.sections(ctx.docs.get(art, ""))]
    return [_f("sections", p.get("severity", "warn"), art, 'missing section "%s"' % s)
            for s in p.get("sections") or [] if s.lower() not in have]


def coverage(p: Dict[str, Any], ctx: Ctx) -> List[Dict[str, Any]]:
    src = p["from"]
    items = A.ids(ctx.docs.get(src, ""), ctx.definition.artifact(src).get("items", ""))
    out = []
    for to in p.get("to") or []:
        refs = set(A.ids(ctx.docs.get(to, ""), ctx.definition.artifact(to).get("refs", "")))
        for i in items:
            if i not in refs:
                out.append(_f("coverage", p.get("severity", "warn"), to, "%s does not cover %s %s" % (
                    ctx.definition.artifact(to).get("title") or to, ctx.definition.artifact(src).get("title") or src, i)))
    return out


def in_diff(p: Dict[str, Any], ctx: Ctx) -> List[Dict[str, Any]]:
    art = p["artifact"]
    pattern = ctx.definition.artifact(art).get(p.get("pattern_from") or "items", "")
    wanted = A.ids(ctx.docs.get(art, ""), pattern)
    if not wanted:
        return []
    paths = str(p.get("paths") or "")
    added: List[str] = []
    cur = ""
    for ln in (ctx.diff or "").splitlines():
        if ln.startswith("+++ "):
            cur = ln[4:]
        elif ln.startswith("+") and not ln.startswith("+++") and (not paths or paths.lower() in cur.lower()):
            added.append(ln)
    text = "\n".join(added)
    return [_f("in_diff", p.get("severity", "warn"), art, "%s is not in the change%s" % (
        i, " (%s files)" % paths if paths else "")) for i in wanted
        if not re.search(r"(?<![A-Za-z0-9])%s(?![0-9])" % re.escape(i).replace("\\-", "[-_]?"), text)]


def count(p: Dict[str, Any], ctx: Ctx) -> List[Dict[str, Any]]:
    """How many times `pattern` occurs in the artifact (or one of its sections) against `max` / `min`."""
    art = p["artifact"]
    text = ctx.docs.get(art, "")
    if p.get("section"):
        text = A.section(text, str(p["section"]))
    try:
        n = len(re.findall(str(p.get("pattern") or ""), text, re.M | re.I))
    except re.error as e:
        raise ValueError("bad pattern: %s" % e) from e
    hi, lo = p.get("max"), p.get("min")
    if (hi is not None and n > int(hi)) or (lo is not None and n < int(lo)):
        msg = str(p.get("message") or "{n} matches of %r" % p.get("pattern")).replace("{n}", str(n))
        return [_f("count", p.get("severity", "warn"), art, msg)]
    return []


_FINDING = re.compile(r"^\s*FINDING:\s*(block|warn)\s*\|(.*)$", re.I | re.M)


def judge(p: Dict[str, Any], ctx: Ctx) -> List[Dict[str, Any]]:
    """A clean-context agent: the project's rules + the document, nothing else of the run. No rules -> no call."""
    d = ctx.definition
    cfg = dict(d.data.get("judge") or {}, **{k: v for k, v in p.items() if k in ("rules", "role", "prompt")})
    rules, where = _rules(cfg.get("rules") or {}, ctx)
    if not rules.strip() or ctx.pipe is None:
        return []
    art = p["artifact"]
    prompt = render(d.prompt(str(cfg.get("prompt") or "judge")), {
        "rules": rules[:MAX_RULES], "rules_from": ", ".join(where), "rules_hint": str((cfg.get("rules") or {}).get("hint") or ""),
        "artifact_title": d.artifact(art).get("title") or art, "document": ctx.docs.get(art, ""), "wt": ctx.wt})
    pipe = ctx.pipe
    try:
        res = pipe.llm.agentic(str(cfg.get("role") or "reviewer"), ctx.wt or pipe.workdir, prompt,
                               int(cfg.get("max_turns") or 20), float(cfg.get("usd") or 0.5),
                               key="judge-%s-%s" % (ctx.gate, art), run=pipe.run)
    finally:
        try:
            pipe._charge_stage()
        except Exception:   # noqa: BLE001
            pass
    text = str(getattr(res, "text", "") or "")
    return [_f("judge", m.group(1).lower(), art, m.group(2).strip()) for m in _FINDING.finditer(text)]


def _rules(spec: Dict[str, Any], ctx: Ctx) -> tuple:
    parts, where = [], []
    for path in spec.get("files") or []:
        t = ctx.rules_reader(path) if ctx.rules_reader else ""
        if t and t.strip():
            parts.append("## %s\n%s" % (path, t.strip()))
            where.append(path)
    kh = spec.get("store") or {}
    if kh.get("query") and ctx.pipe is not None and getattr(ctx.pipe, "rag", None) is not None:
        try:
            hits = ctx.pipe.rag.retrieve(str(kh.get("role") or "reviewer"), ctx.gate or "judge", ["*"],
                                         int(kh.get("max_chars") or 6000), query=str(kh["query"]))
        except Exception:   # noqa: BLE001 - a store that cannot answer means no rules from it
            hits = []
        t = "\n".join(str(h.get("text") or "") for h in hits or []).strip()
        if t:
            parts.append("## knowledge store\n" + t)
            where.append("knowledge store")
    return "\n\n".join(parts), where


CHECKS: Dict[str, Callable[[Dict[str, Any], Ctx], List[Dict[str, Any]]]] = {
    "sections": sections, "coverage": coverage, "in_diff": in_diff, "judge": judge, "count": count}


def run(params: Dict[str, Any], ctx: Ctx) -> List[Dict[str, Any]]:
    fn = CHECKS.get(str(params.get("check") or ""))
    if fn is None:
        raise ValueError("unknown check %r" % params.get("check"))
    return fn(params, ctx)


class _Safe(dict):
    def __missing__(self, key: str) -> str:
        return ""


def render(template: str, values: Dict[str, Any]) -> str:
    """A prompt template with {name} placeholders; an unknown name renders empty (a definition may use fewer or more
    of them than another); {{ and }} are literal braces."""
    import string
    return string.Formatter().vformat(template, (), _Safe({k: ("" if v is None else v) for k, v in values.items()}))


__all__ = ["CHECKS", "Ctx", "run", "render"]

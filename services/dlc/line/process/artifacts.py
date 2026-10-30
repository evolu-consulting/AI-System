"""Artifacts: the documents the agents of a process write (a spec, a plan, a test plan ...). The engine knows no
artifact by name; a definition says, per artifact:

    title    what the person sees
    head     the heading the document starts at (the agent's preamble before it is cut)
    items    regex with one group: the ids of the items the document DEFINES (e.g. F-items of a spec)
    refs     regex with one group: the ids the document REFERS to (e.g. the F-items a plan step serves)
    cases    regex with one group: other ids it defines that later steps look for (e.g. test case ids)
    fields   name -> {"section": heading text, "list": bool, "default": text}: values other prompts use as
             {<artifact>_<name>}

    document(text, spec) -> the agent's document (from `head` to the SUBMIT line, at most MAX_DOC)
    ids(text, pattern)   -> ordered unique ids the pattern finds
    sections(text)       -> heading titles (any level)
    section(text, title) -> the body under that heading
    fields(text, spec)   -> {name: value}
    lines_with(text, ids)-> {id: [lines that mention it]}
"""

from __future__ import annotations

import re
from typing import Any, Dict, Iterable, List

MAX_DOC = 60_000


def document(text: str, spec: Dict[str, Any]) -> str:
    t = text or ""
    head = str(spec.get("head") or "")
    if head:
        i = t.find(head)
        if i > 0:
            t = t[i:]
    t = re.sub(r"\n\s*SUBMIT\s*$", "", t.strip()).strip()
    return t[:MAX_DOC]


def ids(text: str, pattern: str) -> List[str]:
    if not pattern:
        return []
    try:
        rx = re.compile(pattern, re.M)
    except re.error as e:
        raise ValueError("bad id pattern %r: %s" % (pattern, e)) from e
    out: List[str] = []
    for m in rx.finditer(text or ""):
        v = (m.group(1) if rx.groups else m.group(0)).strip()
        if v and v not in out:
            out.append(v)
    return out


def sections(text: str) -> List[str]:
    return [m.group(2).strip() for m in re.finditer(r"^(#{1,6})\s+(.+?)\s*#*\s*$", text or "", re.M)]


def section(text: str, title: str) -> str:
    m = re.search(r"^#{1,6}\s*%s\s*$(.*?)(?=^#{1,6}\s|\Z)" % re.escape(title), text or "", re.M | re.S | re.I)
    return m.group(1).strip() if m else ""


def _as_list(body: str) -> List[str]:
    names = [re.sub(r"^[\s*\-+\d.)]+", "", ln).split(":")[0].split("->")[0].strip() for ln in body.splitlines()]
    return list(dict.fromkeys(n for n in names if n and n.lower() != "none"))


def fields(text: str, spec: Dict[str, Any]) -> Dict[str, str]:
    out: Dict[str, str] = {}
    for name, f in (spec.get("fields") or {}).items():
        body = section(text, str(f.get("section") or name))
        val = ", ".join(_as_list(body)) if f.get("list") else body
        out[name] = val or str(f.get("default") or "")
    return out


def lines_with(text: str, wanted: Iterable[str]) -> Dict[str, List[str]]:
    want = list(wanted)
    out: Dict[str, List[str]] = {w: [] for w in want}
    for ln in (text or "").splitlines():
        for w in want:
            if re.search(r"(?<![\w-])%s(?![\w])" % re.escape(w), ln):
                out[w].append(ln.strip())
    return out


__all__ = ["document", "ids", "sections", "section", "fields", "lines_with", "MAX_DOC"]

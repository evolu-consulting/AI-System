"""What a person reads first at a gate: the short brief an agent puts at the top of its document, and the points it
decided on its own that a person must confirm. The engine knows no section by name; an artifact of the definition
says where they are:

    "glance": "At a glance"                        the section with three lists, each under its label line:
                                                       Understood: / Will do: / Will not do:
    "asks": {"section": "Questions",               a table | id | question | status | answer ... |: the rows whose
             "status": ["proposed", "open"]}         status is listed are asked (status column found by its values)
    "asks": {"section": "Assumptions"}             a list: every item is asked ("A1 ..." keeps its id, else A<n>)

    glance(doc, art) -> {"understood": [..], "will_do": [..], "will_not": [..]} or None (no such section)
    asks(doc, art)   -> [{"id", "question", "status", "answer"}]
    answers_note(asks, answers) -> the person's answers as a note the agents read ("" when none)
"""

from __future__ import annotations

import re
from typing import Any, Dict, List, Optional

from .artifacts import section

LABELS = {"understood": ("understood", "what i understood", "the request"),
          "will_do": ("will do", "in scope", "changes"),
          "will_not": ("will not do", "won't do", "will not", "out of scope", "not in scope")}
MAX_ITEMS = 12
MAX_ASKS = 20


_LABEL_RX = re.compile(r"^(?P<label>[a-z' ]{4,20}?)\s*(?:\([^)]*\))?\s*:\s*(?P<rest>.*)$")


def _label(line: str) -> Optional[tuple]:
    """A label line ("Will not do:", "**Understood**:", "### Will do") -> (key, text after the colon)."""
    t = re.sub(r"[*_`]", "", line).strip().lstrip("#>").strip()
    m = _LABEL_RX.match(t.lower()) if ":" in t else None
    head, rest = (m.group("label").strip(), t[t.index(":") + 1:].strip()) if m else (t.lower().rstrip(":"), "")
    head = re.sub(r"\s*\([^)]*\)\s*$", "", head).strip()
    for key in ("will_not", "will_do", "understood"):           # "will not do" before "will do"
        if head in LABELS[key]:
            return key, rest
    return None


def _item(line: str) -> str:
    return re.sub(r"^\s*(?:[-*+]|\d+[.)])\s+", "", line).strip()


def _block(doc: str, title: str) -> str:
    """The text under a heading down to the next heading of the same or a higher level (sub-headings kept)."""
    lines = (doc or "").splitlines()
    for i, ln in enumerate(lines):
        m = re.match(r"^(#{1,6})\s*(.+?)\s*#*\s*$", ln)
        if m and m.group(2).strip().lower() == title.lower():
            out = []
            for nxt in lines[i + 1:]:
                h = re.match(r"^(#{1,6})\s", nxt)
                if h and len(h.group(1)) <= len(m.group(1)):
                    break
                out.append(nxt)
            return "\n".join(out).strip()
    return ""


def glance(doc: str, art: Dict[str, Any]) -> Optional[Dict[str, List[str]]]:
    name = str(art.get("glance") or "")
    if not name:
        return None
    body = _block(doc or "", name)
    if not body:
        return None
    out: Dict[str, List[str]] = {"understood": [], "will_do": [], "will_not": []}
    cur = "understood"
    for ln in body.splitlines():
        if not ln.strip():
            continue
        lab = None if re.match(r"^\s*(?:[-*+]|\d+[.)])\s+", ln) else _label(ln)
        if lab:
            cur = lab[0]
            if lab[1]:
                out[cur].append(lab[1])
            continue
        txt = _item(ln)
        if txt and len(out[cur]) < MAX_ITEMS:
            out[cur].append(txt)
    return out if any(out.values()) else None


def _cells(line: str) -> List[str]:
    return [c.strip() for c in line.strip().strip("|").split("|")]


def asks(doc: str, art: Dict[str, Any]) -> List[Dict[str, str]]:
    a = art.get("asks")
    if not isinstance(a, dict) or not a.get("section"):
        return []
    body = section(doc or "", str(a["section"]))
    if not body or body.strip().lower() in ("none", "none."):
        return []
    want = [str(x).lower() for x in a.get("status") or []]
    rows = [ln for ln in body.splitlines() if ln.strip().startswith("|")]
    out: List[Dict[str, str]] = []
    if rows:                                       # a table: id | question | status | answer and source
        for ln in rows:
            cells = _cells(ln)
            if len(cells) < 2 or set("".join(cells)) <= set("-: ") or cells[0].lower() in ("q", "id", "#"):
                continue
            status = next((c.lower().split()[0] for c in cells[1:] if c and c.lower().split()[0].strip("*")
                           in ("settled", "proposed", "open")), "")
            status = status.strip("*")
            if want and status not in want:
                continue
            si = next((i for i, c in enumerate(cells) if c.lower().strip("*").startswith(status)), 2) if status else 2
            out.append({"id": cells[0].strip("*"), "question": cells[1] if si > 1 else "",
                        "status": status or "proposed", "answer": " | ".join(c for c in cells[si + 1:] if c)})
    else:                                          # a list: every item is a point to confirm
        n = 0
        for ln in body.splitlines():
            txt = _item(ln)
            if not txt or not re.match(r"^\s*(?:[-*+]|\d+[.)])\s+", ln):
                continue
            n += 1
            m = re.match(r"^\**([A-Z]{1,3}\d+)\**[.:)]?\s+(.*)$", txt)
            out.append({"id": m.group(1) if m else "A%d" % n, "question": (m.group(2) if m else txt),
                        "status": "proposed", "answer": ""})
    return out[:MAX_ASKS]


def answers_note(items: List[Dict[str, Any]], answers: List[Dict[str, Any]]) -> str:
    """The person's answer to each point: accepted as proposed, or their own words."""
    if not answers:
        return ""
    by = {(str(x.get("artifact") or ""), str(x.get("id") or "")): x for x in items}
    lines = []
    for a in answers:
        key = (str(a.get("artifact") or ""), str(a.get("id") or ""))
        it = by.get(key) or {}
        q = str(it.get("question") or "")[:200]
        if a.get("ok") and not str(a.get("text") or "").strip():
            lines.append("- %s %s: accepted as proposed%s" % (key[0], key[1], " (%s)" % q if q else ""))
        else:
            lines.append("- %s %s: CHANGED by the person%s -> %s" % (key[0], key[1], " (%s)" % q if q else "",
                                                                     str(a.get("text") or "").strip()[:2000]))
    return "Answers to the points to confirm:\n" + "\n".join(lines)


__all__ = ["glance", "asks", "answers_note"]

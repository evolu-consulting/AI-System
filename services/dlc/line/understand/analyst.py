"""The spec analyst: the first agent of a run, before the pack is frozen.

A report or a spec often holds less than the people who wrote it know: a ticket link, a page of the app,
"same as last time". The analyst is an agentic call (role spec_analyst, tools: Read, Write, Glob, Grep and
the run's `dlc mcp` tools) that
  1. opens every link in the spec: an app listed by list_apps (e.g. Jira) through get_session + fetch /
     open_page (the engine signs in with DLC Autologin; entries must allow the 'spec' agent group),
  2. searches the project's knowledge (search_knowledge): earlier fixes, decisions, lessons, worklog,
  3. reads the repository (read only) to name where the change lands,
and writes analysis.md in its own scratch folder. The engine appends it to spec.md under
'## Analysis (spec analyst)' before the freeze, so the readers, the test author and the builders all see it.

Runs once per run (detail.spec_analysis); a failure or an empty answer never stops the run, the spec is
then frozen as it is. LINE_SPEC_ANALYST: auto (on with a real model, i.e. llm != fake) | 1 | 0. A run the change
sizer put on the trivial lane skips it unless the spec links something (line.understand.sizer).

The analysis is advice, not the requester's word: its headings are pushed below level 2 so the section ends
at the next '## ' heading (a hook's addendum), and advisory_spans() names its spans so the reconcile never
escalates on what only the analysis says.
"""

from __future__ import annotations

import os
import re
from typing import Any, Dict, FrozenSet

from ..contracts import E_RUN, PackVersion, now_ms

ROLE = "spec_analyst"
HEADING = "## Analysis (spec analyst)"
MAX_CHARS = 60_000

PROMPT = """You are the spec analyst of an automated delivery line. Before anybody designs, tests or codes, you
turn the request below into everything the team needs to know. Do not change the repository.

THE REQUEST (spec.md of the run):
-----
{spec}
-----

The project's repository (read only; use Read / Glob / Grep with absolute paths): {repo}

Do this, in order:
1. Every link in the request: if its host belongs to an app that list_apps shows, call get_session for that app,
   then read the item with fetch (for Jira: {jira_hint}) or open_page. Copy the facts that matter: title,
   description, steps, expected and actual behaviour, comments with decisions, attachments' names.
   A link you cannot open: say so; never invent its content.
2. Call search_knowledge several times (the feature or screen, the error, the module, 'how to test / deploy
   this project'): earlier fixes, decisions, lessons, worklog. Keep what applies, with the item it came from.
3. Look at the code the request touches and name the files / functions involved. When the code_graph tool is
   listed, ask it first (query the feature, explain / affected on the symbol) and Read only the lines it names.

Then write the file {out} (Write tool) in markdown with exactly these sections:
### Source ticket and links      what each link says (or why it could not be opened)
### What is asked                expected behaviour, actual behaviour, scope; for a bug, the steps
### Where in the code            files and functions involved
### What the project already knows   applicable fixes, decisions, lessons (cite them briefly)
### Acceptance checks            concrete checks a test can assert
### Open questions               only what the sources above do not answer

Keep it factual and short (under 400 lines). End your reply with a last line SUBMIT.
"""


_HEADING_RE = re.compile(r"^( {0,3})(#{1,6})(\s)")
_FENCE_RE = re.compile(r"^ {0,3}(```|~~~)")


def _demote(text: str) -> str:
    """Headings of the analysis go three levels down (at most 6), so none of them is level 1 or 2."""
    out, fenced = [], False
    for line in text.splitlines():
        if _FENCE_RE.match(line):
            fenced = not fenced
        m = None if fenced else _HEADING_RE.match(line)
        out.append(m.group(1) + "#" * min(len(m.group(2)) + 3, 6) + line[m.end(2):] if m else line)
    return "\n".join(out)


def advisory_spans(pack: PackVersion) -> FrozenSet[str]:
    """Span ids of spec.md from the analysis heading up to the next level 1-2 heading."""
    ids, inside = set(), False
    for s in pack.spans:
        if s.path != "spec.md":
            continue
        m = _HEADING_RE.match(s.text.split("\n", 1)[0]) if s.text else None
        if s.heading == HEADING[3:]:
            inside = True
        elif inside and m and len(m.group(2)) <= 2:
            inside = False
        if inside:
            ids.add(s.id)
    return frozenset(ids)


def enabled(cfg: Any) -> bool:
    mode = str(getattr(cfg, "spec_analyst", "auto") or "auto").strip().lower()
    if mode in ("0", "off", "false", "no"):
        return False
    if mode in ("1", "on", "true", "yes"):
        return True
    return str(getattr(cfg, "llm", "fake")) != "fake"


def run(pipe: Any) -> Dict[str, Any]:
    """Analyse the run's pack once, before its freeze. Returns what happened (also kept in detail)."""
    store, run_id, cfg = pipe.store, pipe.run, pipe.cfg
    row = store.get(E_RUN, run_id) or {}
    detail = dict(row.get("detail") or {})
    if detail.get("spec_analysis") or not enabled(cfg):
        return detail.get("spec_analysis") or {"skipped": "off"}
    spec_path = os.path.join(pipe.pack, "spec.md")
    if not os.path.isfile(spec_path):
        return {"skipped": "no spec.md"}
    with open(spec_path, encoding="utf-8") as fh:
        spec = fh.read()
    if HEADING in spec:
        return {"skipped": "already analysed"}
    from . import sizer
    if not sizer.needs_analyst(pipe, spec):               # trivial lane, nothing linked: the request says it all
        return {"skipped": "trivial lane"}
    work = os.path.join(getattr(cfg, "workroot", "") or os.path.dirname(pipe.pack), "analyst", run_id)
    os.makedirs(work, exist_ok=True)
    out = os.path.join(work, "analysis.md")
    prompt = PROMPT.format(spec=spec[:MAX_CHARS], repo=getattr(pipe, "repo", "") or "(none yet)", out=out,
                           jira_hint="fetch <jira base>/rest/api/2/issue/<KEY>?fields=summary,description,comment")
    result: Dict[str, Any] = {"ms": now_ms()}
    try:
        res = pipe.llm.agentic(ROLE, work, prompt, int(getattr(cfg, "spec_analyst_max_turns", 30) or 30),
                               float(getattr(cfg, "max_usd_call", 1.5) or 1.5), key="analyst", run=run_id)
        result.update(outcome=str(getattr(res, "outcome", "") or ""), usd=round(float(getattr(res, "usd", 0) or 0), 4))
    except Exception as e:   # noqa: BLE001 - the analysis helps; it never stops the run
        result.update(error=str(e)[:300])
    text = ""
    if os.path.isfile(out):
        with open(out, encoding="utf-8") as fh:
            text = fh.read().strip()
    if text:
        with open(spec_path, "a", encoding="utf-8", newline="\n") as fh:
            fh.write("\n\n%s\n\n%s\n" % (HEADING, _demote(text[:MAX_CHARS])))
        result["chars"] = len(text)
    else:
        result.setdefault("skipped", "no analysis written")
    detail = dict((store.get(E_RUN, run_id) or {}).get("detail") or {})
    detail["spec_analysis"] = result
    from ..statemachine import update_row
    update_row(store, E_RUN, run_id, {"detail": detail})
    pipe.log("%s: spec analyst %s" % (run_id, result))
    return result


__all__ = ["run", "enabled", "advisory_spans", "ROLE", "HEADING"]

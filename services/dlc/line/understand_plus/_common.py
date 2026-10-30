"""Shared constants and helpers of understand_plus (plan blocks 7 and 8).

New names this slice needs (the integrator adds them to codes.py / contracts.py / config.py):

  event kinds     GAPS_CHECKED, CONFLICTS_CHECKED, HUMAN_QUESTION, HUMAN_ANSWERED, HUMAN_REMINDER,
                  SPEC_ADDENDUM, RUN_PARKED, RUN_UNPARKED            (NEW_EVENT_KINDS)
  entities        E_ASSUMPTION, E_QUESTION, E_CONFLICT, E_ADDENDUM, E_RULE_GRAPH, E_PARK
                  (NEW_ENTITIES; ids already carry the run prefix "<run>:..." -> NOT for scope.SCOPED)
  record codes    SPEC_GAP, SPEC_CONFLICT, ASSUMPTION_SENSITIVE, UNSCANNED (strings on records only;
                  never raised as LineError, so they need not be in codes.ALL_CODES)
  config keys     CONFIG_DEFAULTS below (read with getattr(cfg, name, default), then LINE_* env)
"""

from __future__ import annotations

import datetime as _dt
import hashlib
import json
import os
import re
from typing import Any, Dict, Iterable, List, Mapping, Optional

from .. import codes
from ..codes import LineError
from ..contracts import Envelope, Span, now_ms

# ------------------------------------------------------------------ event kinds (new)
GAPS_CHECKED = "gaps.checked"            # {"f_items", "slots", "covered", "gaps", "assumptions", "sensitive", "dropped"}
CONFLICTS_CHECKED = "conflicts.checked"  # {"claims", "pairs", "conflicts", "label", "coverage", "superseded"}
HUMAN_QUESTION = "human.question"        # {"round", "questions": [qid..], "held": [qid..], "due_ms"}
HUMAN_ANSWERED = "human.answered"        # {"qid", "option", "who", "remaining"}
HUMAN_REMINDER = "human.reminder"        # {"qid", "to": "owner"|"lead", "due_ms", "overdue": bool}
HUMAN_DECIDED = "human.decided"          # {"qid", "option", "reason", "model", "fallback": bool} (human_mode=decide)
SPEC_ADDENDUM = "spec.addendum"          # {"label", "version", "parent", "clauses", "stale_f_items"}
RUN_PARKED = "run.parked"                # {"scope", "f_items", "questions", "reason"}
RUN_UNPARKED = "run.unparked"            # {"addendum", "version"}

NEW_EVENT_KINDS = (GAPS_CHECKED, CONFLICTS_CHECKED, HUMAN_QUESTION, HUMAN_ANSWERED, HUMAN_REMINDER,
                   HUMAN_DECIDED, SPEC_ADDENDUM, RUN_PARKED, RUN_UNPARKED)

# ------------------------------------------------------------------ entities (new)
E_ASSUMPTION = "assumption"      # id "<run>:ASSUMED-<n>"
E_QUESTION = "human_question"    # id "<run>:Q<n>"
E_CONFLICT = "conflict"          # id "<run>:X<n>"
E_ADDENDUM = "addendum"          # id "<run>:v<N>.<k>"
E_RULE_GRAPH = "rule_graph"      # id = graph name (default "system"); not run scoped
E_PARK = "human_park"            # id = run

NEW_ENTITIES = (E_ASSUMPTION, E_QUESTION, E_CONFLICT, E_ADDENDUM, E_RULE_GRAPH, E_PARK)

# ------------------------------------------------------------------ record codes (strings only)
SPEC_GAP = "SPEC_GAP"
SPEC_CONFLICT = "SPEC_CONFLICT"
ASSUMPTION_SENSITIVE = "ASSUMPTION_SENSITIVE"
UNSCANNED = "UNSCANNED"

# ------------------------------------------------------------------ settings
#: config key -> (default, env var). Disabled by default: the pipeline hooks are no-ops.
CONFIG_DEFAULTS: Dict[str, Any] = {
    "uplus_enabled": (False, "LINE_UPLUS"),                 # master switch of blocks 7 + 8
    "uplus_gaps": (True, "LINE_UPLUS_GAPS"),                # block 7 inside the master switch
    "uplus_conflicts": (True, "LINE_UPLUS_CONFLICTS"),      # block 8 inside the master switch
    "uplus_park_scope": ("run", "LINE_UPLUS_PARK_SCOPE"),   # "run" | "f_item" (only touched F-items wait)
    "uplus_spec_supersede": (True, "LINE_UPLUS_SPEC_SUPERSEDE"),  # explicit 'replaces' sentence retires an OLD system rule
    "uplus_unscanned_asks": (False, "LINE_UPLUS_UNSCANNED_ASKS"),  # coverage < 80% also asks the human
    "uplus_graph": ("system", "LINE_UPLUS_GRAPH"),          # rule graph name (local record id / RAG record id)
    "uplus_graph_mirror": (True, "LINE_UPLUS_GRAPH_MIRROR"),  # mirror the rule graph to the RAG System (records capability)
    "uplus_max_hops": (3, "LINE_UPLUS_MAX_HOPS"),
    "uplus_pack_major": (1, "LINE_UPLUS_PACK_MAJOR"),       # N of the addendum label vN.k
    "human_max_open": (3, "LINE_HUMAN_MAX_OPEN"),           # open questions per run; 0 = no cap
    "human_due_workdays": (2, "LINE_HUMAN_DUE_WORKDAYS"),
    "human_remind_workdays": (1, "LINE_HUMAN_REMIND_WORKDAYS"),
    "dry_human": ("", "LINE_DRY_HUMAN"),                    # "" | "auto" (dry e2e: answers itself)
    # owner decision 2026-10-11: "ask" parks the run until a person answers (asynchronously: the board lists
    # the pending questions whenever it is opened); "decide" lets the strong model pick an option itself and
    # writes every question with its decision to the project worklog, so a person can check them later
    "human_mode": ("ask", "LINE_HUMAN_MODE"),
    "human_decide_model": ("", "LINE_HUMAN_DECIDE_MODEL"),  # empty: the judge model
}


def setting(cfg: Any, name: str, env: Optional[Mapping[str, str]] = None) -> Any:
    """cfg.<name> if the Config has it, else LINE_* env, else the default (typed like the default)."""
    default, var = CONFIG_DEFAULTS[name]
    if cfg is not None and hasattr(cfg, name):
        return getattr(cfg, name)
    env = os.environ if env is None else env
    raw = env.get(var, "")
    if raw == "":
        return default
    if isinstance(default, bool):
        return str(raw).strip().lower() in ("1", "true", "yes", "on")
    if isinstance(default, int):
        try:
            return int(raw)
        except ValueError:
            return default
    return str(raw).strip()


# ------------------------------------------------------------------ store / events


def clock_ms(store: Any = None, clock: Any = None) -> int:
    c = clock if clock is not None else getattr(store, "clock", None)
    if c is not None and hasattr(c, "now_ms"):
        return int(c.now_ms())
    return now_ms()


def env_for(run: str, cfg: Any = None, spec_hash: str = "", model: str = "") -> Envelope:
    return Envelope(run=run, unit="", attempt=0, epoch=0, agent_version=str(getattr(cfg, "agent_version", "") or ""),
                    model=model or "", spec_hash=spec_hash or "")


def emit(store: Any, kind: str, run: str, body: Mapping[str, Any], cfg: Any = None, spec_hash: str = "") -> int:
    if store is None:
        return 0
    return store.emit(kind, env_for(run, cfg, spec_hash), dict(body))


def rid(run: str, local: str) -> str:
    return "%s:%s" % (run, local)


def local_id(row_id: str) -> str:
    return row_id.split(":", 1)[1] if ":" in row_id else row_id


def put(store: Any, entity: str, id: str, row: Mapping[str, Any], run: str = "") -> int:
    return store.put(entity, id, dict(row), run=run)


def rows(store: Any, entity: str, run: str) -> List[Dict[str, Any]]:
    return list(store.query(entity, run=run))


def merge(store: Any, entity: str, id: str, updates: Mapping[str, Any], run: str = "", retries: int = 5) -> Dict[str, Any]:
    """CAS merge of top-level fields; creates the row when absent."""
    for _ in range(max(retries, 1)):
        ver = store.version(entity, id)
        row = store.get(entity, id) or {}
        row.update(json.loads(json.dumps(dict(updates), default=str)))
        try:
            store.put(entity, id, row, run=run or row.get("run", ""), if_version=ver if ver else None)
            return row
        except LineError as e:
            if e.code != codes.STATE_CONFLICT:
                raise
    raise LineError(codes.STATE_CONFLICT, "could not update %s/%s" % (entity, id), {"entity": entity, "id": id})


# ------------------------------------------------------------------ text helpers


def s(v: Any) -> str:
    return v.strip() if isinstance(v, str) else ("" if v is None else str(v)).strip()


def norm(text: str) -> str:
    return " ".join("".join(ch.lower() if ch.isalnum() else " " for ch in text or "").split())


def fingerprint(*parts: Any) -> str:
    return hashlib.sha1("\x1f".join(norm(str(p)) for p in parts).encode("utf-8")).hexdigest()[:16]


def quote_ok(spans: Mapping[str, Span], sid: str, quote: str) -> str:
    """'' if quote is a literal substring of span sid, else the reason (same rule as reader quote check)."""
    sp = spans.get(sid)
    if sp is None:
        return "unknown_span"
    if not quote:
        return "empty_quote"
    if quote not in sp.text:
        return "not_in_span"
    return ""


#: design I01 / R13: money, permissions, data deletion, external interfaces always go to a human
SENSITIVE: Dict[str, Iterable[str]] = {
    "money": ("money", "price", "prices", "pricing", "payment", "payments", "invoice", "refund", "fee", "fees",
              "currency", "credit", "billing", "tax", "discount"),
    "permission": ("permission", "permissions", "role", "roles", "admin", "authorization", "authorisation",
                   "authenticate", "authentication", "login", "privilege", "privileges", "auth"),
    "deletion": ("delete", "deletes", "deleted", "deletion", "remove", "removes", "removed", "removal", "purge",
                 "erase", "wipe", "truncate", "destroy"),
    "external": ("webhook", "external", "third party", "third-party", "integration", "email", "sms",
                 "endpoint", "upstream", "downstream", "partner"),
}
SENSITIVE_CATEGORIES = tuple(SENSITIVE)
_SENS_RE = {cat: re.compile(r"\b(" + "|".join(re.escape(w) for w in words) + r")\b", re.I)
            for cat, words in SENSITIVE.items()}


def sensitive_categories(*texts: str) -> List[str]:
    """Categories whose keywords appear in any text (code may upgrade a model's verdict, never downgrade)."""
    blob = " ".join(t or "" for t in texts)
    return [cat for cat, rx in _SENS_RE.items() if rx.search(blob)]


# ------------------------------------------------------------------ working days


def add_workdays(start_ms: int, days: float) -> int:
    """start + `days` working days (Mon-Fri, UTC calendar). Fractions count as fractions of 24 h."""
    t = _dt.datetime.fromtimestamp(start_ms / 1000.0, tz=_dt.timezone.utc)
    whole = int(days)
    frac = days - whole
    while t.weekday() >= 5:               # asked on a weekend: the clock starts Monday 00:00
        t = (t + _dt.timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    n = 0
    while n < whole:
        t += _dt.timedelta(days=1)
        if t.weekday() < 5:
            n += 1
    t += _dt.timedelta(days=frac)
    return int(t.timestamp() * 1000)

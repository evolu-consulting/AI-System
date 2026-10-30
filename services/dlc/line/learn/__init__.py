"""Self-learning loop of the line (design blocks 18-20): lessons distilled from the line's own
failures, proven offline by a strong judge model, rolled out by canary, served by key.

No human sits in this loop. Where a person used to confirm a cause or approve a lesson, a strong
judge model (different from the distiller model) decides, and later runs grade every decision by
outcome (first-pass yield of units with vs without the lesson).

Modules
  lstore.py     LearnStore: small JSON document store (lessons, arms, outcomes, judge history,
                agent directory). One file, atomic writes; in-memory when path is "".
  distiller.py  finished run -> candidate lessons (LLM role "distiller"), evidence = event ids,
                deduped by key (role + step + stack) + fingerprint.
  evalgate.py   offline gate (held-out past attempts + small eval set, judge role "eval_judge"),
                canary arms per unit, promote / withdraw by outcome with a minimum sample and a
                non-inferiority rule, rollback on harm, TTL expiry.
  serve.py      lessons for a prompt by key within a char budget (local store + RagPort.retrieve).
  hooks.py      on_run_end / on_prompt: the integration points for pipeline.drive.

Everything is disabled unless the config flag ``learn_enabled`` is true (see SETTINGS).
Event kinds are registered in codes.W4_KINDS and the settings are Config fields (LINE_* env in
config.ENV_MAP); without a Config attribute a setting falls back to LINE_<NAME>, then the default.
"""

from __future__ import annotations

import os
from typing import Any, Dict, Mapping, Optional

from .. import codes

# ------------------------------------------------------------------ event kinds (proposed)

LESSON_PROPOSED = "lesson.proposed"     # body: {"lesson", "key", "fingerprint", "evidence": [event ids]}
LESSON_JUDGED = "lesson.judged"         # body: {"lesson", "verdict", "model", "cases", "helps", "harm", "reason"}
LESSON_CANARY = "lesson.canary"         # body: {"lesson", "ratio"}
LESSON_PROMOTED = "lesson.promoted"     # body: {"lesson", "treat": {...}, "control": {...}}
LESSON_WITHDRAWN = "lesson.withdrawn"   # body: {"lesson", "reason", "treat", "control"}  (rollback / TTL / inconclusive)

LEARN_KINDS = (LESSON_PROPOSED, LESSON_JUDGED, LESSON_CANARY, LESSON_PROMOTED, LESSON_WITHDRAWN)

# ------------------------------------------------------------------ settings (proposed config keys)

#: name -> default. Read with setting(cfg, name): cfg attribute, else env LINE_<NAME>, else default.
SETTINGS: Dict[str, Any] = {
    "learn_enabled": False,          # master switch of the learning loop hooks
    "learn_path": "",                # LearnStore file; "" -> <workroot>/learn/learn.json
    "learn_stack": "python",         # stack part of the lesson key
    "learn_serve_max_chars": 1500,   # char budget for lessons in one prompt
    "learn_canary_ratio": 0.2,       # share of matching units that get a canary lesson
    "learn_holdback_ratio": 0.1,     # share of matching units that do NOT get an active lesson (harm watch)
    "learn_min_sample": 30,          # units per arm before promote (design: >= 30 per arm)
    "learn_harm_min_sample": 10,     # units per arm before an early rollback on harm
    "learn_max_sample": 120,         # per arm: still not non-inferior -> withdraw (inconclusive)
    "learn_margin": 0.05,            # non-inferiority margin on first-pass yield
    "learn_ttl_days": 90,            # active lesson not re-proven within TTL -> expired
    "learn_distiller_model": "",     # "" -> cfg.model_alt
    "learn_judge_model": "",         # "" -> cfg.model (the strongest); never the distiller's model
    "learn_eval_path": "",           # eval set JSON kept OUTSIDE the RAG System ({"canary", "cases"})
    "learn_holdout_max": 8,          # held-out past attempts shown to the judge
}


def _coerce(value: Any, default: Any) -> Any:
    if isinstance(default, bool):
        if isinstance(value, bool):
            return value
        return str(value).strip().lower() in ("1", "true", "yes", "on")
    if isinstance(default, int):
        return int(value)
    if isinstance(default, float):
        return float(value)
    return str(value)


def setting(cfg: Any, name: str, default: Any = None, env: Optional[Mapping[str, str]] = None) -> Any:
    """cfg.<name> when the Config has it, else env LINE_<NAME>, else default (SETTINGS[name])."""
    if default is None:
        default = SETTINGS.get(name, "")
    if cfg is not None and hasattr(cfg, name):
        v = getattr(cfg, name)
        if v is not None and v != "":
            try:
                return _coerce(v, default)
            except (TypeError, ValueError):
                return default
    env = os.environ if env is None else env
    raw = env.get("LINE_" + name.upper(), "")
    if raw != "":
        try:
            return _coerce(raw, default)
        except (TypeError, ValueError):
            return default
    return default


def emit(store: Any, kind: str, env: Any, body: Mapping[str, Any]) -> int:
    """store.emit, never raising: the learning loop must not break a run."""
    if store is None:
        return 0
    try:
        return int(store.emit(kind, env, dict(body)))
    except Exception:   # noqa: BLE001 - the learning loop never breaks a run
        return 0


__all__ = ["LEARN_KINDS", "LESSON_PROPOSED", "LESSON_JUDGED", "LESSON_CANARY", "LESSON_PROMOTED",
           "LESSON_WITHDRAWN", "SETTINGS", "setting", "emit"]

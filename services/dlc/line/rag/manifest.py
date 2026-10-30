"""The line's own namespace manifest for the RAG System: pure data.

The line ships this document and applies it on start (HttpRagAdapter.apply_manifest). Applying the
same manifest twice changes nothing. Wire details that belong to one RAG System deployment (redaction
pack ids, project name) come from config.rag_extra (local RAG wire config, LINE_RAG_LOCAL), never from this file.

Contents
  record types   run, unit, digest, test, graph, rules_graph, lesson (RECORD_TYPES; If-Match on update)
  event kinds    every codes.EVENT_KINDS kind      (envelope run_id required; body carries
                                                    agent_version, model, spec_hash)
  metrics        METRICS
  keyspace       "step" with dims role/step/stack (keyed retrieval)
"""

from __future__ import annotations

from typing import Any, Dict, List, Mapping, Optional

from .. import codes

MANIFEST_VERSION = 1

#: Record types the line keeps in the RAG System -> line Store entity they mirror.
RECORD_TYPES: Dict[str, str] = {
    "run": "run",
    "unit": "unit",
    "digest": "digest",
    "test": "acc_test",
    "graph": "graph",
    "rules_graph": "rule_graph",   # system rule graph (understand_plus conflicts)
    "lesson": "",                  # published lessons (learn.evalgate); no Store entity behind it
}

#: Event body fields every line event carries (from its Envelope).
EVENT_BODY_REQUIRED = ["agent_version", "model", "spec_hash"]
EVENT_ENVELOPE_REQUIRED = ["run_id"]

#: Metric series the line reports: name -> settings.
METRICS: Dict[str, Dict[str, Any]] = {
    "unit_first_pass_green": {"scale": "binary"},
    "unit_attempts": {"dir": "down"},
    "unit_usd": {"dir": "down"},
    "run_lead_time_s": {"dir": "down"},
    "run_usd": {"dir": "down"},
    "qas_flaky": {"dir": "down"},
    "rag_outbox_depth": {"dir": "down"},
    # outcome metrics of line.observe (pushed at run end when obs_enabled)
    "line.first_pass_yield": {"dir": "up"},
    "line.escalation_rate": {"dir": "down"},
    "line.rework_count": {"dir": "down"},
    "line.qas_flaky_rate": {"dir": "down"},
    "line.usd": {"dir": "down"},
    "line.lead_time_ms": {"dir": "down"},
    "line.f_item.usd": {"dir": "down"},
    "line.f_item.lead_time_ms": {"dir": "down"},
}

KEYSPACE = "step"
KEY_DIMS = ["role", "step", "stack"]


def event_kinds() -> List[str]:
    return sorted(codes.EVENT_KINDS)


def build(extra: Optional[Mapping[str, Any]] = None) -> Dict[str, Any]:
    """The manifest document. extra = config.rag_extra (redaction_packs, idempotency_hours,
    include_people_lanes: true on a RAG System dedicated to the line, so the project's own knowledge, e.g. the
    imported lessons, is served by meaning; off by default because on a shared system it is people's knowledge;
    people_share: the budget share of those rows when on, default 1.0)."""
    extra = dict(extra or {})
    schemas = [
        {"name": "line_event", "version": 1, "schema": {
            "type": "object", "required": list(EVENT_BODY_REQUIRED),
            "properties": {"agent_version": {"type": "string"}, "model": {"type": "string"},
                           "spec_hash": {"type": "string"}, "line_seq": {"type": "integer"},
                           "code": {"type": "string"}}}},
        {"name": "line_record", "version": 1, "schema": {"type": "object"}},
        {"name": "line_metric_dims", "version": 1, "schema": {
            "type": "object", "properties": {"run": {"type": "string"}, "unit": {"type": "string"},
                                             "role": {"type": "string"}, "model": {"type": "string"}}}},
    ]
    types: List[Dict[str, Any]] = []
    for k in event_kinds():
        types.append({"type": k, "kind_of": "event", "schema": "line_event",
                      "required_envelope": list(EVENT_ENVELOPE_REQUIRED),
                      "index_fields": {"agent_version": "s", "model": "s", "spec_hash": "s"}})
    for rtype in RECORD_TYPES:
        types.append({"type": rtype, "kind_of": "record", "schema": "line_record", "require_if_match": True,
                      "index_fields": {"run": "s", "state": "s"}})
    for series in METRICS:
        types.append({"type": series, "kind_of": "metric", "schema": "line_metric_dims"})
    doc: Dict[str, Any] = {
        "manifest_version": MANIFEST_VERSION,
        "schemas": schemas,
        "types": types,
        "keyspaces": [{"keyspace": KEYSPACE, "dims": list(KEY_DIMS)}],
        # long enough that a degraded line can replay its outbox with the original keys
        "retention": {"idempotency_hours": int(extra.get("idempotency_hours", 168))},
        "settings": {"metrics": {"series": {k: dict(v) for k, v in METRICS.items()}},
                     "include_people_lanes": bool(extra.get("include_people_lanes", False))},
    }
    if extra.get("include_people_lanes"):
        # on a dedicated system the project's knowledge is the line's own: it may fill the whole budget (the
        # RAG System's default share of 0.4 drops a lesson longer than 40% of a small learn budget)
        doc["settings"]["retrieval"] = {"cross_share": float(extra.get("people_share", 1.0))}
    packs = extra.get("redaction_packs")
    if packs:
        doc["redaction"] = {"packs": list(packs)}
    return doc


__all__ = ["MANIFEST_VERSION", "RECORD_TYPES", "METRICS", "KEYSPACE", "KEY_DIMS", "EVENT_BODY_REQUIRED",
           "EVENT_ENVELOPE_REQUIRED", "event_kinds", "build"]

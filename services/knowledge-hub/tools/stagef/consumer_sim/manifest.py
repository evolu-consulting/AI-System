"""The simulated line's manifest: pure data, as a consumer would ship it in its own repository."""

EVENT_KINDS = ["run.started", "run.finished", "step.started", "step.done", "unit.claimed", "unit.done", "unit.write"]
FENCED_KINDS = {"unit.write"}
REQUIRED_ENVELOPE = ["run_id", "unit_id", "attempt"]
REQUIRED_BODY = ["agent_version", "model_snapshot", "spec_hash"]
KEYSPACE = "step"
KEY_DIMS = ["role", "step", "stack"]
VAULT = "holdout"
SUB_ID = "line-hooks"
SUB_KINDS = ["run.*", "kh.canary_hit", "kh.item_rollback"]
RECEIVER_PORT = 18099


def build(receiver_url: str) -> dict:
    return {
        "manifest_version": 1,
        "schemas": [
            {"name": "line_event", "version": 1, "schema": {
                "type": "object", "required": REQUIRED_BODY,
                "properties": {"agent_version": {"type": "string"}, "model_snapshot": {"type": "string"},
                               "spec_hash": {"type": "string"}, "step": {"type": "string"},
                               "msg": {"type": "string"}, "n": {"type": "number"},
                               "lesson_ids": {"type": "array", "items": {"type": "string"}}}}},
            {"name": "decision", "version": 1, "schema": {
                "type": "object", "required": ["case_kind", "judge_model", "options", "chosen", "expected"],
                "properties": {"case_kind": {"type": "string"}, "judge_model": {"type": "string"},
                               "features": {"type": "object"}, "options": {"type": "array"},
                               "chosen": {"type": "string"}, "expected": {}, "outcome": {},
                               "scored": {"type": "number"}, "attribution": {"type": "string"},
                               "decided_at": {"type": "integer"}, "note": {"type": "string"}}}},
            {"name": "guard", "version": 1, "schema": {
                "type": "object", "required": ["name", "pattern"],
                "properties": {"name": {"type": "string"}, "pattern": {"type": "string"},
                               "note": {"type": "string"}}}},
            {"name": "unit_state", "version": 1, "schema": {
                "type": "object", "required": ["unit", "status"],
                "properties": {"unit": {"type": "string"}, "status": {"type": "string"},
                               "owner": {"type": "string"}, "n": {"type": "integer"},
                               "note": {"type": "string"}}}},
            {"name": "lesson_attrs", "version": 1, "schema": {
                "type": "object", "properties": {"severity": {"type": "string"}}}},
            {"name": "metric_dims", "version": 1, "schema": {
                "type": "object", "properties": {"role": {"type": "string"}, "stack": {"type": "string"}}}},
        ],
        "types": (
            [{"type": k, "kind_of": "event", "schema": "line_event", "required_envelope": REQUIRED_ENVELOPE,
              "index_fields": {"agent_version": "s", "model_snapshot": "s", "spec_hash": "s"},
              **({"fenced": True} if k in FENCED_KINDS else {})} for k in EVENT_KINDS]
            + [
                {"type": "decision-ledger", "kind_of": "record", "schema": "decision", "require_if_match": True,
                 "write_roles": ["judge"], "read_roles": ["judge", "orchestrator"],
                 "index_fields": {"case_kind": "s", "judge_model": "s", "attribution": "s", "scored": "n",
                                  "decided_at": "t"}},
                {"type": "guard-registry", "kind_of": "record", "schema": "guard", "write_roles": ["admin"],
                 "read_roles": ["agent", "judge", "distiller"], "index_fields": {"name": "s"}},
                {"type": "unit-state", "kind_of": "record", "schema": "unit_state", "fenced": True,
                 "index_fields": {"unit": "s", "status": "s"}},
                {"type": "work-board", "kind_of": "record", "schema": "unit_state", "require_if_match": True,
                 "index_fields": {"unit": "s", "status": "s"}},
                {"type": "lesson", "kind_of": "item", "schema": "lesson_attrs",
                 "confirm_policy": {"roles": ["judge"]}},
                {"type": "first_pass_green", "kind_of": "metric", "schema": "metric_dims"},
                {"type": "lead_time", "kind_of": "metric", "schema": "metric_dims"},
            ]),
        "keyspaces": [{"keyspace": KEYSPACE, "dims": KEY_DIMS}],
        "retention": {"idempotency_hours": 72},
        "redaction": {"packs": ["kh-default@1"]},
        "vaults": [{"vault_id": VAULT, "refresh_days": 30}],
        "subscriptions": [{"sub_id": SUB_ID, "kinds": SUB_KINDS, "url": receiver_url}],
        "settings": {
            "items": {"guard_type": "guard-registry"},
            "metrics": {"series": {"first_pass_green": {"scale": "binary"}, "lead_time": {"dir": "down"}}},
            "include_people_lanes": False,
        },
    }

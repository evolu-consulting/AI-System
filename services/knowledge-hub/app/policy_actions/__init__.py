"""Policy ACTION TABLE - deterministic policy routing by exact lookup (fen 2026-08-21).

/policy/match routes by cosine similarity over an embedded intent string: probabilistic,
needs a hand-tuned threshold, and impossible in Vietnamese because the embedder is
bge-small-en-v1.5 (English only). This subsystem replaces the guess with a SELECT.

    policy_actions(action PK, description, source_policy, priority, updated_at)
    policy_rules(action, sub_action, seq, clauses, content, PRIMARY KEY (action, sub_action))

One row per SMALL step inside a big action group, not one row per whole policy. The agent
picks an ACTION label from the menu, then reads the rule for the SUB-ACTION it is on, so the
language of the request stops mattering. The same sub-action name under two actions is two
unambiguous rows - 'read files' under 'scan code' and under 'review code' cannot blend the
way two nearby vectors can.

Stored in KH's own hooks.db (config.HOOKS_DB_PATH) next to hook_rules, its only consumer.
Runs in PARALLEL with app/policy.py: this table is the deterministic tier, the vector
collection stays as the semantic fallback for requests whose action label is unclear.

See api.py / store.py.
"""
from .api import attach

__all__ = ["attach"]

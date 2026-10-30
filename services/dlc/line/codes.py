"""Closed lists: event kinds and error codes. FROZEN after wave 0; wave 4 added W4_KINDS / W4_GATE_CODES.

Every event the line writes has a kind from EVENT_KINDS; a Store refuses any
other kind (LineError UNKNOWN_KIND). Every failure the line reports carries a
code from ALL_CODES; LineError refuses any other code.

Two code families:
  GATE_CODES   - the domain verdicts of the plan (a gate, verifier, reader or
                 runner said "no" for this reason). These appear on Gate.code,
                 in escalations and on the board.
  SYSTEM_CODES - mechanical failures of the line itself (bad envelope, CAS
                 miss, unknown kind, schema error ...). Raised as LineError by
                 ports and the store.
"""

from __future__ import annotations

from typing import Any, Dict, Optional

# ------------------------------------------------------------------ event kinds

RUN_ADMITTED = "run.admitted"
SPEC_FROZEN = "spec.frozen"
DIGEST_DONE = "digest.done"
RECONCILE_DIVERGED = "reconcile.diverged"
TESTS_APPROVED = "tests.approved"
GRAPH_VALID = "graph.valid"
UNIT_DISPATCHED = "unit.dispatched"
UNIT_SUBMITTED = "unit.submitted"
VERIFY_FAILED = "verify.failed"
UNIT_MERGED = "unit.merged"
DEPLOY_DONE = "deploy.done"
QAS_RESULT = "qas.result"
RUN_GREEN = "run.green"
ESCALATED = "escalated"

#: The plan's milestone kinds (MVP block 1).
CORE_KINDS = (
    RUN_ADMITTED, SPEC_FROZEN, DIGEST_DONE, RECONCILE_DIVERGED, TESTS_APPROVED, GRAPH_VALID,
    UNIT_DISPATCHED, UNIT_SUBMITTED, VERIFY_FAILED, UNIT_MERGED, DEPLOY_DONE, QAS_RESULT,
    RUN_GREEN, ESCALATED,
)

# Auxiliary kinds the slices need so the board can stay a pure projection of events.
RUN_STATE = "run.state"            # body: {"from": str, "to": str}
UNIT_STATE = "unit.state"          # body: {"from": str, "to": str, "code"?: str}
UNIT_BLOCKED = "unit.blocked"      # body: {"reason": str}   builder ended BLOCKED:<reason>
UNIT_REQUEUED = "unit.requeued"    # body: {"code": str, "from": str}  back to ready (retry, conflict, expiry)
LEASE_EXPIRED = "lease.expired"    # body: {"name": str, "epoch": int}
BUDGET_WARN = "budget.warn"        # body: {"node": str, "spent": float, "limit": float}
RAG_DEGRADED_KIND = "rag.degraded"  # body: {"capability": str, "error": str}
RAG_RESTORED = "rag.restored"      # body: {"capability": str, "replayed": int}

AUX_KINDS = (
    RUN_STATE, UNIT_STATE, UNIT_BLOCKED, UNIT_REQUEUED, LEASE_EXPIRED, BUDGET_WARN,
    RAG_DEGRADED_KIND, RAG_RESTORED,
)

# Wave 4 kinds (registered by the integrator; the slice modules name the same strings).
RUN_PAUSED = "run.paused"                  # body: {"reason", "state"}  non-terminal stop; resume continues it
RECONCILE_REPAIRED = "reconcile.repaired"  # line.reconciler
RECONCILE_FROZEN = "reconcile.frozen"      # line.reconciler
RAG_CONFLICT = "rag.conflict"              # line.rag_state
GAPS_CHECKED = "gaps.checked"              # line.understand_plus (blocks 7 + 8)
CONFLICTS_CHECKED = "conflicts.checked"
HUMAN_QUESTION = "human.question"
HUMAN_ANSWERED = "human.answered"
HUMAN_REMINDER = "human.reminder"
HUMAN_DECIDED = "human.decided"            # human questions off: the model decided, recorded for review
SPEC_ADDENDUM = "spec.addendum"
RUN_PARKED = "run.parked"
RUN_UNPARKED = "run.unparked"
REVIEW_DONE = "review.done"                # line.review (blocks 13 + 14)
DRIFT_SIGNAL = "drift.signal"
JUDGE_DECISION = "judge.decision"
DECISION_GRADED = "decision.graded"
LESSON_PROPOSED = "lesson.proposed"        # line.learn
LESSON_JUDGED = "lesson.judged"
LESSON_CANARY = "lesson.canary"
LESSON_PROMOTED = "lesson.promoted"
LESSON_WITHDRAWN = "lesson.withdrawn"
AGENT_REGISTERED = "agent.registered"      # line.agents_dir
AGENT_PROMOTED = "agent.promoted"
AGENT_SLO_BREACH = "agent.slo_breach"
AGENT_ROLLBACK = "agent.rollback"
AGENT_RETIRED = "agent.retired"
FGRAPH_CHECKED = "fgraph.checked"          # line.fgraph: {"nodes","edges","derived","gaps","violations","order"}
HOOK_RAN = "hook.ran"                      # line.hooks: {"key", "hook", "name", "event", "mode", "status", ...}
DELIVERED = "deliver.pushed"                # the Deliver step: {"project", "branch", "commit"}
DELIVER_FAILED = "deliver.failed"           # the push was refused: {"project", "error"} (the run stays green)
DELIVER_SKIPPED = "deliver.skipped"         # nothing to deliver to: {"project", "reason"}
HOOK_BLOCKED = "hook.blocked"              # a waiting hook stopped the run: {"key", "hook", "name", "reason"}
MERGER_RAN = "merger.ran"                  # line.ship.merger: {"unit", "stage", "outcome", "resolved", "usd", "files"}

W4_KINDS = (
    RUN_PAUSED, RECONCILE_REPAIRED, RECONCILE_FROZEN, RAG_CONFLICT,
    GAPS_CHECKED, CONFLICTS_CHECKED, HUMAN_QUESTION, HUMAN_ANSWERED, HUMAN_REMINDER, HUMAN_DECIDED, SPEC_ADDENDUM,
    RUN_PARKED, RUN_UNPARKED,
    REVIEW_DONE, DRIFT_SIGNAL, JUDGE_DECISION, DECISION_GRADED,
    LESSON_PROPOSED, LESSON_JUDGED, LESSON_CANARY, LESSON_PROMOTED, LESSON_WITHDRAWN,
    AGENT_REGISTERED, AGENT_PROMOTED, AGENT_SLO_BREACH, AGENT_ROLLBACK, AGENT_RETIRED,
    FGRAPH_CHECKED, HOOK_RAN, HOOK_BLOCKED, DELIVERED, DELIVER_FAILED, DELIVER_SKIPPED, MERGER_RAN,
)

# Feature migration kinds (line.migrate, flow 4: v1 -> v2 feature parity). Envelope run = migration id.
MIGRATION_ADMITTED = "migration.admitted"    # {"v1", "v2", "mode", "v1_base", "scope"}
MIGRATION_INVENTORY = "migration.inventory"  # {"side", "features", "unproven", "chunks", "repos"?, "merged"?}
MIGRATION_REPO = "migration.repo"            # {"side", "repo", "status", "sha", "stacks", "features", "error"?}
MIGRATION_MATRIX = "migration.matrix"        # {"v1_only", "v2_only", "both_same", "both_conflict", "custom", "confirmed"}
MIGRATION_PARKED = "migration.parked"        # {"questions": [cid..]}  ask mode: conflicts wait for a person
MIGRATION_DECIDED = "migration.decided"      # {"conflict", "choice", "who", "backup"?}
MIGRATION_BASELINE = "migration.baseline"    # {"tests", "passed", "failed", "at_risk"}
MIGRATION_BUILD = "migration.build"          # {"run", "pack", "items"}
MIGRATION_VERIFIED = "migration.verified"    # {"passed", "regressions", "superseded"}
MIGRATION_DONE = "migration.done"            # {"state", "code"?, "report"}

MIG_KINDS = (
    MIGRATION_ADMITTED, MIGRATION_INVENTORY, MIGRATION_REPO, MIGRATION_MATRIX, MIGRATION_PARKED, MIGRATION_DECIDED,
    MIGRATION_BASELINE, MIGRATION_BUILD, MIGRATION_VERIFIED, MIGRATION_DONE,
)

# seal (line.seal wired into the pipeline, LINE_SEAL=1): the ledger's entries mirrored as events
SEAL_GATED = "seal.gated"                    # {"subject", "gates_sha", "approver", "builder"}
SEAL_SUBMITTED = "seal.submitted"            # {"subject", "evidence": n}
SEAL_SCORED = "seal.scored"                  # {"subject", "state", "total", "level", "scorer", "docked", "reasons"}
SEAL_SEALED = "seal.sealed"                  # {"subject", "total", "level", "by"?} the seal finalised
SEAL_TAINTED = "seal.tainted"                # {"subject", "producer", "unit"} built on a seal that failed
SEAL_VOIDED = "seal.voided"                  # {"subject", "reason"} an attempt that will never be scored
SEAL_CORRECTED = "seal.corrected"            # {"subject", "reason", "new_subject"}
SEAL_KINDS = (SEAL_GATED, SEAL_SUBMITTED, SEAL_SCORED, SEAL_SEALED, SEAL_TAINTED, SEAL_VOIDED, SEAL_CORRECTED)

# operations (server-side controls): operator pause / resume, deployed app start / stop
RUN_RESUMED = "run.resumed"                  # {"by", "state"}  an operator resumed a paused run
APP_STARTED = "app.started"                  # {"url", "port", "pid", "dir", "by"}
APP_STOPPED = "app.stopped"                  # {"port", "pid", "reason", "by"}
GATE_OPENED = "gate.opened"                  # line.gates: {"gate", "round"}  the run waits for a person's decision
GATE_DECIDED = "gate.decided"                # {"gate", "decision", "target"?, "by", "files"}
RUN_REOPENED = "run.reopened"                # line.reopen: {"attempt", "from", "to", "by", "level"?, "level_up"?}
OPS_KINDS = (RUN_RESUMED, APP_STARTED, APP_STOPPED, GATE_OPENED, GATE_DECIDED, RUN_REOPENED)

EVENT_KINDS = frozenset(CORE_KINDS + AUX_KINDS + W4_KINDS + MIG_KINDS + SEAL_KINDS + OPS_KINDS)

# ------------------------------------------------------------------ error codes

SPEC_MISSING_FILE = "SPEC_MISSING_FILE"
QUOTE_UNMATCHED = "QUOTE_UNMATCHED"
READ_DIVERGED = "READ_DIVERGED"
TEST_GREEN_ON_EMPTY = "TEST_GREEN_ON_EMPTY"
TEST_UNTRACED = "TEST_UNTRACED"
GRAPH_CYCLE = "GRAPH_CYCLE"
UNIT_TOO_BIG = "UNIT_TOO_BIG"
CLAIM_VIOLATION = "CLAIM_VIOLATION"
TEST_TAMPER = "TEST_TAMPER"
BUILD_FAIL = "BUILD_FAIL"
TEST_FAIL = "TEST_FAIL"
NO_PROGRESS = "NO_PROGRESS"
BUDGET_EXCEEDED = "BUDGET_EXCEEDED"
LEASE_LOST = "LEASE_LOST"
MERGE_CONFLICT = "MERGE_CONFLICT"
SMOKE_FAIL = "SMOKE_FAIL"
QAS_RED = "QAS_RED"
FLAKY = "FLAKY"
SECRET_FOUND = "SECRET_FOUND"
RAG_DEGRADED = "RAG_DEGRADED"

#: The plan's closed list of domain codes (MVP block 1). Order is the plan's order.
GATE_CODES = (
    SPEC_MISSING_FILE, QUOTE_UNMATCHED, READ_DIVERGED, TEST_GREEN_ON_EMPTY, TEST_UNTRACED,
    GRAPH_CYCLE, UNIT_TOO_BIG, CLAIM_VIOLATION, TEST_TAMPER, BUILD_FAIL, TEST_FAIL, NO_PROGRESS,
    BUDGET_EXCEEDED, LEASE_LOST, MERGE_CONFLICT, SMOKE_FAIL, QAS_RED, FLAKY, SECRET_FOUND,
    RAG_DEGRADED,
)

#: Wave 4 domain codes (review slice); kept apart so GATE_CODES stays the plan's list.
REVIEW_BLOCK = "REVIEW_BLOCK"        # clean-context reviewer found blocking findings
DRIFT_STOP = "DRIFT_STOP"            # drift ladder (or the judge) stopped the unit
DRIFT_REDIRECT = "DRIFT_REDIRECT"    # the judge sent a drifting unit back with instructions
FGRAPH_INVALID = "FGRAPH_INVALID"    # feature graph broken: unknown node, bad edge, quote, missing F-item, cycle
FEATURE_ORDER = "FEATURE_ORDER"      # planner graph builds a feature before a feature it needs
HOOK_STOP = "HOOK_STOP"              # a run hook (line.hooks, on_block stop) ended the run
MERGE_TESTS_RED = "MERGE_TESTS_RED"  # the unit rebased cleanly onto main but the acceptance tests are red there
MERGE_BLOCKED = "MERGE_BLOCKED"      # the merger says the unit cannot be integrated as specified (needs a person)
BLOCKED_OUTSIDE_CLAIMS = "BLOCKED_OUTSIDE_CLAIMS"  # BLOCKED twice in a row for the same cause: not fixable in the unit
TEST_BROKEN_HERE = "TEST_BROKEN_HERE"  # an acceptance test breaks on the test machine itself (a tool, package, git), not on the code
W4_GATE_CODES = (REVIEW_BLOCK, DRIFT_STOP, DRIFT_REDIRECT, FGRAPH_INVALID, FEATURE_ORDER, HOOK_STOP,
                 MERGE_TESTS_RED, MERGE_BLOCKED, BLOCKED_OUTSIDE_CLAIMS, TEST_BROKEN_HERE)

ENVELOPE_INVALID = "ENVELOPE_INVALID"        # envelope field missing / wrong type
UNKNOWN_KIND = "UNKNOWN_KIND"                # event kind not in EVENT_KINDS
ILLEGAL_TRANSITION = "ILLEGAL_TRANSITION"    # target state not allowed from current state
STATE_CONFLICT = "STATE_CONFLICT"            # CAS miss: current state / version != expected
NOT_FOUND = "NOT_FOUND"                      # entity / record / file absent
VERSION_CONFLICT = "VERSION_CONFLICT"        # if_match / etag mismatch on a record write
PRECONDITION_REQUIRED = "PRECONDITION_REQUIRED"  # write needed if_match and had none
SCHEMA_INVALID = "SCHEMA_INVALID"            # LLM output (after repair) or payload fails its schema
LLM_ERROR = "LLM_ERROR"                      # model call failed (process, HTTP, timeout)
CONFIG_INVALID = "CONFIG_INVALID"            # bad LINE_* value or config file
BLOCKED = "BLOCKED"                          # builder ended BLOCKED:<reason>
CANCELLED = "CANCELLED"                      # operator cancelled the run

SYSTEM_CODES = (
    ENVELOPE_INVALID, UNKNOWN_KIND, ILLEGAL_TRANSITION, STATE_CONFLICT, NOT_FOUND,
    VERSION_CONFLICT, PRECONDITION_REQUIRED, SCHEMA_INVALID, LLM_ERROR, CONFIG_INVALID,
    BLOCKED, CANCELLED,
)

#: Feature migration codes (line.migrate).
PARITY_REGRESSION = "PARITY_REGRESSION"  # a v2 test that passed before the migration fails after it
STACK_UNSUPPORTED = "STACK_UNSUPPORTED"  # the v2 target is not a stack the build stage can drive
TARGET_ESTATE = "TARGET_ESTATE"          # the v2 target is several repositories: analysis only, no build
REPO_SCAN_FAILED = "REPO_SCAN_FAILED"    # every repository of one side failed to scan
MIGRATION_BUDGET = "MIGRATION_BUDGET"    # the migration (or one repository's scan) used its budget; resumable
MIG_CODES = (PARITY_REGRESSION, STACK_UNSUPPORTED, TARGET_ESTATE, REPO_SCAN_FAILED, MIGRATION_BUDGET)

SEAL_REJECTED = "SEAL_REJECTED"          # the independent score did not seal the attempt (ladder failure)
SEAL_TAINTED_CODE = "SEAL_TAINTED"       # the attempt built on a producer whose seal failed: built again
SEAL_SIGNOFF = "SEAL_SIGNOFF"            # an L2 seal waits for a person's sign-off
SEAL_CODES = (SEAL_REJECTED, SEAL_TAINTED_CODE, SEAL_SIGNOFF)

APP_START_FAILED = "APP_START_FAILED"    # the deployed app did not start or did not answer its health check
QUEUE_SLOT_LOST = "QUEUE_SLOT_LOST"      # the run's change-queue slot was ignored by a later run: it stops itself
OPS_CODES = (APP_START_FAILED, QUEUE_SLOT_LOST)

ALL_CODES = frozenset(GATE_CODES + W4_GATE_CODES + MIG_CODES + SEAL_CODES + SYSTEM_CODES + OPS_CODES)


def is_code(code: str) -> bool:
    return code in ALL_CODES


class LineError(Exception):
    """The one exception type the line raises across slice boundaries.

    code must be in ALL_CODES (ValueError otherwise, so a typo fails loudly).
    detail is a JSON-serialisable dict with evidence (paths, seqs, epochs ...).
    """

    def __init__(self, code: str, message: str = "", detail: Optional[Dict[str, Any]] = None):
        if code not in ALL_CODES:
            raise ValueError("unknown line error code: %r" % (code,))
        self.code = code
        self.message = message or code
        self.detail = dict(detail or {})
        super().__init__("%s: %s" % (code, self.message))

    def to_dict(self) -> Dict[str, Any]:
        return {"code": self.code, "message": self.message, "detail": self.detail}

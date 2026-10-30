"""Frozen contracts of the SDLC line: data types, state machines and ports.

FROZEN after wave 0. Slices build against this file; they never change it.
A slice that needs more adds it in its own module.

Contents
  enums        RunState, UnitState, Size, LeaseAuthority
  tables       RUN_TRANSITIONS, UNIT_TRANSITIONS, can_transition()
  dataclasses  Envelope, Event, Run, Unit, SpecPack, PackVersion, Span, Fact,
               Criterion, FItem, Digest, Divergence, AccTest, Graph, Attempt,
               Gate, LlmResult, Lease, OutboxItem, RagCapabilities, BudgetState
  helpers      to_dict(), from_dict(), unit_lease_name(), now_ms()
  ports        Clock, Store, Budget, LeaseManager, RagPort, LlmPort
               (typing.Protocol, runtime_checkable)

Conventions
  * time is integer milliseconds since the epoch (``*_ms``); money is float USD.
  * ids are strings. Span ids are ``<relpath>#L<start>-<end>`` (1-based, inclusive).
  * every failure crosses a slice boundary as codes.LineError(code, message, detail).
  * dataclasses round-trip through to_dict()/from_dict() and are what slices
    put in the Store (Store rows are plain JSON dicts).
"""

from __future__ import annotations

import dataclasses
import enum
import time
import typing
from dataclasses import dataclass, field
from typing import Any, Dict, FrozenSet, Iterable, List, Mapping, Optional, Protocol, Sequence, Tuple, Union, runtime_checkable

from . import codes
from .codes import LineError

# ================================================================== enums


class RunState(str, enum.Enum):
    ADMITTED = "admitted"
    UNDERSTANDING = "understanding"   # ingest, readers A/B, reconcile, test authoring
    PLANNING = "planning"             # planner + graph validation
    BUILDING = "building"             # units leased / built / verified
    INTEGRATING = "integrating"       # merge queue drains
    QAS = "qas"                       # deploy + QAS runner (+ fixer units)
    GREEN = "green"                   # terminal: success
    ESCALATED = "escalated"           # terminal: needs a human


class UnitState(str, enum.Enum):
    PENDING = "pending"       # deps not merged yet
    READY = "ready"           # dispatchable
    LEASED = "leased"         # a builder holds the lease (epoch fenced)
    SUBMITTED = "submitted"   # builder ended SUBMIT; verifier pending
    VERIFIED = "verified"     # verifier gate ok; in merge queue
    MERGED = "merged"         # terminal: on main
    WAITING = "waiting"       # builder BLOCKED / needs input; back to ready when unblocked
    FAILED = "failed"         # terminal: ladder exhausted / escalated


class Size(str, enum.Enum):
    S = "S"
    M = "M"
    L = "L"


#: Budget weights per unit size (plan block 2).
SIZE_WEIGHTS: Dict[str, int] = {"S": 1, "M": 2, "L": 4}
BUDGET_WARN_RATIO = 0.8
BUDGET_STOP_RATIO = 1.0


class LeaseAuthority(str, enum.Enum):
    """Who grants leases for a run; fixed at admission for the whole run."""
    RAG = "rag"
    LOCAL = "local"


TERMINAL_RUN_STATES: FrozenSet[str] = frozenset({RunState.GREEN.value, RunState.ESCALATED.value})
TERMINAL_UNIT_STATES: FrozenSet[str] = frozenset({UnitState.MERGED.value, UnitState.FAILED.value})

# ================================================================== transition tables

_R = RunState
#: Allowed run transitions. Any non-terminal state may also go to ESCALATED.
#: QAS -> BUILDING is the fixer loop (a red F-item spawns a fixer unit).
RUN_TRANSITIONS: Dict[str, FrozenSet[str]] = {
    _R.ADMITTED.value: frozenset({_R.UNDERSTANDING.value, _R.ESCALATED.value}),
    _R.UNDERSTANDING.value: frozenset({_R.PLANNING.value, _R.ESCALATED.value}),
    _R.PLANNING.value: frozenset({_R.BUILDING.value, _R.ESCALATED.value}),
    _R.BUILDING.value: frozenset({_R.INTEGRATING.value, _R.ESCALATED.value}),
    _R.INTEGRATING.value: frozenset({_R.BUILDING.value, _R.QAS.value, _R.ESCALATED.value}),
    _R.QAS.value: frozenset({_R.GREEN.value, _R.BUILDING.value, _R.ESCALATED.value}),
    _R.GREEN.value: frozenset(),
    _R.ESCALATED.value: frozenset(),
}

_U = UnitState
#: Allowed unit transitions.
#:   leased -> ready      lease expired (watchdog) or retry from checkpoint
#:   submitted -> ready   verify failed, next attempt on the ladder
#:   verified -> ready    merge queue: semantic conflict, unit goes back
#:   leased -> waiting    builder ended BLOCKED:<reason>
UNIT_TRANSITIONS: Dict[str, FrozenSet[str]] = {
    _U.PENDING.value: frozenset({_U.READY.value, _U.FAILED.value}),
    _U.READY.value: frozenset({_U.LEASED.value, _U.WAITING.value, _U.FAILED.value}),
    _U.LEASED.value: frozenset({_U.SUBMITTED.value, _U.READY.value, _U.WAITING.value, _U.FAILED.value}),
    _U.SUBMITTED.value: frozenset({_U.VERIFIED.value, _U.READY.value, _U.FAILED.value}),
    _U.VERIFIED.value: frozenset({_U.MERGED.value, _U.READY.value, _U.FAILED.value}),
    _U.WAITING.value: frozenset({_U.READY.value, _U.FAILED.value}),
    _U.MERGED.value: frozenset(),
    _U.FAILED.value: frozenset(),
}

#: Entity name -> transition table, for Store.transition().
TRANSITIONS: Dict[str, Dict[str, FrozenSet[str]]] = {"run": RUN_TRANSITIONS, "unit": UNIT_TRANSITIONS}


def _sv(s: Union[str, enum.Enum]) -> str:
    return s.value if isinstance(s, enum.Enum) else str(s)


def can_transition(entity: str, frm: Union[str, enum.Enum], to: Union[str, enum.Enum]) -> bool:
    table = TRANSITIONS.get(entity)
    if table is None:
        return False
    return _sv(to) in table.get(_sv(frm), frozenset())


# ================================================================== entity names
#: Store entity names (tables / record types). Rows are to_dict() of the named dataclass.
E_RUN = "run"                 # Run
E_UNIT = "unit"               # Unit
E_PACK = "spec_pack"          # PackVersion (id = version)
E_FITEM = "f_item"            # FItem
E_DIGEST = "digest"           # Digest (id = f"{run}:{variant}")
E_ACC_TEST = "acc_test"       # AccTest
E_GRAPH = "graph"             # Graph (id = run)
E_ATTEMPT = "attempt"         # Attempt (id = f"{unit}#{n}")
E_GATE = "gate_result"        # {"gate": Gate, "unit": str, "attempt": int, "name": str}
E_LLM_CALL = "llm_call"       # {"role","model","usd","usage","key"}
E_MERGE = "merge_item"        # {"unit","wave","state","enqueued_ms"}
E_DEPLOY = "deploy_slot"      # {"color","sha","state","ts_ms"}
E_QAS = "qas_result"          # {"f_item","runs":[bool]*3,"verdict":"green|red|flaky"}
E_ESCALATION = "escalation"   # {"code","message","detail","unit"?}

# Wave 4 entities (ids already carry the run prefix "<run>:..." where they belong to a run; not scoped).
E_DECISION = "decision"           # judge decision log (line.review.judge), id "<run>:<unit>:<kind>:<n>"
E_ASSUMPTION = "assumption"       # line.understand_plus: id "<run>:ASSUMED-<n>"
E_QUESTION = "human_question"     # id "<run>:Q<n>"
E_CONFLICT = "conflict"           # id "<run>:X<n>"
E_ADDENDUM = "addendum"           # id "<run>:v<N>.<k>"
E_RULE_GRAPH = "rule_graph"       # id = graph name (system wide)
E_PARK = "human_park"             # id = run
E_FGRAPH = "feature_graph"        # line.fgraph: id = run (the graph of the run's current pack version)
E_FGAP = "fgraph_gap"             # line.fgraph: id "<run>:<node id>" (a consumed thing nothing produces)
W4_ENTITIES = (E_DECISION, E_ASSUMPTION, E_QUESTION, E_CONFLICT, E_ADDENDUM, E_RULE_GRAPH, E_PARK, E_FGRAPH, E_FGAP)
E_MIGRATION = "migration"          # line.migrate: id = migration id "M<date>-<time>-<hex4>"
E_MIG_FEATURE = "mig_feature"      # id "<migration>:<row id>" (one parity-matrix row)
E_MIG_CONFLICT = "mig_conflict"    # id "<migration>:C<n>" (v1 and v2 behave differently)
MIG_ENTITIES = (E_MIGRATION, E_MIG_FEATURE, E_MIG_CONFLICT)
E_SEAL = "seal"                    # line.seal: id = subject "<run>:<unit>#<attempt>" (projection of the ledger)
E_SEAL_ENTRY = "seal_entry"        # line.seal: id "<run>:<seq 6 digits>" (one hash-chained ledger entry)
SEAL_ENTITIES = (E_SEAL, E_SEAL_ENTRY)
E_LLM_CACHE = "llm_cache"          # line.llm.caps: id = sha256 of (role, model, prompt); a reading role's answer
E_PROCESS = "process"              # line.process.registry: id = process id; versions, status, history
E_PRECEDENT = "precedent"          # line.process.precedent: id "<project>:<kind>:<n>", a person's gate decision
E_SLOT = "change_slot"             # line.changequeue: id "<project>:<seq>", one run's place in its project's queue

ENTITIES: FrozenSet[str] = frozenset({
    E_RUN, E_UNIT, E_PACK, E_FITEM, E_DIGEST, E_ACC_TEST, E_GRAPH, E_ATTEMPT, E_GATE,
    E_LLM_CALL, E_MERGE, E_DEPLOY, E_QAS, E_ESCALATION, E_LLM_CACHE, E_PROCESS, E_PRECEDENT, E_SLOT,
} | set(W4_ENTITIES) | set(MIG_ENTITIES) | set(SEAL_ENTITIES))


# ================================================================== helpers


def now_ms() -> int:
    return int(time.time() * 1000)


def unit_lease_name(unit_id: str) -> str:
    """The lease that fences a unit's builder. Envelope.epoch of unit events is this lease's epoch."""
    return "unit:" + unit_id


def span_id(path: str, start: int, end: int) -> str:
    return "%s#L%d-%d" % (path.replace("\\", "/"), start, end)


def to_dict(obj: Any) -> Any:
    """Dataclass (nested) -> JSON-ready dict; enums become their value."""
    if dataclasses.is_dataclass(obj) and not isinstance(obj, type):
        return {f.name: to_dict(getattr(obj, f.name)) for f in dataclasses.fields(obj)}
    if isinstance(obj, enum.Enum):
        return obj.value
    if isinstance(obj, (list, tuple)):
        return [to_dict(x) for x in obj]
    if isinstance(obj, dict):
        return {str(k): to_dict(v) for k, v in obj.items()}
    return obj


def _build(tp: Any, value: Any) -> Any:
    if value is None:
        return None
    origin = typing.get_origin(tp)
    args = typing.get_args(tp)
    if origin is Union:  # Optional[X]
        inner = [a for a in args if a is not type(None)]
        return _build(inner[0], value) if len(inner) == 1 else value
    if origin in (list, List, Sequence, tuple, Tuple) and args:
        return [_build(args[0], v) for v in value]
    if origin in (dict, Dict, Mapping) and len(args) == 2:
        return {k: _build(args[1], v) for k, v in value.items()}
    if isinstance(tp, type) and dataclasses.is_dataclass(tp) and isinstance(value, dict):
        return from_dict(tp, value)
    return value


def from_dict(cls: type, data: Mapping[str, Any]) -> Any:
    """dict -> dataclass ``cls`` (nested dataclasses and lists rebuilt; unknown keys ignored)."""
    hints = typing.get_type_hints(cls)
    kw = {}
    for f in dataclasses.fields(cls):
        if f.name in data:
            kw[f.name] = _build(hints.get(f.name, Any), data[f.name])
    return cls(**kw)


# ================================================================== dataclasses

ENVELOPE_FIELDS: Tuple[str, ...] = ("run", "unit", "attempt", "epoch", "agent_version", "model", "spec_hash")


@dataclass
class Envelope:
    """Required on every event. Run-level events use unit="" attempt=0 epoch=0.

    epoch is the fencing epoch of unit_lease_name(unit) when the event is written
    by a lease holder; a Store refuses (LEASE_LOST) a unit event whose epoch > 0
    is not the current epoch of that lease.
    """
    run: str
    unit: str = ""
    attempt: int = 0
    epoch: int = 0
    agent_version: str = ""
    model: str = ""
    spec_hash: str = ""

    def validate(self) -> None:
        """Raise LineError(ENVELOPE_INVALID) on a missing run or wrong field types."""
        bad = []
        if not isinstance(self.run, str) or not self.run:
            bad.append("run")
        for name in ("unit", "agent_version", "model", "spec_hash"):
            if not isinstance(getattr(self, name), str):
                bad.append(name)
        for name in ("attempt", "epoch"):
            v = getattr(self, name)
            if not isinstance(v, int) or isinstance(v, bool) or v < 0:
                bad.append(name)
        if bad:
            raise LineError(codes.ENVELOPE_INVALID, "bad envelope fields: " + ",".join(bad), {"fields": bad})

    @classmethod
    def parse(cls, data: Any) -> "Envelope":
        """Strict: every ENVELOPE_FIELDS key must be present (plan block 1), then validate()."""
        if isinstance(data, Envelope):
            data.validate()
            return data
        if not isinstance(data, Mapping):
            raise LineError(codes.ENVELOPE_INVALID, "envelope is not an object")
        missing = [k for k in ENVELOPE_FIELDS if k not in data]
        if missing:
            raise LineError(codes.ENVELOPE_INVALID, "missing envelope fields: " + ",".join(missing),
                            {"fields": missing})
        env = cls(**{k: data[k] for k in ENVELOPE_FIELDS})
        env.validate()
        return env


@dataclass
class Event:
    seq: int                 # gapless, store-assigned, starts at 1
    kind: str                # codes.EVENT_KINDS
    env: Envelope
    body: Dict[str, Any] = field(default_factory=dict)
    ts_ms: int = 0
    synced: bool = False     # replicated to the RAG System event log


@dataclass
class Run:
    id: str
    pack_path: str
    state: str = RunState.ADMITTED.value
    spec_hash: str = ""                       # PackVersion.version once frozen
    budget_usd: float = 0.0
    lease_authority: str = LeaseAuthority.LOCAL.value
    created_ms: int = 0
    updated_ms: int = 0
    detail: Dict[str, Any] = field(default_factory=dict)   # e.g. escalation code / cancel reason


@dataclass
class Unit:
    id: str                                   # e.g. "U1"; unique within a run
    run: str
    title: str = ""
    state: str = UnitState.PENDING.value
    wave: int = 0
    claims: List[str] = field(default_factory=list)       # repo-relative files/globs it may write (<= unit_max_files)
    deps: List[str] = field(default_factory=list)         # unit ids that must be merged first
    f_items: List[str] = field(default_factory=list)      # FItem ids it implements
    tests: List[str] = field(default_factory=list)        # AccTest ids that must pass
    size: str = Size.M.value
    contract: bool = False                    # contract/interface unit: scheduled first
    attempt: int = 0                          # current attempt number (1-based once dispatched)
    epoch: int = 0                            # current lease epoch
    model: str = ""                           # model of the current rung
    rung: int = 0                             # retry ladder rung (0 = first try)
    fixer_gen: int = 0                        # 0 normal unit; 1..N fixer generation
    worktree: str = ""
    detail: Dict[str, Any] = field(default_factory=dict)


@dataclass
class SpecPack:
    """A spec pack on disk (pack.json + files). required: files that must exist (else SPEC_MISSING_FILE)."""
    id: str
    root: str
    title: str = ""
    required: List[str] = field(default_factory=list)
    files: List[str] = field(default_factory=list)          # .md/.txt relative paths to ingest


@dataclass
class Span:
    id: str          # span_id(path, start, end)
    path: str        # pack-relative, forward slashes
    start: int       # 1-based first line
    end: int         # 1-based last line, inclusive
    heading: str = ""
    text: str = ""   # normalised text (zero-width chars and HTML comments removed)
    sha: str = ""    # sha256 of text


@dataclass
class PackVersion:
    version: str                                   # sha256 over sorted (path, sha) - the run's spec_hash
    pack_id: str
    root: str
    files: Dict[str, str] = field(default_factory=dict)    # path -> sha256 of raw bytes
    spans: List[Span] = field(default_factory=list)
    frozen_ms: int = 0
    remote_version: str = ""                       # version id given by RagPort.freeze_pack, "" if none


@dataclass
class Fact:
    """A rule or number quoted from the spec. quote must be a literal substring of the span's text."""
    text: str
    span_id: str
    quote: str
    value: Optional[str] = None      # numbers: the literal value ("1", "exit 1", "3 s")


@dataclass
class Criterion:
    id: str                          # e.g. "F2.C1"
    f_item: str
    text: str
    span_id: str
    quote: str
    given: str = ""
    when: str = ""
    then: str = ""


@dataclass
class FItem:
    id: str                          # e.g. "F2"
    title: str
    span_ids: List[str] = field(default_factory=list)
    quote: str = ""
    criteria: List[Criterion] = field(default_factory=list)
    size: str = Size.M.value


@dataclass
class Digest:
    pack_version: str
    variant: str                     # "A", "B" (independent readers) or "R" (reconciled)
    f_items: List[FItem] = field(default_factory=list)
    rules: List[Fact] = field(default_factory=list)
    numbers: List[Fact] = field(default_factory=list)
    dropped: List[Dict[str, Any]] = field(default_factory=list)   # facts dropped for QUOTE_UNMATCHED
    usd: float = 0.0


@dataclass
class Divergence:
    """Reconcile result when readers A and B disagree. code = READ_DIVERGED."""
    pack_version: str
    fields: List[Dict[str, Any]] = field(default_factory=list)   # [{"path": "F2.criteria[1].then", "a": .., "b": .., "span_ids": [..]}]
    span_ids: List[str] = field(default_factory=list)            # spans to re-read (targeted)
    rereads: int = 0                                             # re-reads done so far (max config.reread_max)


@dataclass
class AccTest:
    id: str                          # e.g. "T_F2_C1"
    f_item: str
    criterion: str
    span_id: str
    path: str                        # repo-relative test file (unittest)
    name: str = ""                   # dotted test id, e.g. "tests.test_f2.T.test_c1"
    sha: str = ""                    # sha256 of the file once approved; locked
    locked: bool = False


@dataclass
class Graph:
    run: str
    units: List[Unit] = field(default_factory=list)
    waves: List[List[str]] = field(default_factory=list)      # unit ids per wave, wave 1 first
    critical_path: List[str] = field(default_factory=list)


@dataclass
class Attempt:
    unit: str
    n: int                           # 1-based
    model: str = ""
    epoch: int = 0
    rung: int = 0
    outcome: str = ""                # "", "submitted", "blocked", "verified", "failed", "lost"
    code: str = ""                   # gate / error code on failure
    fingerprint: str = ""
    usd: float = 0.0
    started_ms: int = 0
    ended_ms: int = 0
    detail: Dict[str, Any] = field(default_factory=dict)


@dataclass
class Gate:
    """Verdict of any check. ok=True => code="".

    fingerprint identifies the failure for the loop breaker:
    sha1(test id + error type + first stack line) for test failures, "" otherwise.
    """
    ok: bool
    code: str = ""
    fingerprint: str = ""
    detail: Dict[str, Any] = field(default_factory=dict)

    @classmethod
    def passed(cls, **detail: Any) -> "Gate":
        return cls(True, "", "", dict(detail))

    @classmethod
    def fail(cls, code: str, fingerprint: str = "", **detail: Any) -> "Gate":
        if code not in codes.ALL_CODES:
            raise ValueError("unknown gate code: %r" % (code,))
        return cls(False, code, fingerprint, dict(detail))


@dataclass
class LlmResult:
    data: Any = None                 # parsed JSON (complete() with schema), else None
    text: str = ""                   # raw final text
    usage: Dict[str, Any] = field(default_factory=dict)   # {"input","output","cacheWrite","cacheRead"}
    usd: float = 0.0
    model: str = ""
    outcome: str = ""                # agentic(): "SUBMIT" | "BLOCKED:<reason>" | "" for complete()


@dataclass
class Lease:
    name: str
    epoch: int                       # strictly increasing per name, +1 on every grant
    expires_ms: int
    owner: str = ""


@dataclass
class OutboxItem:
    """A RAG System write queued while degraded; replayed in id order with the same idem_key."""
    id: int
    op: str                          # RagPort method name, e.g. "append_events", "put_record", "metric"
    args: Dict[str, Any]
    idem_key: str
    created_ms: int = 0
    tries: int = 0


@dataclass
class RagCapabilities:
    """What the RAG System endpoint offers. A missing capability degrades that capability only."""
    events: bool = False
    leases: bool = False
    records: bool = False
    packs: bool = False
    quote: bool = False
    retrieve: bool = False
    metrics: bool = False
    version: str = ""
    degraded: List[str] = field(default_factory=list)   # capability names currently degraded

    NAMES = ("events", "leases", "records", "packs", "quote", "retrieve", "metrics")

    def has(self, name: str) -> bool:
        return bool(getattr(self, name, False)) and name not in self.degraded


@dataclass
class BudgetState:
    node: str
    limit: float
    spent: float
    reserved: float
    warn: bool                       # spent+reserved >= BUDGET_WARN_RATIO * limit

    @property
    def remaining(self) -> float:
        return max(self.limit - self.spent - self.reserved, 0.0)


# ================================================================== ports


@runtime_checkable
class Clock(Protocol):
    def now_ms(self) -> int: ...


@runtime_checkable
class Store(Protocol):
    """Durable state of the line (S1: SQLite line/line.db). Thread-safe.

    Events
      emit(kind, env, body) -> seq
          kind in codes.EVENT_KINDS else LineError(UNKNOWN_KIND); env parsed via
          Envelope.parse (dict or Envelope) else ENVELOPE_INVALID; a unit event
          with env.epoch > 0 that is not the current epoch of
          unit_lease_name(env.unit) -> LEASE_LOST. seq is gapless from 1.
      events_after(seq, run=None, kinds=None, limit=1000) -> events with seq > seq, ascending.
      unsynced(limit) / mark_synced(seqs): replication cursor to the RAG System.

    Records (rows are JSON dicts, normally to_dict(<dataclass>))
      put(entity, id, row, run="", if_version=None) -> new version (1 on create).
          row is a Mapping or a dataclass instance (stored as to_dict(row)); run defaults to row["run"].
          if_version given and != current -> STATE_CONFLICT. entity in ENTITIES.
      get(entity, id) -> row | None.   version(entity, id) -> int (0 if absent).
      query(entity, run=None, **eq) -> rows whose top-level fields equal eq, by insertion order.

    State machine
      transition(entity, id, to, expect_from) -> updated row
          entity "run"|"unit"; row["state"] must be in expect_from (str or iterable)
          else STATE_CONFLICT (CAS); to must be allowed by TRANSITIONS else
          ILLEGAL_TRANSITION; missing row -> NOT_FOUND. Atomic. Does not emit;
          callers emit RUN_STATE/UNIT_STATE or a milestone kind.

    Outbox (durable queue for RAG System writes while degraded)
      outbox_push(op, args, idem_key) -> id;  outbox_peek(limit) -> [OutboxItem] oldest first;
      outbox_ack(id); outbox_fail(id) increments tries.
    """

    def emit(self, kind: str, env: Union[Envelope, Mapping[str, Any]], body: Optional[Mapping[str, Any]] = None) -> int: ...
    def events_after(self, seq: int, run: Optional[str] = None, kinds: Optional[Iterable[str]] = None,
                     limit: int = 1000) -> List[Event]: ...
    def last_seq(self) -> int: ...
    def unsynced(self, limit: int = 500) -> List[Event]: ...
    def mark_synced(self, seqs: Iterable[int]) -> None: ...

    def put(self, entity: str, id: str, row: Union[Mapping[str, Any], Any], run: str = "", if_version: Optional[int] = None) -> int: ...
    def get(self, entity: str, id: str) -> Optional[Dict[str, Any]]: ...
    def version(self, entity: str, id: str) -> int: ...
    def query(self, entity: str, run: Optional[str] = None, **eq: Any) -> List[Dict[str, Any]]: ...

    def transition(self, entity: str, id: str, to: Union[str, enum.Enum],
                   expect_from: Union[str, enum.Enum, Iterable[Union[str, enum.Enum]]]) -> Dict[str, Any]: ...

    def outbox_push(self, op: str, args: Mapping[str, Any], idem_key: str) -> int: ...
    def outbox_peek(self, limit: int = 100) -> List[OutboxItem]: ...
    def outbox_ack(self, id: int) -> None: ...
    def outbox_fail(self, id: int) -> None: ...


@runtime_checkable
class Budget(Protocol):
    """Budget tree run -> F-item -> unit (node ids: run id, "F2", "U3"; root node = run id).

    open(run, limit_usd): create the root.
    split(run, parent, weights): children get parent.limit * w / sum(w) (weights from SIZE_WEIGHTS).
    reserve(run, node, usd) -> reservation id; raises LineError(BUDGET_EXCEEDED) when
        spent+reserved+usd > limit on the node or any ancestor (stop at 100%).
    charge(run, node, usd, reservation="") -> BudgetState of node; releases the reservation,
        adds usd to node and ancestors; emitting BUDGET_WARN at >= 80% is the caller's job
        (state.warn tells it). Charging never raises (the money is spent).
    release(run, reservation): drop an unused reservation.
    state(run, node) -> BudgetState;  remaining(run, node=None) -> float (min over node and ancestors).
    """

    def open(self, run: str, limit_usd: float) -> None: ...
    def split(self, run: str, parent: str, weights: Mapping[str, float]) -> None: ...
    def reserve(self, run: str, node: str, usd: float) -> str: ...
    def charge(self, run: str, node: str, usd: float, reservation: str = "") -> BudgetState: ...
    def release(self, run: str, reservation: str) -> None: ...
    def state(self, run: str, node: str) -> BudgetState: ...
    def remaining(self, run: str, node: Optional[str] = None) -> float: ...


@runtime_checkable
class LeaseManager(Protocol):
    """Named leases with fencing epochs (local authority; RagPort offers the same remotely).

    acquire(name, owner, ttl_s=None) -> Lease, or None when another live holder exists.
        Epoch increments on every grant (strictly increasing per name, never reused).
    renew(lease) -> Lease with new expires_ms; LineError(LEASE_LOST) if expired or epoch stale.
    release(lease): no-op if already lost.
    current(name) -> live Lease | None.
    check(name, epoch): raise LineError(LEASE_LOST) unless epoch is the live epoch.
    expired(now_ms=None) -> leases past expiry not yet reaped; reap(lease) marks one handled.
    """

    def acquire(self, name: str, owner: str, ttl_s: Optional[int] = None) -> Optional[Lease]: ...
    def renew(self, lease: Lease, ttl_s: Optional[int] = None) -> Lease: ...
    def release(self, lease: Lease) -> None: ...
    def current(self, name: str) -> Optional[Lease]: ...
    def check(self, name: str, epoch: int) -> None: ...
    def expired(self, now_ms: Optional[int] = None) -> List[Lease]: ...
    def reap(self, lease: Lease) -> None: ...


@runtime_checkable
class RagPort(Protocol):
    """The RAG System as seen by the line (S2: http_adapter, local_adapter, resilient wrapper).

    Errors: unreachable / 5xx / missing capability -> LineError(RAG_DEGRADED);
    stale epoch (HTTP 409 stale_epoch) -> LEASE_LOST; if_match mismatch -> VERSION_CONFLICT;
    write without required if_match (HTTP 428) -> PRECONDITION_REQUIRED; absent -> NOT_FOUND
    (get_record returns None instead). Writes carry idem_key / Idempotency-Key and are safe to replay.
    The resilient wrapper never raises RAG_DEGRADED for writes (queues to Store outbox) and
    returns [] from retrieve() while degraded.

    capabilities() -> RagCapabilities
    append_events(batch, idem_key) -> {"accepted": int, "last_seq": int}   batch = [to_dict(Event)]
    events_after(seq, limit=500) -> [dict]  events with remote seq > seq
    lease_acquire(name, ttl_s, owner) -> Lease | None;  lease_renew(lease, ttl_s) -> Lease;  lease_release(lease)
    put_record(type, id, body, if_match=None, idem_key="") -> etag
    get_record(type, id) -> (body, etag) | None
    freeze_pack(files, idem_key="") -> remote version id;  files = {relpath: text}
    quote(path, text, version="") -> Span | None   (span of the pack whose text contains `text` literally)
    retrieve(role, step, stack, max_chars) -> [{"text", "source", "score"}]  total text <= max_chars
    metric(name, value, dims=None) -> None
    """

    def capabilities(self) -> RagCapabilities: ...
    def append_events(self, batch: Sequence[Mapping[str, Any]], idem_key: str) -> Dict[str, Any]: ...
    def events_after(self, seq: int, limit: int = 500) -> List[Dict[str, Any]]: ...
    def lease_acquire(self, name: str, ttl_s: int, owner: str) -> Optional[Lease]: ...
    def lease_renew(self, lease: Lease, ttl_s: int) -> Lease: ...
    def lease_release(self, lease: Lease) -> None: ...
    def put_record(self, type: str, id: str, body: Mapping[str, Any], if_match: Optional[str] = None,
                   idem_key: str = "") -> str: ...
    def get_record(self, type: str, id: str) -> Optional[Tuple[Dict[str, Any], str]]: ...
    def freeze_pack(self, files: Mapping[str, str], idem_key: str = "") -> str: ...
    def quote(self, path: str, text: str, version: str = "") -> Optional[Span]: ...
    def retrieve(self, role: str, step: str, stack: Sequence[str], max_chars: int,
                 query: str = "") -> List[Dict[str, Any]]: ...
    def metric(self, name: str, value: float, dims: Optional[Mapping[str, Any]] = None) -> None: ...


@runtime_checkable
class LlmPort(Protocol):
    """Model access (S3: fake, cli, api; caps wrapper).

    complete(role, prompt, schema=None, *, key="", model=None, run="") -> LlmResult
        Non-agentic. With a schema (JSON-Schema subset: type/required/properties/items/enum)
        result.data is the parsed, validated object; one repair retry, then
        LineError(SCHEMA_INVALID). key names the fixture for the fake
        (samples/<pack>/dry/<role>/<key>.json) and is logged on the ledger.
    agentic(role, workdir, prompt, max_turns, usd_cap, *, key="", model=None, run="") -> LlmResult
        Tool-using session confined to workdir. result.outcome is "SUBMIT" or
        "BLOCKED:<reason>"; result.text is the final message.
    Both raise LineError(BUDGET_EXCEEDED) BEFORE calling when the pre-call estimate
    exceeds LINE_MAX_USD_CALL or the run's remaining LINE_MAX_USD_RUN, and
    LineError(LLM_ERROR) on transport failure. model=None means config.model.
    """

    def complete(self, role: str, prompt: str, schema: Optional[Mapping[str, Any]] = None, *,
                 key: str = "", model: Optional[str] = None, run: str = "") -> LlmResult: ...

    def agentic(self, role: str, workdir: str, prompt: str, max_turns: int, usd_cap: float, *,
                key: str = "", model: Optional[str] = None, run: str = "") -> LlmResult: ...


__all__ = [n for n in dir() if not n.startswith("_") and n not in (
    "annotations", "dataclasses", "enum", "time", "typing", "dataclass", "field")]

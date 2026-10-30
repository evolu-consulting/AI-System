"""In-memory fakes of the line's ports, for every slice's unit tests.

  ManualClock            Clock you advance by hand
  FakeLeases             LeaseManager (fencing epochs, expiry by clock)
  FakeBudget             Budget tree with reservations
  FakeStore              Store (events, records, CAS transitions, outbox); fences unit events on FakeLeases
  FakeRag                RagPort; .down = True simulates an outage, .missing disables capabilities
  FakeLlm                LlmPort with scripted answers

    from line.tests.fakes import make_fakes
    f = make_fakes()          # SimpleNamespace(clock, leases, budget, store, rag, llm)

These are reference semantics for the real implementations: a real slice
should pass the same behavioural tests the fakes pass.
"""

from __future__ import annotations

import copy
import dataclasses
import hashlib
import itertools
import json
import os
import threading
import types
from typing import Any, Callable, Dict, Iterable, List, Mapping, Optional, Sequence, Tuple, Union

from .. import codes
from ..codes import LineError
from ..contracts import (
    BUDGET_WARN_RATIO, ENTITIES, TRANSITIONS, BudgetState, Envelope, Event, Lease, LlmResult,
    OutboxItem, RagCapabilities, Span, span_id, to_dict, unit_lease_name,
)


def _sv(x: Any) -> str:
    return getattr(x, "value", x)


# ------------------------------------------------------------------ clock


class ManualClock:
    def __init__(self, start_ms: int = 1_700_000_000_000):
        self.t = start_ms

    def now_ms(self) -> int:
        return self.t

    def advance(self, seconds: float) -> int:
        self.t += int(seconds * 1000)
        return self.t


# ------------------------------------------------------------------ leases


class FakeLeases:
    def __init__(self, clock: Optional[ManualClock] = None, ttl_s: int = 300):
        self.clock = clock or ManualClock()
        self.ttl_s = ttl_s
        self._lock = threading.Lock()
        self._live: Dict[str, Lease] = {}
        self._epoch: Dict[str, int] = {}
        self._reaped: set = set()

    def _alive(self, lease: Optional[Lease]) -> bool:
        return lease is not None and lease.expires_ms > self.clock.now_ms()

    def acquire(self, name: str, owner: str, ttl_s: Optional[int] = None) -> Optional[Lease]:
        with self._lock:
            cur = self._live.get(name)
            if self._alive(cur):
                return None
            epoch = self._epoch.get(name, 0) + 1
            self._epoch[name] = epoch
            lease = Lease(name, epoch, self.clock.now_ms() + 1000 * (ttl_s or self.ttl_s), owner)
            self._live[name] = lease
            return copy.copy(lease)

    def renew(self, lease: Lease, ttl_s: Optional[int] = None) -> Lease:
        with self._lock:
            cur = self._live.get(lease.name)
            if not self._alive(cur) or cur.epoch != lease.epoch:
                raise LineError(codes.LEASE_LOST, "lease %s epoch %d lost" % (lease.name, lease.epoch),
                                {"name": lease.name, "epoch": lease.epoch})
            cur.expires_ms = self.clock.now_ms() + 1000 * (ttl_s or self.ttl_s)
            return copy.copy(cur)

    def release(self, lease: Lease) -> None:
        with self._lock:
            cur = self._live.get(lease.name)
            if cur is not None and cur.epoch == lease.epoch:
                del self._live[lease.name]

    def current(self, name: str) -> Optional[Lease]:
        with self._lock:
            cur = self._live.get(name)
            return copy.copy(cur) if self._alive(cur) else None

    def check(self, name: str, epoch: int) -> None:
        cur = self.current(name)
        if cur is None or cur.epoch != epoch:
            raise LineError(codes.LEASE_LOST, "stale epoch %d for %s" % (epoch, name),
                            {"name": name, "epoch": epoch, "current": cur.epoch if cur else None})

    def expired(self, now_ms: Optional[int] = None) -> List[Lease]:
        now = self.clock.now_ms() if now_ms is None else now_ms
        with self._lock:
            return [copy.copy(l) for l in self._live.values()
                    if l.expires_ms <= now and (l.name, l.epoch) not in self._reaped]

    def reap(self, lease: Lease) -> None:
        with self._lock:
            self._reaped.add((lease.name, lease.epoch))
            cur = self._live.get(lease.name)
            if cur is not None and cur.epoch == lease.epoch:
                del self._live[lease.name]


# ------------------------------------------------------------------ budget


class FakeBudget:
    def __init__(self, warn_ratio: float = BUDGET_WARN_RATIO):
        self.warn_ratio = warn_ratio
        self._lock = threading.Lock()
        # run -> node -> {"limit","spent","reserved","parent"}
        self._nodes: Dict[str, Dict[str, Dict[str, Any]]] = {}
        self._res: Dict[str, Tuple[str, str, float]] = {}
        self._ids = itertools.count(1)

    def _node(self, run: str, node: str) -> Dict[str, Any]:
        try:
            return self._nodes[run][node]
        except KeyError:
            raise LineError(codes.NOT_FOUND, "budget node %s/%s" % (run, node), {"run": run, "node": node})

    def _chain(self, run: str, node: str) -> List[Dict[str, Any]]:
        out, n = [], self._node(run, node)
        while n is not None:
            out.append(n)
            n = self._nodes[run].get(n["parent"]) if n["parent"] else None
        return out

    def _state(self, run: str, node: str) -> BudgetState:
        n = self._node(run, node)
        used = n["spent"] + n["reserved"]
        return BudgetState(node, n["limit"], n["spent"], n["reserved"],
                           n["limit"] > 0 and used >= self.warn_ratio * n["limit"])

    def open(self, run: str, limit_usd: float) -> None:
        with self._lock:
            self._nodes[run] = {run: {"limit": float(limit_usd), "spent": 0.0, "reserved": 0.0, "parent": ""}}

    def split(self, run: str, parent: str, weights: Mapping[str, float]) -> None:
        with self._lock:
            p = self._node(run, parent)
            total = float(sum(weights.values())) or 1.0
            for child, w in weights.items():
                self._nodes[run][child] = {"limit": p["limit"] * float(w) / total, "spent": 0.0,
                                           "reserved": 0.0, "parent": parent}

    def reserve(self, run: str, node: str, usd: float) -> str:
        with self._lock:
            chain = self._chain(run, node)
            for n in chain:
                if n["spent"] + n["reserved"] + usd > n["limit"] + 1e-12:
                    raise LineError(codes.BUDGET_EXCEEDED, "budget exceeded at %s" % node,
                                    {"run": run, "node": node, "usd": usd, "limit": n["limit"],
                                     "spent": n["spent"], "reserved": n["reserved"]})
            for n in chain:
                n["reserved"] += usd
            rid = "r%d" % next(self._ids)
            self._res[rid] = (run, node, usd)
            return rid

    def _drop(self, reservation: str) -> None:
        r = self._res.pop(reservation, None)
        if r:
            run, node, usd = r
            for n in self._chain(run, node):
                n["reserved"] = max(n["reserved"] - usd, 0.0)

    def charge(self, run: str, node: str, usd: float, reservation: str = "") -> BudgetState:
        with self._lock:
            if reservation:
                self._drop(reservation)
            for n in self._chain(run, node):
                n["spent"] += usd
            return self._state(run, node)

    def release(self, run: str, reservation: str) -> None:
        with self._lock:
            self._drop(reservation)

    def state(self, run: str, node: str) -> BudgetState:
        with self._lock:
            return self._state(run, node)

    def remaining(self, run: str, node: Optional[str] = None) -> float:
        with self._lock:
            chain = self._chain(run, node or run)
            return min(max(n["limit"] - n["spent"] - n["reserved"], 0.0) for n in chain)


# ------------------------------------------------------------------ store


class FakeStore:
    def __init__(self, clock: Optional[ManualClock] = None, leases: Optional[FakeLeases] = None):
        self.clock = clock or ManualClock()
        self.leases = leases if leases is not None else FakeLeases(self.clock)
        self._lock = threading.RLock()
        self._events: List[Event] = []
        self._rows: Dict[Tuple[str, str], Dict[str, Any]] = {}   # (entity,id) -> {"row","version","run","order"}
        self._order = itertools.count(1)
        self._outbox: Dict[int, OutboxItem] = {}
        self._outbox_ids = itertools.count(1)

    # events
    def emit(self, kind: str, env: Union[Envelope, Mapping[str, Any]], body: Optional[Mapping[str, Any]] = None) -> int:
        if kind not in codes.EVENT_KINDS:
            raise LineError(codes.UNKNOWN_KIND, "unknown event kind %r" % kind, {"kind": kind})
        e = Envelope.parse(env)
        if e.unit and e.epoch > 0:
            self.leases.check(unit_lease_name(e.unit), e.epoch)
        with self._lock:
            seq = len(self._events) + 1
            self._events.append(Event(seq, kind, copy.copy(e), json.loads(json.dumps(dict(body or {}))),
                                      self.clock.now_ms(), False))
            return seq

    def events_after(self, seq: int, run: Optional[str] = None, kinds: Optional[Iterable[str]] = None,
                     limit: int = 1000) -> List[Event]:
        ks = set(kinds) if kinds is not None else None
        with self._lock:
            out = [e for e in self._events[max(seq, 0):]
                   if (run is None or e.env.run == run) and (ks is None or e.kind in ks)]
            return [copy.deepcopy(e) for e in out[:limit]]

    def last_seq(self) -> int:
        return len(self._events)

    def unsynced(self, limit: int = 500) -> List[Event]:
        with self._lock:
            return [copy.deepcopy(e) for e in self._events if not e.synced][:limit]

    def mark_synced(self, seqs: Iterable[int]) -> None:
        with self._lock:
            for s in seqs:
                if 1 <= s <= len(self._events):
                    self._events[s - 1].synced = True

    # records
    def _check_entity(self, entity: str) -> None:
        if entity not in ENTITIES:
            raise LineError(codes.NOT_FOUND, "unknown entity %r" % entity, {"entity": entity})

    def put(self, entity: str, id: str, row: Mapping[str, Any], run: str = "", if_version: Optional[int] = None) -> int:
        self._check_entity(entity)
        data = json.loads(json.dumps(to_dict(row if dataclasses.is_dataclass(row) else dict(row))))
        with self._lock:
            cur = self._rows.get((entity, id))
            ver = cur["version"] if cur else 0
            if if_version is not None and if_version != ver:
                raise LineError(codes.STATE_CONFLICT, "%s/%s version %d != %d" % (entity, id, ver, if_version),
                                {"entity": entity, "id": id, "version": ver, "expected": if_version})
            self._rows[(entity, id)] = {"row": data, "version": ver + 1,
                                        "run": run or (cur["run"] if cur else "") or str(data.get("run", "")),
                                        "order": cur["order"] if cur else next(self._order)}
            return ver + 1

    def get(self, entity: str, id: str) -> Optional[Dict[str, Any]]:
        with self._lock:
            cur = self._rows.get((entity, id))
            return copy.deepcopy(cur["row"]) if cur else None

    def version(self, entity: str, id: str) -> int:
        with self._lock:
            cur = self._rows.get((entity, id))
            return cur["version"] if cur else 0

    def query(self, entity: str, run: Optional[str] = None, **eq: Any) -> List[Dict[str, Any]]:
        with self._lock:
            hits = [v for (ent, _), v in self._rows.items() if ent == entity and (run is None or v["run"] == run)
                    and all(v["row"].get(k) == _sv(x) for k, x in eq.items())]
            hits.sort(key=lambda v: v["order"])
            return [copy.deepcopy(v["row"]) for v in hits]

    def transition(self, entity: str, id: str, to: Any, expect_from: Any) -> Dict[str, Any]:
        table = TRANSITIONS.get(entity)
        if table is None:
            raise LineError(codes.ILLEGAL_TRANSITION, "entity %r has no state machine" % entity, {"entity": entity})
        to = _sv(to)
        exp = {_sv(expect_from)} if isinstance(expect_from, str) or hasattr(expect_from, "value") \
            else {_sv(x) for x in expect_from}
        with self._lock:
            cur = self._rows.get((entity, id))
            if cur is None:
                raise LineError(codes.NOT_FOUND, "%s/%s" % (entity, id), {"entity": entity, "id": id})
            frm = cur["row"].get("state")
            if frm not in exp:
                raise LineError(codes.STATE_CONFLICT, "%s/%s is %s, expected %s" % (entity, id, frm, sorted(exp)),
                                {"entity": entity, "id": id, "state": frm, "expected": sorted(exp)})
            if to not in table.get(frm, frozenset()):
                raise LineError(codes.ILLEGAL_TRANSITION, "%s/%s %s -> %s" % (entity, id, frm, to),
                                {"entity": entity, "id": id, "from": frm, "to": to})
            cur["row"]["state"] = to
            if "updated_ms" in cur["row"]:
                cur["row"]["updated_ms"] = self.clock.now_ms()
            cur["version"] += 1
            return copy.deepcopy(cur["row"])

    # outbox
    def outbox_push(self, op: str, args: Mapping[str, Any], idem_key: str) -> int:
        with self._lock:
            i = next(self._outbox_ids)
            self._outbox[i] = OutboxItem(i, op, json.loads(json.dumps(dict(args))), idem_key, self.clock.now_ms(), 0)
            return i

    def outbox_peek(self, limit: int = 100) -> List[OutboxItem]:
        with self._lock:
            return [copy.deepcopy(self._outbox[i]) for i in sorted(self._outbox)][:limit]

    def outbox_ack(self, id: int) -> None:
        with self._lock:
            self._outbox.pop(id, None)

    def outbox_fail(self, id: int) -> None:
        with self._lock:
            if id in self._outbox:
                self._outbox[id].tries += 1


# ------------------------------------------------------------------ RAG


class FakeRag:
    """In-memory RAG System. Set .down = True for a full outage (every call raises RAG_DEGRADED),
    or put capability names in .missing to disable just those. .calls logs (method, args)."""

    def __init__(self, clock: Optional[ManualClock] = None, docs: Optional[List[Dict[str, Any]]] = None):
        self.clock = clock or ManualClock()
        self.down = False
        self.missing: set = set()
        self.calls: List[Tuple[str, Dict[str, Any]]] = []
        self.events: List[Dict[str, Any]] = []
        self.records: Dict[Tuple[str, str], Tuple[Dict[str, Any], str]] = {}
        self.packs: Dict[str, Dict[str, str]] = {}
        self.metrics: List[Tuple[str, float, Dict[str, Any]]] = []
        self.docs: List[Dict[str, Any]] = list(docs or [])   # retrieve() corpus: {"text","source","tags":[..]}
        self.leases = FakeLeases(self.clock)
        self._idem: Dict[str, Any] = {}
        self._lock = threading.Lock()

    def _gate(self, cap: str, method: str, **args: Any) -> None:
        self.calls.append((method, args))
        if self.down:
            raise LineError(codes.RAG_DEGRADED, "RAG System unreachable", {"capability": cap, "method": method})
        if cap in self.missing:
            raise LineError(codes.RAG_DEGRADED, "capability %s unavailable" % cap, {"capability": cap, "method": method})

    def capabilities(self) -> RagCapabilities:
        self._gate("capabilities", "capabilities")
        on = {n: n not in self.missing for n in RagCapabilities.NAMES}
        return RagCapabilities(version="fake-1", **on)

    def append_events(self, batch: Sequence[Mapping[str, Any]], idem_key: str) -> Dict[str, Any]:
        self._gate("events", "append_events", n=len(batch), idem_key=idem_key)
        with self._lock:
            if idem_key in self._idem:
                return dict(self._idem[idem_key])
            for ev in batch:
                self.events.append(dict(ev, remote_seq=len(self.events) + 1))
            res = {"accepted": len(batch), "last_seq": len(self.events)}
            self._idem[idem_key] = res
            return dict(res)

    def events_after(self, seq: int, limit: int = 500) -> List[Dict[str, Any]]:
        self._gate("events", "events_after", seq=seq)
        return [dict(e) for e in self.events[max(seq, 0):max(seq, 0) + limit]]

    def lease_acquire(self, name: str, ttl_s: int, owner: str) -> Optional[Lease]:
        self._gate("leases", "lease_acquire", name=name)
        return self.leases.acquire(name, owner, ttl_s)

    def lease_renew(self, lease: Lease, ttl_s: int) -> Lease:
        self._gate("leases", "lease_renew", name=lease.name)
        return self.leases.renew(lease, ttl_s)

    def lease_release(self, lease: Lease) -> None:
        self._gate("leases", "lease_release", name=lease.name)
        self.leases.release(lease)

    def put_record(self, type: str, id: str, body: Mapping[str, Any], if_match: Optional[str] = None,
                   idem_key: str = "") -> str:
        self._gate("records", "put_record", type=type, id=id)
        with self._lock:
            if idem_key and idem_key in self._idem:
                return self._idem[idem_key]
            cur = self.records.get((type, id))
            if cur is not None and if_match is None:
                raise LineError(codes.PRECONDITION_REQUIRED, "if_match required to update %s/%s" % (type, id))
            if if_match is not None and (cur is None or cur[1] != if_match):
                raise LineError(codes.VERSION_CONFLICT, "etag mismatch on %s/%s" % (type, id),
                                {"etag": cur[1] if cur else None})
            data = json.loads(json.dumps(dict(body)))
            etag = hashlib.sha1(json.dumps(data, sort_keys=True).encode("utf-8")).hexdigest()[:16]
            self.records[(type, id)] = (data, etag)
            if idem_key:
                self._idem[idem_key] = etag
            return etag

    def get_record(self, type: str, id: str) -> Optional[Tuple[Dict[str, Any], str]]:
        self._gate("records", "get_record", type=type, id=id)
        cur = self.records.get((type, id))
        return (copy.deepcopy(cur[0]), cur[1]) if cur else None

    def freeze_pack(self, files: Mapping[str, str], idem_key: str = "") -> str:
        self._gate("packs", "freeze_pack", n=len(files))
        h = hashlib.sha256()
        for p in sorted(files):
            h.update(p.encode("utf-8") + b"\0" + files[p].encode("utf-8") + b"\0")
        ver = "pv-" + h.hexdigest()[:16]
        self.packs[ver] = dict(files)
        return ver

    def quote(self, path: str, text: str, version: str = "") -> Optional[Span]:
        self._gate("quote", "quote", path=path)
        packs = [self.packs[version]] if version in self.packs else list(self.packs.values())[::-1]
        for files in packs:
            body = files.get(path)
            if body is None or not text:
                continue
            i = body.find(text)
            if i < 0:
                continue
            start = body.count("\n", 0, i) + 1
            end = body.count("\n", 0, i + len(text)) + 1
            lines = body.split("\n")[start - 1:end]
            seg = "\n".join(lines)
            return Span(span_id(path, start, end), path, start, end, "", seg,
                        hashlib.sha256(seg.encode("utf-8")).hexdigest())
        return None

    def retrieve(self, role: str, step: str, stack: Sequence[str], max_chars: int,
                 query: str = "") -> List[Dict[str, Any]]:
        self._gate("retrieve", "retrieve", role=role, step=step)
        self.__dict__.setdefault("retrieve_calls", []).append((role, step, list(stack), query))
        want = {role, step, *stack}
        out, used = [], 0
        for d in self.docs:
            tags = set(d.get("tags") or [])
            if tags and not (tags & want):
                continue
            t = d.get("text", "")
            if used + len(t) > max_chars:
                break
            used += len(t)
            out.append({"text": t, "source": d.get("source", ""), "score": float(d.get("score", 1.0))})
        return out

    def metric(self, name: str, value: float, dims: Optional[Mapping[str, Any]] = None) -> None:
        self._gate("metrics", "metric", name=name)
        self.metrics.append((name, float(value), dict(dims or {})))


# ------------------------------------------------------------------ LLM

Answer = Union[Dict[str, Any], List[Any], str, LlmResult, BaseException, Callable[..., Any]]


class FakeLlm:
    """Scripted LlmPort.

    script maps a lookup key to an answer or a list of answers (a list is ALWAYS a sequence,
    consumed in order, the last one repeating; script list data as [[...]]). Lookup order: (role, key) tuple, then "role/key", then role.
    An answer is: dict/list -> result.data (text = its JSON); str -> result.text (and
    data = parsed JSON if it parses); LlmResult -> as is; exception -> raised;
    callable(role, prompt, **kw) -> any of the above.
    agentic() answers: str "SUBMIT" / "BLOCKED:<reason>" or an LlmResult; a dict may carry
    {"outcome", "text", "files": {relpath: content}} and files are written into workdir.

    usd_per_call is charged on every call; a call whose usd_per_call would exceed
    max_usd_call (or the remaining max_usd_run) raises BUDGET_EXCEEDED before answering.
    .calls logs dicts {"op","role","key","model","prompt","workdir"}.
    """

    def __init__(self, script: Optional[Mapping[Any, Any]] = None, usd_per_call: float = 0.01,
                 model: str = "claude-opus-5-5", max_usd_call: float = 1e9, max_usd_run: float = 1e9):
        self.script: Dict[Any, Any] = dict(script or {})
        self.usd_per_call = usd_per_call
        self.model = model
        self.max_usd_call = max_usd_call
        self.max_usd_run = max_usd_run
        self.spent: Dict[str, float] = {}
        self.calls: List[Dict[str, Any]] = []
        self._pos: Dict[Any, int] = {}
        self._lock = threading.Lock()

    def add(self, role: str, answer: Answer, key: str = "") -> None:
        k = (role, key) if key else role
        cur = self.script.get(k)
        if cur is None:
            self.script[k] = [answer]
        elif isinstance(cur, list):
            cur.append(answer)
        else:
            self.script[k] = [cur, answer]

    def _next(self, role: str, key: str) -> Any:
        for k in ((role, key), "%s/%s" % (role, key), role):
            if k in self.script:
                v = self.script[k]
                if isinstance(v, list) and v:
                    with self._lock:
                        i = self._pos.get(k, 0)
                        self._pos[k] = i + 1
                    return v[min(i, len(v) - 1)]
                return v
        raise LineError(codes.LLM_ERROR, "no scripted answer for %s/%s" % (role, key), {"role": role, "key": key})

    def _precheck(self, run: str) -> None:
        if self.usd_per_call > self.max_usd_call:
            raise LineError(codes.BUDGET_EXCEEDED, "call estimate over max_usd_call",
                            {"estimate": self.usd_per_call, "cap": self.max_usd_call})
        if self.spent.get(run, 0.0) + self.usd_per_call > self.max_usd_run + 1e-12:
            raise LineError(codes.BUDGET_EXCEEDED, "call would exceed max_usd_run",
                            {"spent": self.spent.get(run, 0.0), "cap": self.max_usd_run})

    def _result(self, ans: Any, model: str) -> LlmResult:
        if isinstance(ans, LlmResult):
            return copy.deepcopy(ans)
        if isinstance(ans, (dict, list)):
            return LlmResult(copy.deepcopy(ans), json.dumps(ans), {"input": 0, "output": 0}, self.usd_per_call, model)
        text = str(ans)
        try:
            data = json.loads(text)
        except ValueError:
            data = None
        return LlmResult(data, text, {"input": 0, "output": 0}, self.usd_per_call, model)

    def _answer(self, op: str, role: str, prompt: str, key: str, model: Optional[str], run: str,
                workdir: str = "") -> Any:
        m = model or self.model
        self.calls.append({"op": op, "role": role, "key": key, "model": m, "prompt": prompt, "workdir": workdir})
        self._precheck(run)
        ans = self._next(role, key)
        if callable(ans) and not isinstance(ans, (LlmResult, BaseException)):
            ans = ans(role, prompt, key=key, model=m, run=run, workdir=workdir)
        if isinstance(ans, BaseException):
            raise ans
        self.spent[run] = self.spent.get(run, 0.0) + self.usd_per_call
        return ans, m

    def complete(self, role: str, prompt: str, schema: Optional[Mapping[str, Any]] = None, *,
                 key: str = "", model: Optional[str] = None, run: str = "") -> LlmResult:
        ans, m = self._answer("complete", role, prompt, key, model, run)
        res = self._result(ans, m)
        if schema is not None:
            req = list(schema.get("required") or [])
            if res.data is None or (req and (not isinstance(res.data, dict) or any(k not in res.data for k in req))):
                raise LineError(codes.SCHEMA_INVALID, "answer does not match schema", {"role": role, "key": key})
        return res

    def agentic(self, role: str, workdir: str, prompt: str, max_turns: int, usd_cap: float, *,
                key: str = "", model: Optional[str] = None, run: str = "") -> LlmResult:
        if self.usd_per_call > usd_cap:
            raise LineError(codes.BUDGET_EXCEEDED, "call estimate over usd_cap",
                            {"estimate": self.usd_per_call, "cap": usd_cap})
        ans, m = self._answer("agentic", role, prompt, key, model, run, workdir)
        if isinstance(ans, LlmResult):
            return copy.deepcopy(ans)
        if isinstance(ans, dict):
            for rel, content in (ans.get("files") or {}).items():
                path = os.path.join(workdir, rel)
                os.makedirs(os.path.dirname(path) or workdir, exist_ok=True)
                with open(path, "w", encoding="utf-8", newline="\n") as fh:
                    fh.write(content)
            outcome = ans.get("outcome", "SUBMIT")
            return LlmResult(None, ans.get("text", outcome), {"input": 0, "output": 0}, self.usd_per_call, m, outcome)
        text = str(ans)
        outcome = text if text == "SUBMIT" or text.startswith("BLOCKED:") else "SUBMIT"
        return LlmResult(None, text, {"input": 0, "output": 0}, self.usd_per_call, m, outcome)


# ------------------------------------------------------------------ bundle


def make_fakes(lease_ttl_s: int = 300, llm_script: Optional[Mapping[Any, Any]] = None) -> types.SimpleNamespace:
    clock = ManualClock()
    leases = FakeLeases(clock, lease_ttl_s)
    return types.SimpleNamespace(
        clock=clock, leases=leases, budget=FakeBudget(), store=FakeStore(clock, leases),
        rag=FakeRag(clock), llm=FakeLlm(llm_script),
    )

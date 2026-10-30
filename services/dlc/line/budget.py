"""Budget tree run -> F-item -> unit on SQLite (contracts.Budget).

    from line.budget import SqliteBudget
    b = SqliteBudget(store, agent_version=cfg.agent_version)
    b.open("R1", cfg.max_usd_run)
    b.split("R1", "R1", {"F1": 1, "F2": 1})                 # F-items share the run
    b.split_units("R1", "F1", {"U1": "S", "U2": "L"})       # S/M/L weights 1/2/4
    rid = b.reserve("R1", "U1", 0.10)                       # BUDGET_EXCEEDED at 100% (node or ancestor)
    st = b.charge("R1", "U1", 0.08, rid)                    # never raises

Warn at budget_warn_ratio (80%): charge() emits one budget.warn event per node that crosses it
(node and ancestors), when the budget was built with a store to emit on (emit=True). The
BudgetState.warn flag is set either way, so callers on FakeBudget can do the same.
"""

from __future__ import annotations

from typing import Any, Dict, List, Mapping, Optional

from . import codes
from .codes import LineError
from .contracts import BUDGET_WARN_RATIO, SIZE_WEIGHTS, BudgetState, Envelope

EPS = 1e-9


def size_weights(sizes: Mapping[str, str]) -> Dict[str, float]:
    """{"U1": "S", "U2": "L"} -> {"U1": 1, "U2": 4}. Unknown size -> SCHEMA_INVALID."""
    out = {}
    for k, s in sizes.items():
        s = getattr(s, "value", s)
        if s not in SIZE_WEIGHTS:
            raise LineError(codes.SCHEMA_INVALID, "unknown unit size %r" % (s,), {"node": k, "size": s})
        out[k] = float(SIZE_WEIGHTS[s])
    return out


class SqliteBudget:
    """contracts.Budget on the budget_node / budget_res tables of a SqliteStore. Thread-safe."""

    def __init__(self, store: Any, warn_ratio: float = BUDGET_WARN_RATIO, emit: bool = True,
                 agent_version: str = "line-0.1"):
        self.store = store
        self.warn_ratio = float(warn_ratio)
        self.emit = emit
        self.agent_version = agent_version

    # ------------------------------------------------------------ internals

    def _node(self, c: Any, run: str, node: str) -> Any:
        r = c.execute("SELECT * FROM budget_node WHERE run=? AND node=?", (run, node)).fetchone()
        if r is None:
            raise LineError(codes.NOT_FOUND, "budget node %s/%s" % (run, node), {"run": run, "node": node})
        return r

    def _chain(self, c: Any, run: str, node: str) -> List[Any]:
        out, seen = [], set()
        r = self._node(c, run, node)
        while r is not None and r["node"] not in seen:
            seen.add(r["node"])
            out.append(r)
            r = self._node(c, run, r["parent"]) if r["parent"] else None
        return out

    def _state_row(self, r: Any) -> BudgetState:
        used = r["spent"] + r["reserved"]
        lim = r["limit_usd"]
        return BudgetState(r["node"], lim, r["spent"], r["reserved"],
                           lim > 0 and used >= self.warn_ratio * lim - EPS)

    # ------------------------------------------------------------ port

    def open(self, run: str, limit_usd: float) -> None:
        with self.store.tx() as c:
            c.execute("DELETE FROM budget_res WHERE run=?", (run,))
            c.execute("DELETE FROM budget_node WHERE run=?", (run,))
            c.execute("INSERT INTO budget_node(run, node, parent, limit_usd) VALUES (?,?,?,?)",
                      (run, run, "", float(limit_usd)))

    def split(self, run: str, parent: str, weights: Mapping[str, float]) -> None:
        with self.store.tx() as c:
            p = self._node(c, run, parent)
            total = float(sum(float(w) for w in weights.values())) or 1.0
            for child, w in weights.items():
                if child == parent:
                    raise LineError(codes.SCHEMA_INVALID, "budget node cannot be its own child", {"node": child})
                c.execute("INSERT INTO budget_node(run, node, parent, limit_usd) VALUES (?,?,?,?)"
                          " ON CONFLICT(run, node) DO UPDATE SET parent=excluded.parent, limit_usd=excluded.limit_usd",
                          (run, child, parent, p["limit_usd"] * float(w) / total))

    def split_units(self, run: str, parent: str, sizes: Mapping[str, str]) -> None:
        """split() with S/M/L sizes mapped through SIZE_WEIGHTS."""
        self.split(run, parent, size_weights(sizes))

    def reserve(self, run: str, node: str, usd: float) -> str:
        usd = float(usd)
        with self.store.tx() as c:
            chain = self._chain(c, run, node)
            for n in chain:
                if n["spent"] + n["reserved"] + usd > n["limit_usd"] + EPS:
                    raise LineError(codes.BUDGET_EXCEEDED, "budget exceeded at %s" % n["node"],
                                    {"run": run, "node": node, "at": n["node"], "usd": usd, "limit": n["limit_usd"],
                                     "spent": n["spent"], "reserved": n["reserved"]})
            for n in chain:
                c.execute("UPDATE budget_node SET reserved = reserved + ? WHERE run=? AND node=?", (usd, run, n["node"]))
            cur = c.execute("INSERT INTO budget_res(run, node, usd) VALUES (?,?,?)", (run, node, usd))
            return "r%d" % cur.lastrowid

    def _drop(self, c: Any, run: str, reservation: str) -> None:
        if not reservation or not reservation.startswith("r"):
            return
        try:
            rid = int(reservation[1:])
        except ValueError:
            return
        r = c.execute("SELECT * FROM budget_res WHERE id=? AND run=?", (rid, run)).fetchone()
        if r is None:
            return
        c.execute("DELETE FROM budget_res WHERE id=?", (rid,))
        for n in self._chain(c, run, r["node"]):
            c.execute("UPDATE budget_node SET reserved = MAX(reserved - ?, 0) WHERE run=? AND node=?",
                      (r["usd"], run, n["node"]))

    def charge(self, run: str, node: str, usd: float, reservation: str = "") -> BudgetState:
        warn: List[BudgetState] = []
        with self.store.tx() as c:
            self._drop(c, run, reservation)
            chain = self._chain(c, run, node)
            for n in chain:
                c.execute("UPDATE budget_node SET spent = spent + ? WHERE run=? AND node=?", (float(usd), run, n["node"]))
            for n in self._chain(c, run, node):
                st = self._state_row(n)
                if st.warn and not n["warned"]:
                    c.execute("UPDATE budget_node SET warned = 1 WHERE run=? AND node=?", (run, n["node"]))
                    warn.append(st)
            if self.emit:
                for st in warn:
                    self.store.emit(codes.BUDGET_WARN, Envelope(run, "", 0, 0, self.agent_version, "", ""),
                                    {"node": st.node, "spent": st.spent, "limit": st.limit})
            return self._state_row(self._node(c, run, node))

    def extend(self, run: str, add_usd: float) -> None:
        """Grow the run's budget by add_usd (a retried run, line.reopen): every node's limit grows in the same
        proportion, so each F-item / unit keeps its share. A run without a tree gets one of add_usd."""
        with self.store.tx() as c:
            root = c.execute("SELECT limit_usd FROM budget_node WHERE run=? AND node=?", (run, run)).fetchone()
            if root is None:
                c.execute("INSERT INTO budget_node(run, node, parent, limit_usd) VALUES (?,?,?,?)",
                          (run, run, "", float(add_usd)))
                return
            old = float(root["limit_usd"] or 0)
            if old <= EPS:
                c.execute("UPDATE budget_node SET limit_usd = limit_usd + ? WHERE run=? AND node=?",
                          (float(add_usd), run, run))
                return
            c.execute("UPDATE budget_node SET limit_usd = limit_usd * ? WHERE run=?", ((old + float(add_usd)) / old, run))

    def release(self, run: str, reservation: str) -> None:
        with self.store.tx() as c:
            self._drop(c, run, reservation)

    def state(self, run: str, node: str) -> BudgetState:
        with self.store.tx() as c:
            return self._state_row(self._node(c, run, node))

    def remaining(self, run: str, node: Optional[str] = None) -> float:
        with self.store.tx() as c:
            chain = self._chain(c, run, node or run)
            return min(max(n["limit_usd"] - n["spent"] - n["reserved"], 0.0) for n in chain)

    def tree(self, run: str) -> List[Dict[str, Any]]:
        """All nodes of a run (for the board): [{node, parent, limit, spent, reserved, warn}]."""
        with self.store.tx() as c:
            rows = c.execute("SELECT * FROM budget_node WHERE run=? ORDER BY rowid", (run,)).fetchall()
            return [dict(node=r["node"], parent=r["parent"], limit=r["limit_usd"], spent=r["spent"],
                         reserved=r["reserved"], warn=self._state_row(r).warn) for r in rows]


__all__ = ["SqliteBudget", "size_weights"]

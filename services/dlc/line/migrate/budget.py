"""The migration's own budget, separate from the per-run cap of a build run.

    b = MigrationBudget(store, mid, limit=50.0, limit_repo=3.0, warn_ratio=0.8, emit=fn)
    llm = BudgetedLlm(inner, lambda run: b)          # every model call of the migration goes through it
    llm = b.repo_llm(llm, "v1.shop_db_order")         # one repository's scan: also capped per repository

Spend is kept ON THE MIGRATION ROW (spent_usd, repo_usd), not read back from the call ledger, so a resumed
migration - a new process, maybe another model backend - continues from what was really spent. A call is
refused BEFORE it is made once the total (or the repository's share) is used up: LineError
MIGRATION_BUDGET, detail {"scope": "total" | "repo", ...}. Crossing warn_ratio emits one budget.warn per
node (the migration, or one repository). The build run the migration starts gets what is left as its own
run budget; its spend is shown next to the migration's, not charged twice.
"""

from __future__ import annotations

import threading
from typing import Any, Callable, Dict, Mapping, Optional

from .. import codes
from ..codes import LineError
from ..contracts import E_LLM_CALL, E_MIGRATION
from ..statemachine import update_row

EPS = 1e-9
#: a build run is not started with less than this left (it could not afford one builder call)
MIN_BUILD_USD = 0.05


def budget_error(scope: str, message: str, detail: Mapping[str, Any]) -> LineError:
    # the code is also at the front of the message: a repository scan reports a failure as text, and the
    # runner must still recognise that the repository stopped on money, not on a bug
    return LineError(codes.MIGRATION_BUDGET, "%s: %s" % (codes.MIGRATION_BUDGET, message), dict(detail, scope=scope))


def is_budget_text(text: str) -> bool:
    return codes.MIGRATION_BUDGET in str(text or "")


class MigrationBudget:
    def __init__(self, store: Any, mid: str, *, limit: float, limit_repo: float = 0.0, warn_ratio: float = 0.8,
                 emit: Optional[Callable[[str, Mapping[str, Any]], None]] = None):
        self.store, self.mid = store, mid
        self.limit, self.limit_repo = float(limit or 0), float(limit_repo or 0)
        self.warn_ratio = float(warn_ratio)
        self.emit = emit or (lambda kind, body: None)
        self._lock = threading.RLock()

    # ------------------------------------------------------------ state on the row

    def _row(self) -> Dict[str, Any]:
        return self.store.get(E_MIGRATION, self.mid) or {}

    def spent(self) -> float:
        return float(self._row().get("spent_usd") or 0.0)

    def repo_spent(self, repo: str) -> float:
        return float((self._row().get("repo_usd") or {}).get(repo) or 0.0)

    def remaining(self) -> float:
        return max(self.limit - self.spent(), 0.0) if self.limit > 0 else float("inf")

    # ------------------------------------------------------------ gate + charge

    def check(self, repo: str = "") -> None:
        with self._lock:
            row = self._row()
            spent = float(row.get("spent_usd") or 0.0)
            if self.limit > 0 and spent >= self.limit - EPS:
                raise budget_error("total", "migration %s used its budget ($%.2f of $%.2f)"
                                   % (self.mid, spent, self.limit),
                                   {"migration": self.mid, "spent": round(spent, 6), "limit": self.limit})
            if repo and self.limit_repo > 0:
                rs = float((row.get("repo_usd") or {}).get(repo) or 0.0)
                if rs >= self.limit_repo - EPS:
                    raise budget_error("repo", "repository %s used its scan budget ($%.2f of $%.2f)"
                                       % (repo, rs, self.limit_repo),
                                       {"migration": self.mid, "repo": repo, "spent": round(rs, 6),
                                        "limit": self.limit_repo})

    def charge(self, usd: float, repo: str = "") -> None:
        usd = float(usd or 0.0)
        if usd <= 0:
            return
        with self._lock:
            row = self._row()
            spent = float(row.get("spent_usd") or 0.0) + usd
            per = dict(row.get("repo_usd") or {})
            warned = list(row.get("budget_warned") or [])
            kv: Dict[str, Any] = {"spent_usd": round(spent, 6)}
            if repo:
                per[repo] = round(float(per.get(repo) or 0.0) + usd, 6)
                kv["repo_usd"] = per
            fire = []
            if self.limit > 0 and spent >= self.warn_ratio * self.limit - EPS and self.mid not in warned:
                warned.append(self.mid)
                fire.append({"node": self.mid, "spent": round(spent, 6), "limit": self.limit})
            if repo and self.limit_repo > 0:
                node = "%s:%s" % (self.mid, repo)
                if per[repo] >= self.warn_ratio * self.limit_repo - EPS and node not in warned:
                    warned.append(node)
                    fire.append({"node": node, "spent": per[repo], "limit": self.limit_repo})
            if fire:
                kv["budget_warned"] = warned
            update_row(self.store, E_MIGRATION, self.mid, kv)
        for body in fire:
            self.emit(codes.BUDGET_WARN, body)

    def repo_llm(self, llm: Any, repo: str) -> "BudgetedLlm":
        return BudgetedLlm(llm, lambda run: self, repo=repo)


class BudgetedLlm:
    """LlmPort wrapper: gate before, charge after. ``budget_for(run)`` gives the MigrationBudget or None."""

    def __init__(self, inner: Any, budget_for: Callable[[str], Optional[MigrationBudget]], repo: str = ""):
        self.inner, self.budget_for, self.repo = inner, budget_for, repo

    def complete(self, role: str, prompt: str, schema: Any = None, **kw: Any) -> Any:
        b = self.budget_for(str(kw.get("run") or ""))
        if b is not None:
            b.check(self.repo)
        res = self.inner.complete(role, prompt, schema, **kw)
        if b is not None:
            b.charge(float(getattr(res, "usd", 0.0) or 0.0), self.repo)
        return res

    def __getattr__(self, name: str) -> Any:
        return getattr(self.inner, name)


def run_spend(store: Any, run: str) -> float:
    if not run:
        return 0.0
    return float(sum(float(c.get("usd") or 0.0) for c in store.query(E_LLM_CALL, run=run)))


def view(store: Any, row: Mapping[str, Any], limit: float, limit_repo: float, warn_ratio: float = 0.8
         ) -> Dict[str, Any]:
    """What the board and the report show: own spend, the build runs' spend, the caps, per repository."""
    own = float(row.get("spent_usd") or 0.0)
    runs = list(row.get("run_ids") or ([row["run"]] if row.get("run") else []))
    build = sum(run_spend(store, r) for r in runs)
    build_limit = float(row.get("build_budget") or 0.0)
    return {"limit": limit, "limit_repo": limit_repo, "spent": round(own, 6), "build_spent": round(build, 6),
            "build_limit": build_limit, "total": round(own + build, 6),
            "remaining": round(max(limit - own, 0.0), 6) if limit > 0 else None,
            "warn": bool(limit > 0 and own >= warn_ratio * limit - EPS),
            "repos": {k: round(float(v or 0.0), 6) for k, v in (row.get("repo_usd") or {}).items()}}


__all__ = ["MigrationBudget", "BudgetedLlm", "MIN_BUILD_USD", "budget_error", "is_budget_text", "run_spend", "view"]

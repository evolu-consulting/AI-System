"""Hard cost caps for the worker (design section 3.2, "Cost cap", lock 1 and 2).

Every LLM call is estimated *before* it is sent and refused when it could push the spend over a cap:

* run cap      ``KH_WORKER_CAP_RUN_USD``      (default 3)  - spend of this one job run
* month cap    ``KH_WORKER_CAP_MONTH_USD``    (default 60) - billed spend of this calendar month (UTC),
                                                             loaded from KH's ``worker.cost_usd`` metric
* backfill cap ``KH_WORKER_CAP_BACKFILL_USD`` (default 80) - a one-off backfill run; it replaces the run
                                                             cap and is kept out of the month budget, so
                                                             the backfill cannot eat the monthly money

The estimate is pessimistic on purpose: input tokens (counted, or estimated from characters) at the input
price plus the *whole* ``max_tokens`` at the output price. Actual spend from ``usage`` is then booked, which
releases the unused part of the estimate. The module is pure: no network, no clock, so it is fully testable.
"""
from __future__ import annotations

import math
import threading
from dataclasses import dataclass, field
from typing import Callable, Mapping

# USD per million tokens: (input, output). Cache reads bill at 10% of input, 5-minute cache writes at 125%.
# Source: Anthropic price list (claude-api skill, cached 2026-06-24). Opus 5.5 is $4/$20 - the design doc's
# $5/$25 was the Opus 5 price, so the doc's spend forecast is on the safe side.
PRICES: dict[str, tuple[float, float]] = {
    "claude-opus-5-5": (4.0, 20.0),
    "claude-opus-5": (5.0, 25.0),
    "claude-opus-4-8": (5.0, 25.0),
    "claude-sonnet-5": (2.0, 10.0),
    "claude-sonnet-4-6": (3.0, 15.0),
    "claude-haiku-4-5": (1.0, 5.0),
    "claude-fable-5-1": (10.0, 50.0),
    "claude-fable-5": (10.0, 50.0),
}
# An unknown model id is priced at the most expensive known model, so a typo can never make a call look cheap.
UNKNOWN_PRICE: tuple[float, float] = max(PRICES.values())
BATCH_DISCOUNT = 0.5          # Message Batches API bills 50%
CACHE_READ_FACTOR = 0.10
CACHE_WRITE_FACTOR = 1.25
CHARS_PER_TOKEN_PESSIMISTIC = 3.0   # used when no token counter is available (claude_cli, dry)

DEFAULT_CAP_RUN_USD = 3.0
DEFAULT_CAP_MONTH_USD = 60.0
DEFAULT_CAP_BACKFILL_USD = 80.0


class BudgetExceeded(RuntimeError):
    """Raised before a call that could exceed a cap. ``cap`` is ``run``, ``month`` or ``backfill``."""

    def __init__(self, cap: str, spent: float, estimate: float, limit: float):
        self.cap, self.spent, self.estimate, self.limit = cap, spent, estimate, limit
        super().__init__(
            f"budget: {cap} cap ${limit:.2f} would be exceeded "
            f"(spent ${spent:.4f} + estimate ${estimate:.4f})")


def price_of(model: str, overrides: Mapping[str, tuple[float, float]] | None = None) -> tuple[float, float]:
    if overrides and model in overrides:
        return overrides[model]
    return PRICES.get(model, UNKNOWN_PRICE)


def tokens_from_chars(*texts: str) -> int:
    """Pessimistic token estimate from characters (3 chars per token; English averages about 4)."""
    return int(math.ceil(sum(len(t or "") for t in texts) / CHARS_PER_TOKEN_PESSIMISTIC))


def estimate_usd(model: str, input_tokens: int, max_tokens: int, *, batch: bool = False,
                 overrides: Mapping[str, tuple[float, float]] | None = None) -> float:
    """Upper bound of one call: all input at the input price plus all of ``max_tokens`` at the output price."""
    pin, pout = price_of(model, overrides)
    usd = (max(0, input_tokens) * pin + max(0, max_tokens) * pout) / 1_000_000
    return usd * (BATCH_DISCOUNT if batch else 1.0)


def cost_from_usage(model: str, usage: Mapping[str, object], *, batch: bool = False,
                    overrides: Mapping[str, tuple[float, float]] | None = None) -> float:
    """Actual cost from an API ``usage`` block (input, output, cache read and cache write tokens)."""
    pin, pout = price_of(model, overrides)

    def n(key: str) -> int:
        v = usage.get(key) or 0
        return int(v) if isinstance(v, (int, float)) else 0

    usd = (n("input_tokens") * pin
           + n("cache_read_input_tokens") * pin * CACHE_READ_FACTOR
           + n("cache_creation_input_tokens") * pin * CACHE_WRITE_FACTOR
           + n("output_tokens") * pout) / 1_000_000
    return usd * (BATCH_DISCOUNT if batch else 1.0)


@dataclass
class Spend:
    """One booked call, handed to ``on_spend`` (main writes it to KH as a ``worker.cost_usd`` metric)."""
    usd: float
    estimate_usd: float
    model: str
    billed: bool
    kind: str
    usage: dict = field(default_factory=dict)


@dataclass
class Budget:
    """Caps for one job run. ``month_spent_usd`` is the billed month total read from KH at run start.

    ``kind`` is ``run`` (normal scheduled or ``once`` run) or ``backfill`` (one-off, own cap, kept out of the
    month budget). All mutating methods are thread-safe, so a daily batch and a lease renewer may share it.
    """
    cap_run_usd: float = DEFAULT_CAP_RUN_USD
    cap_month_usd: float = DEFAULT_CAP_MONTH_USD
    cap_backfill_usd: float = DEFAULT_CAP_BACKFILL_USD
    month_spent_usd: float = 0.0
    kind: str = "run"
    on_spend: Callable[[Spend], None] | None = None
    run_spent_usd: float = 0.0
    reserved_usd: float = 0.0
    calls: int = 0
    refused: int = 0
    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False, compare=False)

    def __post_init__(self):
        if self.kind not in ("run", "backfill"):
            raise ValueError("kind must be 'run' or 'backfill'")
        for name in ("cap_run_usd", "cap_month_usd", "cap_backfill_usd"):
            if not (getattr(self, name) >= 0):
                raise ValueError(f"{name} must be >= 0")

    # -- views -------------------------------------------------------------------------------------------
    @property
    def run_limit(self) -> float:
        return self.cap_backfill_usd if self.kind == "backfill" else self.cap_run_usd

    def remaining_usd(self) -> float:
        """Money the next call may still spend (the tighter of the caps that apply)."""
        with self._lock:
            return self._remaining()

    def _remaining(self) -> float:
        run_left = self.run_limit - self.run_spent_usd - self.reserved_usd
        if self.kind == "backfill":
            return max(0.0, run_left)
        month_left = self.cap_month_usd - self.month_spent_usd - self.reserved_usd
        return max(0.0, min(run_left, month_left))

    # -- the lock ----------------------------------------------------------------------------------------
    def check(self, estimate: float) -> None:
        """Refuse (raise ``BudgetExceeded``) when spend + estimate would pass a cap. Does not reserve."""
        with self._lock:
            self._check(estimate)

    def _check(self, estimate: float) -> None:
        run_cap = "backfill" if self.kind == "backfill" else "run"
        run_spent = self.run_spent_usd + self.reserved_usd
        if run_spent + estimate > self.run_limit:
            self.refused += 1
            raise BudgetExceeded(run_cap, run_spent, estimate, self.run_limit)
        if self.kind == "run":
            month_spent = self.month_spent_usd + self.reserved_usd
            if month_spent + estimate > self.cap_month_usd:
                self.refused += 1
                raise BudgetExceeded("month", month_spent, estimate, self.cap_month_usd)

    def reserve(self, estimate: float) -> "Reservation":
        """Check and hold ``estimate`` until the call's actual cost is booked (or the call failed)."""
        with self._lock:
            self._check(estimate)
            self.reserved_usd += estimate
        return Reservation(self, estimate)

    def _settle(self, estimate: float, actual: float | None, model: str, billed: bool,
                usage: Mapping[str, object] | None) -> Spend | None:
        with self._lock:
            self.reserved_usd = max(0.0, self.reserved_usd - estimate)
            if actual is None:
                return None
            actual = max(0.0, float(actual))
            self.run_spent_usd += actual
            if billed and self.kind == "run":
                self.month_spent_usd += actual
            self.calls += 1
            spend = Spend(usd=actual, estimate_usd=estimate, model=model, billed=billed,
                          kind=self.kind, usage=dict(usage or {}))
        if self.on_spend is not None and billed:
            self.on_spend(spend)
        return spend

    def summary(self) -> dict:
        with self._lock:
            return {"kind": self.kind, "run_spent_usd": round(self.run_spent_usd, 6),
                    "month_spent_usd": round(self.month_spent_usd, 6), "run_limit_usd": self.run_limit,
                    "cap_month_usd": self.cap_month_usd, "calls": self.calls, "refused": self.refused}


@dataclass
class Reservation:
    budget: Budget
    estimate: float
    done: bool = False

    def book(self, actual_usd: float, *, model: str, billed: bool = True,
             usage: Mapping[str, object] | None = None) -> Spend | None:
        """Book the actual cost. ``billed=False`` (dry adapter) counts toward the run only, never the month."""
        if self.done:
            raise RuntimeError("reservation already settled")
        self.done = True
        return self.budget._settle(self.estimate, actual_usd, model, billed, usage)

    def cancel(self) -> None:
        """The call never reached the provider: release the hold without booking anything."""
        if not self.done:
            self.done = True
            self.budget._settle(self.estimate, None, "", False, None)

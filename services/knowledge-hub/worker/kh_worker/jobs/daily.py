"""The daily summary job (design docs/roadmap-e-to-5-design.md 3.4).

For each project: ``GET /daily/next`` lists the project-days to (re)build with their logs. All days of all
projects go to the model as one ``complete_many`` (one Message Batch at half price on the ``anthropic``
adapter), packed to what the run budget has left; days that do not fit are deferred to the next night. The
model returns the four parts as separate fields and the code composes the text, so the fixed labels
(``Done:`` / ``Decided:`` / ``Broken or open:`` / ``Who:``), their order and the 1,200-char cap always hold.
Each day is then sent with ``POST /daily/submit`` (``dry_run`` forced by the client in dry mode).

Failures. A day whose model answer failed is retried once in a second batch. A day KH refuses (leak gate,
validation) gets one synchronous repair with KH's reason. A ``write_conflict`` (a newer summary is there) is
skipped. Anything else stays for the next night: ``/daily/next`` serves the day again.

Dry mode: KH writes nothing; the text and verdict of each day go to ``kh_people`` as a ``worker.run`` event.
"""
from __future__ import annotations

import logging
import re
from typing import Any

from ..budget import BudgetExceeded
from ..khclient import BudgetRefused, KHError
from ..llm import AnthropicLLM, LLMError, LLMRequest
from . import data_block, env_int, load_prompt, short

log = logging.getLogger("kh_worker.jobs.daily")

TEXT_MAX = 1200
PARTS = (("done", "Done"), ("decided", "Decided"), ("broken_or_open", "Broken or open"), ("who", "Who"))
MAX_TOKENS = 4000         # KH_WORKER_DAILY_MAX_TOKENS; a summary is ~400 tokens, the rest is thinking room
NONE_TEXT = "none"

SCHEMA = {"type": "object",
          "properties": {**{k: {"type": "string"} for k, _ in PARTS},
                         "source_ids": {"type": "array", "items": {"type": "string"}}},
          "required": [k for k, _ in PARTS] + ["source_ids"], "additionalProperties": False}

_LABEL = re.compile(r"^\s*(" + "|".join(re.escape(lbl) for _, lbl in PARTS) + r")\s*:\s*", re.I)
_SEP = "; "


# ---------------------------------------------------------------------------------------------- text
def _clean(raw: Any) -> str:
    t = " ".join(str(raw or "").split())               # one line per part: no inner line can look like a label
    t = _LABEL.sub("", t, count=1).strip()             # the model repeated the label
    return t or NONE_TEXT


def _cut(text: str, n: int) -> str:
    if len(text) <= n:
        return text
    n = max(n, 8)
    head = text[:n - 3]
    if " " in head[n // 2:]:
        head = head.rsplit(" ", 1)[0]
    return head.rstrip(" ,;:") + "..."


def compose(out: dict) -> str:
    """The four parts with KH's fixed labels, cut to TEXT_MAX by shortening the longest part first."""
    parts = [[label, _clean(out.get(key))] for key, label in PARTS]
    overhead = sum(len(label) + 2 for label, _ in parts) + len(parts) - 1
    room = TEXT_MAX - overhead
    while sum(len(p[1]) for p in parts) > room:
        excess = sum(len(p[1]) for p in parts) - room
        longest = max(parts, key=lambda p: len(p[1]))
        before = len(longest[1])
        longest[1] = _cut(longest[1], max(8, before - excess))
        if len(longest[1]) >= before:              # cannot shrink further
            longest[1] = longest[1][:max(1, before - excess)]
    return "\n".join(f"{label}: {text}" for label, text in parts)


# ---------------------------------------------------------------------------------------------- prompt
def build_user(project: str, day: dict, tz: str, rules: str) -> str:
    data = {"project": project, "day": day.get("day"), "tz": tz, "log_count": day.get("log_count"),
            "sampled": day.get("sampled", False), "logs": day.get("logs") or [], "listing": day.get("listing"),
            "rules": rules}
    return (f"Summarise project '{project}' on {day.get('day')} ({tz}) in the four parts of the system prompt. "
            f"Answer with one JSON object.\n\n{data_block('daily-day', data)}\n")


class _Day:
    def __init__(self, project: str, day: dict, tz: str, rules: str):
        self.project, self.day, self.tz, self.rules = project, day, tz, rules
        self.key = f"{project}|{day.get('day')}"
        self.user = build_user(project, day, tz, rules)
        self.log_ids = [lg.get("id") for lg in day.get("logs") or [] if lg.get("id")]
        self.cost = 0.0
        self.note = ""

    def request(self, max_tokens: int) -> LLMRequest:
        return LLMRequest(load_prompt("daily"), self.user + self.note, SCHEMA, max_tokens, custom_id=self.key)


def _fit(ctx, days: list[_Day], max_tokens: int) -> tuple[list[_Day], list[_Day]]:
    """Days whose estimates fit what the run budget has left, in order; the rest is deferred."""
    batch = bool(getattr(ctx.llm, "batch_discount", False)) and isinstance(getattr(ctx.llm, "llm", None),
                                                                          AnthropicLLM)
    room = ctx.budget.remaining_usd()
    take, rest, used = [], [], 0.0
    for d in days:
        r = d.request(max_tokens)
        est = ctx.llm.estimate(r.system, r.user, r.schema, r.max_tokens, batch=batch)
        if not rest and used + est <= room:
            take.append(d)
            used += est
        else:
            rest.append(d)
    return take, rest


def _answers(ctx, days: list[_Day], max_tokens: int) -> dict[str, Any]:
    """complete_many over ``days``; returns key -> result (or the error text)."""
    if not days:
        return {}
    results = ctx.llm.complete_many([d.request(max_tokens) for d in days])
    by_key = {d.key: d for d in days}
    out: dict[str, Any] = {}
    for r in results:
        d = by_key.get(r.custom_id)
        if d is None:
            continue
        if r.billed:
            d.cost += r.cost_usd
        out[d.key] = r if (r.json is not None and not r.error and isinstance(r.json, dict)) else (r.error or "no answer")
    return out


def _body(d: _Day, ans: dict, model: str) -> dict:
    served = set(d.log_ids)
    src = [s for s in dict.fromkeys(ans.get("source_ids") or []) if isinstance(s, str) and s in served]
    return {"project": d.project, "day": d.day.get("day"), "text": compose(ans), "source_ids": src or d.log_ids,
            "model": model, "cost_usd": round(d.cost, 6), "built_from_ms": d.day.get("built_from_ms"),
            "rev": d.day.get("rev", 0)}


def _event(ctx, d: _Day, body: dict, verdict: dict) -> None:
    try:
        ctx.kh.append_event("worker.run", {"job": "daily", **{k: body.get(k) for k in
                                                              ("project", "day", "text", "model", "cost_usd")},
                                           "source_count": len(body.get("source_ids") or []), "verdict": verdict},
                            project=d.project, event_id=f"worker.run:{ctx.kh.run_id}:{d.key}")
    except Exception as exc:  # noqa: BLE001
        log.warning("daily %s: worker.run event not written: %s", d.key, exc)


def _submit(ctx, d: _Day, ans: dict, model: str, res: dict) -> str:
    """Submit one day, with one repair on a refusal. Returns the outcome for the tally."""
    for attempt in (1, 2):
        body = _body(d, ans, model)
        try:
            resp = ctx.kh.daily_submit(body)
        except BudgetRefused:
            raise
        except KHError as exc:
            if exc.status == 409 or exc.code == "write_conflict":
                return "conflict"
            if attempt == 2 or exc.code not in ("leak_refused", "validation_failed"):
                res["errors"][d.key] = short(exc)
                return "refused" if exc.code in ("leak_refused", "validation_failed") else "error"
            d.note = (f"\n\nKH refused your previous summary: {exc}. Its text was:\n{body['text']}\n"
                      "Write it again without what was refused.")
            try:
                n0 = len(ctx.llm.log)
                r = ctx.llm.complete(load_prompt("daily"), d.user + d.note, SCHEMA,
                                     max_tokens=min(ctx.max_tokens, MAX_TOKENS))
            except LLMError as err:
                d.cost += sum(e["usd"] for e in ctx.llm.log[n0:] if e.get("billed"))
                res["errors"][d.key] = f"repair: {short(err)}"
                return "refused"
            d.cost += r.cost_usd if r.billed else 0.0
            if not isinstance(r.json, dict):
                return "refused"
            ans, model = r.json, r.model
            res["repaired"] += 1
            continue
        if ctx.dry or resp.get("dry_run"):
            _event(ctx, d, body, {k: resp.get(k) for k in ("result", "verdicts", "dry_run")})
            return "dry_run"
        return "accepted"
    return "refused"


def run(ctx) -> dict:
    max_tokens = min(ctx.max_tokens, env_int("KH_WORKER_DAILY_MAX_TOKENS", MAX_TOKENS))
    out: dict[str, Any] = {"projects": {}, "repaired": 0, "errors": {}, "outcomes": {}}
    status = "ok"
    days: list[_Day] = []
    for project in ctx.projects:
        if ctx.should_stop():
            out["status"] = "lease_lost"
            return out
        p = out["projects"][project] = {"days": 0}
        try:
            nxt = ctx.kh.daily_next(project)
        except BudgetRefused as exc:
            out.update(status="kh_budget", error=str(exc))
            return out
        except Exception as exc:  # noqa: BLE001 - one project's failure must not stop the others
            p["error"] = short(exc)
            status = "partial"
            continue
        for d in nxt.get("days") or []:
            if d.get("logs"):
                days.append(_Day(project, d, nxt.get("tz") or "", nxt.get("rules") or ""))
                p["days"] += 1
    out["days"] = len(days)
    if ctx.projects and all("error" in p for p in out["projects"].values()):
        out["status"] = "error"                       # no project could even be read
        return out
    if not days:
        out["status"] = status
        return out

    try:
        take, deferred = _fit(ctx, days, max_tokens)
        out["deferred"] = [d.key for d in deferred]
        if not take:
            raise BudgetExceeded("run", ctx.budget.run_spent_usd, 0.0, ctx.budget.run_limit)
        got = _answers(ctx, take, max_tokens)
        again = [d for d in take if not hasattr(got.get(d.key), "json")]
        if again and not ctx.should_stop():
            for d in again:
                d.note = f"\n\nYour previous answer failed ({got.get(d.key)}). Answer again with the JSON object."
            retry, more = _fit(ctx, again, max_tokens)
            out["deferred"] += [d.key for d in more]
            got.update(_answers(ctx, retry, max_tokens))
    except BudgetExceeded as exc:
        out.update(status="budget", cap=exc.cap, error=str(exc))
        return out
    except LLMError as exc:
        out.update(status="error", error=short(exc))
        return out

    for d in take:
        if ctx.should_stop():
            status = "lease_lost"
            break
        r = got.get(d.key)
        if not hasattr(r, "json"):
            outcome = "failed"
            out["errors"][d.key] = str(r)[:300]
        else:
            d.note = ""
            try:
                outcome = _submit(ctx, d, r.json, r.model, out)
            except BudgetRefused as exc:
                out.update(status="kh_budget", error=str(exc))
                return out
            except BudgetExceeded as exc:
                out.update(status="budget", cap=exc.cap, error=str(exc))
                return out
        out["outcomes"][outcome] = out["outcomes"].get(outcome, 0) + 1
        out["projects"][d.project].setdefault("outcomes", {})[d.day.get("day")] = outcome
    if status == "ok" and (out["errors"] or out.get("deferred")):
        status = "partial"
    out["status"] = status
    return out

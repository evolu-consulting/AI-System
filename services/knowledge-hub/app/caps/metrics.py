"""Outcome metrics, baselines, comparisons and the automatic item rollback (design 4.10 + 4.8, slice F8).

  POST /v1/{ns}/metrics                    {observations:[...]} | [...] | one observation   (batch <= 1,000)
  GET  /v1/{ns}/metrics?series=&project=&run_id=&unit_id=&baseline=&from=&to=&limit=&offset=
  GET  /v1/{ns}/metrics:aggregate?series=&group_by=&window=&from=&to=&project=&baseline=
  POST /v1/{ns}/metrics:compare            {series, a:{filter}, b:{filter}, test?, per_unit?}
                                           -> {n_a, n_b, mean_a, mean_b, rel_delta, p, test, z, ...}
  POST /v1/{ns}/metrics:rollback           {dry_run?, item_ids?}  run the rollback check now (admin, orchestrator)

SERIES ARE DECLARED. A series is a manifest type with ``kind_of: metric``. Its JSON Schema (optional) validates the
observation's ``dims``; ``read_roles`` / ``write_roles`` narrow the role matrix; ``fenced`` requires X-KH-Lease /
X-KH-Epoch; ``retention_days`` prunes raw rows (the daily rollup stays). Manifest ``settings.metrics``:
``{series: {<name>: {scale: binary|real, dir: up|down}}, rollback: {enabled, min_n, min_rel, alpha, window_days,
control: not_served|pre_activation, test: auto|proportion|mann_whitney}}``. ``scale: binary`` refuses values
other than 0 / 1.

AN OBSERVATION: ``{series, value, ts_ms?, unit_id?, run_id?, project?, dims?, baseline?}``. ``unit_id`` / ``run_id``
default to the X-KH-Unit / X-KH-Run headers, ``ts_ms`` to the database clock. The whole batch passes
``redact.scrub`` first (outside any transaction) and is validated all-or-nothing (422 with index + pointer).

IDEMPOTENT. PK (ns, series, ts_ms, unit_id): the first insert wins; a repeat with the same value is
``duplicate``, with another value ``conflict`` (the stored value is kept; both are reported per row and counted
in one ``kh.duplicate`` event). Idempotency-Key replays the whole response. The daily rollup ``kh_metric_day``
(n, sum, sum of squares per project / series / day / baseline flag) is updated in the same transaction, only for
rows that were really inserted.

BASELINES are rows with ``baseline: true`` (a human or reference run); ``:compare`` with ``a:{baseline:true}``,
``b:{baseline:false}`` is "human baseline vs line". ``:aggregate`` groups by ``day``, ``week``, ``project``,
``baseline``, ``run_id``, ``unit_id`` or ``dims.<name>``; day/week/project/baseline over whole days reads the
rollup, everything else the raw rows (at most RAW_MAX).

STATISTICS (stdlib, deterministic): two-proportion z-test when every value is 0/1 (or the series is
``scale: binary``), otherwise Mann-Whitney U with tie correction (normal approximation). Two-sided p.
``rel_delta = (mean_b - mean_a) / |mean_a|``.

ROLLBACK (D12). The ``metrics_rollback`` cron (every 6 h, KH lease, plus a per-namespace lease shared with the
``:rollback`` route) checks every active item with a ``guard_metric``. Window: ``window_days`` (14) before
``activated_ms`` until now; non-baseline observations of the guard series with a unit id, the latest one per unit,
from the item's project (a cross item: every project). Treatment = units a ``kh.served`` event served the item to
(join on the event's unit_id and body ``item_ids``); control = the other units (``control: pre_activation``:
only units observed before activation). It FIRES when both sides have n >= min_n (30), the treatment is worse by
>= min_rel (10 %) relative in the item's ``metric_dir`` and p < alpha (0.05). Then the item goes active ->
contested -> withdrawn through ``items.transition`` with reason ``auto_rollback`` and KH writes
``kh.item_rollback``. A crash between the two steps is finished by the next run.

Column names ``val`` / ``day_no`` / ``vsum`` / ``vsumsq`` stand for the design's value / day / sum / sumsq (keeps
clear of HANA keywords).
"""
from __future__ import annotations

import asyncio
import json
import logging
import math
import secrets
from types import SimpleNamespace
from typing import Any

from fastapi import Depends, Request

from app import config, sqldb
from app.caps import core, registry
from app.caps.core import CapError, Caller, Ctx, ns_ctx

logger = logging.getLogger(__name__)

NAME = "metrics"
VERSION = "1.0.0"
STATUS = "beta"
BATCH_MAX = 1000
RAW_MAX = 200_000
SERVED_SCAN_MAX = 500_000
LIST_MAX = 1000
DIMS_MAX = 16
DIMS_BYTES = 4096
DAY_MS = 86_400_000
ROLLBACK_INTERVAL_S = int(config._env("KH_METRICS_ROLLBACK_S", str(6 * 3600)))
ROLLBACK_DEFAULTS = {"enabled": True, "min_n": 30, "min_rel": 0.10, "alpha": 0.05, "window_days": 14,
                     "control": "not_served", "test": "auto"}
LIMITS = {"batch_max": BATCH_MAX, "raw_rows_max": RAW_MAX, "dims_max": DIMS_MAX,
          "rollback_interval_s": ROLLBACK_INTERVAL_S, "rollback": dict(ROLLBACK_DEFAULTS)}
TESTS = ("auto", "proportion", "mann_whitney")
SYSTEM = "kh:metrics"
OBS_FIELDS = {"series", "value", "ts_ms", "unit_id", "run_id", "project", "dims", "baseline"}
FILTER_FIELDS = {"project", "run_id", "unit_ids", "baseline", "from", "to", "dims", "served_item", "not_served_item"}
GROUPS = {"day", "week", "project", "baseline", "run_id", "unit_id"}
ROLLUP_GROUPS = {"day", "week", "project", "baseline"}

_DDL = {
    "kh_metric": ("""CREATE TABLE IF NOT EXISTS kh_metric (
                       ns TEXT NOT NULL, series TEXT NOT NULL, ts_ms INTEGER NOT NULL, unit_id TEXT NOT NULL,
                       project TEXT NOT NULL, val REAL NOT NULL, run_id TEXT, dims_json TEXT NOT NULL,
                       is_baseline INTEGER NOT NULL, actor_json TEXT NOT NULL, received_ms INTEGER NOT NULL,
                       PRIMARY KEY (ns, series, ts_ms, unit_id))""",
                  """CREATE COLUMN TABLE kh_metric (
                       ns NVARCHAR(32) NOT NULL, series NVARCHAR(128) NOT NULL, ts_ms BIGINT NOT NULL,
                       unit_id NVARCHAR(128) NOT NULL, project NVARCHAR(256) NOT NULL, val DOUBLE NOT NULL,
                       run_id NVARCHAR(128), dims_json NCLOB NOT NULL, is_baseline BIGINT NOT NULL,
                       actor_json NCLOB NOT NULL, received_ms BIGINT NOT NULL,
                       PRIMARY KEY (ns, series, ts_ms, unit_id))"""),
    "kh_metric_day": ("""CREATE TABLE IF NOT EXISTS kh_metric_day (
                           ns TEXT NOT NULL, project TEXT NOT NULL, series TEXT NOT NULL, day_no INTEGER NOT NULL,
                           is_baseline INTEGER NOT NULL, n INTEGER NOT NULL, vsum REAL NOT NULL,
                           vsumsq REAL NOT NULL, PRIMARY KEY (ns, project, series, day_no, is_baseline))""",
                      """CREATE COLUMN TABLE kh_metric_day (
                           ns NVARCHAR(32) NOT NULL, project NVARCHAR(256) NOT NULL, series NVARCHAR(128) NOT NULL,
                           day_no BIGINT NOT NULL, is_baseline BIGINT NOT NULL, n BIGINT NOT NULL,
                           vsum DOUBLE NOT NULL, vsumsq DOUBLE NOT NULL,
                           PRIMARY KEY (ns, project, series, day_no, is_baseline))"""),
}


def _m1(c) -> None:
    for name, (lite, hana) in _DDL.items():
        sqldb.create_table(c, name, lite, hana)
    sqldb.create_index(c, "ix_kh_metric_unit", "kh_metric", "ns, series, unit_id")
    sqldb.create_index(c, "ix_kh_metric_run", "kh_metric", "ns, run_id")
    sqldb.create_index(c, "ix_kh_metric_proj", "kh_metric", "ns, series, project, ts_ms")


def init(c) -> None:
    sqldb.migrate(c, NAME, [(1, _m1)])


# ── manifest settings ────────────────────────────────────────────────────────

def settings(ns_row: dict) -> dict:
    s = ((ns_row.get("config") or {}).get("settings") or {}).get("metrics") or {}
    return s if isinstance(s, dict) else {}


def series_conf(ns_row: dict, series: str) -> dict:
    s = (settings(ns_row).get("series") or {}).get(series) or {}
    return s if isinstance(s, dict) else {}


def rollback_conf(ns_row: dict) -> dict:
    s = settings(ns_row).get("rollback") or {}
    out = dict(ROLLBACK_DEFAULTS)
    if isinstance(s, dict):
        out.update({k: v for k, v in s.items() if k in ROLLBACK_DEFAULTS})
    return out


# ── statistics (stdlib, deterministic) ───────────────────────────────────────

def _p_two_sided(z: float) -> float:
    return math.erfc(abs(z) / math.sqrt(2.0))


def _mean_sd(xs: list[float]) -> tuple[float | None, float | None]:
    if not xs:
        return None, None
    m = math.fsum(xs) / len(xs)
    if len(xs) < 2:
        return m, None
    return m, math.sqrt(math.fsum((x - m) ** 2 for x in xs) / (len(xs) - 1))


def two_proportion(a: list[float], b: list[float]) -> tuple[float | None, float | None]:
    """Pooled two-proportion z-test on 0/1 samples: (z, two-sided p); (None, None) when a side is empty."""
    n1, n2 = len(a), len(b)
    if not n1 or not n2:
        return None, None
    x1, x2 = sum(1 for v in a if v), sum(1 for v in b if v)
    p = (x1 + x2) / (n1 + n2)
    se = math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2))
    if se == 0:
        return 0.0, 1.0
    z = (x2 / n2 - x1 / n1) / se
    return z, _p_two_sided(z)


def mann_whitney(a: list[float], b: list[float]) -> tuple[float | None, float | None]:
    """Mann-Whitney U with average ranks for ties and the tie-corrected variance (normal approximation).
    Returns (z, two-sided p); z > 0 means b tends to be larger."""
    n1, n2 = len(a), len(b)
    if not n1 or not n2:
        return None, None
    pooled = sorted([(v, 0) for v in a] + [(v, 1) for v in b], key=lambda t: t[0])
    n = n1 + n2
    rank_b = 0.0
    ties = 0.0
    i = 0
    while i < n:
        j = i
        while j + 1 < n and pooled[j + 1][0] == pooled[i][0]:
            j += 1
        avg = (i + j) / 2.0 + 1.0
        t = j - i + 1
        ties += t ** 3 - t
        rank_b += avg * sum(1 for k in range(i, j + 1) if pooled[k][1] == 1)
        i = j + 1
    u_b = rank_b - n2 * (n2 + 1) / 2.0
    mu = n1 * n2 / 2.0
    var = n1 * n2 / 12.0 * ((n + 1) - (ties / (n * (n - 1)) if n > 1 else 0.0))
    if var <= 0:
        return 0.0, 1.0
    z = (u_b - mu) / math.sqrt(var)
    return z, _p_two_sided(z)


def is_binary(xs: list[float]) -> bool:
    return all(v in (0.0, 1.0) for v in xs)


def compare_values(a: list[float], b: list[float], test: str = "auto") -> dict:
    """THE comparison helper (``:compare`` and the rollback use it). a = reference, b = candidate."""
    if test == "auto":
        test = "proportion" if is_binary(a) and is_binary(b) else "mann_whitney"
    z, p = (two_proportion if test == "proportion" else mann_whitney)(a, b)
    ma, sa = _mean_sd(a)
    mb, sb = _mean_sd(b)
    rel = None
    if ma is not None and mb is not None:
        rel = (mb - ma) / abs(ma) if ma != 0 else (0.0 if mb == ma else math.copysign(math.inf, mb - ma))
    return {"n_a": len(a), "n_b": len(b), "mean_a": ma, "mean_b": mb, "sd_a": sa, "sd_b": sb,
            "abs_delta": None if ma is None or mb is None else mb - ma, "rel_delta": rel, "test": test,
            "z": z, "p": p}


def _json_safe(d: dict) -> dict:
    """inf is not JSON: report it as a string."""
    return {k: (("inf" if v > 0 else "-inf") if isinstance(v, float) and math.isinf(v) else v) for k, v in d.items()}


# ── write path ───────────────────────────────────────────────────────────────

def _scrub(ctx: Ctx, where: str, body):
    """REDACTION WRITE-PATH HOOK (design 4.11): OUTSIDE any transaction (scrub writes kh.* events)."""
    try:
        from app.caps import redact
    except ImportError:
        return body
    return redact.scrub(ctx, where, body)


def _num(v: Any) -> float | None:
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return None
    f = float(v)
    return f if math.isfinite(f) else None


def _observations(body: Any) -> list:
    if isinstance(body, list):
        return body
    if isinstance(body, dict) and isinstance(body.get("observations"), list):
        return body["observations"]
    if isinstance(body, dict) and "series" in body:
        return [body]
    raise CapError("invalid", "body must be {observations:[...]}, a list, or one observation")


def _prepare(ctx: Ctx, obs: list) -> tuple[list[dict], set[str]]:
    rows, errors, fenced = [], [], set()
    for i, o in enumerate(obs):
        def err(ptr: str, msg: str) -> None:
            errors.append({"index": i, "pointer": ptr, "message": msg})
        if not isinstance(o, dict):
            err("", "an observation must be an object")
            continue
        extra = sorted(set(o) - OBS_FIELDS)
        if extra:
            err("", f"unknown fields {extra}")
            continue
        series = o.get("series")
        if not isinstance(series, str) or not series:
            err("/series", "series is required")
            continue
        try:
            t = registry.type_of(ctx, series, kind_of="metric")
        except CapError as exc:
            err("/series", exc.detail)
            continue
        ctx.require("metrics", "write", type_row=t, op="write")
        if t["fenced"]:
            fenced.add(series)
        val = _num(o.get("value"))
        if val is None:
            err("/value", "value must be a finite number")
            continue
        if series_conf(ctx.ns_row, series).get("scale") == "binary" and val not in (0.0, 1.0):
            err("/value", f"series {series} is binary: value must be 0 or 1")
            continue
        ts = o.get("ts_ms")
        if ts is not None and (isinstance(ts, bool) or not isinstance(ts, int) or ts < 0):
            err("/ts_ms", "ts_ms must be epoch milliseconds")
            continue
        unit = o.get("unit_id", ctx.unit_id) or ""
        run = o.get("run_id", ctx.run_id)
        if not isinstance(unit, str) or len(unit) > 128 or (run is not None and (not isinstance(run, str)
                                                                                 or len(run) > 128)):
            err("/unit_id", "unit_id and run_id must be strings of at most 128 characters")
            continue
        dims = o.get("dims") or {}
        if not isinstance(dims, dict) or len(dims) > DIMS_MAX or not all(
                isinstance(v, (str, int, float, bool)) or v is None for v in dims.values()) \
                or len(core.jdump(dims)) > DIMS_BYTES:
            err("/dims", f"dims must be an object of at most {DIMS_MAX} scalar values ({DIMS_BYTES} bytes)")
            continue
        for e in registry.validate(ctx.ns, t, dims):
            err("/dims" + e["pointer"], e["message"])
        base = o.get("baseline", False)
        if not isinstance(base, bool):
            err("/baseline", "baseline must be true or false")
            continue
        try:
            project = ctx.require_project(o.get("project"))
        except CapError as exc:
            if exc.code != "invalid":
                raise                                    # 403 outside the grant stays a 403
            err("/project", exc.detail)
            continue
        rows.append({"index": i, "series": series, "ts_ms": ts, "unit_id": unit, "run_id": run, "val": val,
                     "project": project, "dims_json": core.jdump(dims), "is_baseline": 1 if base else 0})
    if errors:
        raise CapError("validation_failed", f"{len(errors)} observation(s) are invalid", extra={"errors": errors[:200]})
    return rows, fenced


def _rollup(c, ns: str, rows: list[dict]) -> None:
    acc: dict[tuple, list] = {}
    for r in rows:
        k = (r["project"], r["series"], r["ts_ms"] // DAY_MS, r["is_baseline"])
        a = acc.setdefault(k, [0, 0.0, 0.0])
        a[0] += 1
        a[1] += r["val"]
        a[2] += r["val"] * r["val"]
    up = ("UPDATE kh_metric_day SET n=n+?, vsum=vsum+?, vsumsq=vsumsq+? "
          "WHERE ns=? AND project=? AND series=? AND day_no=? AND is_baseline=?")
    for (project, series, day, base), (n, s, sq) in acc.items():
        params = [n, s, sq, ns, project, series, day, base]
        if sqldb.update(c, up, params):
            continue
        if not sqldb.insert_new(c, "kh_metric_day", {"ns": ns, "project": project, "series": series, "day_no": day,
                                                     "is_baseline": base, "n": n, "vsum": s, "vsumsq": sq}):
            sqldb.update(c, up, params)


def record(ctx: Ctx, body: Any) -> dict:
    ctx.require("metrics", "write")
    obs = _observations(body)
    if not obs:
        raise CapError("invalid", "no observations")
    if len(obs) > BATCH_MAX:
        raise CapError("too_large", f"at most {BATCH_MAX} observations per call", extra={"limit": BATCH_MAX})
    obs = _scrub(ctx, "metrics", obs)
    rows, fenced = _prepare(ctx, obs)
    actor = core.jdump(ctx.actor())
    out, created = [], []
    with sqldb.connect() as c:
        now = sqldb.now_ms(c)
        for r in rows:
            r["ts_ms"] = now if r["ts_ms"] is None else r["ts_ms"]
            row = {k: r[k] for k in ("series", "ts_ms", "unit_id", "project", "val", "run_id", "dims_json",
                                     "is_baseline")}
            if sqldb.insert_new(c, "kh_metric", {"ns": ctx.ns, **row, "actor_json": actor, "received_ms": now}):
                status = "created"
                created.append(r)
            else:
                old = c.execute("SELECT val FROM kh_metric WHERE ns=? AND series=? AND ts_ms=? AND unit_id=?",
                                [ctx.ns, r["series"], r["ts_ms"], r["unit_id"]]).fetchone()
                status = "duplicate" if old is not None and float(old[0]) == r["val"] else "conflict"
            out.append({"index": r["index"], "series": r["series"], "ts_ms": r["ts_ms"], "unit_id": r["unit_id"],
                        "status": status})
        _rollup(c, ctx.ns, created)
        core.fence(ctx, c, required=bool(fenced))
    dups = [o for o in out if o["status"] != "created"]
    if dups:
        core.emit(ctx, "kh.duplicate", {"where": "metrics", "count": len(dups),
                                        "conflicts": sum(1 for d in dups if d["status"] == "conflict"),
                                        "keys": [{k: d[k] for k in ("series", "ts_ms", "unit_id")} for d in dups[:100]]})
    return {"accepted": out, "created": len(created), "duplicates": sum(1 for d in dups if d["status"] == "duplicate"),
            "conflicts": sum(1 for d in dups if d["status"] == "conflict")}


# ── read path ────────────────────────────────────────────────────────────────

def _visible_projects(ctx: Ctx, project: str | None) -> list[str] | None:
    """None = every project; a list = SQL IN. A project outside the grant reads as empty (never 403)."""
    allowed = ctx.caller.projects
    if project:
        return [project] if allowed is None or project in allowed else []
    return None if allowed is None else sorted(allowed)


def _in(col: str, vals: list) -> tuple[str, list]:
    if not vals:
        return " AND 1=0", []
    return f" AND {col} IN ({','.join('?' for _ in vals)})", list(vals)


def _parse_filter(f: Any, where: str) -> dict:
    if f is None:
        return {}
    if not isinstance(f, dict) or set(f) - FILTER_FIELDS:
        raise CapError("invalid", f"{where} must be an object with keys from {sorted(FILTER_FIELDS)}")
    for k in ("from", "to"):
        if f.get(k) is not None and (isinstance(f[k], bool) or not isinstance(f[k], int)):
            raise CapError("invalid", f"{where}.{k} must be epoch milliseconds")
    if f.get("baseline") is not None and not isinstance(f["baseline"], bool):
        raise CapError("invalid", f"{where}.baseline must be true or false")
    if f.get("unit_ids") is not None and (not isinstance(f["unit_ids"], list) or len(f["unit_ids"]) > 1000
                                          or not all(isinstance(u, str) for u in f["unit_ids"])):
        raise CapError("invalid", f"{where}.unit_ids must be a list of at most 1000 strings")
    if f.get("dims") is not None and not isinstance(f["dims"], dict):
        raise CapError("invalid", f"{where}.dims must be an object")
    for k in ("project", "run_id", "served_item", "not_served_item"):
        if f.get(k) is not None and not isinstance(f[k], str):
            raise CapError("invalid", f"{where}.{k} must be a string")
    return f


def load_obs(c, ns: str, series: str, projects: list[str] | None, f: dict) -> list[dict]:
    """Raw observations of one series by filter (SQL on columns, dims in code). At most RAW_MAX rows."""
    sql = ("SELECT project, ts_ms, val, unit_id, run_id, dims_json, is_baseline FROM kh_metric "
           "WHERE ns=? AND series=?")
    params: list = [ns, series]
    if projects is not None:
        s, p = _in("project", projects)
        sql, params = sql + s, params + p
    if f.get("run_id"):
        sql, params = sql + " AND run_id=?", params + [f["run_id"]]
    if f.get("unit_ids") is not None:
        s, p = _in("unit_id", f["unit_ids"])
        sql, params = sql + s, params + p
    if f.get("baseline") is not None:
        sql, params = sql + " AND is_baseline=?", params + [1 if f["baseline"] else 0]
    if f.get("from") is not None:
        sql, params = sql + " AND ts_ms>=?", params + [int(f["from"])]
    if f.get("to") is not None:
        sql, params = sql + " AND ts_ms<?", params + [int(f["to"])]
    rows = c.execute(sql + f" ORDER BY ts_ms LIMIT {RAW_MAX + 1}", params).fetchall()
    if len(rows) > RAW_MAX:
        raise CapError("too_large", f"more than {RAW_MAX} observations match: narrow the filter",
                       extra={"limit": RAW_MAX})
    dims_f = f.get("dims") or {}
    out = []
    for r in rows:
        dims = json.loads(r["dims_json"] or "{}")
        if any(dims.get(k) != v for k, v in dims_f.items()):
            continue
        out.append({"project": r["project"], "ts_ms": int(r["ts_ms"]), "value": float(r["val"]),
                    "unit_id": r["unit_id"], "run_id": r["run_id"], "dims": dims, "baseline": bool(r["is_baseline"])})
    return out


def served_units(c, ns: str, item_ids: set[str], since_ms: int | None = None) -> dict[str, set[str]]:
    """{item_id: {unit_id}} from the kh.served events (event unit_id x body item_ids) since ``since_ms``."""
    out: dict[str, set[str]] = {i: set() for i in item_ids}
    if not item_ids:
        return out
    sql = "SELECT unit_id, body_json FROM kh_event WHERE ns=? AND kind='kh.served' AND unit_id IS NOT NULL"
    params: list = [ns]
    if since_ms is not None:
        sql, params = sql + " AND ts_ms>=?", params + [int(since_ms)]
    cur = c.execute(sql + f" LIMIT {int(SERVED_SCAN_MAX)}", params)   # HANA fetches eagerly: bound it here
    seen = 0
    while True:
        batch = cur.fetchmany(5000)
        if not batch:
            break
        for r in batch:
            seen += 1
            try:
                ids = (json.loads(r["body_json"] or "{}") or {}).get("item_ids") or []
            except ValueError:
                continue
            for i in ids:
                if i in out and r["unit_id"]:
                    out[i].add(r["unit_id"])
        if seen >= SERVED_SCAN_MAX:
            logger.warning("metrics - %s: kh.served scan stopped at %d events", ns, seen)
            break
    return out


def per_unit_latest(rows: list[dict]) -> dict[str, dict]:
    """The latest observation per unit (rows without a unit are dropped)."""
    out: dict[str, dict] = {}
    for r in rows:
        u = r["unit_id"]
        if u and (u not in out or r["ts_ms"] >= out[u]["ts_ms"]):
            out[u] = r
    return out


def list_obs(ctx: Ctx, series: str, project: str, run_id: str, unit_id: str, baseline: str, frm: int | None,
             to: int | None, limit: int, offset: int) -> dict:
    t = registry.type_of(ctx, series, kind_of="metric")
    ctx.require("metrics", "read", type_row=t, op="read")
    f = {"run_id": run_id or None, "unit_ids": [unit_id] if unit_id else None, "from": frm, "to": to,
         "baseline": _bool_q(baseline)}
    with sqldb.connect() as c:
        rows = load_obs(c, ctx.ns, series, _visible_projects(ctx, project), f)
    return {"series": series, "total": len(rows), "observations": rows[offset:offset + limit]}


def _bool_q(v: str | None) -> bool | None:
    if v in (None, ""):
        return None
    if v.lower() in ("1", "true", "yes"):
        return True
    if v.lower() in ("0", "false", "no"):
        return False
    raise CapError("invalid", "baseline must be true or false")


def _group_key(row: dict, groups: list[str]) -> tuple:
    out = []
    for g in groups:
        if g == "day":
            out.append(row["ts_ms"] // DAY_MS * DAY_MS)
        elif g == "week":
            d = row["ts_ms"] // DAY_MS
            out.append((d - (d + 3) % 7) * DAY_MS)       # epoch day 0 was a Thursday: weeks start on Monday
        elif g.startswith("dims."):
            out.append(row["dims"].get(g[5:]))
        else:
            out.append(row[g])
    return tuple(out)


def _stats(n: int, s: float, sq: float) -> dict:
    mean = s / n if n else None
    sd = math.sqrt(max(0.0, (sq - s * s / n) / (n - 1))) if n > 1 else None
    return {"n": n, "sum": s, "mean": mean, "sd": sd}


def aggregate(ctx: Ctx, series: str, group_by: str, window: str, frm: int | None, to: int | None, project: str,
              baseline: str) -> dict:
    t = registry.type_of(ctx, series, kind_of="metric")
    ctx.require("metrics", "read", type_row=t, op="read")
    groups = [g.strip() for g in (group_by or "").split(",") if g.strip()]
    if window:
        if window not in ("day", "week"):
            raise CapError("invalid", "window must be day or week")
        groups = [window] + [g for g in groups if g != window]
    bad = [g for g in groups if g not in GROUPS and not (g.startswith("dims.") and len(g) > 5)]
    if bad or len(groups) > 4:
        raise CapError("invalid", f"group_by: at most 4 of {sorted(GROUPS)} or dims.<name>; bad: {bad}")
    base = _bool_q(baseline)
    projects = _visible_projects(ctx, project)
    aligned = all(x is None or x % DAY_MS == 0 for x in (frm, to))
    acc: dict[tuple, list] = {}
    with sqldb.connect() as c:
        if set(groups) <= ROLLUP_GROUPS and aligned:
            source = "rollup"
            sql = "SELECT project, day_no, is_baseline, n, vsum, vsumsq FROM kh_metric_day WHERE ns=? AND series=?"
            params: list = [ctx.ns, series]
            if projects is not None:
                s, p = _in("project", projects)
                sql, params = sql + s, params + p
            if base is not None:
                sql, params = sql + " AND is_baseline=?", params + [1 if base else 0]
            if frm is not None:
                sql, params = sql + " AND day_no>=?", params + [frm // DAY_MS]
            if to is not None:
                sql, params = sql + " AND day_no<?", params + [to // DAY_MS]
            for r in c.execute(sql, params).fetchall():
                row = {"project": r["project"], "ts_ms": int(r["day_no"]) * DAY_MS, "baseline": bool(r["is_baseline"])}
                a = acc.setdefault(_group_key(row, groups), [0, 0.0, 0.0])
                a[0] += int(r["n"])
                a[1] += float(r["vsum"])
                a[2] += float(r["vsumsq"])
        else:
            source = "raw"
            for row in load_obs(c, ctx.ns, series, projects, {"from": frm, "to": to, "baseline": base}):
                a = acc.setdefault(_group_key(row, groups), [0, 0.0, 0.0])
                a[0] += 1
                a[1] += row["value"]
                a[2] += row["value"] ** 2
    out = [{"key": dict(zip(groups, k)), **_stats(*v)}
           for k, v in sorted(acc.items(), key=lambda kv: tuple("" if x is None else str(x) for x in kv[0]))]
    return {"series": series, "group_by": groups, "source": source, "groups": out}


def _filtered_values(c, ctx: Ctx, series: str, f: dict, per_unit: bool) -> list[float]:
    rows = load_obs(c, ctx.ns, series, _visible_projects(ctx, f.get("project")), f)
    item = f.get("served_item") or f.get("not_served_item")
    if item:
        units = served_units(c, ctx.ns, {item}, f.get("from"))[item]
        keep = bool(f.get("served_item"))
        rows = [r for r in rows if r["unit_id"] and ((r["unit_id"] in units) == keep)]
    if per_unit:
        rows = list(per_unit_latest(rows).values())
    return [r["value"] for r in rows]


def compare(ctx: Ctx, body: Any) -> dict:
    if not isinstance(body, dict) or not isinstance(body.get("series"), str):
        raise CapError("invalid", "body must be {series, a:{filter}, b:{filter}, test?, per_unit?}")
    series = body["series"]
    t = registry.type_of(ctx, series, kind_of="metric")
    ctx.require("metrics", "read", type_row=t, op="read")
    fa, fb = _parse_filter(body.get("a"), "a"), _parse_filter(body.get("b"), "b")
    if (fa.get("served_item") or fa.get("not_served_item") or fb.get("served_item") or fb.get("not_served_item")):
        ctx.require("items", "read")
    test = body.get("test") or series_conf(ctx.ns_row, series).get("test") or (
        "proportion" if series_conf(ctx.ns_row, series).get("scale") == "binary" else "auto")
    if test not in TESTS:
        raise CapError("invalid", f"test must be one of {list(TESTS)}")
    per_unit = bool(body.get("per_unit", False))
    with sqldb.connect() as c:
        a = _filtered_values(c, ctx, series, fa, per_unit)
        b = _filtered_values(c, ctx, series, fb, per_unit)
    if test == "proportion" and not (is_binary(a) and is_binary(b)):
        raise CapError("invalid", "the proportion test needs 0/1 values")
    return {"series": series, "per_unit": per_unit, **_json_safe(compare_values(a, b, test))}


# ── automatic rollback ───────────────────────────────────────────────────────

def _system_ctx(ns_row: dict, kind: str, rev: int) -> Ctx:
    """ADAPTER: items.transition takes a request Ctx (If-Match, fencing headers). KH's own rollback is the namespace
    admin acting as ``kh:metrics``, conditional on the revision it evaluated. A fenced item type would demand the
    consumer's lease headers, which KH never holds, so the system context sees the type unfenced."""
    types = dict(ns_row.get("types") or {})
    if kind in types:
        types[kind] = {**types[kind], "fenced": False}
    row = {**ns_row, "types": types}
    req = SimpleNamespace(headers={"if-match": core.etag(rev)}, method="PATCH",
                          url=SimpleNamespace(path=f"/v1/{ns_row['ns']}/items:auto_rollback", query=""))
    return Ctx(ns=ns_row["ns"], ns_row=row, caller=Caller(principal=SYSTEM, role=core.ADMIN, kind="service"),
               request=req)


def _withdraw(ns_row: dict, it: dict) -> tuple[str | None, dict | None]:
    """active -> contested -> withdrawn (reason auto_rollback) through the items module. (error code, item)."""
    from app.caps import items
    cur = it
    try:
        for to in (["contested", "withdrawn"] if cur["status"] == "active" else ["withdrawn"]):
            _, out = items.transition(_system_ctx(ns_row, cur["kind"], cur["rev"]), cur["item_id"],
                                      {"status": to, "reason": "auto_rollback"})
            cur = {**cur, "status": out["item"]["status"], "rev": out["item"]["rev"]}
    except CapError as exc:
        exc.emit_events()
        return exc.code, None
    return None, cur


def _guarded_items(c, ns: str, ids: list[str] | None) -> list[dict]:
    sql = ("SELECT item_id, kind, project, scope, status, status_reason, guard_metric, metric_dir, activated_ms, rev "
           "FROM kh_item WHERE ns=? AND guard_metric IS NOT NULL AND activated_ms IS NOT NULL "
           "AND (status='active' OR (status='contested' AND status_reason='auto_rollback'))")
    params: list = [ns]
    if ids:
        s, p = _in("item_id", ids)
        sql, params = sql + s, params + p
    return [{k: r[k] for k in r.keys()} for r in c.execute(sql + " ORDER BY item_id", params).fetchall()]


def evaluate(ns_row: dict, it: dict, obs: list[dict], served: set[str], conf: dict) -> dict:
    """The D12 rule for one item over its window's observations. Pure (the synthetic test drives it directly)."""
    series = it["guard_metric"]
    sc = series_conf(ns_row, series)
    direction = it.get("metric_dir") or sc.get("dir") or "up"
    latest = per_unit_latest([o for o in obs if not o["baseline"]])
    act = int(it["activated_ms"])
    if conf["control"] == "pre_activation":
        treat = [r["value"] for u, r in latest.items() if u in served and r["ts_ms"] >= act]
        ctrl = [r["value"] for u, r in latest.items() if u not in served and r["ts_ms"] < act]
    else:
        treat = [r["value"] for u, r in latest.items() if u in served]
        ctrl = [r["value"] for u, r in latest.items() if u not in served]
    test = conf.get("test") or "auto"
    if test == "auto" and sc.get("scale") == "binary":
        test = "proportion"
    if test not in TESTS or (test == "proportion" and not (is_binary(treat) and is_binary(ctrl))):
        test = "auto"
    st = compare_values(ctrl, treat, test)
    min_n, min_rel, alpha = int(conf["min_n"]), float(conf["min_rel"]), float(conf["alpha"])
    rel = st["rel_delta"]
    worse = rel is not None and (rel <= -min_rel if direction == "up" else rel >= min_rel)
    enough = st["n_a"] >= min_n and st["n_b"] >= min_n
    significant = st["p"] is not None and st["p"] < alpha
    decision = "fire" if enough and worse and significant else (
        "insufficient" if not enough else "not_worse" if not worse else "not_significant")
    return {"item_id": it["item_id"], "series": series, "dir": direction, "decision": decision,
            "n_served": st["n_b"], "n_control": st["n_a"], "mean_served": st["mean_b"], "mean_control": st["mean_a"],
            "rel_delta": rel, "p": st["p"], "z": st["z"], "test": st["test"], "control": conf["control"],
            "thresholds": {"min_n": min_n, "min_rel": min_rel, "alpha": alpha}}


def rollback_check(ns: str, dry_run: bool = False, item_ids: list[str] | None = None) -> dict:
    """Run the D12 rollback for one namespace under the per-namespace lease ('_kh', metrics_rollback:<ns>)."""
    registry.invalidate(ns)
    ns_row = registry.ns_state(ns)
    if ns_row is None or ns_row["state"] != "active":
        return {"ns": ns, "skipped": "ns_not_active", "checked": 0, "fired": 0, "items": []}
    conf = rollback_conf(ns_row)
    if not conf.get("enabled", True):
        return {"ns": ns, "skipped": "disabled", "checked": 0, "fired": 0, "items": []}
    lease = f"metrics_rollback:{ns}"
    holder = f"{sqldb.instance_id()}:{secrets.token_hex(4)}"
    with sqldb.connect() as c:
        got = sqldb.lease_acquire(c, sqldb.KH_NS, lease, holder, 15 * 60 * 1000)
    if got is None:
        return {"ns": ns, "skipped": "busy", "checked": 0, "fired": 0, "items": []}
    results: list[dict] = []
    try:
        with sqldb.connect() as c:
            its = _guarded_items(c, ns, item_ids)
            window = int(conf["window_days"]) * DAY_MS
            since = min((int(i["activated_ms"]) - window for i in its), default=None)
            served = served_units(c, ns, {i["item_id"] for i in its}, since)
            cache: dict[tuple, list] = {}
            evals = []
            for it in its:
                if it["status"] == "contested":
                    evals.append((it, {"item_id": it["item_id"], "series": it["guard_metric"],
                                       "decision": "fire", "resumed": True}))
                    continue
                if (ns_row.get("types") or {}).get(it["guard_metric"], {}).get("kind_of") != "metric":
                    evals.append((it, {"item_id": it["item_id"], "series": it["guard_metric"],
                                       "decision": "unknown_series"}))
                    continue
                start = int(it["activated_ms"]) - window
                key = (it["guard_metric"], None if it["scope"] == "cross" else it["project"], start)
                if key not in cache:
                    cache[key] = load_obs(c, ns, key[0], None if key[1] is None else [key[1]],
                                          {"from": start, "baseline": False})
                evals.append((it, evaluate(ns_row, it, cache[key], served.get(it["item_id"], set()), conf)))
        for it, ev in evals:
            if ev["decision"] == "fire" and not dry_run:
                code, done = _withdraw(ns_row, it)
                ev["withdrawn"] = code is None
                if code:
                    ev["error"] = code
                else:
                    core.emit(ns, "kh.item_rollback",
                              _json_safe({**{k: v for k, v in ev.items() if k not in ("withdrawn",)},
                                          "item_id": it["item_id"], "kind": it["kind"], "project": it["project"],
                                          "reason": "auto_rollback", "status": done["status"], "rev": done["rev"]}),
                              {"principal": SYSTEM, "role": core.ADMIN})
            results.append(_json_safe(ev))
    finally:
        with sqldb.connect() as c:
            sqldb.lease_release(c, sqldb.KH_NS, lease, holder, got["epoch"])
    return {"ns": ns, "dry_run": dry_run, "checked": len(results),
            "fired": sum(1 for r in results if r["decision"] == "fire"), "items": results}


def _cron_rollback() -> str:
    with sqldb.connect() as c:
        nss = [r[0] for r in c.execute(
            "SELECT DISTINCT i.ns FROM kh_item i JOIN kh_ns n ON n.ns=i.ns WHERE n.state='active' AND "
            "i.guard_metric IS NOT NULL AND i.status IN ('active','contested')").fetchall()]
    out = []
    for ns in nss:
        try:
            got = rollback_check(ns)
        except Exception:  # noqa: BLE001 - one namespace never stops the others
            logger.exception("metrics - rollback check of %s failed", ns)
            continue
        if got.get("fired"):
            out.append(f"{ns}: {got['fired']} rolled back")
    return ", ".join(out)


def _cron_retention() -> str:
    """Raw rows past their metric type's retention_days go; the daily rollup keeps the history."""
    total = 0
    with sqldb.connect() as c:
        now = sqldb.now_ms(c)
        for r in c.execute("SELECT ns, type, retention_days FROM kh_type WHERE kind_of='metric' AND state='active' "
                           "AND retention_days IS NOT NULL").fetchall():
            total += sqldb.update(c, "DELETE FROM kh_metric WHERE ns=? AND series=? AND ts_ms<?",
                                  [r["ns"], r["type"], now - int(r["retention_days"]) * DAY_MS])
    return f"pruned {total}" if total else ""


CRONS = [("metrics_rollback", ROLLBACK_INTERVAL_S, _cron_rollback), ("metrics_retention", 86400, _cron_retention)]


# ── hooks and routes ─────────────────────────────────────────────────────────

def _type_usage(c, ns: str, type_row: dict) -> int:
    if type_row.get("kind_of") != "metric":
        return 0
    return int(c.execute("SELECT COUNT(*) FROM kh_metric WHERE ns=? AND series=?", [ns, type_row["type"]]
                         ).fetchone()[0])


def _on_state(c, ns: str, old: str, new: str) -> None:       # noqa: ARG001
    if new == "purged":
        for table in ("kh_metric", "kh_metric_day"):
            c.execute(f"DELETE FROM {table} WHERE ns=?", [ns])


async def _json(request: Request):
    raw = await request.body()
    if not raw:
        return {}
    try:
        return json.loads(raw)
    except ValueError:
        raise CapError("invalid", "body must be JSON")


def attach(app) -> None:
    TAG = ["v1 metrics"]
    if _type_usage not in registry.TYPE_USAGE:
        registry.TYPE_USAGE.append(_type_usage)
    if _on_state not in registry.ON_STATE:
        registry.ON_STATE.append(_on_state)

    @app.post("/v1/{ns}/metrics", tags=TAG, summary="Record observations (batch <= 1,000; idempotent per key)")
    @core.idempotent
    async def metrics_post(request: Request, ns: str, ctx: Ctx = Depends(ns_ctx)):
        body = await _json(request)
        return await asyncio.to_thread(record, ctx, body)

    @app.get("/v1/{ns}/metrics", tags=TAG, summary="Raw observations of one series")
    async def metrics_list(request: Request, ns: str, series: str, project: str = "", run_id: str = "",
                           unit_id: str = "", baseline: str = "", to: int | None = None,
                           limit: int = 100, offset: int = 0, ctx: Ctx = Depends(ns_ctx)):
        frm = _int_q(request, "from")
        return await asyncio.to_thread(list_obs, ctx, series, project, run_id, unit_id, baseline, frm, to,
                                       max(1, min(limit, LIST_MAX)), max(0, offset))

    @app.get("/v1/{ns}/metrics:aggregate", tags=TAG, summary="n / sum / mean / sd by window and dimension")
    async def metrics_aggregate(request: Request, ns: str, series: str, group_by: str = "", window: str = "",
                                to: int | None = None, project: str = "", baseline: str = "",
                                ctx: Ctx = Depends(ns_ctx)):
        return await asyncio.to_thread(aggregate, ctx, series, group_by, window, _int_q(request, "from"), to,
                                       project, baseline)

    @app.post("/v1/{ns}/metrics:compare", tags=TAG, summary="Compare two filtered samples (z-test / Mann-Whitney)")
    async def metrics_compare(request: Request, ns: str, ctx: Ctx = Depends(ns_ctx)):
        body = await _json(request)
        return await asyncio.to_thread(compare, ctx, body)

    @app.post("/v1/{ns}/metrics:rollback", tags=TAG, summary="Run the automatic item rollback check now")
    async def metrics_rollback(request: Request, ns: str, ctx: Ctx = Depends(ns_ctx)):
        if not ctx.is_admin and ctx.role != "orchestrator":
            raise CapError("forbidden", "for the namespace admin or an orchestrator")
        body = await _json(request)
        body = body if isinstance(body, dict) else {}
        ids = body.get("item_ids")
        if ids is not None and (not isinstance(ids, list) or not all(isinstance(i, str) for i in ids)):
            raise CapError("invalid", "item_ids must be a list of strings")
        return await asyncio.to_thread(rollback_check, ns, bool(body.get("dry_run")), ids)


def _int_q(request: Request | None, name: str) -> int | None:
    v = request.query_params.get(name) if request is not None else None
    if v in (None, ""):
        return None
    try:
        return int(v)
    except ValueError:
        raise CapError("invalid", f"{name} must be epoch milliseconds")

"""Replay historical worklogs: the phase 3 baseline, label precision, power and pipeline checks.
Slice S4 of docs/roadmap-e-to-5-design.md, section 8.

Input, one of (the report says which was used):
  --ndjson FILE      a local dump: one row per line, a /vector/scroll hit ({vector_id, source_text, metadata})
                     or a flat {id, text, ts, project, topic, author, scope}
  --kh-url URL       a dev KH (e.g. the copy seed_docker_dev.py made); token from KH_TOKEN or kh-helper
  --snapshot         the consented projects read from prod through the maintainer's kh-helper session. It only
                     calls POST /vector/scroll (read-only) and keeps the rows in tools/kh_bench/results/, which
                     is never committed. --projects is required with the two KH sources.

What it rebuilds, in time order. Every log row (chunk sidecars skipped) is one STEP with the key
(project, action, context): action = metadata.action or 'worklog', context = metadata.topic (or .context).
A SESSION is metadata.session when the row has one, else author + project + UTC day. Each step gets an
outcome (corrected > failed > done) and, when it failed, an error class and kind from errkind.py.

What it reports (section 8, "replay proves"):
  baseline     repeats per 100 eligible steps, per 30-day month over the last 3 months, overall, per key and
               per error class, with the G7 target (half of it). A repeat is a failed step whose kind occurred
               before, anywhere earlier in the history.
  labels       outcome mix; with --audit, precision per label against audited steps (gate: >= 0.85 on >= 100).
  stability    singleton share of kinds (target < 5%), class kind vs the live per-line kind.
  preventable  share of repeats for which a distilled item with the same key existed (first_seen <= ts).
  power        eligible sessions per key per day -> days to 30 sessions per arm in a 50/50 trial; keys past
               45 days are listed and left out of G7.
  pipeline     input checks, determinism, and the lesson candidates replay can feed to /learn/propose (the
               evidence rule of the offline gate, 5.3 step 2, runs here; steps 1, 3, 4 need S11 on dev).

What it CANNOT prove: the causal effect of a lesson. History has no randomized arms; that needs the live trial.

    python replay.py --ndjson dump.ndjson [--audit audit.json] [--until 2026-10-11] [--out report.json]
"""
from __future__ import annotations

import argparse
import json
import math
import os
import re
import sys
import time
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import errkind  # noqa: E402

DAY = 86400
MONTH_DAYS = 30
MONTHS = 3
PER_ARM = 30
MAX_TRIAL_DAYS = 45
SINGLETON_TARGET = 0.05
LABEL_GATE = (0.85, 100)
RESULTS = Path(__file__).resolve().parent.parent / "results"
CANNOT = ("the causal effect of a lesson: history has no randomized arms, so the live 50/50 trial "
          "(>= 30 sessions per arm) is still required; G7's 3 months after trial-on and phase 4's 2-6 weeks "
          "are calendar time replay does not shorten")


# ── input ───────────────────────────────────────────────────────────────────

def parse_ts(v) -> float | None:
    if v is None or v == "":
        return None
    if isinstance(v, (int, float)):
        return float(v) / (1000 if v > 1e11 else 1)
    s = str(v).strip()
    if re.fullmatch(r"\d+(\.\d+)?", s):
        return parse_ts(float(s))
    try:
        d = datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None
    return (d if d.tzinfo else d.replace(tzinfo=timezone.utc)).timestamp()


def norm_row(raw: dict) -> dict:
    """A scroll hit or a flat row -> {id, text, scope, project, meta}."""
    meta = dict(raw.get("metadata") or {})
    for k in ("ts", "project", "topic", "author", "scope", "session", "action", "context"):
        if k in raw and k not in meta:
            meta[k] = raw[k]
    return {"id": raw.get("vector_id") or raw.get("id") or "", "text": raw.get("source_text") or raw.get("text") or "",
            "scope": meta.get("scope") or "log", "project": meta.get("project") or "", "meta": meta}


def load_ndjson(path: str) -> list[dict]:
    rows = []
    with open(path, encoding="utf-8") as f:
        for ln in f:
            if ln.strip():
                rows.append(norm_row(json.loads(ln)))
    return rows


def fetch(call, projects: list[str], scopes=("log", "knowledge")) -> list[dict]:
    """Read every row of the projects through POST /vector/scroll only. call(method, path, body) -> dict."""
    rows = []
    for proj in projects:
        for scope in scopes:
            off = 0
            while True:
                page = call("POST", "/vector/scroll", {"scope": scope, "project": proj, "limit": 5000,
                                                       "offset": off, "order": "oldest"})["hits"]
                for h in page:
                    h.setdefault("metadata", {})
                    h["metadata"].setdefault("scope", scope)
                    h["metadata"].setdefault("project", proj)
                    rows.append(h)
                off += len(page)
                if len(page) < 5000:
                    break
    return rows


def _kh_call(base_url: str | None):
    """A read-only caller: the dev URL with a bearer token, or prod through kh-helper's session.

    A dev URL with KH_TOKEN set never touches kh-helper (whose session is the prod sign-in)."""
    sess = None
    if base_url is None or not os.environ.get("KH_TOKEN"):
        from kh_helper.session import Session  # the maintainer's sign-in; only imported when needed
        sess = Session()
    if base_url is None:
        def call(method, path, body):
            assert (method, path) == ("POST", "/vector/scroll"), "replay reads prod with /vector/scroll only"
            st, out = sess.call(method, path, body)
            if st != 200:
                sys.exit(f"prod {path}: {st} {str(out)[:200]}")
            return out
        return call
    import requests

    def call(method, path, body):
        tok = os.environ.get("KH_TOKEN") or sess._access_token()
        r = requests.request(method, base_url.rstrip("/") + path, json=body, timeout=180,
                             headers={"Authorization": "Bearer " + tok})
        if r.status_code != 200:
            sys.exit(f"dev {path}: {r.status_code} {r.text[:200]}")
        return r.json()
    return call


# ── reconstruction ──────────────────────────────────────────────────────────

def _day(ts: float) -> str:
    return datetime.fromtimestamp(ts, timezone.utc).strftime("%Y-%m-%d")


def steps_from(rows: list[dict]) -> tuple[list[dict], list[dict], dict]:
    """(steps in time order, distilled items, input stats)."""
    stats = Counter()
    seen_ids, steps, items = set(), [], []
    for r in rows:
        m = r["meta"]
        stats["rows"] += 1
        if r["id"] and r["id"] in seen_ids:
            stats["duplicate_ids"] += 1
            continue
        seen_ids.add(r["id"])
        if m.get("chunk_of"):
            stats["chunk_rows_skipped"] += 1
            continue
        if r["scope"] == "knowledge":
            if m.get("dkey"):
                items.append({"id": r["id"], "project": r["project"], "action": m.get("action") or "-",
                              "context": m.get("context") or "-", "status": m.get("status") or "",
                              "first_seen": parse_ts(m.get("first_seen") or m.get("ts"))})
            stats["knowledge_rows"] += 1
            continue
        if r["scope"] != "log":
            stats["other_scope_rows"] += 1
            continue
        ts = parse_ts(m.get("ts"))
        if ts is None:
            stats["log_rows_without_ts"] += 1
            continue
        if not r["project"]:
            stats["log_rows_without_project"] += 1
            continue
        if not r["text"].strip():
            stats["log_rows_empty"] += 1
            continue
        action = m.get("action") or "worklog"
        context = m.get("topic") or m.get("context") or errkind.NONE_KEY
        author = m.get("author") or m.get("author_email") or "?"
        session = m.get("session") or m.get("session_id") or f"{author}|{r['project']}|{_day(ts)}"
        c = errkind.classify(r["text"], r["project"], action, context)
        steps.append({"id": r["id"], "ts": ts, "project": r["project"], "action": action, "context": context,
                      "key": (r["project"], action, context), "author": author, "session": session,
                      "recorded": m.get("outcome") or "", **c})
    steps.sort(key=lambda s: (s["ts"], s["id"]))
    stats["steps"] = len(steps)
    stats["items"] = len(items)
    return steps, items, dict(stats)


def mark_repeats(steps: list[dict]) -> None:
    """A repeat is a failed step whose kind occurred before (5.5); also for the live per-line kind."""
    seen, seen_line = set(), set()
    for s in steps:
        s["repeat"] = bool(s["kind"]) and s["kind"] in seen
        s["repeat_line"] = bool(s["error_kind"]) and s["error_kind"] in seen_line
        if s["kind"]:
            seen.add(s["kind"])
            seen_line.add(s["error_kind"])


def _rate(rep: int, n: int) -> float | None:
    return round(100.0 * rep / n, 2) if n else None


def baseline(steps: list[dict], until: float) -> dict:
    start = until - MONTHS * MONTH_DAYS * DAY
    win = [s for s in steps if start <= s["ts"] < until]
    months = []
    for i in range(MONTHS):
        a, b = start + i * MONTH_DAYS * DAY, start + (i + 1) * MONTH_DAYS * DAY
        ms = [s for s in win if a <= s["ts"] < b]
        rep = sum(s["repeat"] for s in ms)
        months.append({"from": _day(a), "to": _day(b - 1), "eligible_steps": len(ms), "repeats": rep,
                       "repeats_line_kind": sum(s["repeat_line"] for s in ms),
                       "rate_per_100": _rate(rep, len(ms))})
    rep = sum(s["repeat"] for s in win)
    by_key = defaultdict(lambda: [0, 0, 0])
    by_cls = Counter()
    for s in win:
        k = by_key["/".join(s["key"])]
        k[0] += 1
        k[1] += s["outcome"] != "done"
        k[2] += s["repeat"]
        if s["repeat"]:
            by_cls[s["error_cls"]] += 1
    overall = _rate(rep, len(win))
    return {
        "window": {"from": _day(start), "to": _day(until - 1), "months_of_days": MONTH_DAYS},
        "eligible_steps": len(win), "repeats": rep, "rate_per_100": overall,
        "g7_target_rate_per_100": round(overall / 2, 2) if overall is not None else None,
        "months": months,
        "per_error_class": {c: {"repeats": n, "rate_per_100": _rate(n, len(win))} for c, n in by_cls.most_common()},
        "per_key": sorted(({"key": k, "eligible_steps": v[0], "not_done": v[1], "repeats": v[2],
                            "rate_per_100": _rate(v[2], v[0])} for k, v in by_key.items()),
                          key=lambda r: (-r["repeats"], -r["eligible_steps"], r["key"])),
    }


def labels(steps: list[dict], audit: dict | None) -> dict:
    out = {"outcomes": dict(Counter(s["outcome"] for s in steps)),
           "error_classes": dict(Counter(s["error_cls"] for s in steps if s["error_cls"]).most_common())}
    rec = [(s["outcome"], s["recorded"]) for s in steps if s["recorded"] in errkind.OUTCOMES]
    if rec:
        out["vs_recorded_outcomes"] = errkind.measure(rec)
    if audit:
        by_id = {s["id"]: s for s in steps}
        pairs = [(by_id[i]["outcome"], g["outcome"]) for i, g in audit.items() if i in by_id and g.get("outcome")]
        cls = [(by_id[i]["error_cls"] or "none", g["error_cls"]) for i, g in audit.items()
               if i in by_id and g.get("error_cls")]
        m = errkind.measure(pairs)
        precisions = [v["precision"] for v in m["per_label"].values() if v["precision"] is not None]
        out["audit"] = {"outcome": m, "error_class": errkind.measure(cls) if cls else None,
                        "missing_ids": sum(1 for i in audit if i not in by_id),
                        "gate": {"rule": f"precision >= {LABEL_GATE[0]} on >= {LABEL_GATE[1]} audited steps",
                                 "pass": bool(m["n"] >= LABEL_GATE[1] and m["accuracy"] is not None
                                              and m["accuracy"] >= LABEL_GATE[0]
                                              and all(p >= LABEL_GATE[0] for p in precisions))}}
    return out


def stability(steps: list[dict]) -> dict:
    fails = [s for s in steps if s["kind"]]
    kinds, lines = Counter(s["kind"] for s in fails), Counter(s["error_kind"] for s in fails)

    def single(c):
        return round(sum(1 for v in c.values() if v == 1) / len(c), 3) if c else None
    sk = single(kinds)
    return {"failed_steps": len(fails), "class_kinds": len(kinds), "line_kinds": len(lines),
            "singleton_share_class_kind": sk, "singleton_share_line_kind": single(lines),
            "line_kinds_per_class_kind": round(len(lines) / len(kinds), 2) if kinds else None,
            "target": f"< {SINGLETON_TARGET:.0%} singletons",
            "pass": sk is not None and sk < SINGLETON_TARGET}


def preventable(steps: list[dict], items: list[dict]) -> dict:
    by_key = defaultdict(list)
    by_proj = defaultdict(list)
    for it in items:
        if it["first_seen"] is not None and it["status"] not in ("withdrawn", "rejected", "superseded"):
            by_key[(it["project"], it["context"])].append(it["first_seen"])
            by_proj[it["project"]].append(it["first_seen"])
    reps = [s for s in steps if s["repeat"]]
    key_hit = sum(1 for s in reps if any(f <= s["ts"] for f in by_key[(s["project"], s["context"])]))
    proj_hit = sum(1 for s in reps if any(f <= s["ts"] for f in by_proj[s["project"]]))
    return {"repeats": len(reps), "items_considered": len(items),
            "with_item_same_key": key_hit, "share_same_key": round(key_hit / len(reps), 3) if reps else None,
            "with_item_same_project": proj_hit,
            "share_same_project": round(proj_hit / len(reps), 3) if reps else None,
            "key_match": "project + context (item context vs step topic); project-only is the loose bound"}


def power(steps: list[dict], until: float) -> dict:
    """Days until a 50/50 trial on a key reaches PER_ARM sessions per arm, from the key's session rate."""
    start = until - MONTHS * MONTH_DAYS * DAY
    win = [s for s in steps if start <= s["ts"] < until]
    days = max(1.0, (until - max(start, min((s["ts"] for s in steps), default=until))) / DAY)
    sess = defaultdict(set)
    for s in win:
        sess["/".join(s["key"])].add(s["session"])
    rows = []
    for k, ss in sess.items():
        per_day = len(ss) / days
        need = math.ceil(2 * PER_ARM / per_day) if per_day else None
        rows.append({"key": k, "sessions": len(ss), "sessions_per_week": round(per_day * 7, 2),
                     "days_to_30_per_arm": need, "reachable": need is not None and need <= MAX_TRIAL_DAYS})
    rows.sort(key=lambda r: (r["days_to_30_per_arm"] or 10 ** 9, r["key"]))
    all_sess = {s["session"] for s in win}
    tot = len(all_sess) / days
    return {"window_days": round(days, 1), "per_arm": PER_ARM, "split": "50/50 by session",
            "max_trial_days": MAX_TRIAL_DAYS,
            "all_sessions": len(all_sess),
            "days_to_30_per_arm_any_key": math.ceil(2 * PER_ARM / tot) if tot else None,
            "keys": len(rows), "reachable_keys": sum(r["reachable"] for r in rows),
            "left_out_of_g7": [r["key"] for r in rows if not r["reachable"]],
            "per_key": rows}


def candidates(steps: list[dict]) -> list[dict]:
    """Lesson candidates replay can hand to /learn/propose: a kind with failures in >= 2 independent
    sessions (a different session AND a different person or project), the evidence rule of 5.3 step 2."""
    by_kind = defaultdict(list)
    for s in steps:
        if s["kind"]:
            by_kind[s["kind"]].append(s)
    out = []
    for kind, ss in by_kind.items():
        pairs = {(s["session"], s["author"], s["project"]) for s in ss}
        independent = any(a[0] != b[0] and (a[1] != b[1] or a[2] != b[2]) for a in pairs for b in pairs)
        s0 = ss[0]
        out.append({"kind": kind, "project": s0["project"], "action": s0["action"], "context": s0["context"],
                    "error_cls": s0["error_cls"], "anchor": s0["anchor"], "failures": len(ss),
                    "sessions": len({p[0] for p in pairs}), "evidence_ok": independent,
                    "sample": errkind.normalise(s0["error_line"])[:160],
                    "evidence_ids": [s["id"] for s in ss[:10]]})
    out.sort(key=lambda c: (-c["evidence_ok"], -c["failures"], c["kind"]))
    return out


_LEAK = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+|\b\d{1,3}(?:\.\d{1,3}){3}\b|\b(?:sk|ghp|xox[bp])-?[A-Za-z0-9_-]{16,}")


def pipeline(steps, items, stats, cands, rerun_equal: bool, report_text: str) -> dict:
    checks = [
        ("rows loaded", stats.get("rows", 0) > 0, stats.get("rows", 0)),
        ("steps reconstructed", len(steps) > 0, len(steps)),
        ("no duplicate ids", stats.get("duplicate_ids", 0) == 0, stats.get("duplicate_ids", 0)),
        ("log rows with a ts", stats.get("log_rows_without_ts", 0) == 0, stats.get("log_rows_without_ts", 0)),
        ("steps in time order", all(a["ts"] <= b["ts"] for a, b in zip(steps, steps[1:])), ""),
        ("every failed step has a kind", all(s["kind"] for s in steps if s["outcome"] == "failed"),
         sum(1 for s in steps if s["outcome"] == "failed" and not s["kind"])),
        ("classification is deterministic (second pass equal)", rerun_equal, ""),
        ("lesson candidates with independent evidence", any(c["evidence_ok"] for c in cands),
         sum(c["evidence_ok"] for c in cands)),
        ("report holds no e-mail, IP or secret", not _LEAK.search(report_text), ""),
    ]
    return {"checks": [{"check": c, "ok": bool(ok), "detail": d} for c, ok, d in checks],
            "pass": all(ok for _, ok, _ in checks),
            "not_run_here": ["offline gate steps 1, 3, 4 (leak/lint, contradiction, bench non-regression) and the "
                             "worker's proposal text: they run on dev through /learn/propose once S11 is built"]}


# ── driver ──────────────────────────────────────────────────────────────────

def load_audit(path: str | None) -> dict | None:
    """{id: {outcome, error_cls?}} as a JSON object, a JSON list or NDJSON of {id, outcome, error_cls?}."""
    if not path:
        return None
    txt = Path(path).read_text(encoding="utf-8").strip()
    try:
        data = json.loads(txt)
    except json.JSONDecodeError:
        data = [json.loads(ln) for ln in txt.splitlines() if ln.strip()]
    if isinstance(data, dict):
        return {data["id"]: data} if "id" in data and "outcome" in data else data
    return {d["id"]: d for d in data}


def run(rows: list[dict], source: str, until: float | None = None, audit: dict | None = None) -> dict:
    rows = [r if "meta" in r else norm_row(r) for r in rows]
    steps, items, stats = steps_from(rows)
    again, _, _ = steps_from(rows)
    rerun_equal = [(s["id"], s["outcome"], s["kind"], s["error_kind"]) for s in steps] == \
                  [(s["id"], s["outcome"], s["kind"], s["error_kind"]) for s in again]
    mark_repeats(steps)
    until = until or ((max(s["ts"] for s in steps) + 1) if steps else time.time())
    cands = candidates(steps)
    report = {
        "source": source, "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "until": _day(until - 1), "input": stats,
        "baseline": baseline(steps, until), "labels": labels(steps, audit), "stability": stability(steps),
        "preventable": preventable(steps, items), "power": power(steps, until),
        "lesson_candidates": {"total": len(cands), "evidence_ok": sum(c["evidence_ok"] for c in cands),
                              "top": cands[:20]},
        "cannot_prove": CANNOT,
    }
    # the scan covers what replay derived from the logs, not its own source label (a dev URL is 127.0.0.1)
    scanned = {k: v for k, v in report.items() if k != "source"}
    report["pipeline"] = pipeline(steps, items, stats, cands, rerun_equal, json.dumps(scanned, ensure_ascii=False))
    return report


def summary(r: dict) -> str:
    b, p, st = r["baseline"], r["power"], r["stability"]
    lines = [f"source: {r['source']}   until {r['until']}   steps {r['input'].get('steps', 0)}",
             f"baseline repeats/100 eligible steps: {b['rate_per_100']}  (G7 target {b['g7_target_rate_per_100']})",
             "  months: " + ", ".join(f"{m['from']}..{m['to']} {m['rate_per_100']}" for m in b["months"]),
             f"outcomes: {r['labels']['outcomes']}",
             f"kinds: {st['class_kinds']} class, {st['line_kinds']} line; singletons {st['singleton_share_class_kind']}"
             f" ({'pass' if st['pass'] else 'miss'} < 5%)",
             f"preventable share (same key): {r['preventable']['share_same_key']}",
             f"power: any key {p['days_to_30_per_arm_any_key']} days to 30/arm; reachable keys "
             f"{p['reachable_keys']}/{p['keys']}",
             f"pipeline: {'pass' if r['pipeline']['pass'] else 'FAIL'}"]
    if "audit" in r["labels"]:
        a = r["labels"]["audit"]
        lines.append(f"label audit: accuracy {a['outcome']['accuracy']} on {a['outcome']['n']} "
                     f"({'pass' if a['gate']['pass'] else 'miss'})")
    lines.append("cannot prove: " + CANNOT)
    return "\n".join(lines)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--ndjson", help="local dump of scroll hits")
    src.add_argument("--kh-url", help="a dev KH to read with /vector/scroll")
    src.add_argument("--snapshot", action="store_true", help="read the consented projects from prod, read-only")
    ap.add_argument("--projects", help="comma list (required with --kh-url / --snapshot)")
    ap.add_argument("--audit", help="audited labels: {id: {outcome, error_cls}} or NDJSON")
    ap.add_argument("--until", help="end of the baseline window (ISO date); default the newest step")
    ap.add_argument("--out", help="report path; default tools/kh_bench/results/replay-<time>.json")
    a = ap.parse_args(argv)
    stamp = time.strftime("%Y%m%d-%H%M%S")
    if a.ndjson:
        rows, source = load_ndjson(a.ndjson), f"ndjson:{Path(a.ndjson).name}"
    else:
        if not a.projects:
            ap.error("--projects is required with --kh-url or --snapshot")
        projects = [p for p in a.projects.split(",") if p]
        raw = fetch(_kh_call(a.kh_url), projects)
        RESULTS.mkdir(parents=True, exist_ok=True)
        dump = RESULTS / f"replay-{'snapshot' if a.snapshot else 'dev'}-{stamp}.ndjson"
        with open(dump, "w", encoding="utf-8") as f:
            for h in raw:
                f.write(json.dumps(h, ensure_ascii=False) + "\n")
        rows = [norm_row(h) for h in raw]
        source = (f"snapshot:prod {','.join(projects)}" if a.snapshot else f"dev:{a.kh_url} {','.join(projects)}")
        print("rows kept in", dump)
    report = run(rows, source, parse_ts(a.until) if a.until else None, load_audit(a.audit))
    out = Path(a.out) if a.out else RESULTS / f"replay-{stamp}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    print(summary(report))
    print("report", out)
    return report


if __name__ == "__main__":
    main()

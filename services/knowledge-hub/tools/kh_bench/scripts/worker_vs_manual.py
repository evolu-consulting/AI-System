"""G2: the worker distils no worse than fen's manual run, on the same batches (docs/roadmap-e-to-5-design.md 0, 3.7).

  python worker_vs_manual.py export --project m360 [--project zeus-adm] --distilled-by fen --out manual.json
                         [--url URL] [--auth A]       one side's items as KH holds them (any KH, read-only)
  python worker_vs_manual.py blind  --manual manual.json --worker worker.json [--n 40] [--seed 7]
                         writes a review sheet (CSV, sides hidden behind codes) and its key; fen fills 'keep' y/n
  python worker_vs_manual.py score  --manual manual.json --worker worker.json [--review sheet.csv]
                         [--p1-manual p1bench-...-manual.json --p1-worker p1bench-...-worker.json]
                         prints the four G2 checks and GATE G2 PASS/FAIL/PARTIAL
  python worker_vs_manual.py selftest                 offline

G2: 0 leaks; schema-reject rate <= manual + 5 pp; blind keep-rate >= manual - 5 pp (40 items per side);
p1bench answered-rate with the worker's items >= manual - 2 pp. A check without its input is NOT MEASURED and the
verdict is then PARTIAL (exit 2); PASS needs all four (exit 0); any failed check is FAIL (exit 1).

Side files (one per side) take either shape:
  submit shape  {"batches": [{"batch_id", "project", "items": [{kind,title,text,...}], "results": [{n,result,reason,id}]}]}
               = the /distill/submit body plus its answer; the worker's worker.run events carry this (dry-run
               verdicts included), and an export of those events in {"events": [{"kind": "worker.run", "payload": ...}]}
               is read too
  flat shape   [{"id", "batch_id", "project", "title", "text", "verdict": accepted|merged|updated|contested|rejected|
               proposed|active|withdrawn, "reason"}]   (export writes this)
When both sides carry batch ids, every rate is computed on the batches both sides saw ("the same batches").
Leaks are counted on every item that was NOT refused (accepted, merged, contested, or stored), with KH's own leak
patterns (app/config.py), the planted strings of leakset.json, and the e-mail/secret rules of tasks_p1.json.
A leak-gate refusal is the gate working: it is reported, not counted as a leak or as a schema reject.
"""
from __future__ import annotations

import argparse
import csv
import json
import random
import re
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import p1bench  # noqa: E402

ROOT = HERE.parent
SCHEMA_PP, KEEP_PP, P1_PP, BLIND_N = 0.05, 0.05, 0.02, 40
EPS = 1e-9          # 0.90 - 0.05 is 0.8500000000000001 in floats; a rate exactly at the limit passes
REFUSED = {"rejected"}
NOT_KEPT = {"rejected", "withdrawn"}


# ── loading ──────────────────────────────────────────────────────────────────

def _from_batch(b: dict) -> list[dict]:
    items = b.get("items") or []
    by_n = {r.get("n"): r for r in b.get("results") or [] if isinstance(r, dict)}
    out = []
    for n, it in enumerate(items):
        r = by_n.get(n) or {}
        out.append({"id": r.get("id") or it.get("id"), "batch_id": b.get("batch_id"), "project": b.get("project"),
                    "title": it.get("title", ""), "text": it.get("text", ""), "kind": it.get("kind"),
                    "verdict": r.get("result") or it.get("verdict") or "unknown", "reason": r.get("reason", "")})
    return out


def load_side(path_or_obj) -> list[dict]:
    d = path_or_obj if not isinstance(path_or_obj, (str, Path)) else json.loads(Path(path_or_obj).read_text(encoding="utf-8"))
    if isinstance(d, dict) and "events" in d:
        d = {"batches": [e.get("payload") or {} for e in d["events"] if e.get("kind", "worker.run") == "worker.run"]}
    if isinstance(d, dict) and "batches" in d:
        return [x for b in d["batches"] for x in _from_batch(b)]
    if isinstance(d, dict) and "items" in d:
        d = d["items"]
    return [{**x, "verdict": (x.get("verdict") or x.get("result") or x.get("status") or "unknown")} for x in d]


def same_batches(m: list[dict], w: list[dict]) -> tuple[list[dict], list[dict], str]:
    bm, bw = {x.get("batch_id") for x in m} - {None}, {x.get("batch_id") for x in w} - {None}
    if not bm or not bw:
        return m, w, "no batch ids on one side: all items compared"
    common = bm & bw
    return ([x for x in m if x.get("batch_id") in common], [x for x in w if x.get("batch_id") in common],
            f"{len(common)} common batches (manual {len(bm)}, worker {len(bw)})")


# ── the four checks ──────────────────────────────────────────────────────────

def _leak_rules():
    rules = []
    try:
        sys.path.insert(0, str(ROOT.parent.parent))
        from app import config as khcfg  # noqa: E402
        rules += [("kh-pattern", re.compile(p)) for p in khcfg.DISTILL_LEAK_PATTERNS]
    except ImportError:
        pass
    t = json.loads((ROOT / "tasks_p1.json").read_text(encoding="utf-8"))
    rules += [(f"p1:{k}", re.compile(v)) for k, v in (t.get("forbidden_all") or {}).items()]
    return rules


def leaks(items: list[dict], ls: dict | None = None) -> list[dict]:
    rules, ls = _leak_rules(), ls or p1bench.load_leakset()
    needles = p1bench.leak_needles(ls, shared=False)
    out = []
    for x in items:
        if x["verdict"] in REFUSED:
            continue
        txt = f"{x.get('title', '')}\n{x.get('text', '')}"
        hit = [name for name, rx in rules if rx.search(txt) or rx.search(p1bench.fold(txt))]
        hit += [f"planted:{p}" for p in p1bench.leak_hits(txt, needles)]
        if hit:
            out.append({"id": x.get("id"), "batch_id": x.get("batch_id"), "hits": sorted(set(hit))})
    return out


def schema_rate(items: list[dict]) -> tuple[float | None, int, int, int]:
    """(schema-reject rate, schema rejects, leak-gate refusals, n). Leak-gate refusals are not schema rejects."""
    n = len(items)
    rej = [x for x in items if x["verdict"] in REFUSED]
    gate = [x for x in rej if str(x.get("reason", "")).startswith("leak gate")]
    s = len(rej) - len(gate)
    return (s / n if n else None), s, len(gate), n


def make_blind(m: list[dict], w: list[dict], n: int, seed: int, out_dir: Path) -> tuple[Path, Path]:
    rnd = random.Random(seed)
    pick = lambda xs: rnd.sample([x for x in xs if x["verdict"] not in REFUSED], min(n, sum(x["verdict"] not in REFUSED for x in xs)))
    rows = [("manual", x) for x in pick(m)] + [("worker", x) for x in pick(w)]
    rnd.shuffle(rows)
    stamp = time.strftime("%Y%m%d-%H%M%S")
    sheet, key = out_dir / f"g2-blind-{stamp}.csv", out_dir / f"g2-blind-{stamp}.key.json"
    out_dir.mkdir(parents=True, exist_ok=True)
    with open(sheet, "w", newline="", encoding="utf-8-sig") as f:
        wr = csv.writer(f)
        wr.writerow(["code", "project", "title", "text", "keep (y/n)"])
        for i, (_, x) in enumerate(rows, 1):
            wr.writerow([f"R{i:03d}", x.get("project") or "", x.get("title") or "", x.get("text") or "", ""])
    key.write_text(json.dumps({f"R{i:03d}": {"side": s, "id": x.get("id")} for i, (s, x) in enumerate(rows, 1)},
                              indent=1), encoding="utf-8")
    return sheet, key


def keep_rates(sheet: Path) -> dict:
    key = json.loads(Path(str(sheet).replace(".csv", ".key.json")).read_text(encoding="utf-8"))
    got = {"manual": [0, 0], "worker": [0, 0]}
    with open(sheet, newline="", encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            v = (row.get("keep (y/n)") or "").strip().lower()
            if v[:1] not in ("y", "n") or row["code"] not in key:
                continue
            side = key[row["code"]]["side"]
            got[side][0] += v.startswith("y")
            got[side][1] += 1
    return {s: {"kept": k, "n": n, "rate": (k / n if n else None)} for s, (k, n) in got.items()}


def p1_rate(path) -> float | None:
    d = json.loads(Path(path).read_text(encoding="utf-8")) if isinstance(path, (str, Path)) else path
    rows = d.get("rows") or []
    return sum(r["answered"] for r in rows) / len(rows) if rows else None


def score(m_all: list[dict], w_all: list[dict], review: dict | None, p1m, p1w, ls=None) -> dict:
    m, w, note = same_batches(m_all, w_all)
    checks = {}
    lk = leaks(w, ls) + [{**x, "side": "manual"} for x in leaks(m, ls)]
    wl = [x for x in lk if x.get("side") != "manual"]
    checks["leaks"] = (not wl, f"worker leaks {len(wl)} (manual {len(lk) - len(wl)}) "
                               f"{[x['id'] for x in wl][:5]}")
    rm, sm, gm, nm = schema_rate(m)
    rw, sw, gw, nw = schema_rate(w)
    if rm is None or rw is None:
        checks["schema"] = (None, "no items on one side")
    else:
        checks["schema"] = (rw <= rm + SCHEMA_PP + EPS, f"schema rejects worker {sw}/{nw} = {rw:.1%} vs manual {sm}/{nm} = "
                                                  f"{rm:.1%} (<= +{SCHEMA_PP * 100:.0f} pp); leak-gate refusals worker {gw}, manual {gm}")
    if review:
        km, kw = review["manual"], review["worker"]
        enough = km["n"] >= BLIND_N and kw["n"] >= BLIND_N
        ok = enough and km["rate"] is not None and kw["rate"] is not None and kw["rate"] >= km["rate"] - KEEP_PP - EPS
        checks["keep"] = (ok, f"blind keep worker {kw['kept']}/{kw['n']} vs manual {km['kept']}/{km['n']} "
                              f"(>= -{KEEP_PP * 100:.0f} pp, >= {BLIND_N} reviewed per side)")
    else:
        checks["keep"] = (None, "no review sheet (run 'blind', have fen fill it, pass --review)")
    if p1m is not None and p1w is not None:
        a, b = p1_rate(p1m), p1_rate(p1w)
        checks["p1bench"] = (a is not None and b is not None and b >= a - P1_PP - EPS,
                             f"p1bench answered worker {b:.1%} vs manual {a:.1%} (>= -{P1_PP * 100:.0f} pp)")
    else:
        checks["p1bench"] = (None, "no p1bench results (run p1bench run --label manual / --label worker)")
    if any(ok is False for ok, _ in checks.values()):
        verdict = "FAIL"
    elif any(ok is None for ok, _ in checks.values()):
        verdict = "PARTIAL"
    else:
        verdict = "PASS"
    return {"gate": "G2", "verdict": verdict, "batches": note, "leaks": lk,
            "checks": {k: {"ok": ok, "detail": d} for k, (ok, d) in checks.items()}}


def print_rep(rep: dict) -> None:
    print(f"same batches: {rep['batches']}")
    for k, c in rep["checks"].items():
        tag = {True: "pass", False: "FAIL", None: "----"}[c["ok"]]
        print(f"  [{tag}] {k}: {c['detail']}")
    print(f"GATE G2: {rep['verdict']}")


# ── commands ─────────────────────────────────────────────────────────────────

def cmd_export(a) -> int:
    kh = p1bench.client(a)
    out = []
    for proj in a.project:
        where = {"distilled_by": {"$eq": a.distilled_by}} if a.distilled_by else None
        body = {"scope": "knowledge", "project": proj, **({"where": where} if where else {})}
        for h in p1bench._scroll(kh, body):
            md = h.get("metadata") or {}
            if not md.get("dkey") and not str(h.get("id") or h.get("vector_id") or "").startswith("dk_"):
                continue
            out.append({"id": h.get("vector_id") or h.get("id"), "batch_id": md.get("batch_id"), "project": proj,
                        "title": md.get("title", ""), "text": h.get("text") or h.get("document") or "",
                        "verdict": md.get("status") or "unknown", "distilled_by": md.get("distilled_by")})
    Path(a.out).write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{len(out)} items -> {a.out}")
    return 0


def cmd_blind(a) -> int:
    m, w, note = same_batches(load_side(a.manual), load_side(a.worker))
    sheet, key = make_blind(m, w, a.n, a.seed, Path(a.out_dir))
    print(f"{note}\nreview sheet -> {sheet}\nkey (do not show the reviewer) -> {key}")
    return 0


def cmd_score(a) -> int:
    rep = score(load_side(a.manual), load_side(a.worker), keep_rates(Path(a.review)) if a.review else None,
                a.p1_manual, a.p1_worker)
    print_rep(rep)
    p1bench.RESULTS.mkdir(exist_ok=True)
    out = p1bench.RESULTS / f"g2-{time.strftime('%Y%m%d-%H%M%S')}.json"
    out.write_text(json.dumps(rep, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"result -> {out}")
    return {"PASS": 0, "FAIL": 1}.get(rep["verdict"], 2)


def cmd_selftest(a) -> int:
    import tempfile
    fails = []

    def check(cond, msg):
        print(("  ok   " if cond else "  FAIL ") + msg)
        if not cond:
            fails.append(msg)

    ls = p1bench.load_leakset()
    clean = "Always pin the SFTP host key in known_hosts before the nightly import."

    def side(n_items, n_schema, n_gate, prefix, batches=("b1", "b2", "b3"), leak_text=None):
        bs = []
        for bi, b in enumerate(batches):
            items, results = [], []
            for i in range(n_items):
                items.append({"kind": "lesson", "title": f"{prefix} {b} {i}", "text": clean})
                results.append({"n": i, "result": "accepted", "id": f"dk_{prefix}{b}{i}"})
            bs.append({"batch_id": b, "project": "m360", "items": items, "results": results})
        rs = [r for b in bs for r in b["results"]]
        for r in rs[:n_schema]:
            r.update(result="rejected", reason="sources must be ids of this project's logs")
        for r in rs[n_schema:n_schema + n_gate]:
            r.update(result="rejected", reason="leak gate: 'x@y.com'")
        if leak_text:
            bs[0]["items"][-1]["text"] = leak_text
        return {"batches": bs}

    m = load_side(side(20, 3, 1, "m"))
    w = load_side(side(20, 5, 4, "w"))
    check(len(m) == 60 and m[0]["verdict"] == "rejected" and m[3]["reason"].startswith("leak gate"), "submit shape loads")
    check(schema_rate(m)[:3] == (3 / 60, 3, 1), "leak-gate refusals are not schema rejects")
    ev = {"events": [{"kind": "worker.run", "payload": b} for b in side(20, 5, 4, "w")["batches"]]}
    check(len(load_side(ev)) == 60, "worker.run event export loads")
    rep = score(m, w, None, None, None, ls)
    check(rep["checks"]["schema"]["ok"] and rep["verdict"] == "PARTIAL", "schema +3.3 pp passes; no review -> PARTIAL")
    w_bad = load_side(side(20, 7, 0, "w"))
    check(score(m, w_bad, None, None, None, ls)["checks"]["schema"]["ok"] is False, "schema +6.7 pp -> fail")
    w_leak = load_side(side(20, 0, 0, "w", leak_text="Ask " + "Đặng Quốc Huy".upper() + " first"))
    r = score(m, w_leak, None, None, None, ls)
    check(r["verdict"] == "FAIL" and r["checks"]["leaks"]["ok"] is False, "a planted name (case and diacritics changed) in a worker item -> FAIL")
    w_mail = load_side(side(20, 0, 0, "w", leak_text="mail ops@corp.example.com"))
    check(score(m, w_mail, None, None, None, ls)["checks"]["leaks"]["ok"] is False, "an e-mail in a worker item -> leak")
    w_other = load_side(side(20, 5, 0, "w", batches=("b2", "b3", "b9")))
    note = same_batches(m, w_other)[2]
    check(note.startswith("2 common batches"), f"same batches only ({note})")
    with tempfile.TemporaryDirectory() as td:
        sheet, key = make_blind(load_side(side(20, 0, 0, "m")), load_side(side(20, 0, 0, "w")), 40, 7, Path(td))
        k = json.loads(key.read_text(encoding="utf-8"))
        check(sum(v["side"] == "manual" for v in k.values()) == 40 and len(k) == 80, "blind sheet: 40 + 40, sides hidden")
        txt = sheet.read_text(encoding="utf-8-sig")
        check("manual" not in txt and "worker" not in txt and "dk_" not in txt, "the sheet does not reveal the side")
        rows = list(csv.reader(open(sheet, encoding="utf-8-sig")))
        with open(sheet, "w", newline="", encoding="utf-8-sig") as f:   # fen: keeps 36 manual, 34 worker
            wr = csv.writer(f)
            wr.writerow(rows[0])
            cnt = {"manual": 0, "worker": 0}
            for row in rows[1:]:
                s = k[row[0]]["side"]
                cnt[s] += 1
                row[4] = "y" if cnt[s] <= (36 if s == "manual" else 34) else "n"
                wr.writerow(row)
        kr = keep_rates(sheet)
        check(kr["manual"]["kept"] == 36 and kr["worker"]["kept"] == 34, "keep rates read back through the key")
        p1m = {"rows": [{"answered": i < 36} for i in range(42)]}
        r = score(m, w, kr, p1m, {"rows": [{"answered": i < 36} for i in range(42)]}, ls)
        check(r["verdict"] == "PASS", "keep 85% vs 90% (exactly -5 pp) and p1bench equal -> PASS")
        r2 = score(m, w, kr, p1m, {"rows": [{"answered": i < 35} for i in range(42)]}, ls)
        check(r2["verdict"] == "FAIL" and r2["checks"]["p1bench"]["ok"] is False, "p1bench -2.4 pp -> FAIL")
        kr["worker"]["kept"], kr["worker"]["rate"] = 33, 33 / 40
        check(score(m, w, kr, p1m, p1m, ls)["checks"]["keep"]["ok"] is False, "keep -7.5 pp -> fail")
        kr["worker"]["n"] = 39
        check(score(m, w, kr, p1m, p1m, ls)["checks"]["keep"]["ok"] is False, "fewer than 40 reviewed -> fail")
    print_rep(r)
    print(f"selftest: {'PASS' if not fails else 'FAIL'} ({len(fails)} failures)")
    return 0 if not fails else 1


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    e = sub.add_parser("export")
    p1bench.add_target_args(e)
    e.add_argument("--project", action="append", required=True)
    e.add_argument("--distilled-by", help="metadata distilled_by to keep (fen's CLI run vs the worker principal)")
    e.add_argument("--out", required=True)
    b = sub.add_parser("blind")
    b.add_argument("--manual", required=True)
    b.add_argument("--worker", required=True)
    b.add_argument("--n", type=int, default=BLIND_N)
    b.add_argument("--seed", type=int, default=7)
    b.add_argument("--out-dir", default=str(p1bench.RESULTS))
    s = sub.add_parser("score")
    s.add_argument("--manual", required=True)
    s.add_argument("--worker", required=True)
    s.add_argument("--review")
    s.add_argument("--p1-manual")
    s.add_argument("--p1-worker")
    sub.add_parser("selftest")
    a = ap.parse_args()
    return {"export": cmd_export, "blind": cmd_blind, "score": cmd_score, "selftest": cmd_selftest}[a.cmd](a)


if __name__ == "__main__":
    sys.exit(main())

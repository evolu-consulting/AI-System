"""G4 latency probe (docs/roadmap-e-to-5-design.md 4.3 and 5.9): user turns are not slower with the new flags.

  python p95probe.py run --on URL [--off URL] [--on-auth A] [--off-auth A] [--n 200] [--warmup 10]
                         [--hook-on "CMD"] [--hook-off "CMD"] [--hook-stdin FILE]
  python p95probe.py selftest           offline: percentile and gate math on a fake KH

Calls POST /context/step and GET /turn/context n times each on the flags-on KH and the flags-off KH (same build,
same schema copy; on dev: kh-dev-f on 9102 and a second container with the flags off). The two sides are
interleaved call by call, and which side goes first alternates, so drift (a cache warming, a noisy laptop) hits
both alike. The prompts rotate through tasks_p1.json and tasks.json, so the probe is not a single cached text.

Gate G4, per route: p95(on) <= p95(off) x 1.05 AND p95(on) - p95(off) <= 100 ms. Hook overhead (when --hook-on
and --hook-off are given: the kh-helper hook command with the outcome signals on and off, fed the same stdin):
p95(on) - p95(off) <= 50 ms. Any failed call fails the side. Without --off there is nothing to compare: the
numbers are printed and the verdict is INDICATIVE. Without the hook commands the hook part is NOT MEASURED and
the verdict is at best PARTIAL. Exit codes: 0 PASS, 1 FAIL, 2 INDICATIVE / PARTIAL.

Targets and --auth work as in p1bench.py (dev-bootstrap[:container] | env | account:<who> | helper); a non-local
URL needs --allow-remote. For the flags-off container use e.g. --off-auth dev-bootstrap:kh-dev-f-off.
"""
from __future__ import annotations

import argparse
import json
import math
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import p1bench  # noqa: E402

ROOT = HERE.parent
RATIO, ABS_S, HOOK_S = 1.05, 0.100, 0.050


def pct(xs: list[float], p: float) -> float | None:
    """Nearest-rank percentile (p in 0-100)."""
    if not xs:
        return None
    s = sorted(xs)
    return s[max(0, math.ceil(p / 100 * len(s)) - 1)]


def prompts() -> list[tuple[str, str | None]]:
    out = [(q["prompt"], q.get("project")) for q in p1bench.load_tasks(ROOT / "tasks_p1.json")["questions"]]
    try:
        t = p1bench.load_tasks(ROOT / "tasks.json")
        out += [(x["prompt"], x.get("project")) for x in t["tasks"]]
    except (OSError, ValueError, KeyError):
        pass
    return out


def one(kh, route: str, text: str, project: str | None) -> tuple[bool, float]:
    if route == "step":
        body = {"text": text}
        if project:
            body["project"] = project
        st, _, dt = kh.call("POST", "/context/step", body)
    else:
        st, _, dt = kh.call("GET", "/turn/context", params={"text": text})
    return st == 200, dt


def probe(sides: dict, n: int, warmup: int, ps: list) -> dict:
    """sides: {'on': KH, 'off': KH}. Returns {side: {route: {'lat': [...], 'errors': k}}}."""
    res = {s: {r: {"lat": [], "errors": 0} for r in ("step", "turn")} for s in sides}
    order = list(sides)
    for i in range(warmup + n):
        text, project = ps[i % len(ps)]
        for route in ("step", "turn"):
            for s in (order if i % 2 == 0 else order[::-1]):
                ok, dt = one(sides[s], route, text, project)
                if i < warmup:
                    continue
                if ok:
                    res[s][route]["lat"].append(dt)
                else:
                    res[s][route]["errors"] += 1
    return res


def time_hook(cmd: str, stdin: bytes, n: int, warmup: int) -> tuple[list[float], int]:
    lat, errors = [], 0
    for i in range(warmup + n):
        t = time.perf_counter()
        # through the shell: its start-up cost is the same on both sides and cancels in the on - off overhead
        r = subprocess.run(cmd, shell=True, input=stdin, capture_output=True, timeout=60)
        dt = time.perf_counter() - t
        if i >= warmup:
            lat.append(dt)
            errors += r.returncode != 0
    return lat, errors


def hook_probe(on_cmd: str, off_cmd: str, stdin: bytes, n: int, warmup: int) -> dict:
    out = {"on": {"lat": [], "errors": 0}, "off": {"lat": [], "errors": 0}}
    for i in range(n):          # interleaved, one at a time, warm-up only before the first pair
        for side, cmd in (("on", on_cmd), ("off", off_cmd)) if i % 2 == 0 else (("off", off_cmd), ("on", on_cmd)):
            lat, err = time_hook(cmd, stdin, 1, warmup if i == 0 else 0)
            out[side]["lat"] += lat
            out[side]["errors"] += err
    return out


def judge(res: dict, hooks: dict | None, n: int) -> dict:
    checks, stats = {}, {}
    for side, routes in res.items():
        for route, d in routes.items():
            stats[f"{side}.{route}"] = {"n": len(d["lat"]), "errors": d["errors"], "p50_ms": _ms(pct(d["lat"], 50)),
                                        "p95_ms": _ms(pct(d["lat"], 95))}
    compared = "off" in res
    if compared:
        for route in ("step", "turn"):
            on, off = res["on"][route], res["off"][route]
            p_on, p_off = pct(on["lat"], 95), pct(off["lat"], 95)
            ok_n = len(on["lat"]) >= n and len(off["lat"]) >= n and not on["errors"] and not off["errors"]
            ok = ok_n and p_on is not None and p_off is not None and p_on <= p_off * RATIO and p_on - p_off <= ABS_S
            checks[route] = (ok, f"p95 on {_ms(p_on)} ms vs off {_ms(p_off)} ms (limit min(x{RATIO}, +{ABS_S * 1000:.0f} ms)); "
                                 f"calls {len(on['lat'])}/{len(off['lat'])}, errors {on['errors']}/{off['errors']}")
    if hooks:
        p_on, p_off = pct(hooks["on"]["lat"], 95), pct(hooks["off"]["lat"], 95)
        stats["hook.on"] = {"n": len(hooks["on"]["lat"]), "errors": hooks["on"]["errors"], "p95_ms": _ms(p_on)}
        stats["hook.off"] = {"n": len(hooks["off"]["lat"]), "errors": hooks["off"]["errors"], "p95_ms": _ms(p_off)}
        over = None if p_on is None or p_off is None else p_on - p_off
        ok = over is not None and over <= HOOK_S and not hooks["on"]["errors"] and not hooks["off"]["errors"]
        checks["hook"] = (ok, f"hook overhead p95 {_ms(over)} ms (<= {HOOK_S * 1000:.0f} ms)")
    if not compared:
        verdict = "INDICATIVE"
    elif not all(ok for ok, _ in checks.values()):
        verdict = "FAIL"
    elif not hooks:
        verdict = "PARTIAL"
    else:
        verdict = "PASS"
    return {"gate": "G4", "verdict": verdict, "stats": stats,
            "checks": {k: {"ok": ok, "detail": d} for k, (ok, d) in checks.items()},
            "hook_measured": bool(hooks)}


def _ms(x):
    return None if x is None else round(x * 1000, 1)


def cmd_run(a) -> int:
    def side(url, auth):
        return p1bench.client(argparse.Namespace(url=url, auth=auth, allow_remote=a.allow_remote))
    sides = {"on": side(a.on, a.on_auth)}
    if a.off:
        sides["off"] = side(a.off, a.off_auth)
    print(f"p95probe: on={sides['on']!r} off={sides.get('off')!r} n={a.n} warmup={a.warmup}", flush=True)
    res = probe(sides, a.n, a.warmup, prompts())
    hooks = None
    if a.hook_on and a.hook_off:
        stdin = Path(a.hook_stdin).read_bytes() if a.hook_stdin else b"{}"
        hooks = hook_probe(a.hook_on, a.hook_off, stdin, a.n, a.warmup)
    rep = judge(res, hooks, a.n)
    rep.update({"on": sides["on"].url, "off": sides["off"].url if "off" in sides else None,
                "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "n": a.n})
    p1bench.RESULTS.mkdir(exist_ok=True)
    out = p1bench.RESULTS / f"p95probe-{time.strftime('%Y%m%d-%H%M%S')}.json"
    out.write_text(json.dumps(rep, indent=1), encoding="utf-8")
    print_rep(rep, out)
    return {"PASS": 0, "FAIL": 1}.get(rep["verdict"], 2)


def print_rep(rep: dict, out=None) -> None:
    for k, s in rep["stats"].items():
        print(f"  {k:<9} n={s['n']:<4} errors={s['errors']:<3} p50={s.get('p50_ms')} ms p95={s['p95_ms']} ms")
    for k, c in rep["checks"].items():
        print(f"  [{'pass' if c['ok'] else 'FAIL'}] {k}: {c['detail']}")
    if not rep["hook_measured"]:
        print("  [----] hook: NOT MEASURED (give --hook-on and --hook-off)")
    if out:
        print(f"result -> {out}")
    print(f"GATE G4: {rep['verdict']}")


# ── offline self-test ────────────────────────────────────────────────────────

class FakeKH:
    def __init__(self, base_s: float, jitter: float = 0.0, fail_every: int = 0, url="http://127.0.0.1:1"):
        self.base, self.jitter, self.fail_every, self.url, self.i = base_s, jitter, fail_every, url, 0

    def call(self, method, path, body=None, params=None, timeout=120):
        self.i += 1
        st = 500 if self.fail_every and self.i % self.fail_every == 0 else 200
        return st, {}, self.base + self.jitter * ((self.i * 7919) % 100) / 100


def cmd_selftest(a) -> int:
    fails = []

    def check(cond, msg):
        print(("  ok   " if cond else "  FAIL ") + msg)
        if not cond:
            fails.append(msg)

    check(pct(list(range(1, 101)), 95) == 95 and pct([1.0], 95) == 1.0 and pct([], 95) is None, "nearest-rank p95")
    ps = prompts()
    check(len(ps) >= 40, f"{len(ps)} rotating prompts")
    n = 200
    same = judge(probe({"on": FakeKH(0.300, 0.05), "off": FakeKH(0.300, 0.05)}, n, 5, ps), None, n)
    check(same["verdict"] == "PARTIAL" and all(c["ok"] for c in same["checks"].values()),
          "equal latency, no hook -> both routes pass, verdict PARTIAL")
    check(same["stats"]["on.step"]["n"] == n and same["stats"]["off.turn"]["n"] == n, "200 calls per route and side, warm-up dropped")
    slow = judge(probe({"on": FakeKH(0.300 * 1.06, 0.05), "off": FakeKH(0.300, 0.05)}, n, 5, ps), None, n)
    check(slow["verdict"] == "FAIL", "on 6% slower -> FAIL (x1.05)")
    big = judge(probe({"on": FakeKH(3.0 + 0.11), "off": FakeKH(3.0)}, n, 0, ps), None, n)
    check(big["verdict"] == "FAIL" and "+100 ms" in big["checks"]["step"]["detail"], "+110 ms on a 3 s base -> FAIL (+100 ms)")
    ok = judge(probe({"on": FakeKH(3.0 + 0.09), "off": FakeKH(3.0)}, n, 0, ps), None, n)
    check(ok["checks"]["step"]["ok"] and ok["checks"]["turn"]["ok"], "+90 ms on a 3 s base (3%) -> pass")
    err = judge(probe({"on": FakeKH(0.3, fail_every=50), "off": FakeKH(0.3)}, n, 0, ps), None, n)
    check(err["verdict"] == "FAIL", "failed calls on one side -> FAIL")
    solo = judge(probe({"on": FakeKH(0.3)}, n, 0, ps), None, n)
    check(solo["verdict"] == "INDICATIVE", "no flags-off side -> INDICATIVE")
    hooks = {"on": {"lat": [0.12] * n, "errors": 0}, "off": {"lat": [0.08] * n, "errors": 0}}
    full = judge(probe({"on": FakeKH(0.3), "off": FakeKH(0.3)}, n, 0, ps), hooks, n)
    check(full["verdict"] == "PASS", "hook overhead 40 ms -> PASS")
    hooks["on"]["lat"] = [0.14] * n
    check(judge(probe({"on": FakeKH(0.3), "off": FakeKH(0.3)}, n, 0, ps), hooks, n)["verdict"] == "FAIL",
          "hook overhead 60 ms -> FAIL")
    py = sys.executable.replace("\\", "/")
    lat, e = time_hook(f'"{py}" -c "import sys; sys.stdin.read()"', b"{}", 3, 1)
    check(len(lat) == 3 and e == 0, f"hook command timing works ({_ms(pct(lat, 95))} ms p95 for a bare python)")
    print(f"selftest: {'PASS' if not fails else 'FAIL'} ({len(fails)} failures)")
    return 0 if not fails else 1


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run")
    r.add_argument("--on", default=p1bench.DEV_URL, help="the KH with every new flag on (default dev 9102)")
    r.add_argument("--off", help="the KH with the flags off, same build and schema copy")
    r.add_argument("--on-auth", default=None)
    r.add_argument("--off-auth", default=None)
    r.add_argument("--allow-remote", action="store_true")
    r.add_argument("--n", type=int, default=200)
    r.add_argument("--warmup", type=int, default=10)
    r.add_argument("--hook-on", help="hook command with the outcome signals on (timed as a subprocess)")
    r.add_argument("--hook-off", help="the same hook with them off")
    r.add_argument("--hook-stdin", help="file fed to the hook on stdin (a UserPromptSubmit / Stop payload)")
    sub.add_parser("selftest")
    a = ap.parse_args()
    return cmd_run(a) if a.cmd == "run" else cmd_selftest(a)


if __name__ == "__main__":
    sys.exit(main())

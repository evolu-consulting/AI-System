"""Run every consumer-simulator scenario against the dev KH, in order, and write a JSON report.

    .venv\\Scripts\\python tools\\stagef\\consumer_sim\\run_all.py [--only S01,S11] [--load-s 180]

Secrets come from the kh-dev-f container env (docker inspect) and stay in memory; the report holds none.
Report: tools/stagef/consumer_sim/out/run-<utc>.json (git-ignored).
"""
import argparse
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import simlib  # noqa: E402

SCENARIOS = [
    ("S01", "s01_attach"), ("S02", "s02_agents"), ("S03", "s03_spec_pack"), ("S04", "s04_rules"),
    ("S05", "s05_judge"), ("S06", "s06_lessons"), ("S07", "s07_vault"), ("S08", "s08_redaction"),
    ("S09", "s09_outbox"), ("S10", "s10_plugout"), ("S11", "s11_load"),
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="", help="comma list of scenario ids (S01 always runs first)")
    ap.add_argument("--load-s", type=float, default=None, help="S11 duration in seconds (default 180)")
    a = ap.parse_args()
    if a.load_s is not None:
        os.environ["KH_SIM_LOAD_S"] = str(a.load_s)
    only = {x.strip().upper() for x in a.only.split(",") if x.strip()}
    import importlib
    sim = simlib.Sim.connect()
    print(f"KH {sim.base}  namespace {sim.ns}  project {sim.project}")
    results = []
    t0 = time.time()
    for sid, modname in SCENARIOS:
        if only and sid not in only and sid != "S01":
            continue
        mod = importlib.import_module(modname)
        results.append(simlib.run_scenario(sim, sid, mod.TITLE, mod.run))
    import s01_attach
    s01_attach.stop_receiver()
    os.makedirs(os.path.join(HERE, "out"), exist_ok=True)
    path = os.path.join(HERE, "out", time.strftime("run-%Y%m%dT%H%M%SZ.json", time.gmtime()))
    with open(path, "w", encoding="utf-8") as f:
        json.dump(simlib.scrub({"base": sim.base, "ns": sim.ns, "started": t0, "seconds": round(time.time() - t0, 1),
                                "results": results}, depth=-50), f, indent=1, default=str)
    print("\n=== summary")
    for r in results:
        print(f"{r['id']}  {'PASS' if r['passed'] else 'FAIL'}  {r['checks']:3d} checks  {r['seconds']:6.1f} s  "
              f"{r['title']}")
        for c in r["failed"]:
            print(f"       FAIL {c['name']}")
        if r.get("error"):
            print(f"       ERROR {r['error']}")
    print(f"report: {path}")
    sys.exit(0 if all(r["passed"] for r in results) else 1)


if __name__ == "__main__":
    main()

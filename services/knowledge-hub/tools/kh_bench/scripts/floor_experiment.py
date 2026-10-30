"""Score floor: which similarity score keeps the rows a task needs and drops the rest? Measured on prod.

Roadmap item C, fix 2. Tier 1 makes three /vector/query reads per task (knowledge, log, entity, k=8),
so a task gets 17-24 rows whatever it asks. For each retrieval task this reads the same rows with
their scores, then for every candidate floor reports how many rows survive and how many of the task's
source rows (tasks.json "sources", the rows the answer lives in) survive.

Read-only; uses the bench account like tier 1.
  python floor_experiment.py [--env prod]
"""
import argparse, json, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import khbench as kb  # noqa: E402

FLOORS = [0.0, 0.55, 0.6, 0.62, 0.65, 0.68, 0.7, 0.72, 0.75]


def scored_rows(env, task):
    rows = []
    for scope in ("knowledge", "log", "entity"):
        body = {"text": task["prompt"], "scope": scope, "k": 8, "max_chars": 200}
        if task["project"]:
            body["project"] = task["project"]
        s, b, *_ = kb.call(env, "POST", "/vector/query", body)
        for h in (b.get("hits", []) if isinstance(b, dict) else []):
            rows.append({"scope": scope, "id": h["vector_id"], "score": h["score"]})
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--env", default="prod", choices=list(kb.ENVS))
    a = ap.parse_args()
    res = []
    for t in kb.TASKS["tasks"]:
        if t["category"] == "permission":
            continue
        rows = scored_rows(a.env, t)
        src = set(t["sources"])
        rec = {"task": t["id"], "category": t["category"], "rows": len(rows),
               "source_scores": {r["id"]: round(r["score"], 3) for r in rows if r["id"] in src},
               "floors": {}}
        for f in FLOORS:
            kept = [r for r in rows if r["score"] >= f]
            rec["floors"][str(f)] = {"rows": len(kept), "sources": len({r["id"] for r in kept} & src)}
        res.append(rec)
        print(json.dumps(rec), flush=True)
    total_src = sum(len(t["sources"]) for t in kb.TASKS["tasks"] if t["category"] != "permission")
    found_any = sum(len(r["source_scores"]) for r in res)
    print(f"\nsources in tasks {total_src}, reached by these reads at any score {found_any}")
    print("floor  rows  sources_kept")
    for f in FLOORS:
        n = sum(r["floors"][str(f)]["rows"] for r in res)
        s = sum(r["floors"][str(f)]["sources"] for r in res)
        print(f"{f:<5}  {n:>4}  {s:>3}")
    (kb.RESULTS / f"floor_experiment-{a.env}.json").write_text(json.dumps(res, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()

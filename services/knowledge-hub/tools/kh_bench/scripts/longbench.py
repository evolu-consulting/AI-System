"""Long-session bench (fen, 2026-10-04): the same 10-turn conversation through four hook set-ups, to measure where
the lazy-policy design should pay off - hooks that repeat every turn, and policies loaded once and reused.

  local-old  Rowan's local hooks as they were before the rollout (replayed by oldhooks.py)
  local-new  Rowan's local hooks now (KH 9000)
  prod-old   kh-helper to KH prod, with the pre-rollout kernel and prompt-guard replayed
  prod-new   kh-helper to KH prod as it is now

Every set-up uses compare3's read tools, deny rules and no Stop hook. Graded turns reuse tasks.json must-patterns.

  python longbench.py run [--runs 2] [--cases local-old,local-new,prod-old,prod-new]
Run from PowerShell (kh-helper's owner lock needs an unbroken Windows parent chain).
"""
import argparse, json, statistics, sys, time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import khbench as kb  # noqa: E402
import compare3 as c3  # noqa: E402

HERE = Path(__file__).parent
OLD = f'python "{(HERE / "oldhooks.py").as_posix()}"'
TASKS = {t["id"]: t for t in (lambda d: d["tasks"] if isinstance(d, dict) else d)(
    json.loads((kb.ROOT / "tasks.json").read_text(encoding="utf-8")))}
TURNS = [
    ("lô fen", None),
    (TASKS["W1"]["prompt"], "W1"),
    (TASKS["X2"]["prompt"], "X2"),
    (TASKS["R1"]["prompt"], "R1"),
    (TASKS["M3"]["prompt"], "M3"),
    (TASKS["P2"]["prompt"], "P2"),
    ("thanks. Summarise in 3 bullets what we covered about ticketing-system.", None),
    ("Project ticketing-system: who is Hugh Le there, in one line?", {"must": {"product owner": "product owner"}, "forbidden": {}}),
    ("What did the m360 project do most recently?", None),
    ("ok cảm ơn fen", None),
]


def files(case):
    base, _, variant = case.partition("-")
    d, allowed = c3.case_files(base)
    s = json.loads((d / "settings.json").read_text(encoding="utf-8"))
    if variant == "old":
        hook = lambda what: {"type": "command", "timeout": 90, "command": f"{OLD} {base} {what}"}
        if base == "local":
            s["hooks"]["SessionStart"] = [{"hooks": [hook("SessionStart"), hook("Personalization")]}]
        else:
            s["hooks"]["SessionStart"] = [{"hooks": [hook("SessionStart")]}]
        s["hooks"]["UserPromptSubmit"] = [{"hooks": [hook("UserPromptSubmit")]}]
    out = kb.ROOT / "run" / "longbench" / case
    out.mkdir(parents=True, exist_ok=True)
    (out / "settings.json").write_text(json.dumps(s, indent=1), encoding="utf-8")
    (out / "mcp.json").write_text((d / "mcp.json").read_text(encoding="utf-8"), encoding="utf-8")
    return out, allowed


def turn(case, prompt, sid, model):
    d, allowed = files(case)
    cmd = ["claude", "-p", prompt, "--output-format", "stream-json", "--verbose", "--model", model,
           "--setting-sources", "project", "--settings", str(d / "settings.json"),
           "--mcp-config", str(d / "mcp.json"), "--strict-mcp-config",
           "--allowedTools", ",".join(allowed), "--max-turns", c3.MAX_TURNS]
    for extra in c3.ADD_DIRS:
        cmd += ["--add-dir", extra]
    if sid:
        cmd += ["--resume", sid]
    r = kb.run_claude(cmd, c3.CWD)
    plans = [str(i)[:200] for n, i in r["uses"] if "policy/plan" in json.dumps(i)]
    r["policy_fetches"] = len(plans)
    r["tool_calls"] = len(r.pop("uses"))
    return r


def session_id(case):
    # the newest transcript of this case's cwd in the bench profile is the session just created
    proj = kb.PROFILE / "projects"
    files_ = sorted(proj.glob("*/*.jsonl"), key=lambda p: p.stat().st_mtime)
    return files_[-1].stem if files_ else None


def run(runs, cases, model):
    rec = {"model": model, "turns": [t for t, _ in TURNS], "runs": []}
    path = kb.RESULTS / f"longbench-{time.strftime('%Y%m%d-%H%M%S')}.json"
    for r in range(runs):
        for case in cases:
            sid, prev_cost = None, 0.0
            for i, (prompt, g) in enumerate(TURNS):
                x = turn(case, prompt, sid, model)
                sid = session_id(case)
                task = TASKS[g] if isinstance(g, str) else g
                x["score"] = kb.grade(task, x)["score"] if task else None
                cum = x["cost_usd"] or 0.0
                x["turn_cost"] = round(cum - prev_cost, 5) if cum >= prev_cost else cum
                prev_cost = cum if cum >= prev_cost else prev_cost + cum
                x.update(run=r + 1, case=case, turn=i + 1, session=sid)
                x.pop("answer_full", None)
                rec["runs"].append(x)
                print(json.dumps({k: x[k] for k in ("run", "case", "turn", "score", "input_tokens", "turn_cost",
                                                      "policy_fetches", "tool_calls")}), flush=True)
                path.write_text(json.dumps(rec, ensure_ascii=False, indent=1), encoding="utf-8")
    summary = {}
    for case in cases:
        rows = [x for x in rec["runs"] if x["case"] == case]
        per_run = {}
        for x in rows:
            per_run.setdefault(x["run"], []).append(x)
        totals = [{"cost": sum(y["turn_cost"] for y in v), "tokens": sum(y["input_tokens"] for y in v),
                   "score": sum(y["score"] for y in v if y["score"] is not None)} for v in per_run.values()]
        summary[case] = {k: round(statistics.median(t[k] for t in totals), 4) for k in ("cost", "tokens", "score")}
    rec["summary"] = summary
    path.write_text(json.dumps(rec, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps(summary, indent=1))
    print("saved", path)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["run"])
    ap.add_argument("--runs", type=int, default=2)
    ap.add_argument("--cases", default="local-old,local-new,prod-old,prod-new")
    ap.add_argument("--model", default=kb.DEFAULT_MODEL)
    a = ap.parse_args()
    run(a.runs, a.cases.split(","), a.model)

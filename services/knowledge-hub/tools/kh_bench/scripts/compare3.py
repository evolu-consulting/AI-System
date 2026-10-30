"""Token cost of the same question in three set-ups (Rowan, 2026-10-03; not a roadmap item).

  none   a clean Claude Code: no KH at all. It may search the disk and the internet until it answers.
  prod   the same, plus KH prod through kh-helper (its hooks and its MCP server), as a BTP user has it.
  local  the same, plus KH local 9000 through Rowan's own hooks, as Rowan works every day.

Every case runs on the bench profile's Claude login, from KH_BENCH_WORKSPACE with KH_BENCH_SCRATCH added, with the same
read tools (Read, Glob, Grep - inside those two folders only) and WebSearch/WebFetch. No case gets a general
shell, so nothing outside the two folders can be read; the local case may run curl, which is how its hooks
tell the model to reach KH. Denied in every case: KH's own data files, the bench profile (its transcripts hold
the answers), test credentials and the personal folder. The Stop hooks are left out of both KH cases: they
only check that a work log was written, which is not part of answering, and the local one would write the
bench's logs into Rowan's KH.

  python compare3.py probe                 one cheap run per case: tools, deny rules and KH reachability
  python compare3.py run [--runs 3] [--tasks R1,M3,W1,P2,X2] [--model M]
  python compare3.py report <result.json>  redraw the report of a finished run

Run from PowerShell (kh-helper's owner lock needs an unbroken Windows parent chain).
"""
import argparse, json, os, statistics, sys, time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import khbench as kb  # noqa: E402

CASES = ("none", "prod", "local")
DEFAULT_TASKS = "R1,M3,W1,P2,X2"
CWD = Path(os.environ.get("KH_BENCH_WORKSPACE") or sys.exit("set KH_BENCH_WORKSPACE (the folder every case runs in)"))
SCRATCH = Path(os.environ.get("KH_BENCH_SCRATCH") or sys.exit("set KH_BENCH_SCRATCH (the extra folder every case may read)"))
ADD_DIRS = [str(SCRATCH)]
KH_DIR = Path(__file__).resolve().parents[3]
MAX_TURNS = "60"
RUN_TIMEOUT = 1800
LOCAL_SETTINGS = Path(os.environ.get("KH_BENCH_LOCAL_SETTINGS") or Path.home() / ".claude" / "settings.json")  # hooks to a local KH
# Paths no case may read (POSIX form, as Claude Code permission rules take them).
def _posix(p):
    """C:\\x\\y -> //c/x/y, the form Claude Code permission rules take."""
    p = Path(p).resolve().as_posix()
    return "//" + p[0].lower() + p[2:] if len(p) > 1 and p[1] == ":" else p


DENY = [_posix(KH_DIR / d) + "/**" for d in ("chroma_data", "kuzu_data", "kuzu_projects", "logs", "output")]
DENY += [_posix(KH_DIR / "hooks.db")]
DENY += [_posix(SCRATCH) + p for p in ("/kh-bench/**", "/kh-test-accounts.json", "/kh-stepwise-trial-*",
                                       "/_personal/**", "/__claude/**")]
DENY_RULES = [f"{tool}({path})" for path in DENY for tool in ("Read", "Edit", "Grep", "Glob")]
WEB = ["WebSearch", "WebFetch"]


def case_files(case):
    """settings.json and mcp.json of one case, written under run/compare3/<case>."""
    d = kb.ROOT / "run" / "compare3" / case
    d.mkdir(parents=True, exist_ok=True)
    # No general shell in any case (Claude Code otherwise lets read-only shell commands through on its own):
    # the local case keeps Bash for the curl its hooks name, nothing else is allowed there.
    settings = {"permissions": {"deny": DENY_RULES + ["PowerShell", "Monitor"] + ([] if case == "local" else ["Bash"])}}
    mcp = {"mcpServers": {}}
    allowed = list(WEB)
    if case == "prod":
        py = str(kb.HELPER["prod"])
        settings["hooks"] = {e: [{"hooks": [{"type": "command", "timeout": 60,
                                             "command": f'"{py}" -m kh_helper.cli hook {e}'}]}]
                             for e in ("SessionStart", "UserPromptSubmit", "PreToolUse")}
        mcp = {"mcpServers": {"knowledge-hub": {"command": py, "args": ["-m", "kh_helper.cli", "--kh-url",
                                                                        kb.ENVS["prod"], "mcp"]}}}
        allowed.append("mcp__knowledge-hub")
    elif case == "local":
        hooks = json.loads(LOCAL_SETTINGS.read_text(encoding="utf-8"))["hooks"]
        settings["hooks"] = {e: g for e, g in hooks.items() if e != "Stop"}
        allowed += ["Bash(curl:*)", "Bash(curl.exe:*)"]
    (d / "settings.json").write_text(json.dumps(settings, indent=1), encoding="utf-8")
    (d / "mcp.json").write_text(json.dumps(mcp, indent=1), encoding="utf-8")
    return d, allowed


def run_case(case, prompt, model, task_id):
    d, allowed = case_files(case)
    cmd = ["claude", "-p", prompt, "--output-format", "stream-json", "--verbose", "--model", model,
           "--setting-sources", "project", "--settings", str(d / "settings.json"),
           "--mcp-config", str(d / "mcp.json"), "--strict-mcp-config",
           "--allowedTools", ",".join(allowed), "--max-turns", MAX_TURNS]
    for extra in ADD_DIRS:
        cmd += ["--add-dir", extra]
    r = kb.run_claude(cmd, CWD, timeout=RUN_TIMEOUT)
    uses = r.pop("uses")
    kinds = {"kh": 0, "disk": 0, "web": 0, "other": 0}
    for name, args in uses:
        kinds[kind_of(name, args)] += 1
    return {"case": case, "task": task_id, **r, "tools": kinds,
            "calls": [f"{n} {json.dumps(a, ensure_ascii=False)[:120]}" for n, a in uses]}


def kind_of(name, args):
    if name.startswith("mcp__knowledge-hub") or (name == "Bash" and ("127.0.0.1:9000" in str(args)
                                                                     or "kh.ps1" in str(args))):
        return "kh"
    if name in ("Read", "Glob", "Grep", "LS"):
        return "disk"
    if name in WEB:
        return "web"
    return "other"


def probe(model):
    """One cheap run per case: what it may read, what it is refused, and whether KH answers."""
    q = ("Do these three things and report each result in one line: (1) read " + (SCRATCH / "kh-test-accounts.json").as_posix() + "; "
         "(2) list three file names in " + (CWD / "TestArea").as_posix() + "; (3) if you have a Knowledge Hub (KH) tool or KH "
         "instructions, make one KH call that lists projects, else say 'no KH'.")
    for case in CASES:
        r = run_case(case, q, model, "probe")
        print(json.dumps({k: r[k] for k in ("case", "rc", "wall_s", "input_tokens", "turns", "tools", "mcp_ok")}))
        print("   ", r["answer"][:600].replace("\n", " / "))
        print("   ", r["calls"][:8])


def run(tasks, runs, model, partial):
    rec = {"kind": "compare3", "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "model": model,
           "cases": list(CASES), "runs": []}
    for n in range(1, runs + 1):
        for t in tasks:
            for case in CASES:          # the cases of one task run back to back, so load hits all three alike
                x = run_case(case, t["prompt"], model, t["id"])
                for retry in range(1, kb.MCP_RETRIES + 1):   # a prod run whose MCP did not connect measures the network
                    if x["mcp_ok"] is not False:
                        break
                    x = run_case(case, t["prompt"], model, t["id"])
                    x["mcp_retries"] = retry
                x["run"] = n
                x["grade"] = kb.grade(t, {**x, "state_ok": True})
                rec["runs"].append(x)
                partial.write_text(json.dumps(rec, indent=1, ensure_ascii=False), encoding="utf-8")
                print(json.dumps({k: x[k] for k in ("run", "case", "task", "rc", "wall_s", "input_tokens", "turns",
                                                    "cost_usd", "tools")} | {"score": x["grade"]["score"]}),
                      flush=True)
    return rec


def summarise(rec):
    """Medians per (case, task), and the sum of those medians per case."""
    per, totals = {}, {}
    for case in rec["cases"]:
        for tid in dict.fromkeys(x["task"] for x in rec["runs"]):
            xs = [x for x in rec["runs"] if x["case"] == case and x["task"] == tid]
            if not xs:
                continue
            per[(case, tid)] = {
                "score": statistics.median(x["grade"]["score"] for x in xs),
                "input_tokens": statistics.median(x["input_tokens"] for x in xs),
                "output_tokens": statistics.median(x["output_tokens"] for x in xs),
                "turns": statistics.median(x["turns"] or 0 for x in xs),
                "cost_usd": statistics.median(x["cost_usd"] or 0 for x in xs),
                "wall_s": statistics.median(x["wall_s"] for x in xs),
                **{f"{k}_calls": statistics.median(x["tools"][k] for x in xs) for k in ("kh", "disk", "web")},
                "subagents": statistics.median(x.get("subagents", 0) for x in xs),
                "runs": len(xs)}
        rows = [v for (c, _), v in per.items() if c == case]
        totals[case] = {k: round(sum(v[k] for v in rows), 4) for k in rows[0] if k != "runs"} if rows else {}
    return per, totals


def report(rec, name, store=True):
    per, totals = summarise(rec)
    base = totals.get("none", {}).get("input_tokens") or 0

    def vs(case):
        t = totals[case]["input_tokens"]
        return "" if case == "none" or not base else f" ({(t - base) / base:+.0%} vs none)"

    rows = "".join(
        f"<tr><td>{c}</td><td>{t['score']:.2f}</td><td>{t['input_tokens']:,.0f}{vs(c)}</td><td>{t['output_tokens']:,.0f}</td>"
        f"<td>{t['turns']:.0f}</td><td>${t['cost_usd']:.2f}</td><td>{t['wall_s']:.0f}</td>"
        f"<td>{t['kh_calls']:.0f} / {t['disk_calls']:.0f} / {t['web_calls']:.0f}</td><td>{t['subagents']:.0f}</td></tr>"
        for c, t in totals.items())
    tasks = list(dict.fromkeys(x["task"] for x in rec["runs"]))
    detail = "".join(
        f"<tr><td>{tid}</td>" + "".join(
            f"<td>{per[(c, tid)]['score']:.2f}</td><td>{per[(c, tid)]['input_tokens']:,.0f}</td>"
            f"<td>{per[(c, tid)]['turns']:.0f}</td>" if (c, tid) in per else "<td></td><td></td><td></td>"
            for c in rec["cases"]) + "</tr>" for tid in tasks)
    head = "".join(f"<th>{c} score</th><th>{c} tokens</th><th>{c} turns</th>" for c in rec["cases"])
    html = f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>KH token comparison</title><style>
:root{{--bg:#fff;--fg:#1d1d1f;--mute:#666;--line:#ddd}}
@media (prefers-color-scheme:dark){{:root{{--bg:#16161a;--fg:#ececf1;--mute:#a0a0aa;--line:#33333b}}}}
body{{background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif;margin:0}}
main{{max-width:1274px;margin:0 auto;padding:24px 16px}}.wrap{{overflow-x:auto}}
table{{border-collapse:collapse;margin:12px 0}}td,th{{border:1px solid var(--line);padding:6px 10px;text-align:right}}
td:first-child,th:first-child{{text-align:left}}.mute{{color:var(--mute)}}</style></head><body><main>
<h1>Token cost of one question: no KH, KH prod, KH local</h1>
<p class="mute">{rec['ts']} · model {rec['model']} · {len(rec['runs'])} runs · medians over runs, summed over tasks</p>
<div class="wrap"><table><tr><th>Case</th><th>Accuracy (of {len(tasks)})</th><th>Input tokens</th><th>Output tokens</th>
<th>Turns</th><th>Cost</th><th>Time s</th><th>KH / disk / web calls</th><th>Subagents</th></tr>{rows}</table></div>
<div class="wrap"><table><tr><th>Task</th>{head}</tr>{detail}</table></div>
<p class="mute">none: no KH, disk (workspace and scratch folders) and internet only. prod: plus kh-helper to KH prod.
local: plus Rowan's hooks to KH 9000. Same read tools and deny rules in every case; Stop hooks left out of both KH
cases. Accuracy is the share of each task's must-have points in the answer. Tokens count the whole run, subagents
included (modelUsage).</p></main></body></html>"""
    out = kb.REPORTS / f"{name}.html"
    out.write_text(html, encoding="utf-8")
    print(json.dumps(totals, indent=1))
    print("report:", out)
    if store:
        kb.store_on_9000(f"KH token comparison {name} (none / prod / local, {len(rec['runs'])} runs): "
                         f"{json.dumps(totals)}; report {out}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["probe", "run", "report"])
    ap.add_argument("file", nargs="?")
    ap.add_argument("--runs", type=int, default=3)
    ap.add_argument("--tasks", default=DEFAULT_TASKS)
    ap.add_argument("--model", default=kb.DEFAULT_MODEL)
    a = ap.parse_args()
    if a.cmd == "probe":
        probe(a.model)
    elif a.cmd == "run":
        stamp = time.strftime("%Y%m%d-%H%M%S")
        rec = run(kb.pick(a.tasks), a.runs, a.model, kb.RESULTS / f"compare3-{stamp}.partial.json")
        (kb.RESULTS / f"compare3-{stamp}.json").write_text(json.dumps(rec, indent=1, ensure_ascii=False), encoding="utf-8")
        kb.cleanup()        # the prod case writes as the bench account; the same cleanup as tier 2
        report(rec, f"compare3-{stamp}")
    else:
        report(json.loads(Path(a.file).read_text(encoding="utf-8")), Path(a.file).stem, store=False)


if __name__ == "__main__":
    main()

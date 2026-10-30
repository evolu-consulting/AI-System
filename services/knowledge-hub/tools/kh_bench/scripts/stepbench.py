"""A/B trial of the STEP-WISE KH hook rule on dev (kh-sso).

Runs a real headless Claude Code (claude -p) with ONLY the KH helper's hooks and MCP server (dev),
no local KH hooks, no other tools. Variant A = current dev hooks; B = the same plus the step-wise rule.
Measures per run: kh_call count, the paths called, tokens, duration, and which expected facts the
final answer contains.  Usage: python stepbench.py setup | run [repeats]
"""
import json, os, re, subprocess, sys, tempfile, time
from pathlib import Path
from kh_prod import req

DEV = "https://kh-sso.cfapps.br10.hana.ondemand.com"
PROFILE = os.environ.get("KH_BENCH_CLAUDE_PROFILE") or os.environ.get("CLAUDE_CONFIG_DIR") or str(Path.home() / ".claude")
PY = str(Path(PROFILE) / "kh-helper" / "Scripts" / "python.exe")
RUN_DIR = Path(os.environ.get("KH_BENCH_RUN_DIR") or Path(tempfile.gettempdir()) / "stepbench_run")
HERE = Path(__file__).parent

STEP_RULE = (
    "STEP-WISE KH. Before acting on a request, split it into the steps you will take and list them in one short line each.\n"
    "Before EACH step: ask KH for that step only - the step's intent plus the minimum context, never the whole message.\n"
    "  1. knowledge by graph (GET /entities/match and /entities/{project}/{name}) -> 2. knowledge by similarity "
    "(POST /vector/query scope knowledge, max_chars 600) -> 3. the project's worklog (POST /vector/query scope log), "
    "only if 1-2 return nothing relevant.\n"
    "  Time questions: GET /log/recent?project=<id>&limit=5&max_chars=600. When an action applies, read the rule of "
    "this step (GET /policy/rule).\n"
    "Fetch full text by id (POST /vector/scroll with ids) only for what you use. Keep each step's KH context small.\n"
    "After each step: note its outcome in one short line (done / not found / needs the person)."
)

TASKS = [
    {"id": "T1", "prompt": "Project ticketing-bench: I am about to redeploy the Ticketing System to Cloud Run. What must I "
     "prepare, where do its secrets live, and what should I check after the deploy? Answer from KH only.",
     "facts": {"ticketing-qa service": r"ticketing-qa", "region us-central1": r"us-central1",
               "Secret Manager / secretKeyRef": r"secret ?manager|secretkeyref", "session secret": r"solace-session-secret|session.secret",
               "SSO redirect / authorized domain": r"sso_redirect|redirect|authori[sz]ed.domain", "Actions deploy workflow": r"build & deploy|actions|workflow"}},
    {"id": "T2", "prompt": "Project ticketing-bench: mails labelled 'Internal' seem to be ignored by the email intake. Why, "
     "what are the options to fix it, and who should I ask about the SLA work? Answer from KH only.",
     "facts": {"Purview label": r"purview", "label encrypts mail": r"encrypt", "mails skipped": r"skip",
               "option: turn off encryption on the label": r"turn(ing)? off|disable|remove encryption",
               "Hugh Le": r"hugh", "Vincent Cao": r"vincent"}},
    {"id": "T3", "prompt": "Using the lessons in project knowledge-bench: cf push says it targets the wrong org, and a "
     "KH /vector/add answered ok but the log is nowhere to be found. Causes and fixes for both? Answer from KH only.",
     "facts": {"cf target / org": r"cf target|-o |org", "CF_HOME or login": r"cf_home|cf login",
               "scope must be top-level": r"top.level", "scope default knowledge": r"default", "read it back": r"read (it )?back|verify"}},
]


def setup():
    RUN_DIR.mkdir(parents=True, exist_ok=True)
    hooks = {e: [{"hooks": [{"type": "command", "timeout": 60,
                             "command": f'"{PY}" -m kh_helper.cli hook {e}'}]}]
             for e in ("SessionStart", "UserPromptSubmit", "PreToolUse", "Stop")}
    (HERE / "stepbench_settings.json").write_text(json.dumps({"hooks": hooks}, indent=1), encoding="utf-8")
    (HERE / "stepbench_mcp.json").write_text(json.dumps({"mcpServers": {"knowledge-hub": {
        "command": PY, "args": ["-m", "kh_helper.cli", "--kh-url", DEV, "mcp"],
        "env": {"CLAUDECODE": "1", "CLAUDE_CONFIG_DIR": PROFILE}}}}, indent=1), encoding="utf-8")
    print("rule", req(DEV, "POST", "/hooks/set", {"hook_type": "UserPromptSubmit", "name": "step-wise",
                                                   "content": STEP_RULE, "position": 5, "enabled": False})[0])


def variant(on: bool):
    s, b = req(DEV, "POST", "/hooks/set", {"hook_type": "UserPromptSubmit", "name": "step-wise",
                                           "content": STEP_RULE, "position": 5, "enabled": on})
    assert s == 200, b


def run_one(task, label):
    env = {**os.environ, "CLAUDE_CONFIG_DIR": PROFILE}
    for k in ("CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT", "CLAUDE_PID"):
        env.pop(k, None)
    cmd = ["claude", "-p", task["prompt"], "--output-format", "stream-json", "--verbose",
           "--setting-sources", "project", "--settings", str(HERE / "stepbench_settings.json"),
           "--mcp-config", str(HERE / "stepbench_mcp.json"), "--strict-mcp-config",
           "--allowedTools", "mcp__knowledge-hub__kh_call", "Bash(*kh_helper.cli call*)", "--max-turns", "40"]
    t = time.time()
    p = subprocess.run(cmd, cwd=RUN_DIR, env=env, capture_output=True, text=True, encoding="utf-8", timeout=1800,
                       creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    wall = time.time() - t
    calls, answer, usage, texts = [], "", {}, []
    for line in p.stdout.splitlines():
        try:
            ev = json.loads(line)
        except ValueError:
            continue
        if ev.get("type") == "assistant":
            texts.extend(c.get("text", "") for c in ev["message"].get("content", []) if c.get("type") == "text")
            for c in ev["message"].get("content", []):
                if c.get("type") == "tool_use" and c.get("name", "").endswith("kh_call"):
                    i = c.get("input", {}); calls.append(f'{i.get("method")} {str(i.get("path"))[:80]}')
                elif c.get("type") == "tool_use" and c.get("name") == "Bash" and "kh_helper.cli call" in str(c.get("input", {}).get("command", "")):
                    m = re.search(r"kh_helper\.cli call (\w+) (\S+)", c["input"]["command"])
                    calls.append(f"{m.group(1)} {m.group(2)[:80]}" if m else "call ?")
        if ev.get("type") == "result":
            usage = ev.get("usage") or {}; usage["cost_usd"] = ev.get("total_cost_usd")
            usage["num_turns"] = ev.get("num_turns")
    answer = "\n\n".join(t for t in texts if t.strip())
    low = answer.lower()
    got = {f: bool(re.search(rx, low)) for f, rx in task["facts"].items()}
    rec = {"task": task["id"], "variant": label, "kh_calls": len(calls), "calls": calls, "wall_s": round(wall, 1),
           "input_tokens": usage.get("input_tokens", 0) + usage.get("cache_read_input_tokens", 0) + usage.get("cache_creation_input_tokens", 0),
           "output_tokens": usage.get("output_tokens"), "cost_usd": usage.get("cost_usd"), "turns": usage.get("num_turns"),
           "facts_found": sum(got.values()), "facts_total": len(got), "facts": got, "answer": answer, "rc": p.returncode,
           "stderr": p.stderr[-400:]}
    print(json.dumps({k: rec[k] for k in ("task", "variant", "kh_calls", "wall_s", "input_tokens", "output_tokens", "facts_found", "facts_total", "rc")}), flush=True)
    return rec


if __name__ == "__main__":
    if sys.argv[1] == "setup":
        setup()
    else:
        repeats = int(sys.argv[2]) if len(sys.argv) > 2 else 1
        results = []
        for r in range(repeats):
            for label, on in (("A-current", False), ("B-stepwise", True)):
                variant(on)
                for task in TASKS:
                    results.append(run_one(task, label))
        variant(False)
        json.dump(results, open(HERE / "stepbench_result.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)

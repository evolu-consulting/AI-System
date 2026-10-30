"""KH bench: measure BTP dev (kh-sso, candidate) against BTP prod (knowledge-hub, baseline).

Operated from the local KH 9000 (Rowan, 2026-10-01): the task set, thresholds and every result live there.
The measured systems are only ever reached as the bench account kh-bench@kh-agent.invalid.

  python khbench.py tier1                    retrieval only, no LLM, all 18 tasks, dev and prod
  python khbench.py tier2 [--runs 3] [--tasks core|all|R1,M3] [--model M]
                                             real Claude Code (claude -p) on the bench profile
  python khbench.py report <result.json> [--expect "input_tokens:-50%"]
                                             grade, gate and write the HTML report again
  python khbench.py cleanup                  remove the bench account's worklogs on prod

Tier 2 uses the Claude login of the bench profile (KH_BENCH_PROFILE, else C:/ or E:/RWTemp/kh-bench/profile, else
~/.kh-bench/profile) and its two kh-helper copies:
kh-helper (prod) and kh-helper-dev (dev), both signed in once as the bench account (refresh token to 2026-12-30).
Run it from PowerShell, not Git Bash: the helper's owner lock needs an unbroken Windows parent chain.
"""
import argparse, json, os, re, statistics, subprocess, sys, time, urllib.error, urllib.parse, urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
# Project ids renamed on KH since tasks.json was written (2026-10-05 knowledge -> lesson-learned; later
# ticketing-system -> simplemdg-ticketing). Applied when the tasks are read, so tasks.json stays as written on
# the machine that maintains it; KH_BENCH_RENAMES='{"old": "new"}' adds or overrides.
RENAMES = {"knowledge": "lesson-learned", "ticketing-system": "simplemdg-ticketing",
           **json.loads(os.environ.get("KH_BENCH_RENAMES", "{}"))}
SHARED = RENAMES.get("knowledge", "knowledge")


def _renamed(raw: str) -> str:
    for old, new in RENAMES.items():
        raw = raw.replace(f'"project": "{old}"', f'"project": "{new}"').replace(f"ent__{old}__", f"ent__{new}__")
    return raw


TASKS = json.loads(_renamed((ROOT / "tasks.json").read_text(encoding="utf-8")))
SECRETS_DIR = Path(os.environ.get("KH_BENCH_SECRETS", Path.home() / ".claude_rowan" / "secrets"))
_secrets = {}


def secrets() -> dict:
    """kh-prod-accounts.json, read on first use (tier 2 runs and the HTML report do not need it up front)."""
    if not _secrets:
        f = SECRETS_DIR / "kh-prod-accounts.json"
        if not f.exists():
            sys.exit(f"missing {f}: copy the bench secrets folder to this machine (never into git) "
                     "or point KH_BENCH_SECRETS at it")
        _secrets.update(json.load(open(f, encoding="utf-8")))
    return _secrets


ENVS = {"prod": "https://knowledge-hub.cfapps.br10.hana.ondemand.com",
        "dev": os.environ.get("KH_BENCH_DEV_URL", "https://kh-sso.cfapps.br10.hana.ondemand.com")}


def _profile() -> Path:
    """The bench Claude profile stays outside the tool (its kh-helper venvs carry absolute paths).

    KH_BENCH_PROFILE wins; otherwise the first that exists of the known per-machine places.
    """
    if os.environ.get("KH_BENCH_PROFILE"):
        return Path(os.environ["KH_BENCH_PROFILE"])
    for p in (Path(r"C:\RWTemp\kh-bench\profile"), Path(r"E:\RWTemp\kh-bench\profile"),
              Path.home() / ".kh-bench" / "profile"):
        if p.exists():
            return p
    return Path.home() / ".kh-bench" / "profile"


PROFILE = _profile()
HELPER = {"prod": PROFILE / "kh-helper" / "Scripts" / "python.exe",
          "dev": PROFILE / "kh-helper-dev" / "Scripts" / "python.exe"}
RESULTS = ROOT / "results"
REPORTS = ROOT / "reports"
# Where results are stored (the operator's local KH). Empty = do not store: a machine whose 9000 is an old
# build (the E: machine, 2026-10-10) keeps them in results/ and reports/ only.
LOCAL_KH = os.environ.get("KH_BENCH_LOCAL_KH", "http://127.0.0.1:9000").strip()
DEFAULT_MODEL = "claude-sonnet-5-5"
MCP_TIMEOUT_MS = 120000      # Claude Code's MCP start-up wait for the bench runs (default 30 s)
MCP_RETRIES = 2              # a run whose KH MCP did not connect is run again, at most this often
# Global guard (every feature): accuracy may not drop, tokens and cost may not rise more than 10%.
GUARD = {"accuracy": ("min_delta", 0.0), "input_tokens": ("max_rise", 0.10), "cost_usd": ("max_rise", 0.10)}


# ── HTTP and tokens ───────────────────────────────────────────────────────────

_tok = {}


def token(who: str) -> str:
    t = _tok.get(who)
    if t and time.time() - t[1] < 200:
        return t[0]
    acct = secrets()["accounts"][who]
    body = urllib.parse.urlencode({"grant_type": "password", "client_id": "kh-test-password",
                                   "username": acct["email"], "password": acct["password"]}).encode()
    for attempt in range(5):  # DNS blips on this network (getaddrinfo) are common; retry them
        try:
            kc = secrets()["keycloak"] + "/realms/knowledge-hub"
            tok = json.load(urllib.request.urlopen(kc + "/protocol/openid-connect/token", body,
                                                   timeout=60))["access_token"]
            break
        except (urllib.error.URLError, OSError):
            if attempt == 4:
                raise
            time.sleep(3)
    _tok[who] = (tok, time.time())
    return tok


def call(env, method, path, body=None, who="kh-bench"):
    url = ENVS[env] + path
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, method=method,
                                 headers={"Authorization": "Bearer " + token(who), "Content-Type": "application/json"})
    t = time.time()
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                raw = r.read()
                try:
                    body = json.loads(raw) if raw else None
                except ValueError:
                    body = raw.decode(errors="replace")  # plain-text routes (/hooks/raw, /personalization/render)
                return r.status, body, time.time() - t, len(raw)
        except urllib.error.HTTPError as e:
            raw = e.read()
            return e.code, raw[:300].decode(errors="replace"), time.time() - t, len(raw)
        except (urllib.error.URLError, OSError):
            if attempt == 2:
                raise
            time.sleep(3)


def local_kh(path, body):
    req = urllib.request.Request(LOCAL_KH + path, data=json.dumps(body).encode(), method="POST",
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def pick(spec):
    if spec in (None, "core"):
        ids = TASKS["core"]
    elif spec == "all":
        ids = [t["id"] for t in TASKS["tasks"]]
    else:
        ids = spec.split(",")
    return [t for t in TASKS["tasks"] if t["id"] in ids]


# ── Tier 1: retrieval, no LLM ─────────────────────────────────────────────────

def hook_bytes(env):
    """What the hooks inject: bytes of each hook text served to the bench account."""
    out = {}
    for h in ("SessionStart", "UserPromptSubmit", "PreToolUse", "Stop"):
        s, b, _, n = call(env, "GET", f"/hooks/raw?hook_type={h}")
        out[h] = n if s == 200 else None
    s, b, _, n = call(env, "GET", "/personalization/render")
    out["personalization"] = n if s == 200 else None
    return out


def coverage(task, text):
    """Share of the task's must-have points present in ``text`` (a proxy: the answer is in the context)."""
    low = text.lower()
    must = task.get("must") or {}
    return round(sum(bool(re.search(rx, low)) for rx in must.values()) / len(must), 2) if must else None


def retrieve(env, task):
    """The reads an assistant would make for this task; returns the ids seen, bytes, latencies, text."""
    seen, nbytes, lat, status, texts = set(), 0, [], [], []
    q, proj = task["prompt"], task["project"]
    reads = []
    for scope in ("knowledge", "log", "entity"):
        body = {"text": q, "scope": scope, "k": 8, "max_chars": 600}
        if proj:
            body["project"] = proj
        reads.append(("POST", "/vector/query", body))
    if proj:
        reads.append(("GET", "/entities/match?" + urllib.parse.urlencode({"text": q, "project": proj}), None))
        if task["category"] == "recency":
            reads.append(("GET", f"/log/recent?project={urllib.parse.quote(proj)}&limit=20&max_chars=600", None))
    for m, p, b in reads:
        s, body, dt, n = call(env, m, p, b)
        status.append(s)
        lat.append(dt)
        nbytes += n
        if isinstance(body, dict):
            for h in body.get("hits") or body.get("results") or body.get("entities") or []:
                if isinstance(h, dict):
                    seen.add(h.get("vector_id") or h.get("id"))
            text = json.dumps(body)
            seen.update(re.findall(r"(?:vec|mig|ent)_[A-Za-z0-9_\-.]+", text))
            texts.append(json.dumps(body, ensure_ascii=False))
    return seen, nbytes, lat, status, "\n".join(texts)


def step_probe(env, task):
    """Roadmap item C: the same task as ONE /context/step call. None where the route does not exist."""
    body = {"text": task["prompt"]}
    if task["project"]:
        body["project"] = task["project"]
    s, b, dt, n = call(env, "POST", "/context/step", body)
    if s == 404 or not isinstance(b, dict):
        return None
    ids = {i.get("id") for i in b.get("items", [])}
    text = json.dumps(b, ensure_ascii=False)
    ids.update(re.findall(r"(?:vec|mig|ent)_[A-Za-z0-9_\-.]+", text))
    found = [x for x in task["sources"] if x in ids]
    return {"recall": len(found) / len(task["sources"]) if task["sources"] else None, "bytes": n,
            "coverage": coverage(task, text), "latency_s": round(dt, 3), "tiers": b.get("tiers"),
            "count": b.get("count")}


def tier1(envs=None):
    rec = {"tier": 1, "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "envs": {}}
    for env in envs or ENVS:
        e = {"hook_bytes": hook_bytes(env), "tasks": {}}
        for t in TASKS["tasks"]:
            r = {"category": t["category"]}
            if t["category"] == "permission":
                r.update(permission_probe(env, t))
            else:
                seen, nbytes, lat, status, text = retrieve(env, t)
                found = [s for s in t["sources"] if s in seen]
                r.update({"recall": len(found) / len(t["sources"]) if t["sources"] else None,
                          "missing": [s for s in t["sources"] if s not in seen],
                          "bytes": nbytes, "coverage": coverage(t, text),
                          "latency_s": [round(x, 3) for x in lat], "status": status,
                          "step": step_probe(env, t)})
            e["tasks"][t["id"]] = r
            print(env, t["id"], {k: v for k, v in r.items() if k not in ("latency_s",)}, flush=True)
        lats = [x for r in e["tasks"].values() for x in r.get("latency_s", [])]
        e["p50_s"] = round(statistics.median(lats), 3) if lats else None
        e["p95_s"] = round(sorted(lats)[int(0.95 * (len(lats) - 1))], 3) if lats else None
        rec["envs"][env] = e
    return rec


def permission_probe(env, t):
    if t["id"] == "A1":
        s, *_ = call(env, "POST", "/vector/scroll", {"scope": "log", "project": t["project"], "limit": 1})
        return {"ok": s == 403, "status": s}
    if t["id"] == "A2":
        s, b, *_ = call(env, "GET", "/projects")
        ids = sorted((b.get("projects") or {}).keys()) if isinstance(b, dict) else []
        leaked = [k for k in t["forbidden"] if k in ids]
        return {"ok": s == 200 and not leaked, "leaked": leaked, "status": s}
    if t["id"] == "A3":
        s, *_ = call(env, "POST", "/vector/add", {"scope": "knowledge", "text": "BENCH-A3 tier1 probe",
                                                  "metadata": {"project": SHARED}})
        return {"ok": s == 403 and state_clean(env), "status": s}
    return {"ok": None}


def state_clean(env):
    """A3: no row containing BENCH-A3 in the shared project (read as agent-admin)."""
    s, b, *_ = call(env, "POST", "/vector/scroll", {"scope": "knowledge", "project": SHARED, "limit": 2000,
                                                     "max_chars": 200}, who="agent-admin")
    return s == 200 and not any("BENCH-A3" in (h.get("source_text") or "") for h in b.get("hits", []))


# ── Tier 2: real Claude Code ──────────────────────────────────────────────────

def env_files(env):
    py = str(HELPER[env])
    hooks = {e: [{"hooks": [{"type": "command", "timeout": 60, "command": f'"{py}" -m kh_helper.cli hook {e}'}]}]
             for e in ("SessionStart", "UserPromptSubmit", "PreToolUse", "Stop")}
    d = ROOT / "run" / env
    d.mkdir(parents=True, exist_ok=True)
    (d / "settings.json").write_text(json.dumps({"hooks": hooks}, indent=1), encoding="utf-8")
    (d / "mcp.json").write_text(json.dumps({"mcpServers": {"knowledge-hub": {
        "command": py, "args": ["-m", "kh_helper.cli", "--kh-url", ENVS[env], "mcp"]}}}, indent=1), encoding="utf-8")
    return d


def run_claude(cmd, cwd, timeout=1800):
    """Run one headless Claude Code (stream-json) on the bench profile and read back what it did.

    Returns rc, wall_s, input/output tokens, turns, cost, every tool use as (name, input), the answer text,
    the tail of stderr and whether the knowledge-hub MCP server connected (None when none was configured).
    """
    # MCP_TIMEOUT: the helper's MCP server calls KH and Keycloak before it answers the handshake, so on a slow
    # network it misses Claude Code's 30 s default and the whole run goes without KH (9 of 36 runs, 2026-10-03).
    environ = {**os.environ, "CLAUDE_CONFIG_DIR": str(PROFILE), "PYTHONIOENCODING": "utf-8",
               "MCP_TIMEOUT": str(MCP_TIMEOUT_MS)}
    for k in ("CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT", "CLAUDE_PID"):
        environ.pop(k, None)  # the bench run is its own Claude Code, not a child of the operator's
    t = time.time()
    p = subprocess.run(cmd, cwd=cwd, env=environ, capture_output=True, text=True, encoding="utf-8", timeout=timeout,
                       creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    wall = time.time() - t
    texts, uses, usage, result, mcp_ok, turns = [], [], {}, {}, None, 0
    for line in p.stdout.splitlines():
        try:
            ev = json.loads(line)
        except ValueError:
            continue
        if ev.get("type") == "system" and ev.get("subtype") == "init":
            servers = ev.get("mcp_servers") or []
            if any(m.get("name") == "knowledge-hub" for m in servers):
                mcp_ok = any(m.get("name") == "knowledge-hub" and m.get("status") == "connected" for m in servers)
        elif ev.get("type") == "assistant":
            for c in ev["message"].get("content", []):
                if c.get("type") == "text":
                    texts.append(c.get("text", ""))
                elif c.get("type") == "tool_use":
                    uses.append((c.get("name") or "", c.get("input") or {}))
        elif ev.get("type") == "result":
            # A run that used a subagent can emit more than one result event, and `usage` counts the main
            # agent only; `modelUsage` is the whole run, subagents included (found 2026-10-03, compare3).
            turns = max(turns, ev.get("num_turns") or 0)
            result, usage = ev, ev.get("usage") or {}
    models = list((result.get("modelUsage") or {}).values())
    if models:
        tokens_in = sum(m.get("inputTokens", 0) + m.get("cacheReadInputTokens", 0)
                        + m.get("cacheCreationInputTokens", 0) for m in models)
        tokens_out = sum(m.get("outputTokens", 0) for m in models)
    else:
        tokens_in = usage.get("input_tokens", 0) + usage.get("cache_read_input_tokens", 0)             + usage.get("cache_creation_input_tokens", 0)
        tokens_out = usage.get("output_tokens", 0)
    return {"rc": p.returncode, "wall_s": round(wall, 1), "input_tokens": tokens_in,
            "output_tokens": tokens_out, "turns": turns or result.get("num_turns"),
            "subagents": sum(1 for n, _ in uses if n in ("Agent", "Task")),
            "cost_usd": result.get("total_cost_usd"), "uses": uses,
            "answer": "\n\n".join(x for x in texts if x.strip()), "stderr": p.stderr[-400:], "mcp_ok": mcp_ok}


def run_one(env, task, model):
    d = env_files(env)
    cmd = ["claude", "-p", task["prompt"], "--output-format", "stream-json", "--verbose", "--model", model,
           "--setting-sources", "project", "--settings", str(d / "settings.json"),
           "--mcp-config", str(d / "mcp.json"), "--strict-mcp-config",
           "--allowedTools", "mcp__knowledge-hub", "--max-turns", "40"]  # every helper tool, as a real user has
    r = run_claude(cmd, d)
    calls = [f'{n} {i.get("method", "")} {str(i.get("path", ""))[:80]}'.strip() for n, i in r.pop("uses")]
    return {"env": env, "task": task["id"], **r, "kh_calls": len(calls), "calls": calls}


def tier2(tasks, runs, model, partial=None):
    """Every run is appended to ``partial`` as it finishes, so a run that is cut off keeps what it measured."""
    rec = {"tier": 2, "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "model": model, "runs": []}
    for r in range(runs):
        for task in tasks:
            for env in ENVS:  # alternate sides so time-of-day load hits both equally
                x = run_one(env, task, model)
                for retry in range(1, MCP_RETRIES + 1):   # a run without KH measures the network, not KH
                    if x["mcp_ok"] is not False:
                        break
                    print(json.dumps({"retry": retry, "env": env, "task": task["id"], "reason": "mcp not connected"}),
                          flush=True)
                    x = run_one(env, task, model)
                    x["mcp_retries"] = retry
                x["run"] = r + 1
                if task.get("state_check"):
                    x["state_ok"] = state_clean(env)
                rec["runs"].append(x)
                if partial:
                    partial.write_text(json.dumps(rec, indent=1, ensure_ascii=False), encoding="utf-8")
                print(json.dumps({k: x[k] for k in ("run", "env", "task", "rc", "wall_s", "input_tokens",
                                                    "turns", "cost_usd", "kh_calls")}), flush=True)
    return rec


# ── Grading, gate, report ─────────────────────────────────────────────────────

def grade(task, run):
    low = run["answer"].lower()
    got = {k: bool(re.search(rx, low)) for k, rx in task["must"].items()}
    bad = [k for k, rx in task["forbidden"].items() if re.search(rx, low)]
    ok_state = run.get("state_ok", True)
    score = 0.0 if bad or not ok_state or run["rc"] != 0 else sum(got.values()) / len(got)
    return {"score": score, "got": got, "forbidden_hit": bad, "state_ok": ok_state}


def summarise(rec):
    by = {}
    tasks = {t["id"]: t for t in TASKS["tasks"]}
    for x in rec["runs"]:
        g = grade(tasks[x["task"]], x)
        x["grade"] = g
        by.setdefault((x["env"], x["task"]), []).append(x)
    out = {}
    for (env, tid), xs in by.items():
        s = out.setdefault(env, {}).setdefault(tid, {})
        for m in ("input_tokens", "output_tokens", "turns", "cost_usd", "wall_s", "kh_calls"):
            vals = [v[m] for v in xs if v.get(m) is not None]
            s[m] = {"median": statistics.median(vals) if vals else None,
                    "min": min(vals) if vals else None, "max": max(vals) if vals else None}
        sc = [v["grade"]["score"] for v in xs]
        s["accuracy"] = {"median": statistics.median(sc), "min": min(sc), "max": max(sc)}
    totals = {}
    for env, ts in out.items():
        totals[env] = {m: sum(t[m]["median"] or 0 for t in ts.values())
                       for m in ("accuracy", "input_tokens", "output_tokens", "turns", "cost_usd", "wall_s", "kh_calls")}
    return out, totals


def gate(per_task, totals, expect, runs=()):
    checks = []
    # a leak or a broken state check in ANY dev run fails the gate: a median would hide one bad run in three
    leaks = sorted({f"{x['task']} run {x['run']}" for x in runs if x["env"] == "dev"
                    and (x["grade"]["forbidden_hit"] or not x["grade"]["state_ok"])})
    checks.append(("no leak / no forbidden write on dev", not leaks, ", ".join(leaks) or "none"))
    dev, prod = totals.get("dev", {}), totals.get("prod", {})
    # a difference inside the spread of either side is a tie, reported but not a failure
    ties = []
    for tid in per_task.get("dev", {}):
        a, b = per_task["dev"][tid]["accuracy"], per_task.get("prod", {}).get(tid, {}).get("accuracy")
        if b and a["median"] < b["median"] and a["max"] >= b["min"]:
            ties.append(tid)
    for m, (kind, lim) in GUARD.items():
        if m not in dev or not prod.get(m):
            continue
        if kind == "min_delta":
            # every task that went down is a tie: the drop is noise, so the guard holds (2026-10-02 baseline:
            # with identical code and data, P2 ranged 0.4-0.8 across three runs on one side)
            dropped = [t for t in per_task.get("dev", {}) if per_task.get("prod", {}).get(t)
                       and per_task["dev"][t]["accuracy"]["median"] < per_task["prod"][t]["accuracy"]["median"]]
            ok = dev[m] >= prod[m] - lim - 1e-9 or (m == "accuracy" and set(dropped) <= set(ties))
            checks.append((f"guard {m}", ok, f"dev {dev[m]:.2f} vs prod {prod[m]:.2f}"))
        else:
            rise = (dev[m] - prod[m]) / prod[m]
            checks.append((f"guard {m}", rise <= lim, f"{rise:+.1%} (limit +{lim:.0%})"))
    for e in expect or []:
        m, pct = e.split(":")
        want = float(pct.strip("%")) / 100
        if prod.get(m):
            change = (dev[m] - prod[m]) / prod[m]
            ok = change <= want if want < 0 else change >= want
            checks.append((f"expect {m} {pct}", ok, f"{change:+.1%}"))
    return checks, ties


def html_report(rec, per_task, totals, checks, ties, path):
    esc = lambda s: str(s).replace("&", "&amp;").replace("<", "&lt;")
    rows = []
    for tid in sorted({t for env in per_task.values() for t in env}):
        cells = []
        for env in ("prod", "dev"):
            s = per_task.get(env, {}).get(tid)
            cells.append("<td>-</td>" * 4 if not s else
                         f"<td>{s['accuracy']['median']:.2f}</td><td>{s['input_tokens']['median']:,.0f}</td>"
                         f"<td>{s['turns']['median']}</td><td>${(s['cost_usd']['median'] or 0):.3f}</td>")
        rows.append(f"<tr><td>{tid}</td>{''.join(cells)}</tr>")
    chk = "".join(f"<tr><td>{esc(n)}</td><td class={'ok' if ok else 'bad'}>{'PASS' if ok else 'FAIL'}</td>"
                  f"<td>{esc(d)}</td></tr>" for n, ok, d in checks)
    verdict = "PASS: dev may go to prod" if checks and all(c[1] for c in checks) else "FAIL: do not upgrade prod"
    page = f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>KH bench report</title><style>
:root{{--bg:#fafaf9;--fg:#1c1c1a;--mut:#6b6b66;--line:#e4e4e0;--card:#fff;--ok:#2f6f5e;--bad:#a4412f}}
@media (prefers-color-scheme:dark){{:root{{--bg:#161615;--fg:#e8e8e4;--mut:#9a9a93;--line:#2c2c2a;--card:#1d1d1b;--ok:#6fb8a3;--bad:#e08a78}}}}
body{{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,Segoe UI,sans-serif}}main{{max-width:1274px;margin:0 auto;padding:24px 16px}}
table{{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--line);margin:10px 0 20px;font-size:14px}}
th,td{{padding:6px 9px;border-bottom:1px solid var(--line);text-align:left}}th{{color:var(--mut);font-size:12px}}
.ok{{color:var(--ok);font-weight:600}}.bad{{color:var(--bad);font-weight:600}}.wrap{{overflow-x:auto}}
</style></head><body><main><h1>KH bench: dev vs prod</h1>
<p>{esc(rec['ts'])} · model {esc(rec.get('model'))} · {len(rec['runs'])} runs · ties (inside the spread): {esc(', '.join(ties) or 'none')}</p>
<p class="{'ok' if verdict.startswith('PASS') else 'bad'}">{verdict}</p>
<div class="wrap"><table><tr><th>Check</th><th>Result</th><th>Detail</th></tr>{chk}</table></div>
<div class="wrap"><table><tr><th>Totals</th><th>Accuracy</th><th>Input tokens</th><th>Turns</th><th>Cost</th><th>Time s</th><th>KH calls</th></tr>
{''.join(f"<tr><td>{e}</td><td>{t['accuracy']:.2f}</td><td>{t['input_tokens']:,.0f}</td><td>{t['turns']}</td><td>${t['cost_usd']:.2f}</td><td>{t['wall_s']:.0f}</td><td>{t['kh_calls']}</td></tr>" for e, t in totals.items())}
</table></div>
<div class="wrap"><table><tr><th>Task</th><th>prod acc</th><th>prod tokens</th><th>prod turns</th><th>prod cost</th>
<th>dev acc</th><th>dev tokens</th><th>dev turns</th><th>dev cost</th></tr>{''.join(rows)}</table></div>
<p>Medians over runs. Accuracy is the share of must-have points; a forbidden match, a failed state check or a crashed run scores 0.</p>
</main></body></html>"""
    path.write_text(page, encoding="utf-8")


def store_on_9000(summary_text, topic="kh-bench-results"):
    if not LOCAL_KH:
        print("KH_BENCH_LOCAL_KH is empty: result kept in results/ and reports/ only", flush=True)
        return
    ts = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    local_kh("/vector/add", {"scope": "log", "text": f"{ts} ({ts[:10]}) - {summary_text}",
                             "metadata": {"scope": "log", "subject": topic, "topic": topic,
                                          "project": "knowledge-hub", "ts": ts}})


def report(rec, expect, name, store=True):
    """Grade, gate and write the HTML. store=False when only redrawing a result already stored on 9000."""
    per_task, totals = summarise(rec)
    checks, ties = gate(per_task, totals, expect, rec["runs"])
    REPORTS.mkdir(exist_ok=True)
    path = REPORTS / f"{name}.html"
    html_report(rec, per_task, totals, checks, ties, path)
    passed = bool(checks) and all(c[1] for c in checks)
    if store:
        store_on_9000(f"KH bench tier 2 {name}: {'PASS' if passed else 'FAIL'}; totals {json.dumps(totals)}; "
                      f"checks {json.dumps(checks)}; ties {ties}; report {path}")
    print("report:", path, "PASS" if passed else "FAIL")
    return passed


def cleanup():
    """Remove the bench account's worklogs from prod (dev is refreshed from prod anyway)."""
    email = secrets()["accounts"]["kh-bench"]["email"]
    s, b, *_ = call("prod", "GET", f"/log/by?author={urllib.parse.quote(email)}&limit=500", who="agent-admin")
    ids = [h["vector_id"] for h in (b.get("hits", []) if isinstance(b, dict) else [])]
    if ids:
        s2, b2, *_ = call("prod", "POST", "/vector/delete", {"ids": ids}, who="agent-admin")
        print("deleted", len(ids), s2)
    else:
        print("nothing to delete", s)


def _mean(xs):
    xs = [x for x in xs if x is not None]
    return round(statistics.mean(xs), 3) if xs else None


def _step_brief(e):
    steps = [t["step"] for t in e["tasks"].values() if t.get("step")]
    if not steps:
        return None
    return {"recall": _mean([x["recall"] for x in steps]), "coverage": _mean([x["coverage"] for x in steps]),
            "bytes": sum(x["bytes"] for x in steps), "p50_s": round(statistics.median([x["latency_s"] for x in steps]), 3)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["tier1", "tier2", "report", "cleanup"])
    ap.add_argument("file", nargs="*", help="report: one or more tier 2 result files, merged run by run")
    ap.add_argument("--runs", type=int, default=3)
    ap.add_argument("--tasks", default="core")
    ap.add_argument("--model", default=DEFAULT_MODEL)
    ap.add_argument("--expect", action="append")
    ap.add_argument("--env", choices=list(ENVS), help="tier1 on one side only")
    a = ap.parse_args()
    RESULTS.mkdir(exist_ok=True)
    stamp = time.strftime("%Y%m%d-%H%M%S")
    if a.cmd == "tier1":
        rec = tier1([a.env] if a.env else None)
        f = RESULTS / f"tier1-{stamp}.json"
        f.write_text(json.dumps(rec, indent=1), encoding="utf-8")
        brief = {env: {"p50_s": e["p50_s"], "p95_s": e["p95_s"], "hook_bytes": e["hook_bytes"],
                       "recall": round(statistics.mean([t["recall"] for t in e["tasks"].values()
                                                        if t.get("recall") is not None]), 3),
                       "bytes": sum(t.get("bytes", 0) for t in e["tasks"].values()),
                       "coverage": _mean([t.get("coverage") for t in e["tasks"].values()]),
                       "step": _step_brief(e),
                       "permission_ok": all(t["ok"] for t in e["tasks"].values() if "ok" in t)}
                 for env, e in rec["envs"].items()}
        print(json.dumps(brief, indent=1))
        store_on_9000(f"KH bench tier 1 {stamp}: {json.dumps(brief)}; file {f}")
    elif a.cmd == "tier2":
        f = RESULTS / f"tier2-{stamp}.json"
        rec = tier2(pick(a.tasks), a.runs, a.model, partial=RESULTS / f"tier2-{stamp}.partial.json")
        f.write_text(json.dumps(rec, indent=1, ensure_ascii=False), encoding="utf-8")
        cleanup()
        sys.exit(0 if report(rec, a.expect, f"tier2-{stamp}") else 1)
    elif a.cmd == "report":
        recs = [json.loads(Path(x).read_text(encoding="utf-8")) for x in a.file]
        rec, offset = dict(recs[0], runs=[]), 0
        for r in recs:  # later files continue the run numbering, so runs from two sittings stay apart
            rec["runs"] += [dict(x, run=x["run"] + offset) for x in r["runs"]]
            offset = max([x["run"] for x in rec["runs"]], default=0)
        name = Path(a.file[0]).stem + ("" if len(a.file) == 1 else f"+{len(a.file) - 1}")
        # one file: its result is already on 9000; a merge is a new result
        sys.exit(0 if report(rec, a.expect, name, store=len(a.file) > 1) else 1)
    else:
        cleanup()


if __name__ == "__main__":
    main()

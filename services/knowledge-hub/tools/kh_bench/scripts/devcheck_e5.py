"""Roadmap E-5 dev integration (slice S15, docs/roadmap-e-to-5-design.md section 10) on the Docker dev KH.

DEV ONLY. Every command refuses a URL that is not local, and nothing here reads or writes prod (BTP, the prod
Keycloak admin, HANA Cloud). Secrets (the HANA password, the dev bootstrap token, the principal signing key, client
secrets) live in memory or in the container's environment only; they are never printed, logged or written to disk.

  python devcheck_e5.py up      [--name kh-dev-f] [--port 9102] [--flags on|off] [--learn-mode record]
                                [--improve-mode shadow] [--bench-hook] [--volume V] [--clone-volume-from V]
                                [--env K=V ...]
        (re)create a dev container from kh-dev:e5 with the section 10 env. Non-secret settings and the HANA
        credentials are copied from --source (default: the container itself, else kh-dev-f) via docker inspect;
        a FRESH dev bootstrap token and a FRESH Ed25519 principal signing key are generated per run, in memory,
        and handed to `docker run -e NAME` through the child environment (never on a command line).
  python devcheck_e5.py health  [--url U] [--container C]       /health, /v1/capabilities, the five E-5 modules
  python devcheck_e5.py seed    --src rows.ndjson [--projects a,b]
        the seeded dev copy into 9102: projects created inside the container, rows through POST /vector/add
        (dev re-embeds). rows.ndjson = a dump of another DEV KH's Chroma ({collection, id, text, metadata}).
  python devcheck_e5.py pour    --src rows.ndjson --from P --to NEW [--days 14] [--waves 4] [--end-days-ago 0]
        "a new project, then real logs of another project poured into it gradually": the logs of P in time order,
        their ts compressed into the last --days days (order kept), written in --waves waves.
  python devcheck_e5.py worker  --mode dry|on --llm dry|claude_cli --job distil|daily --project P [...]
                                [--cap-run 1] [--cap-month 5] [--kh-cap-month X]
        one worker run (worker/kh_worker, in-process CLI) with the kh_people namespace client (rotated, in memory)
  python devcheck_e5.py leaks   [--seed] [--worker-llm claude_cli|dry]   G5: leak set distilled live, scan = 0 hits
  python devcheck_e5.py trial   [--sessions 80]                    phase 3 mechanics (2 x N synthetic sessions)
  python devcheck_e5.py redteam                                     phase 5 shadow: red team + one param proposal
  python devcheck_e5.py crons   --wait learn_gate,learn_decide      restart the container and wait for its crons

Exit codes: 0 pass, 1 fail, 2 skipped / indicative.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import random
import secrets
import subprocess
import sys
import time
import urllib.parse
from datetime import datetime, timedelta, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
KH_BENCH = HERE.parent
APP_ROOT = KH_BENCH.parent.parent
sys.path.insert(0, str(HERE))
import p1bench  # noqa: E402  (KH client, dev-bootstrap auth, leak matcher)

IMAGE = "kh-dev:e5"
DEV_URL = "http://127.0.0.1:9102"
# Env of the base image (python:3.12-slim + deploy/docker/Dockerfile): never copied from a source container.
IMAGE_ENV = {"PATH", "LANG", "GPG_KEY", "PYTHON_VERSION", "PYTHON_SHA256", "PYTHONUNBUFFERED", "HOME", "HOSTNAME"}
SECRET_ENV = ("HANA_PASSWORD", "KH_DEV_BOOTSTRAP_TOKEN", "KH_PRINCIPAL_SIGNING_KEY", "KH_BENCH_HOOK_TOKEN")
# Section 10, item 1 (+ the S12 daily tier, + the KH-side month cap at the dev worker's $5).
FLAGS_ON = {"KH_CAP_PEOPLE": "on", "KH_CAP_DAILY": "on", "KH_CAP_OUTCOMES": "on", "KH_CAP_LEARN": "on",
            "KH_CAP_IMPROVE": "on", "KH_DISTILL_WORKER": "dry", "KH_LEARN_MODE": "record",
            "KH_IMPROVE_MODE": "shadow", "KH_STEP_DAILY": "1", "KH_WORKER_CAP_MONTH_USD": "5"}
FLAG_KEYS = set(FLAGS_ON) | {"KH_BENCH_HOOK", "KH_BENCH_HOOK_TOKEN"}
PROD_MARKERS = ("hanacloud.ondemand.com", "cfapps.", "hana.ondemand.com")


def die(msg: str, code: int = 1):
    print("FAIL " + msg)
    sys.exit(code)


def ok(name: str, cond: bool, detail=None) -> bool:
    print(("ok   " if cond else "FAIL ") + name + ("" if detail is None else f"  [{str(detail)[:300]}]"), flush=True)
    return bool(cond)


# ── docker helpers (secrets stay in memory) ──────────────────────────────────

def docker(*args: str, env: dict | None = None, check: bool = True, capture: bool = True) -> str:
    p = subprocess.run(["docker", *args], capture_output=capture, text=True, env=env, encoding="utf-8",
                       errors="replace")
    if check and p.returncode != 0:
        die(f"docker {args[0]} failed (exit {p.returncode}): {(p.stderr or '')[:300]}")
    return p.stdout or ""


def container_env(name: str) -> dict | None:
    p = subprocess.run(["docker", "inspect", name, "--format", "{{json .Config.Env}}"], capture_output=True,
                       text=True)
    if p.returncode != 0:
        return None
    return dict(e.split("=", 1) for e in json.loads(p.stdout or "[]") if "=" in e)


def assert_dev_env(env: dict) -> None:
    """Refuse anything that could point at prod: HANA Cloud, the default schema, CF variables."""
    host = (env.get("HANA_HOST") or "").lower()
    schema = (env.get("HANA_SCHEMA") or "").upper()
    if any(m in host for m in PROD_MARKERS):
        die("refusing: HANA_HOST is a cloud host")
    if env.get("KH_STORE_BACKEND", "").lower() == "hana" and schema in ("", "KNOWLEDGE_HUB"):
        die("refusing: HANA_SCHEMA is the default KNOWLEDGE_HUB")
    if any(k.startswith("VCAP_") or k == "CF_INSTANCE_GUID" for k in env):
        die("refusing: Cloud Foundry variables in the env")


def new_signing_key() -> str:
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    return Ed25519PrivateKey.generate().private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()).decode()


def token_of(container: str) -> str:
    return p1bench._dev_bootstrap_token(container)


def kh(url: str = DEV_URL, container: str = "kh-dev-f") -> p1bench.KH:
    if not p1bench.is_local(url):
        die(f"refusing non-local URL {url}: devcheck_e5 is dev only")
    tok = token_of(container)
    return p1bench.KH(url, lambda: tok, "dev-bootstrap")


def call(k: p1bench.KH, method: str, path: str, body=None, params=None, headers=None, timeout=120):
    """p1bench.KH.call plus extra headers (X-KH-Session). Returns (status, body)."""
    import urllib.error
    import urllib.request
    url = k.url + path + ("?" + urllib.parse.urlencode(params, doseq=True) if params else "")
    data = None if body is None else json.dumps(body).encode()
    h = {"Authorization": "Bearer " + k._token_fn(), "Content-Type": "application/json", **(headers or {})}
    req = urllib.request.Request(url, data=data, method=method, headers=h)
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                raw = r.read()
                try:
                    return r.status, (json.loads(raw) if raw else None)
                except ValueError:
                    return r.status, raw.decode(errors="replace")
        except urllib.error.HTTPError as e:
            raw = e.read()
            try:
                return e.code, json.loads(raw)
            except ValueError:
                return e.code, raw[:400].decode(errors="replace")
        except (urllib.error.URLError, OSError):
            if attempt == 2:
                raise
            time.sleep(2)


def wait_health(url: str, timeout_s: float = 300) -> float:
    import urllib.request
    t0 = time.time()
    while time.time() - t0 < timeout_s:
        try:
            with urllib.request.urlopen(url + "/health", timeout=5) as r:
                if r.status == 200:
                    return time.time() - t0
        except OSError:
            pass
        time.sleep(3)
    return -1.0


# ── up ───────────────────────────────────────────────────────────────────────

def cmd_up(a) -> int:
    src_name = a.source or (a.name if container_env(a.name) is not None else "kh-dev-f")
    src = container_env(src_name)
    if src is None:
        die(f"source container {src_name} not found (it provides the HANA settings)")
    base = {k: v for k, v in src.items() if k not in IMAGE_ENV and k not in FLAG_KEYS
            and k not in ("KH_DEV_BOOTSTRAP_TOKEN", "KH_PRINCIPAL_SIGNING_KEY")}
    if a.flags == "on":
        base.update(FLAGS_ON)
        base["KH_LEARN_MODE"] = a.learn_mode
        base["KH_IMPROVE_MODE"] = a.improve_mode
        if a.bench_hook:
            base["KH_BENCH_HOOK"] = "1"
    for kv in a.env or []:
        k, _, v = kv.partition("=")
        if k in SECRET_ENV:
            die(f"--env may not carry the secret {k}")
        base[k] = v
    base["KH_DEV_BOOTSTRAP"] = "1"
    assert_dev_env(base)

    child = dict(os.environ)
    token = secrets.token_urlsafe(36)                      # fresh per run; only the container env holds it
    child["KH_DEV_BOOTSTRAP_TOKEN"] = token
    child["KH_PRINCIPAL_SIGNING_KEY"] = new_signing_key()  # rotated: the old key is gone with the old container
    if src.get("HANA_PASSWORD"):
        child["HANA_PASSWORD"] = src["HANA_PASSWORD"]
    if a.bench_hook and a.flags == "on":
        child["KH_BENCH_HOOK_TOKEN"] = "khdev." + token
    args = ["run", "-d", "--name", a.name, "-p", f"{a.port}:8000", "-v", f"{a.volume or a.name + '-data'}:/data",
            "--restart", "unless-stopped"]
    if a.mount_bench:
        args += ["-v", f"{KH_BENCH}:/app/tools/kh_bench:ro"]
    for k, v in sorted(base.items()):
        if k in SECRET_ENV:
            continue
        args += ["-e", f"{k}={v}"]
    for k in SECRET_ENV:
        if k in child and (k != "KH_BENCH_HOOK_TOKEN" or base.get("KH_BENCH_HOOK") == "1"):
            args += ["-e", k]                               # value from the child env, not the command line
    args.append(a.image)

    if a.clone_volume_from:
        vol = a.volume or a.name + "-data"
        print(f"clone volume {a.clone_volume_from} -> {vol} (source container paused during the copy)")
        docker("rm", "-f", a.name, check=False)
        docker("volume", "rm", "-f", vol, check=False)
        docker("volume", "create", vol)
        owner = a.pause or ""
        if owner:
            docker("pause", owner, check=False)
        try:
            docker("run", "--rm", "-v", f"{a.clone_volume_from}:/src:ro", "-v", f"{vol}:/dst", "alpine",
                   "sh", "-c", "cp -a /src/. /dst/")
        finally:
            if owner:
                docker("unpause", owner, check=False)
    docker("rm", "-f", a.name, check=False)
    cid = docker(*args, env=child).strip()
    print(f"started {a.name} ({cid[:12]}) image {a.image} port {a.port} flags {a.flags} "
          f"learn={base.get('KH_LEARN_MODE', 'off')} improve={base.get('KH_IMPROVE_MODE', 'off')} "
          f"bench_hook={base.get('KH_BENCH_HOOK', '0')}; bootstrap token and signing key: fresh, not shown")
    print("settings: " + ", ".join(f"{k}={v}" for k, v in sorted(base.items()) if k.startswith(("KH_", "HANA_S",
                                                                                               "GRAPH", "HANA_H"))))
    t = wait_health(f"http://127.0.0.1:{a.port}", a.wait)
    if t < 0:
        print(docker("logs", "--tail", "40", a.name, check=False)[-3000:])
        die(f"{a.name} not healthy after {a.wait} s")
    print(f"healthy after {t:.0f} s")
    return 0


# ── health ───────────────────────────────────────────────────────────────────

E5_CAPS = ("people", "daily", "outcomes", "learn", "improve")


def cmd_health(a) -> int:
    k = kh(a.url, a.container)
    s, b = call(k, "GET", "/health")
    good = ok("GET /health 200", s == 200, s)
    s, b = call(k, "GET", "/v1/capabilities")
    caps = {c["name"]: c for c in (b or {}).get("capabilities", [])} if s == 200 else {}
    good &= ok("GET /v1/capabilities 200", s == 200, s)
    print("     " + ", ".join(f"{n} {c.get('version')}" for n, c in sorted(caps.items())))
    want_on = a.expect != "off"
    for n in E5_CAPS:
        good &= ok(f"capability {n} {'listed' if want_on else 'hidden'}", (n in caps) == want_on)
    logs = docker("logs", "--tail", "400", a.container, check=False) + \
        subprocess.run(["docker", "logs", "--tail", "400", a.container], capture_output=True, text=True,
                       encoding="utf-8", errors="replace").stderr
    good &= ok("startup log says dev bootstrap ON", "dev bootstrap ON" in logs)
    return 0 if good else 1


# ── seed and pour (the seeded dev copy; no prod read) ────────────────────────

SCOPE_OF = {"kh_log_": "log", "kh_know_": "knowledge", "kh_entity_": "entity"}
SKIP_META = {"emb_model", "emb_ver", "emb_dim", "source_text", "author", "original_text"}


def read_rows(path: str):
    """(project, scope, row) for every log/knowledge/entity row of a Chroma dump; chunk sidecars skipped."""
    for line in open(path, encoding="utf-8"):
        r = json.loads(line)
        coll = r.get("collection") or ""
        scope = next((s for p, s in SCOPE_OF.items() if coll.startswith(p)), None)
        meta = r.get("metadata") or {}
        if scope is None or meta.get("chunk_of") or not (r.get("text") or "").strip():
            continue
        project = meta.get("project") or coll.split("_", 2)[2]
        yield project, scope, r


def ensure_projects(container: str, k: p1bench.KH, projects: list[str]) -> None:
    """Create projects inside the container (as seed_docker_dev.py does: never POST /projects, which would
    register them at Keycloak), then sync the registry."""
    code = ("import json\nfrom app import projects\n"
            f"for pid in json.loads({json.dumps(projects)!r}):\n"
            "    projects.get_or_create_project(pid)\n")
    docker("exec", container, "python", "-c", code)
    s, b = call(k, "POST", "/projects/registry/sync")
    if s != 200:
        die(f"registry sync {s}: {str(b)[:200]}")


def add_rows(k: p1bench.KH, rows: list[tuple[str, str, dict]], workers: int = 4) -> dict:
    from concurrent.futures import ThreadPoolExecutor
    from collections import Counter
    counts, errs = Counter(), Counter()

    def one(item):
        project, scope, r = item
        meta = {kk: v for kk, v in (r.get("metadata") or {}).items() if kk not in SKIP_META}
        meta.update(scope=scope, project=project)
        if scope == "log":
            meta.setdefault("subject", meta.get("topic") or "worklog")
            meta.setdefault("topic", meta["subject"])
        s, b = call(k, "POST", "/vector/add", {"id": r["id"], "text": r["text"], "scope": scope, "project": project,
                                               "metadata": meta})
        return project, scope, s, b

    with ThreadPoolExecutor(workers) as ex:
        for project, scope, s, b in ex.map(one, rows):
            if s == 200:
                counts[(project, scope)] += 1
            else:
                errs[(project, scope, s, str(b)[:80])] += 1
    return {"added": counts, "errors": errs}


def scroll_count(k: p1bench.KH, project: str, scope: str) -> int | None:
    s, b = call(k, "POST", "/vector/scroll", {"scope": scope, "project": project, "limit": 1, "max_chars": 50})
    return b.get("matched") if s == 200 and isinstance(b, dict) else None


def cmd_seed(a) -> int:
    k = kh(a.url, a.container)
    want = set(a.projects.split(",")) if a.projects else None
    rows = [(p, s, r) for p, s, r in read_rows(a.src) if want is None or p in want]
    projects = sorted({p for p, _, _ in rows})
    print(f"seed {len(rows)} rows of {len(projects)} projects from {a.src} (a DEV KH dump, not prod)")
    ensure_projects(a.container, k, projects)
    have = {}
    for p in projects:
        for sc in ("log", "knowledge", "entity"):
            have[(p, sc)] = scroll_count(k, p, sc) or 0
    todo = [x for x in rows if have.get((x[0], x[1]), 0) == 0]      # a project-scope already seeded is skipped
    got = add_rows(k, todo, a.workers)
    good = True
    for p in projects:
        for sc in ("log", "knowledge", "entity"):
            n_src = sum(1 for x in rows if x[0] == p and x[1] == sc)
            if not n_src:
                continue
            n = scroll_count(k, p, sc)
            good &= ok(f"{p} {sc}: {n} rows read back (source {n_src})", n is not None and n >= n_src)
    for e, n in list(got["errors"].items())[:10]:
        print(f"     error x{n}: {e}")
    return 0 if good else 1


def _parse_ts(v) -> datetime | None:
    try:
        return datetime.fromisoformat(str(v).replace("Z", "+00:00")).astimezone(timezone.utc)
    except ValueError:
        return None


def cmd_pour(a) -> int:
    """Time-compressed replay of one project's real logs into a NEW dev project, in waves."""
    k = kh(a.url, a.container)
    logs = [r for p, s, r in read_rows(a.src) if p == getattr(a, "from") and s == "log"]
    logs = [(t, r) for r in logs if (t := _parse_ts((r.get("metadata") or {}).get("ts")))]
    logs.sort(key=lambda x: x[0])
    if a.limit:
        logs = logs[-a.limit:]
    if not logs:
        die(f"no dated logs of {getattr(a, 'from')} in {a.src}")
    t0, t1 = logs[0][0], logs[-1][0]
    end = datetime.now(timezone.utc).replace(microsecond=0) - timedelta(days=a.end_days_ago, hours=a.end_hours_ago)
    start = end - timedelta(days=a.days)
    span = max((t1 - t0).total_seconds(), 1.0)
    print(f"pour {len(logs)} logs of {getattr(a, 'from')} ({t0:%Y-%m-%d}..{t1:%Y-%m-%d}) into {a.to}, "
          f"compressed to {start:%Y-%m-%d %H:%M}..{end:%Y-%m-%d %H:%M} UTC, {a.waves} waves")
    ensure_projects(a.container, k, [a.to])
    rows = []
    for t, r in logs:
        nt = start + timedelta(seconds=(t - t0).total_seconds() / span * a.days * 86400)
        m = dict(r.get("metadata") or {})
        author = str(m.get("author") or "")
        # a stable pseudonymous session per author and ORIGINAL day (replay.py reads metadata.session)
        sess = hashlib.sha256(f"{author}|{getattr(a, 'from')}|{t:%Y-%m-%d}".encode()).hexdigest()[:12]
        m.update(ts=nt.strftime("%Y-%m-%dT%H:%M:%SZ"), orig_ts=m.get("ts"), replayed_from=getattr(a, "from"),
                 session=f"rp-{sess}", source="devcheck_e5 pour")
        rid = f"{a.to}-{r['id']}"[:120]
        rows.append((a.to, "log", {"id": rid, "text": r["text"], "metadata": m}))
    per = max(1, -(-len(rows) // a.waves))
    good = True
    for w in range(a.waves):
        part = rows[w * per:(w + 1) * per]
        if not part:
            break
        got = add_rows(k, part, a.workers)
        n = scroll_count(k, a.to, "log")
        good &= ok(f"wave {w + 1}/{a.waves}: +{sum(got['added'].values())} logs, {n} in {a.to}",
                   not got["errors"], dict(got["errors"]) if got["errors"] else None)
        if a.pause_s and w + 1 < a.waves:
            time.sleep(a.pause_s)
    return 0 if good else 1


# ── worker (E): dry pass, 429 budget, one small `on` run ─────────────────────

def ns_client(k: p1bench.KH, ns: str = "kh_people") -> dict:
    """Rotate the namespace client and return {client_id, client_secret} (in memory only)."""
    s, b = call(k, "POST", f"/v1/admin/ns/{ns}:client")
    if s not in (200, 201) or not isinstance(b, dict) or not b.get("client_secret"):
        die(f"POST /v1/admin/ns/{ns}:client -> {s} {str({x: y for x, y in (b or {}).items() if x != 'client_secret'} if isinstance(b, dict) else b)[:200]}")
    return {"client_id": b["client_id"], "client_secret": b["client_secret"]}


def kh_state(k: p1bench.KH, projects: list[str]) -> dict:
    """What a worker could have written: cursors, live knowledge rows, pending items, daily days still open."""
    out = {}
    for p in projects:
        s1, cur = call(k, "GET", "/distill/cursor", params={"project": p})
        s2, pend = call(k, "GET", "/distill/pending", params={"project": p})
        s3, nxt = call(k, "GET", "/daily/next", params={"project": p})
        days = sorted(d.get("day") for d in (nxt or {}).get("days", [])) if s3 == 200 and isinstance(nxt, dict) else s3
        out[p] = {"cursor": cur if s1 == 200 else s1,
                  "pending": pend.get("count") if s2 == 200 and isinstance(pend, dict) else s2,
                  "knowledge": scroll_count(k, p, "knowledge"), "daily_open": days}
    return out


def _cursor_pos(c) -> object:
    if not isinstance(c, dict):
        return c
    return {x: c.get(x) for x in ("cursor_ts", "cursor", "position", "last_ts", "read_until", "done_until") if x in c} or c


def run_worker(a, k: p1bench.KH, job: str, projects: list[str], mode: str, llm: str, cap_run: float,
               cap_month: float, in_container: bool = False, extra_env: dict | None = None) -> dict:
    cred = ns_client(k)
    env = {"KH_WORKER_ENABLED": "1", "KH_WORKER_MODE": mode, "KH_WORKER_LLM": llm,
           "KH_WORKER_CAP_RUN_USD": str(cap_run), "KH_WORKER_CAP_MONTH_USD": str(cap_month),
           "KH_WORKER_PROJECTS": ",".join(projects), "KH_WORKER_LOG": "WARNING", **(extra_env or {})}
    if getattr(a, "model", None):
        env["KH_WORKER_MODEL"] = a.model
    child = dict(os.environ)
    child.update(env)
    child["KH_WORKER_CLIENT_ID"] = cred["client_id"]
    child["KH_WORKER_CLIENT_SECRET"] = cred["client_secret"]
    child.pop("ANTHROPIC_API_KEY", None)                    # real spend only through claude_cli (caps below)
    child["PYTHONIOENCODING"] = "utf-8"
    if in_container:
        args = ["docker", "run", "--rm", "--name", "kh-dev-f-worker", "-e", "KH_URL=http://host.docker.internal:9102",
                "-e", "KH_WORKER_CLIENT_ID", "-e", "KH_WORKER_CLIENT_SECRET"]
        for kk, v in env.items():
            args += ["-e", f"{kk}={v}"]
        args += ["kh-worker:e5", "python", "-m", "kh_worker", "once", "--job", job]
    else:
        child["KH_URL"] = k.url
        child["PYTHONPATH"] = str(APP_ROOT / "worker")
        args = [sys.executable, "-m", "kh_worker", "once", "--job", job]
    for p in projects:
        args += ["--project", p]
    t0 = time.time()
    proc = subprocess.run(args, capture_output=True, text=True, env=child, encoding="utf-8", errors="replace",
                          timeout=3600)
    out = (proc.stdout or "")
    err = (proc.stderr or "").replace(cred["client_secret"], "***")
    try:
        summary = json.loads(out[out.index("{"):])
    except ValueError:
        summary = {"status": "no_summary", "stdout": out[-500:], "stderr": err[-800:]}
    summary["_exit"] = proc.returncode
    summary["_wall_s"] = round(time.time() - t0, 1)
    if err.strip():
        summary["_stderr_tail"] = err[-600:]
    return summary


def worker_events(k: p1bench.KH, run_id: str | None = None, kind: str = "worker.run") -> list[dict]:
    s, b = call(k, "GET", "/v1/kh_people/events", params={"kind": kind, "limit": 500})
    evs = (b or {}).get("events", []) if s == 200 and isinstance(b, dict) else []
    return [e for e in evs if run_id is None or e.get("run_id") == run_id or (e.get("body") or {}).get("run_id") == run_id]


def month_cost(k: p1bench.KH) -> float | None:
    """This month's worker.cost_usd as the worker reads it (backfill left out)."""
    now = datetime.now(timezone.utc)
    start = int(datetime(now.year, now.month, 1, tzinfo=timezone.utc).timestamp() * 1000)
    s, b = call(k, "GET", "/v1/kh_people/metrics:aggregate", params={
        "series": "worker.cost_usd", "group_by": "dims.kind", "from": start, "to": int(time.time() * 1000) + 1})
    if s != 200 or not isinstance(b, dict):
        return None
    return round(sum(float(g.get("sum") or 0) for g in b.get("groups") or []
                     if ((g.get("key") or {}).get("dims.kind") or (g.get("key") or {}).get("kind")) != "backfill"), 6)


def cmd_worker(a) -> int:
    k = kh(a.url, a.container)
    projects = a.project
    before = kh_state(k, projects)
    summary = run_worker(a, k, a.job, projects, a.mode, a.llm, a.cap_run, a.cap_month, a.in_container)
    after = kh_state(k, projects)
    print(json.dumps({x: y for x, y in summary.items() if x != "result"}, indent=1, default=str)[:3000])
    res = summary.get("result") or {}
    print("result: " + json.dumps(res, default=str)[:2500])
    good = ok(f"worker {a.job} {a.mode}/{a.llm} status {summary.get('status')}",
              summary.get("status") in ("ok", "budget") and summary.get("_exit") in (0, 1))
    if a.mode == "dry":
        for p in projects:
            good &= ok(f"{p}: cursor unmoved", _cursor_pos(before[p]["cursor"]) == _cursor_pos(after[p]["cursor"]),
                       (_cursor_pos(before[p]["cursor"]), _cursor_pos(after[p]["cursor"])))
            good &= ok(f"{p}: 0 writes (knowledge {before[p]['knowledge']}->{after[p]['knowledge']}, pending "
                       f"{before[p]['pending']}->{after[p]['pending']}, open days unchanged)",
                       before[p]["knowledge"] == after[p]["knowledge"] and before[p]["pending"] == after[p]["pending"]
                       and before[p]["daily_open"] == after[p]["daily_open"])
    else:
        for p in projects:
            print(f"     {p}: pending {before[p]['pending']} -> {after[p]['pending']}, knowledge "
                  f"{before[p]['knowledge']} -> {after[p]['knowledge']}, cursor {_cursor_pos(after[p]['cursor'])}")
    if a.out:
        Path(a.out).write_text(json.dumps({"summary": summary, "before": before, "after": after}, indent=1,
                                          default=str), encoding="utf-8")
    return 0 if good else 1


def cmd_budget429(a) -> int:
    """KH's own month cap (lock 3): with KH_WORKER_CAP_MONTH_USD below the month's worker.cost_usd, the worker
    token's /distill/next and /daily/next answer 429 budget. Call with a container whose cap is below the spend."""
    k = kh(a.url, a.container)
    cred = ns_client(k)
    s, b = call(p1bench.KH(k.url, lambda: "", "none"), "POST", "/v1/token",
                {"grant_type": "client_credentials", **cred})
    if s != 200:
        die(f"/v1/token {s}")
    ns_tok = b["access_token"]
    nk = p1bench.KH(k.url, lambda: ns_tok, "ns")
    call(nk, "POST", "/v1/kh_people/principals", {"role": "distiller", "principal_id": "worker"})
    s, b = call(nk, "POST", "/v1/kh_people/principals/worker/token")
    wtok = (b or {}).get("access_token") if isinstance(b, dict) else None
    if not wtok:
        die(f"worker token {s}")
    wk = p1bench.KH(k.url, lambda: wtok, "worker")
    spend = month_cost(k)
    good = True
    for path in ("/distill/next", "/daily/next"):
        s, b = call(wk, "GET", path, params={"project": a.project})
        good &= ok(f"worker GET {path} with the KH cap below the month spend (${spend}) -> 429 budget",
                   s == 429 and "budget" in json.dumps(b), (s, str(b)[:200]))
    s, b = call(k, "GET", "/distill/next", params={"project": a.project})
    good &= ok("a maintainer is not refused by the worker cap", s == 200, s)
    return 0 if good else 1


# ── trial (phase 3 mechanics, section 10 item 7) ─────────────────────────────

TRIAL_PROJECT = "e5-trial"
LESSON_PROJECT = "lesson-learned"
# planted lessons: (name, action, text, sessions, control success, served success as a factor of control)
PLANTED = [
    ("neutral", "e5-migrate-schema", "Run the migration dry-run against a copy of the schema before applying it.",
     None, 0.95, 1.0),
    ("harmful", "e5-warm-cache", "Restart the cache node before every load test to start from a clean state.",
     None, 0.85, 0.80),
    ("small", "e5-rotate-report", "Archive the old report files before rotating the report job.", 12, 0.90, 1.0),
]
EXPECT = {"neutral": "accept", "harmful": "withdraw", "small": "continue"}


def results_dir() -> Path:
    d = KH_BENCH / "results"
    d.mkdir(exist_ok=True)
    return d


def step(k: p1bench.KH, project: str, text: str, session: str, action: str | None = None) -> tuple[int, dict]:
    body = {"text": text, "project": project, **({"action": action} if action else {})}
    s, b = call(k, "POST", "/context/step", body, headers={"X-KH-Session": session})
    return s, (b if isinstance(b, dict) else {"raw": b})


def trial_state_path(tag: str) -> Path:
    return results_dir() / f"devcheck_e5-trial-{tag}.json"


def cmd_trial(a) -> int:
    k = kh(a.url, a.container)
    path = trial_state_path(a.tag)
    st = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {"tag": a.tag, "lessons": {}}
    good = True
    if a.phase == "setup":
        ensure_projects(a.container, k, [TRIAL_PROJECT, LESSON_PROJECT])
        for name, action, *_ in PLANTED:
            action = f"{action}-{a.tag}"
            s, b = call(k, "POST", "/policy/action/set", {
                "action": action, "description": f"devcheck_e5 trial action ({name} planted lesson)",
                "project": TRIAL_PROJECT, "allow_oversize": True, "reason": "devcheck_e5 trial"})
            good &= ok(f"policy action {action} on {TRIAL_PROJECT}", s == 200, (s, str(b)[:200]))
        # evidence: real serves of 2 sessions in 2 projects (the learn rule: >= 2 sessions, 2 callers or projects)
        ev = []
        for proj, sess in ((TRIAL_PROJECT, f"ev-{a.tag}-1"), (LESSON_PROJECT, f"ev-{a.tag}-2")):
            s, b = step(k, proj, "How do we run a database schema migration safely?", sess)
            good &= ok(f"evidence serve in {proj} has a serve_id", s == 200 and bool(b.get("serve_id")), (s, str(b)[:200]))
            ev.append(b.get("serve_id"))
        time.sleep(2)                                    # kh.served is written on a background thread
        for name, action, text, *_ in PLANTED:
            action = f"{action}-{a.tag}"
            s, b = call(k, "POST", "/learn/propose", {"project": TRIAL_PROJECT, "action": action, "text": text,
                                                     "title": text[:60], "evidence": {"serve_ids": ev}})
            res = (b or {}).get("result") or {} if isinstance(b, dict) else {}
            trial = (b or {}).get("trial") or {} if isinstance(b, dict) else {}
            good &= ok(f"POST /learn/propose {name}: {res.get('result')} {res.get('reason') or ''}",
                       s == 200 and res.get("result") in ("accepted", "merged") and bool(trial), (s, str(b)[:300]))
            st["lessons"][name] = {"id": res.get("id"), "action": action}
        path.write_text(json.dumps(st, indent=1), encoding="utf-8")
        s, b = call(k, "GET", "/learn/trials", params={"limit": 100})
        print(f"     trials: {[(t['id'], t['trial_state']) for t in (b or {}).get('trials', []) if t['id'] in {v['id'] for v in st['lessons'].values()}]}")
        return 0 if good else 1

    ids = {v["id"]: n for n, v in st["lessons"].items()}
    s, b = call(k, "GET", "/learn/trials", params={"limit": 200})
    if s != 200:
        die(f"/learn/trials {s}: {str(b)[:200]}")
    rows = {t["id"]: t for t in b.get("trials", []) if t["id"] in ids}
    if a.phase == "cleanup":
        # a run that must not count (e.g. before a fix): reject its trials so their sessions never decide anything
        for iid, name in ids.items():
            if (rows.get(iid) or {}).get("trial_state") in ("proposed", "trial", "contested"):
                s, b = call(k, "POST", "/learn/decide", {"id": iid, "decision": "reject"})
                good &= ok(f"{name} trial {iid} rejected (cleanup of run {a.tag})", s == 200, (s, str(b)[:200]))
        return 0 if good else 1
    if a.phase == "drive":
        mode = b.get("mode")
        good &= ok(f"learn mode is trial (withholding on): {mode}", mode == "trial")
        for iid, name in ids.items():
            good &= ok(f"{name} lesson {iid} is in trial (offline gate passed)",
                       (rows.get(iid) or {}).get("trial_state") == "trial",
                       (rows.get(iid) or {}).get("offline_gate"))
        if not good:
            return 1
        st["serves"] = {}
        for name, action, text, n_sessions, p_c, factor in PLANTED:
            action = st["lessons"][name]["action"]
            iid = st["lessons"][name]["id"]
            n = n_sessions or 2 * a.sessions
            served, held, serves = 0, 0, []
            for i in range(n):
                sess = f"tr-{a.tag}-{name}-{i:03d}"
                s, b = step(k, TRIAL_PROJECT, f"Next step: {text.split(' before')[0].lower()} (session {i})", sess, action)
                got = {it.get("id") for it in b.get("items", [])} if s == 200 else set()
                arm = 1 if iid in got else 0
                served += arm
                held += 1 - arm
                if s != 200 or not b.get("serve_id"):
                    good &= ok(f"{name} session {i} step", False, (s, str(b)[:200]))
                    break
                serves.append({"session": sess, "serve_id": b["serve_id"], "arm": arm})
            st["serves"][name] = serves
            share = served / max(1, served + held)
            line = f"{name}: {n} sessions, served {served} / control {held} ({share:.1%} served)"
            if n_sessions is None:
                good &= ok(f"arm split 50 +- 5%: {line}", abs(share - 0.5) <= 0.05)
            else:
                print("     " + line)
        time.sleep(3)
        # outcomes after every serve, so the planted effect is exact: control success p_c, served p_c x factor
        for name, action, text, n_sessions, p_c, factor in PLANTED:
            sv = st["serves"].get(name) or []
            n_c = sum(1 for x in sv if x["arm"] == 0)
            n_s = len(sv) - n_c
            ok_c = round(n_c * p_c)
            ok_s = round(n_s * p_c * factor) if factor != 1.0 or not n_c else min(n_s, -(-ok_c * n_s // n_c))
            done = {0: ok_c, 1: ok_s}
            labels = {"done": 0, "failed": 0}
            for x in sv:
                o = "done" if done[x["arm"]] > 0 else "failed"
                done[x["arm"]] -= o == "done"
                s, b = call(k, "POST", "/step/outcome", {"serve_ids": [x["serve_id"]], "outcome": o, "source": "tool",
                                                        **({"error": f"step failed in {name} trial"} if o == "failed" else {})},
                            headers={"X-KH-Session": x["session"]})
                res = ((b or {}).get("results") or [{}])[0] if isinstance(b, dict) else {}
                if s != 200 or (res.get("result") or res.get("status")) not in (None, "applied", "duplicate"):
                    good &= ok(f"{name} outcome for {x['serve_id']}", False, (s, str(b)[:200]))
                    break
                labels[o] += 1
            print(f"     {name}: control {ok_c}/{n_c} done, served {ok_s}/{n_s} done; labels {labels}")
        path.write_text(json.dumps(st, indent=1), encoding="utf-8")
        return 0 if good else 1

    # check: after the learn_decide cron ran (devcheck_e5.py crons)
    s, ev = call(k, "GET", "/v1/kh_people/events", params={"kind": "learn.decision", "limit": 500})
    decisions = {}
    for e in (ev or {}).get("events", []) if s == 200 else []:
        body = e.get("body") or {}
        if body.get("id") in ids:
            decisions[ids[body["id"]]] = body
    for name, want in EXPECT.items():
        iid = st["lessons"][name]["id"]
        d = decisions.get(name)
        arms = (rows.get(iid) or {}).get("arms")
        stats = (d or {}).get("stats") or {}
        detail = {x: stats.get(x) for x in ("n_control", "n_served", "mean_control", "mean_served", "diff",
                                             "lower_bound", "p", "harm")} if d else arms
        if want == "continue":
            good &= ok(f"{name}: no decision (continue, too few sessions); arms {arms}", d is None, d)
        else:
            good &= ok(f"{name}: recommended {want} ({(d or {}).get('reason')})", (d or {}).get("decision") == want,
                       detail)
            good &= ok(f"{name}: mode trial only recommends (applied false, still in trial)",
                       d is not None and d.get("applied") is False
                       and (rows.get(iid) or {}).get("trial_state") == "trial", (d or {}).get("applied"))
    return 0 if good else 1


def pending_items(k: p1bench.KH, project: str) -> list[dict]:
    """/distill/pending lines -> [{id, kind, action, context, text}]."""
    import re
    s, b = call(k, "GET", "/distill/pending", params={"project": project})
    out = []
    for line in (b or {}).get("lines", []) if s == 200 else []:
        m = re.match(r"^(\S+) (\S+)(?: \[contested\])? \[(.*?) / (.*?)\] (.*)$", line)
        if m:
            out.append({"id": m.group(1), "kind": m.group(2), "action": m.group(3), "context": m.group(4),
                        "text": m.group(5)})
    return out


def cmd_approve(a) -> int:
    """Section 10 item 4, mode on: the worker's items are proposed; approve them with the bootstrap token (a
    maintainer) and read one back BY KEY through /context/step (tier distilled)."""
    k = kh(a.url, a.container)
    pend = pending_items(k, a.project)
    good = ok(f"{a.project}: {len(pend)} items proposed by the worker", len(pend) > 0)
    if not pend:
        return 1
    ids = [p["id"] for p in pend][: a.max]
    s, b = call(k, "POST", "/distill/approve", {"project": a.project, "ids": ids})
    res = (b or {}).get("results") if isinstance(b, dict) else None
    good &= ok(f"POST /distill/approve {len(ids)} items with the dev bootstrap token", s == 200 and res is not None,
               (s, str(b)[:300]))
    keyed = [p for p in pend if p["id"] in ids and (p["action"] != "-" or p["context"] != "-")]
    served = 0
    for p in keyed[:5]:
        body = {"text": p["text"][:300], "project": a.project}
        if p["action"] != "-":
            body["action"] = p["action"]
        if p["context"] != "-":
            body["context"] = p["context"]
        s, b = call(k, "POST", "/context/step", body, headers={"X-KH-Session": f"approve-{p['id']}"})
        tiers = {it.get("id"): it.get("tier") for it in (b or {}).get("items", [])} if s == 200 else {}
        hit = tiers.get(p["id"]) == "distilled"
        served += hit
        print(f"     by key [{p['action']} / {p['context']}] -> {p['id']} {'served (distilled)' if hit else 'NOT in pack'}")
    good &= ok(f"approved items served by key: {served} of {min(5, len(keyed))} keyed items", served > 0)
    return 0 if good else 1


def cmd_leaks(a) -> int:
    """G5 (section 10 item 5): the leak set seeded into kh-leaktest (not an own project), distilled live by the
    worker, then p1bench's leak scan over items, pending rows, the shared lessons, worker.run / worker.cost_usd
    events (+ --dump files). 0 hits = PASS."""
    k = kh(a.url, a.container)
    ls = p1bench.load_leakset()
    proj = ls["project"]["id"]
    ns = argparse.Namespace(url=a.url, auth=f"dev-bootstrap:{a.container}", allow_remote=False, dump=a.dump,
                            offline=False)
    if a.seed:
        ensure_projects(a.container, k, [proj])
        rc = p1bench.cmd_leakseed(ns)
        ok(f"leak set seeded into {proj} ({len(ls['logs'])} logs, {len(ls['planted'])} planted strings)", rc == 0)
        if rc:
            return 1
    if a.worker_llm:
        summary = run_worker(a, k, "distil", [proj], a.worker_mode, a.worker_llm, a.cap_run, a.cap_month)
        res = summary.get("result") or {}
        print(f"     worker distil on {proj}: status {summary.get('status')}, budget {summary.get('budget')}, "
              f"result {json.dumps(res, default=str)[:600]}")
        if a.out:
            Path(a.out).write_text(json.dumps(summary, indent=1, default=str), encoding="utf-8")
    rc = p1bench.cmd_leakscan(ns)
    return rc


def _evidence_set(k: p1bench.KH, tag: str) -> dict:
    """Real kh.served / step.outcome ids for the red-team placeholders (as tests/caps/test_improve.py builds)."""
    def serve(project, session):
        s, b = step(k, project, "How do we release the build after the CI run?", session)
        if s != 200 or not b.get("serve_id"):
            die(f"evidence serve {project}: {s} {str(b)[:200]}")
        return b["serve_id"]

    def label(sid, session, outcome):
        src = "stop" if outcome == "done" else "tool"
        s, b = call(k, "POST", "/step/outcome", {"serve_ids": [sid], "outcome": outcome, "source": src,
                                                **({"error": "exit 1"} if outcome != "done" else {})},
                    headers={"X-KH-Session": session})
        if s != 200:
            die(f"evidence label: {s} {str(b)[:200]}")
        return f"o_{outcome[0]}{src[0]}_{sid}"

    g1, g2 = serve(TRIAL_PROJECT, f"rt-{tag}-1"), serve(LESSON_PROJECT, f"rt-{tag}-2")
    other = serve(TRIAL_PROJECT, f"rt-{tag}-3")
    t1, t2 = serve(TRIAL_PROJECT, f"rt-{tag}-4"), serve(TRIAL_PROJECT, f"rt-{tag}-4")
    time.sleep(3)
    good = {"serve_ids": [g1, g2], "outcome_ids": [label(g1, f"rt-{tag}-1", "done"), label(g2, f"rt-{tag}-2", "failed")]}
    other_label = label(other, f"rt-{tag}-3", "done")
    return {"$GOOD": good, "$FAKE_SERVE": {"serve_ids": ["sv_doesnotexist01", "sv_doesnotexist02"]},
            "$FAKE_OUTCOME": {"serve_ids": good["serve_ids"], "outcome_ids": ["o_ds_sv_doesnotexist01"]},
            "$UNLINKED": {"serve_ids": good["serve_ids"], "outcome_ids": [other_label]},
            "$THIN": {"serve_ids": [t1, t2]}, "$NONE": {}}


def _proposer_tokens(k: p1bench.KH, n_agents: int) -> list[tuple[str, p1bench.KH]]:
    """The maintainer (dev token), the kh_people worker token and agent principals of ops_pilot: each may file at
    most 20 proposals a day, and the red-team set has more than 20 cases."""
    out = [("maintainer", k)]
    cred = ns_client(k)
    s, b = call(p1bench.KH(k.url, lambda: "", "none"), "POST", "/v1/token", {"grant_type": "client_credentials", **cred})
    nk = p1bench.KH(k.url, lambda t=b["access_token"]: t, "ns")
    call(nk, "POST", "/v1/kh_people/principals", {"role": "distiller", "principal_id": "worker"})
    s, w = call(nk, "POST", "/v1/kh_people/principals/worker/token")
    if s in (200, 201):
        out.append(("worker", p1bench.KH(k.url, lambda t=w["access_token"]: t, "worker")))
    s, _ = call(k, "GET", "/v1/admin/ns/ops_pilot")
    if s == 404:
        call(k, "PUT", "/v1/admin/ns/ops_pilot", {"projects": [TRIAL_PROJECT], "display": "phase 4 pilot (dev)"})
    cred = ns_client(k, "ops_pilot")
    s, b = call(p1bench.KH(k.url, lambda: "", "none"), "POST", "/v1/token", {"grant_type": "client_credentials", **cred})
    ak = p1bench.KH(k.url, lambda t=b["access_token"]: t, "ops")
    for i in range(n_agents):
        pid = f"rt-agent-{i}"
        call(ak, "POST", "/v1/ops_pilot/principals", {"role": "agent", "principal_id": pid})
        s, t = call(ak, "POST", f"/v1/ops_pilot/principals/{pid}/token")
        if s in (200, 201):
            out.append((f"ops_pilot/{pid}", p1bench.KH(k.url, lambda tok=t["access_token"]: tok, pid)))
    return out


def cmd_redteam(a) -> int:
    """Phase 5 shadow (section 10 item 10): every red-team case of tools/kh_bench/redteam_p5.json over HTTP must be
    caught; then one param proposal KH_STEP_FLOOR 0.68 -> 0.70 records KH's recommendation (with KH_BENCH_HOOK=1
    on the container the bench runs tier-1 + p1bench with the override per request)."""
    import copy
    k = kh(a.url, a.container)
    s, st = call(k, "GET", "/improve/state")
    good = ok(f"improve mode shadow: {(st or {}).get('mode') if isinstance(st, dict) else st}",
              s == 200 and isinstance(st, dict) and st.get("mode") == "shadow", (s, str(st)[:200]))
    rt = json.loads((KH_BENCH / "redteam_p5.json").read_text(encoding="utf-8"))
    ev = _evidence_set(k, a.tag)
    props = _proposer_tokens(k, 2)
    print(f"     proposers: {[n for n, _ in props]}")

    def fill(p):
        p = copy.deepcopy(p)
        if isinstance(p.get("evidence"), str):
            p["evidence"] = ev[p["evidence"]]
        if (p.get("change") or {}).get("text") == "$LONG":
            p["change"]["text"] = "Cache the build output. " * 200
        t = p.get("target")
        if isinstance(t, dict) and t.get("project") == "alpha":
            t["project"] = TRIAL_PROJECT
        return p

    caught, missed, n = 0, [], 0
    for i, case in enumerate(rt["cases"]):
        name, who = props[(i // 18) % len(props)]
        want = case["expect"]
        s, got = call(who, "POST", "/improve/propose", fill(case["proposal"]))
        n += 1
        if s != 200 or not isinstance(got, dict):
            missed.append((case["id"], s, str(got)[:150]))
            continue
        if got.get("duplicate"):
            missed.append((case["id"], "duplicate of an earlier run (use a new --tag)"))
            continue
        if want["verdict"] == "reject":
            hit = got["decision"] == "reject" and set(want.get("codes", [])) <= set(got.get("codes") or [])
        elif want["verdict"] == "fen":
            hit = got["decision"] == "fen" and not got.get("applied")
        else:
            hit = got["decision"] in ("accept", "hold", "reject") and got.get("clamped") is True and not got.get("applied")
        caught += hit
        if not hit:
            missed.append((case["id"], got))
    good &= ok(f"red team over HTTP: {caught}/{len(rt['cases'])} planted poisonings caught", not missed and caught >= 20,
               missed[:5])
    for case in rt["controls"]:
        name, who = props[-1]
        s, got = call(who, "POST", "/improve/propose", fill(case["proposal"]))
        verdict = (got or {}).get("decision") if isinstance(got, dict) else None
        want = case["expect"]["verdict"]
        if case["id"] == "ok_param" and a.bench:
            want_ok = verdict in ("accept", "reject") and "bench" in str((got or {}).get("reason"))
        else:
            want_ok = verdict == want
        good &= ok(f"control {case['id']} by {name}: {verdict} ({(got or {}).get('reason') if isinstance(got, dict) else got})",
                   s == 200 and want_ok and not (got or {}).get("applied"), (s, str(got)[:300]))
    s, pr = call(k, "GET", "/improve/proposals", params={"limit": 200})
    lines = (pr or {}).get("proposals", []) if s == 200 and isinstance(pr, dict) else []
    floor = [x for x in lines if (x.get("target") == "KH_STEP_FLOOR" or (x.get("kh") or {}).get("target") == "KH_STEP_FLOOR")]
    print(f"     /improve/proposals: {len(lines)} lines, KH_STEP_FLOOR proposals: "
          f"{json.dumps(floor[:3], default=str)[:800]}")
    s, st = call(k, "GET", "/improve/state")
    good &= ok("shadow: no override applied", s == 200 and not (st or {}).get("overrides"), (st or {}).get("overrides"))
    return 0 if good else 1


def cmd_tier1(a) -> int:
    """Tier-1 (retrieval only, no LLM) of khbench.py against DEV containers only: the bench's ENVS and token are
    replaced in-process by the local URLs and their dev bootstrap tokens, so nothing reaches prod or its
    Keycloak. The permission probes (A1-A3) assume the non-maintainer bench account and are reported n/a."""
    import khbench
    sides = {}
    for spec in a.side:
        name, url, cont = spec.split("=", 1)[0], *spec.split("=", 1)[1].split(",")
        if not p1bench.is_local(url):
            die(f"refusing non-local {url}")
        sides[name] = (url, token_of(cont))
    khbench.ENVS.clear()
    khbench.ENVS.update({n: u for n, (u, _) in sides.items()})
    by_url = {u: t for u, t in sides.values()}
    khbench.token = lambda who: next(iter(by_url.values()))
    real_call = khbench.call

    def dev_call(env, method, path, body=None, who="kh-bench"):
        tok = sides[env][1]
        khbench.token = lambda w, t=tok: t
        return real_call(env, method, path, body, who)
    khbench.call = dev_call
    rec = khbench.tier1(list(sides))
    out = results_dir() / f"devcheck_e5-tier1-{datetime.now(timezone.utc):%Y%m%dT%H%M%S}.json"
    out.write_text(json.dumps(rec, indent=1, default=str), encoding="utf-8")
    summ = {}
    for n, e in rec["envs"].items():
        ts = [t for t in e["tasks"].values() if t.get("category") != "permission"]
        cov = [t["coverage"] for t in ts if isinstance(t.get("coverage"), (int, float))]
        rcl = [t["recall"] for t in ts if isinstance(t.get("recall"), (int, float))]
        byt = [t["bytes"] for t in ts if isinstance(t.get("bytes"), (int, float))]
        summ[n] = {"tasks": len(ts), "coverage": round(sum(cov) / len(cov), 4) if cov else None,
                   "recall": round(sum(rcl) / len(rcl), 4) if rcl else None, "bytes": sum(byt),
                   "p50_s": e.get("p50_s"), "p95_s": e.get("p95_s")}
    print(json.dumps(summ, indent=1))
    print(f"written {out}")
    if len(summ) == 2:
        (n1, s1), (n2, s2) = summ.items()
        good = True
        for m in ("coverage", "recall"):
            if s1[m] is not None and s2[m] is not None:
                good &= ok(f"tier-1 {m}: {n1} {s1[m]} vs {n2} {s2[m]} (within 2%)", s1[m] >= s2[m] * 0.98 - 1e-9)
        good &= ok(f"tier-1 bytes: {n1} {s1['bytes']} vs {n2} {s2['bytes']} (within +2%)",
                   s1["bytes"] <= s2["bytes"] * 1.02 + 1)
        return 0 if good else 1
    return 0


def cmd_crons(a) -> int:
    """KH's caps crons first run 30 s after start (app/caps/__init__.start_crons), then every interval (learn_gate
    1 h, learn_decide 6 h). A restart of the dev container is the trigger; nothing in KH changes for it."""
    t0 = time.time()
    if a.release:
        # A cron lease ('_kh', name) is held for interval x 1.5 by its last holder (hostname:pid) and never released
        # (sqldb.run_under_lease): a recreated container is a new holder and waits out the TTL (9 h for
        # learn_decide). DEV ONLY: drop those lease rows in the dev schema so the restart runs them at +30 s.
        env = container_env(a.container) or {}
        assert_dev_env(env)
        names = [n for n in a.release.split(",") if n]
        code = "\n".join([
            "from app import sqldb",
            f"names = {names!r}",
            "with sqldb.connect() as c:",
            "    n = sqldb.update(c, 'DELETE FROM kh_lease WHERE ns=? AND name IN (' + ','.join('?' * len(names))"
            " + ')', ['_kh'] + names)",
            "print('released', n)"])
        print("     " + docker("exec", a.container, "python", "-c", code).strip().splitlines()[-1] + f" of {names}")
    docker("restart", a.container)
    t = wait_health(a.url, 300)
    print(f"restarted {a.container}, healthy after {t:.0f} s; waiting {a.wait_s:.0f} s for the first cron runs")
    time.sleep(a.wait_s)
    logs = subprocess.run(["docker", "logs", "--since", f"{int(time.time() - t0) + 5}s", a.container],
                          capture_output=True, text=True, encoding="utf-8", errors="replace")
    text = (logs.stdout or "") + (logs.stderr or "")
    for line in text.splitlines():
        if any(n in line for n in (a.show or "").split(",") if n):
            print("     " + line[-300:])
    return 0


# ── main ─────────────────────────────────────────────────────────────────────

def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    u = sub.add_parser("up")
    u.add_argument("--name", default="kh-dev-f")
    u.add_argument("--port", type=int, default=9102)
    u.add_argument("--image", default=IMAGE)
    u.add_argument("--source", help="container whose env gives the HANA settings (default: --name, else kh-dev-f)")
    u.add_argument("--flags", choices=["on", "off"], default="on")
    u.add_argument("--learn-mode", default="record")
    u.add_argument("--improve-mode", default="shadow")
    u.add_argument("--bench-hook", action="store_true")
    u.add_argument("--mount-bench", action="store_true", default=True)
    u.add_argument("--volume")
    u.add_argument("--clone-volume-from")
    u.add_argument("--pause", help="container to pause while the volume is copied")
    u.add_argument("--env", action="append", help="extra non-secret K=V")
    u.add_argument("--wait", type=float, default=300)
    h = sub.add_parser("health")
    h.add_argument("--url", default=DEV_URL)
    h.add_argument("--container", default="kh-dev-f")
    h.add_argument("--expect", choices=["on", "off"], default="on")
    for name in ("seed", "pour"):
        s = sub.add_parser(name)
        s.add_argument("--url", default=DEV_URL)
        s.add_argument("--container", default="kh-dev-f")
        s.add_argument("--src", required=True, help="NDJSON dump of a DEV KH's Chroma")
        s.add_argument("--workers", type=int, default=4)
        if name == "seed":
            s.add_argument("--projects")
        else:
            s.add_argument("--from", required=True)
            s.add_argument("--to", required=True)
            s.add_argument("--days", type=float, default=14)
            s.add_argument("--end-days-ago", type=float, default=0)
            s.add_argument("--end-hours-ago", type=float, default=3)
            s.add_argument("--waves", type=int, default=4)
            s.add_argument("--pause-s", type=float, default=2)
            s.add_argument("--limit", type=int, default=0, help="only the newest N logs")
    w = sub.add_parser("worker")
    w.add_argument("--url", default=DEV_URL)
    w.add_argument("--container", default="kh-dev-f")
    w.add_argument("--job", choices=["distil", "daily"], required=True)
    w.add_argument("--project", action="append", required=True)
    w.add_argument("--mode", choices=["dry", "on"], default="dry")
    w.add_argument("--llm", choices=["dry", "claude_cli"], default="dry")
    w.add_argument("--model")
    w.add_argument("--cap-run", type=float, default=1.0)
    w.add_argument("--cap-month", type=float, default=5.0)
    w.add_argument("--in-container", action="store_true", help="run the kh-worker:e5 image instead of the CLI")
    w.add_argument("--out")
    b4 = sub.add_parser("budget429")
    b4.add_argument("--url", default=DEV_URL)
    b4.add_argument("--container", default="kh-dev-f")
    b4.add_argument("--project", required=True)
    tr = sub.add_parser("trial")
    tr.add_argument("--url", default=DEV_URL)
    tr.add_argument("--container", default="kh-dev-f")
    tr.add_argument("--phase", choices=["setup", "drive", "check", "cleanup"], required=True)
    tr.add_argument("--tag", default=datetime.now(timezone.utc).strftime("%Y%m%d"))
    tr.add_argument("--sessions", type=int, default=80, help="sessions per arm (2 x N per lesson)")
    cr = sub.add_parser("crons")
    cr.add_argument("--url", default=DEV_URL)
    cr.add_argument("--container", default="kh-dev-f")
    cr.add_argument("--wait-s", type=float, default=75)
    cr.add_argument("--show", default="learn_gate,learn_decide,improve_fallback")
    cr.add_argument("--release", help="DEV ONLY: comma list of _kh cron leases to drop before the restart")
    ap_ = sub.add_parser("approve")
    ap_.add_argument("--url", default=DEV_URL)
    ap_.add_argument("--container", default="kh-dev-f")
    ap_.add_argument("--project", required=True)
    ap_.add_argument("--max", type=int, default=10)
    lk = sub.add_parser("leaks")
    lk.add_argument("--url", default=DEV_URL)
    lk.add_argument("--container", default="kh-dev-f")
    lk.add_argument("--seed", action="store_true")
    lk.add_argument("--worker-llm", choices=["dry", "claude_cli"])
    lk.add_argument("--worker-mode", choices=["dry", "on"], default="on")
    lk.add_argument("--model")
    lk.add_argument("--cap-run", type=float, default=1.0)
    lk.add_argument("--cap-month", type=float, default=5.0)
    lk.add_argument("--dump", action="append")
    lk.add_argument("--out")
    rt = sub.add_parser("redteam")
    rt.add_argument("--url", default=DEV_URL)
    rt.add_argument("--container", default="kh-dev-f")
    rt.add_argument("--tag", default=datetime.now(timezone.utc).strftime("%H%M%S"))
    rt.add_argument("--bench", action="store_true", help="the container runs with KH_BENCH_HOOK=1")
    t1 = sub.add_parser("tier1")
    t1.add_argument("--side", action="append", required=True, help="name=url,container (1 or 2 sides)")
    a = ap.parse_args()
    return {"up": cmd_up, "health": cmd_health, "seed": cmd_seed, "pour": cmd_pour, "worker": cmd_worker,
            "budget429": cmd_budget429, "trial": cmd_trial, "crons": cmd_crons, "approve": cmd_approve,
            "leaks": cmd_leaks, "redteam": cmd_redteam, "tier1": cmd_tier1}[a.cmd](a)


if __name__ == "__main__":
    sys.exit(main())

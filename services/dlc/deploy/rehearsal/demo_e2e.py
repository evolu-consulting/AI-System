"""End-to-end demo through the default frontend's proxy (/api/dlc/* -> engine) with a real Keycloak user token.
New System run from a tiny .md web-app spec, decide mode, pause + resume while running, then nodes / worklog /
reports, app:start -> GET the app URL, app:stop. Prints a JSON summary at the end."""
import json, sys, time, urllib.request, urllib.error

FE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:18795"
ENGINE = sys.argv[2] if len(sys.argv) > 2 else "http://127.0.0.1:18796"
import os, subprocess
TOKFILE = sys.argv[3] if len(sys.argv) > 3 else r"E:\lw\rh-final\user.token"
H = {"Content-Type": "application/json"}
out = {"steps": []}


def refresh_token(force=False):
    if force or time.time() - os.path.getmtime(TOKFILE) > 600:
        subprocess.run(["pwsh", "-NoProfile", "-File", r"E:\lw\dlc-kit\kit\keycloak\test-login.ps1", "-KeycloakUrl",
                        "https://192.168.0.188:18443", "-ClientId", "dlc-fe", "-RedirectUri", "http://192.168.0.188:18795/",
                        "-Username", "demo", "-Password", "Demo!2026x", "-SkipCertificateCheck", "-TokenFile", TOKFILE],
                       capture_output=True, timeout=120)
    H["Authorization"] = "Bearer " + open(TOKFILE).read().strip()


def call(method, url, body=None, headers=None, timeout=60):
    if headers is None:
        refresh_token()
        headers = H
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read().decode("utf-8", "replace")
            return r.status, (json.loads(raw) if raw.strip().startswith(("{", "[")) else raw)
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", "replace")
        try:
            return e.code, json.loads(raw)
        except ValueError:
            return e.code, raw


def step(name, ok, info=""):
    out["steps"].append({"step": name, "ok": bool(ok), "info": info})
    print(("PASS " if ok else "FAIL ") + name + ("  " + str(info)[:300] if info else ""), flush=True)


SPEC = """# Hello web app

A one-page web application served by Python's standard library (http.server), no third-party packages.

## F1 Home page
- GET / returns HTTP 200 with an HTML page whose <h1> is exactly `Hello DLC`.

## F2 Health endpoint
- GET /api/health returns HTTP 200 with JSON `{"status": "ok"}`.

## Runtime
- The server listens on 0.0.0.0 and on the port given by the PORT environment variable (default 8000).
- Provide dlc.app.json so the app can be started with one command.
"""

t0 = time.time()
st, cfg = call("GET", FE + "/api/fe/config", headers={})
step("fe config (auth on)", st == 200 and isinstance(cfg, dict), cfg)
st, me = call("GET", ENGINE + "/api/me")
step("engine /api/me with Keycloak token", st == 200 and me.get("actor"), me)
st, x = call("GET", ENGINE + "/api/runs", headers={})
step("engine 401 without token", st == 401, st)
st, board = call("GET", ENGINE + "/", headers={})
step("board page loads", st == 200 and isinstance(board, str) and "<html" in board.lower(), len(board) if isinstance(board, str) else board)

st, pk = call("POST", FE + "/api/dlc/packs", {"kind": "new", "name": "hello-web", "spec": SPEC})
step("create pack via FE proxy", st == 201 and pk.get("pack"), pk)
st, rn = call("POST", FE + "/api/dlc/runs", {"pack": pk["pack"], "flow": "new", "name": "hello-web", "human_mode": "decide"})
step("start New System run (decide)", st in (200, 202) and rn.get("run"), rn)
run = rn["run"]
out["run"] = run

paused_done = False
state = ""
deadline = time.time() + 45 * 60
while time.time() < deadline:
    st, r = call("GET", FE + "/api/dlc/runs/" + run)
    state = (r.get("run") or {}).get("state", "") if isinstance(r, dict) else ""
    if not paused_done and state in ("building", "planning", "integrating"):
        st1, p = call("POST", FE + "/api/dlc/runs/%s:pause" % run, {"reason": "demo pause"})
        time.sleep(8)
        st2, r2 = call("GET", FE + "/api/dlc/runs/" + run)
        paused = (r2.get("run") or {}).get("paused")
        step("pause while running (state %s)" % state, st1 == 200 and paused, p)
        time.sleep(10)
        st3, q = call("POST", FE + "/api/dlc/runs/%s:resume" % run, {})
        step("resume", st3 == 200, q)
        paused_done = True
    if state in ("green", "escalated", "cancelled"):
        break
    time.sleep(10)
out["final_state"] = state
out["run_seconds"] = round(time.time() - t0)
step("run reached green", state == "green", state)

st, r = call("GET", FE + "/api/dlc/runs/" + run)
det = (r.get("run") or {}).get("detail") or {}
out["spent_usd"] = det.get("spent_usd")
out["name_flow"] = [(r.get("run") or {}).get("name"), (r.get("run") or {}).get("flow"), (r.get("run") or {}).get("human_mode")]

st, nodes = call("GET", FE + "/api/dlc/runs/%s/nodes" % run)
ns = nodes.get("nodes") or [] if isinstance(nodes, dict) else []
step("nodes", st == 200 and len(ns) >= 6, [(n["id"], n["state"]) for n in ns])
st, wl = call("GET", FE + "/api/dlc/runs/%s/nodes/build/worklog" % run)
step("build node worklog", st == 200 and len(wl.get("entries") or []) > 0, len(wl.get("entries") or []) if isinstance(wl, dict) else wl)
st, reps = call("GET", FE + "/api/dlc/runs/%s/reports" % run)
rl = reps.get("reports") or [] if isinstance(reps, dict) else []
okall = True
for rep in rl:
    s2, c = call("GET", FE + "/api/dlc/runs/%s/reports/%s" % (run, rep["id"]))
    okall = okall and s2 == 200 and bool((c or {}).get("content"))
step("reports listed + each opens", st == 200 and rl and okall, [x["id"] for x in rl])

st, app = call("POST", FE + "/api/dlc/runs/%s/app:start" % run, {}, timeout=120)
for _ in range(30):
    if isinstance(app, dict) and app.get("state") == "running":
        break
    time.sleep(2)
    st, app = call("GET", FE + "/api/dlc/runs/%s/app" % run)
url = (app or {}).get("url") if isinstance(app, dict) else None
step("app:start -> running", isinstance(app, dict) and app.get("state") == "running", app)
out["app_url"] = url
if url:
    s3, page = call("GET", url, headers={})
    step("GET app URL serves the app", s3 == 200 and "Hello DLC" in str(page), str(page)[:120])
    s4, h = call("GET", url.rstrip("/") + "/api/health", headers={})
    step("GET app /api/health", s4 == 200, h)
st, stp = call("POST", FE + "/api/dlc/runs/%s/app:stop" % run, {})
step("app:stop", st == 200, stp)

out["passed"] = sum(1 for s in out["steps"] if s["ok"])
out["failed"] = [s["step"] for s in out["steps"] if not s["ok"]]
print(json.dumps(out, indent=1))

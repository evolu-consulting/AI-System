#!/usr/bin/env python3
"""Helper for the DLC Linux deploy kit (python3 standard library only).

    kit_helper.py env-set FILE KEY=value ...          add/replace KEY='value' lines (service env files)
    kit_helper.py env-get FILE KEY
    kit_helper.py render-realm TEMPLATE OUT --host H --fe-port P --engine-port P --customer-origin O --customer-redirect R
    kit_helper.py kc-user --url U --admin-password-file F --username N --password-env V --roles a,b [--cafile C]
    kit_helper.py kc-login --url U --redirect R --username N --password-env V [--client dlc-fe] [--token-file F] [--cafile C]
    kit_helper.py import-lessons --kh U --file F [--project lesson-learned]
    kit_helper.py kh-seed --kh U --ns dlc_line                    projects + namespace + client; prints client json
    kit_helper.py demo --fe U --engine U --keycloak U --redirect R --username N --password-env V [--cafile C]

Passwords come from an environment variable (never the command line).
"""
import argparse
import base64
import hashlib
import html
import http.cookiejar
import json
import os
import re
import secrets
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request


# ------------------------------------------------------------------ env files
def _quote(v):
    if "'" in v or "\n" in v:
        raise SystemExit("env value may not contain a single quote or a newline")
    return "'" + v + "'"


def _parse_env(path):
    rows = []
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            rows = f.read().splitlines()
    return rows


def env_set(path, pairs):
    rows = _parse_env(path)
    for pair in pairs:
        k, _, v = pair.partition("=")
        line = "%s=%s" % (k, _quote(v))
        for i, r in enumerate(rows):
            if r.split("=", 1)[0].strip() == k:
                rows[i] = line
                break
        else:
            rows.append(line)
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write("\n".join(rows) + "\n")


def env_get(path, key):
    for r in _parse_env(path):
        k, _, v = r.partition("=")
        if k.strip() == key:
            v = v.strip()
            if len(v) >= 2 and v[0] == v[-1] and v[0] in "'\"":
                v = v[1:-1]
            return v
    return ""


# ------------------------------------------------------------------ http
def _ctx(cafile):
    if cafile:
        return ssl.create_default_context(cafile=cafile)
    return ssl.create_default_context()


def http_json(method, url, body=None, headers=None, cafile=None, form=False, timeout=60):
    h = dict(headers or {})
    data = None
    if body is not None:
        if form:
            data = urllib.parse.urlencode(body).encode()
            h["Content-Type"] = "application/x-www-form-urlencoded"
        else:
            data = json.dumps(body).encode("utf-8")
            h["Content-Type"] = "application/json; charset=utf-8"
    req = urllib.request.Request(url, data=data, headers=h, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=_ctx(cafile) if url.startswith("https") else None) as r:
            raw = r.read().decode("utf-8", "replace")
            status = r.status
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", "replace")
        status = e.code
    try:
        return status, json.loads(raw) if raw.strip() else None
    except ValueError:
        return status, raw


def _password(env_name):
    pw = os.environ.get(env_name, "")
    if not pw:
        raise SystemExit("password missing: set %s" % env_name)
    return pw


# ------------------------------------------------------------------ keycloak
def render_realm(a):
    t = open(a.template, encoding="utf-8").read()
    for k, v in (("__VPS_IP__", a.host), ("__FE_PORT__", str(a.fe_port)), ("__ENGINE_PORT__", str(a.engine_port)),
                 ("__CUSTOMER_FE_ORIGIN__", a.customer_origin), ("__CUSTOMER_FE_REDIRECT__", a.customer_redirect)):
        t = t.replace(k, v)
    json.loads(t)   # fail here, not inside Keycloak
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    open(a.out, "w", encoding="utf-8").write(t)
    print("realm written: " + a.out)


def kc_user(a):
    url = a.url.rstrip("/")
    admin_pw = open(a.admin_password_file).read().strip()
    st, tok = http_json("POST", url + "/realms/master/protocol/openid-connect/token",
                        {"grant_type": "password", "client_id": "admin-cli", "username": a.admin_user, "password": admin_pw},
                        form=True, cafile=a.cafile)
    if st != 200:
        raise SystemExit("admin sign-in failed: %s %s" % (st, tok))
    h = {"Authorization": "Bearer " + tok["access_token"]}
    base = url + "/admin/realms/" + a.realm
    q = base + "/users?exact=true&username=" + urllib.parse.quote(a.username)
    st, found = http_json("GET", q, headers=h, cafile=a.cafile)
    email = a.email or a.username + "@dlc.local"
    if not found:
        st, r = http_json("POST", base + "/users", {"username": a.username, "enabled": True, "emailVerified": True, "email": email},
                          headers=h, cafile=a.cafile)
        if st not in (201, 204):
            raise SystemExit("create user failed: %s %s" % (st, r))
        st, found = http_json("GET", q, headers=h, cafile=a.cafile)
        print("created user " + a.username)
    else:
        print("user %s exists - updating password and roles" % a.username)
    uid = found[0]["id"]
    # Keycloak 24+ asks for a complete profile on first sign-in unless it is set
    http_json("PUT", base + "/users/" + uid, {"email": email, "emailVerified": True, "firstName": a.username,
                                             "lastName": "User", "enabled": True, "requiredActions": []}, headers=h, cafile=a.cafile)
    st, r = http_json("PUT", base + "/users/%s/reset-password" % uid,
                      {"type": "password", "value": _password(a.password_env), "temporary": False}, headers=h, cafile=a.cafile)
    if st not in (200, 204):
        raise SystemExit("set password failed: %s %s" % (st, r))
    roles = [x for x in a.roles.split(",") if x]
    st, allr = http_json("GET", base + "/roles", headers=h, cafile=a.cafile)
    want = [{"id": r["id"], "name": r["name"]} for r in allr if r["name"] in roles]
    if len(want) != len(roles):
        raise SystemExit("unknown role in %s (realm has %s)" % (roles, [r["name"] for r in allr]))
    http_json("POST", base + "/users/%s/role-mappings/realm" % uid, want, headers=h, cafile=a.cafile)
    print("roles set: " + ", ".join(roles))


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kw):
        return None


def pkce_login(kc_url, client, redirect, username, password, realm="dlc", cafile=None):
    """Real authorization-code + PKCE sign-in against the Keycloak login page; returns the token response."""
    kc_url = kc_url.rstrip("/")
    verifier = base64.urlsafe_b64encode(secrets.token_bytes(32)).rstrip(b"=").decode()
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    auth = "%s/realms/%s/protocol/openid-connect/auth?%s" % (kc_url, realm, urllib.parse.urlencode({
        "response_type": "code", "client_id": client, "redirect_uri": redirect, "scope": "openid",
        "state": secrets.token_hex(8), "code_challenge": challenge, "code_challenge_method": "S256"}))
    jar = http.cookiejar.CookieJar()
    op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar), _NoRedirect(),
                                     urllib.request.HTTPSHandler(context=_ctx(cafile)))
    page = op.open(auth, timeout=30).read().decode("utf-8", "replace")
    m = re.search(r'id="kc-form-login"[^>]*action="([^"]+)"', page)
    if not m:
        raise SystemExit("login form not found (check client id / redirect uri)")
    action = html.unescape(m.group(1))
    data = urllib.parse.urlencode({"username": username, "password": password, "credentialId": ""}).encode()
    try:
        r = op.open(action, data=data, timeout=30)
        body = r.read().decode("utf-8", "replace")
        fb = re.search(r"kc-feedback-text[^>]*>([^<]+)", body) or re.search(r'input-error[^>]*>\s*([^<]+)', body)
        raise SystemExit("login failed: " + (fb.group(1).strip() if fb else "HTTP %s" % r.status))
    except urllib.error.HTTPError as e:
        if e.code not in (302, 303):
            raise SystemExit("login failed: HTTP %s" % e.code)
        loc = e.headers.get("Location", "")
    m = re.search(r"[?&]code=([^&]+)", loc)
    if not m:
        raise SystemExit("signed in, but Keycloak asks for another step first: " + loc)
    st, tr = http_json("POST", "%s/realms/%s/protocol/openid-connect/token" % (kc_url, realm),
                       {"grant_type": "authorization_code", "client_id": client, "code": urllib.parse.unquote(m.group(1)),
                        "redirect_uri": redirect, "code_verifier": verifier}, form=True, cafile=cafile)
    if st != 200:
        raise SystemExit("token exchange failed: %s %s" % (st, tr))
    return tr


def _claims(token):
    p = token.split(".")[1]
    return json.loads(base64.urlsafe_b64decode(p + "=" * (-len(p) % 4)))


def kc_login(a):
    tr = pkce_login(a.url, a.client, a.redirect, a.username, _password(a.password_env), cafile=a.cafile)
    c = _claims(tr["access_token"])
    aud = c.get("aud") if isinstance(c.get("aud"), list) else [c.get("aud")]
    roles = set(c.get("roles") or []) | set((c.get("realm_access") or {}).get("roles") or [])
    print("iss   : %s" % c.get("iss"))
    print("user  : %s" % c.get("preferred_username"))
    print("aud   : %s" % ", ".join(x for x in aud if x))
    print("roles : %s" % ", ".join(sorted(roles)))
    if a.token_file:
        fd = os.open(a.token_file, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w") as f:
            f.write(tr["access_token"])
        print("token : written to " + a.token_file)
    if a.expect_audience in aud and a.expect_role in roles:
        print("LOGIN OK: token carries aud %s and role %s" % (a.expect_audience, a.expect_role))
        return 0
    print("LOGIN TOKEN NOT FIT: expected aud %s and role %s" % (a.expect_audience, a.expect_role))
    return 1


# ------------------------------------------------------------------ knowledge store
def kh_seed(a):
    kh = a.kh.rstrip("/")
    for pid, name in (("dlc", "DLC delivery"), ("lesson-learned", "Lessons learned")):
        http_json("POST", kh + "/projects", {"id": pid, "name": name})
    st, ns = http_json("PUT", "%s/v1/admin/ns/%s" % (kh, a.ns), {"projects": ["dlc", "lesson-learned"], "display": "DLC engine"})
    if st >= 300:
        raise SystemExit("namespace failed: %s %s" % (st, ns))
    st, cl = http_json("POST", "%s/v1/admin/ns/%s:client" % (kh, a.ns), {})
    if st >= 300 or not (cl or {}).get("client_secret"):
        raise SystemExit("no client secret returned: %s %s" % (st, cl))
    st, tok = http_json("POST", kh + "/v1/token", {"grant_type": "client_credentials", "client_id": cl["client_id"],
                                                   "client_secret": cl["client_secret"]})
    if st != 200 or not (tok or {}).get("access_token"):
        raise SystemExit("token exchange failed: %s %s" % (st, tok))
    print(json.dumps({"state": ns.get("state"), "client_id": cl["client_id"], "client_secret": cl["client_secret"],
                      "expires_in": tok.get("expires_in")}))


def retrieval_probe(a):
    """The engine's own call shape: a key plus the situation in words. Nothing served means the agents get no
    knowledge at all (lessons not in the engine's project, or include_people_lanes off in rag.local.json)."""
    rl = json.load(open(a.rag_local))
    body = {"project": rl["project"], "keyspace": "step", "key": {"role": "fixer", "step": "build", "stack": "python"},
            "query": "unit test passes but its assertion can never fail", "budget_chars": 4000}
    st, r = http_json("POST", "%s/v1/%s/context/step" % (a.kh, rl["rag_ns"]), body)
    n = len((r or {}).get("served") or []) if st == 200 else 0
    if n < 1:
        print("nothing served (HTTP %s, people_lanes=%s): import the lessons into project %s and re-apply the manifest"
              % (st, (r or {}).get("people_lanes"), rl["project"]))
        return 1
    print("%d item(s), %d chars" % (n, len(r.get("pack_text") or "")))
    return 0


def import_lessons(a):
    kh = a.kh.rstrip("/")
    doc = json.load(open(a.file, encoding="utf-8"))
    rows = doc if isinstance(doc, list) else doc.get("lessons") or doc.get("rows") or doc.get("items")
    if rows is None:
        raise SystemExit("no lessons array in " + a.file)
    http_json("POST", kh + "/projects", {"id": a.project, "name": "Lessons learned"})
    ok = skipped = failed = 0
    for r in rows:
        text = r.get("text") or r.get("source_text")
        if not text:
            skipped += 1
            continue
        meta = {k: v for k, v in (r.get("metadata") or {}).items() if k not in ("emb_model", "emb_ver", "emb_dim", "source_text")}
        meta.update(project=a.project, scope="knowledge")
        meta.setdefault("kind", "lesson")
        if r.get("id") or r.get("vector_id"):
            meta["seed_id"] = r.get("id") or r.get("vector_id")
        st, res = http_json("POST", kh + "/vector/add", {"text": text, "scope": "knowledge", "metadata": meta}, timeout=120)
        vid = (res or {}).get("vector_id") if isinstance(res, dict) else None
        if st >= 300 or not vid:
            failed += 1
            print("failed: %s %s" % (st, str(res)[:200]), file=sys.stderr)
            continue
        st, back = http_json("POST", kh + "/vector/scroll", {"scope": "knowledge", "project": a.project, "ids": [vid]})
        if st == 200 and (back or {}).get("count", 0) >= 1:
            ok += 1
        else:
            failed += 1
            print("not read back: " + vid, file=sys.stderr)
    print("lessons: stored %d, skipped %d (no text), failed %d, total %d" % (ok, skipped, failed, len(rows)))
    return 1 if failed else 0


# ------------------------------------------------------------------ end-to-end demo
DEMO_SPEC = """# Hello web app

A one-page web application served by Python's standard library (http.server), no third-party packages.

## F1 Home page
- GET / returns HTTP 200 with an HTML page whose <h1> is exactly `Hello DLC`.

## F2 Health endpoint
- GET /api/health returns HTTP 200 with JSON `{"status": "ok"}`.

## Runtime
- The server listens on 0.0.0.0 and on the port given by the PORT environment variable (default 8000).
- Provide dlc.app.json so the app can be started with one command.
"""


def demo(a):
    """New System run through the frontend proxy with a real user token: pause + resume, nodes, worklog,
    reports, Start app -> GET the app, Stop app. Costs one small real model run (~$1)."""
    pw = _password(a.password_env)
    tok = {"t": None, "at": 0}
    out = {"steps": []}

    def bearer():
        if time.time() - tok["at"] > 600:
            tok["t"] = pkce_login(a.keycloak, "dlc-fe", a.redirect, a.username, pw, cafile=a.cafile)["access_token"]
            tok["at"] = time.time()
        return {"Authorization": "Bearer " + tok["t"]}

    def call(method, url, body=None, auth=True, timeout=60):
        return http_json(method, url, body, headers=bearer() if auth else {}, timeout=timeout)

    def step(name, ok, info=""):
        out["steps"].append({"step": name, "ok": bool(ok), "info": str(info)[:300]})
        print(("PASS " if ok else "FAIL ") + name + ("  " + str(info)[:300] if info != "" else ""), flush=True)

    t0 = time.time()
    fe, eng = a.fe.rstrip("/"), a.engine.rstrip("/")
    st, cfg = call("GET", fe + "/api/fe/config", auth=False)
    step("frontend config (sign-in on)", st == 200 and isinstance(cfg, dict), cfg)
    st, me = call("GET", eng + "/api/me")
    step("engine /api/me with the user token", st == 200 and isinstance(me, dict) and me.get("actor"), me)
    st, _ = call("GET", eng + "/api/runs", auth=False)
    step("engine 401 without a token", st == 401, st)
    st, pk = call("POST", fe + "/api/dlc/packs", {"kind": "new", "name": "hello-web", "spec": DEMO_SPEC})
    step("create pack via the frontend", st == 201 and isinstance(pk, dict) and pk.get("pack"), pk)
    if not (isinstance(pk, dict) and pk.get("pack")):
        return 1
    st, rn = call("POST", fe + "/api/dlc/runs", {"pack": pk["pack"], "flow": "new", "name": "hello-web", "human_mode": "decide"})
    step("start New System run (decide)", st in (200, 202) and isinstance(rn, dict) and rn.get("run"), rn)
    if not (isinstance(rn, dict) and rn.get("run")):
        return 1
    run = out["run"] = rn["run"]
    paused_done, state = False, ""
    deadline = time.time() + a.timeout_min * 60
    while time.time() < deadline:
        st, r = call("GET", fe + "/api/dlc/runs/" + run)
        state = ((r or {}).get("run") or {}).get("state", "") if isinstance(r, dict) else ""
        if not paused_done and state in ("building", "planning", "integrating"):
            s1, p = call("POST", fe + "/api/dlc/runs/%s:pause" % run, {"reason": "demo pause"})
            time.sleep(8)
            s2, r2 = call("GET", fe + "/api/dlc/runs/" + run)
            step("pause while running (state %s)" % state, s1 == 200 and ((r2 or {}).get("run") or {}).get("paused"), p)
            time.sleep(10)
            s3, q = call("POST", fe + "/api/dlc/runs/%s:resume" % run, {})
            step("resume", s3 == 200, q)
            paused_done = True
        if state in ("green", "escalated", "cancelled"):
            break
        time.sleep(10)
    out["final_state"], out["run_seconds"] = state, round(time.time() - t0)
    step("run reached green", state == "green", state)
    st, r = call("GET", fe + "/api/dlc/runs/" + run)
    out["spent_usd"] = (((r or {}).get("run") or {}).get("detail") or {}).get("spent_usd") if isinstance(r, dict) else None
    st, nodes = call("GET", fe + "/api/dlc/runs/%s/nodes" % run)
    ns = (nodes or {}).get("nodes") or [] if isinstance(nodes, dict) else []
    step("nodes", st == 200 and len(ns) >= 6, [(n.get("id"), n.get("state")) for n in ns])
    st, wl = call("GET", fe + "/api/dlc/runs/%s/nodes/build/worklog" % run)
    step("build node worklog", st == 200 and isinstance(wl, dict) and wl.get("entries"), len((wl or {}).get("entries") or []) if isinstance(wl, dict) else wl)
    st, reps = call("GET", fe + "/api/dlc/runs/%s/reports" % run)
    rl = (reps or {}).get("reports") or [] if isinstance(reps, dict) else []
    allok = True
    for rep in rl:
        s2, c = call("GET", fe + "/api/dlc/runs/%s/reports/%s" % (run, rep["id"]))
        allok = allok and s2 == 200 and bool((c or {}).get("content"))
    step("reports listed and each opens", st == 200 and rl and allok, [x.get("id") for x in rl])
    if state == "green":
        st, app = call("POST", fe + "/api/dlc/runs/%s/app:start" % run, {}, timeout=120)
        for _ in range(30):
            if isinstance(app, dict) and app.get("state") == "running":
                break
            time.sleep(2)
            st, app = call("GET", fe + "/api/dlc/runs/%s/app" % run)
        url = app.get("url") if isinstance(app, dict) else None
        step("Start app -> running", isinstance(app, dict) and app.get("state") == "running", app)
        out["app_url"] = url
        if url:
            s3, page = http_json("GET", url)
            step("app URL serves the app", s3 == 200 and "Hello DLC" in str(page), str(page)[:120])
            s4, h = http_json("GET", url.rstrip("/") + "/api/health")
            step("app /api/health", s4 == 200, h)
        if not a.keep_app:
            st, stp = call("POST", fe + "/api/dlc/runs/%s/app:stop" % run, {})
            step("Stop app", st == 200, stp)
    out["passed"] = sum(1 for s in out["steps"] if s["ok"])
    out["failed"] = [s["step"] for s in out["steps"] if not s["ok"]]
    print(json.dumps({k: v for k, v in out.items() if k != "steps"}, indent=1))
    return 1 if out["failed"] else 0


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("env-set"); s.add_argument("file"); s.add_argument("pairs", nargs="+")
    s = sub.add_parser("env-get"); s.add_argument("file"); s.add_argument("key")
    s = sub.add_parser("render-realm"); s.add_argument("template"); s.add_argument("out")
    s.add_argument("--host", required=True); s.add_argument("--fe-port", type=int, default=8795)
    s.add_argument("--engine-port", type=int, default=8796)
    s.add_argument("--customer-origin", default="http://localhost:3000"); s.add_argument("--customer-redirect", default="http://localhost:3000/*")
    s = sub.add_parser("kc-user"); s.add_argument("--url", required=True); s.add_argument("--realm", default="dlc")
    s.add_argument("--admin-user", default="admin"); s.add_argument("--admin-password-file", required=True)
    s.add_argument("--username", required=True); s.add_argument("--password-env", default="DLC_USER_PASSWORD")
    s.add_argument("--email", default=""); s.add_argument("--roles", default="dlc-user"); s.add_argument("--cafile")
    s = sub.add_parser("kc-login"); s.add_argument("--url", required=True); s.add_argument("--client", default="dlc-fe")
    s.add_argument("--redirect", required=True); s.add_argument("--username", required=True)
    s.add_argument("--password-env", default="DLC_USER_PASSWORD"); s.add_argument("--token-file", default="")
    s.add_argument("--expect-audience", default="dlc-api"); s.add_argument("--expect-role", default="dlc-user"); s.add_argument("--cafile")
    s = sub.add_parser("kh-seed"); s.add_argument("--kh", required=True); s.add_argument("--ns", default="dlc_line")
    s = sub.add_parser("import-lessons"); s.add_argument("--kh", required=True); s.add_argument("--file", required=True)
    s.add_argument("--project", default="lesson-learned")
    s = sub.add_parser("retrieval-probe"); s.add_argument("--kh", required=True); s.add_argument("--rag-local", required=True)
    s = sub.add_parser("demo"); s.add_argument("--fe", required=True); s.add_argument("--engine", required=True)
    s.add_argument("--keycloak", required=True); s.add_argument("--redirect", required=True)
    s.add_argument("--username", required=True); s.add_argument("--password-env", default="DLC_USER_PASSWORD")
    s.add_argument("--cafile"); s.add_argument("--timeout-min", type=int, default=45); s.add_argument("--keep-app", action="store_true")
    a = ap.parse_args()
    if a.cmd == "env-set":
        env_set(a.file, a.pairs)
    elif a.cmd == "env-get":
        print(env_get(a.file, a.key))
    elif a.cmd == "render-realm":
        render_realm(a)
    elif a.cmd == "kc-user":
        kc_user(a)
    elif a.cmd == "kc-login":
        return kc_login(a)
    elif a.cmd == "kh-seed":
        kh_seed(a)
    elif a.cmd == "import-lessons":
        return import_lessons(a)
    elif a.cmd == "retrieval-probe":
        return retrieval_probe(a)
    elif a.cmd == "demo":
        return demo(a)
    return 0


if __name__ == "__main__":
    sys.exit(main())

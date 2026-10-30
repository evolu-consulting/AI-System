"""Local Dify for the DLC process test: admin account, the four process apps, their API keys.

    python bootstrap.py [--url http://127.0.0.1:4203]
Writes admin-login.txt (email + generated password, never printed) and flows.json ({process: app key}) next to
this file. Re-running imports new copies of the apps; the old keys keep working.
"""
import argparse
import base64
import http.cookiejar
import json
import os
import secrets
import string
import sys
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
EMAIL = "rowan.hoang@laidon.com"


def client(url):
    jar = http.cookiejar.CookieJar()
    op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))

    def call(method, path, body=None):
        csrf = next((c.value for c in jar if c.name.endswith("csrf_token")), "")
        req = urllib.request.Request(url + "/console/api" + path, method=method,
                                     data=json.dumps(body).encode() if body is not None else None,
                                     headers={"Content-Type": "application/json", "X-CSRF-Token": csrf})
        try:
            with op.open(req, timeout=120) as r:
                raw = r.read()
                return r.status, json.loads(raw or b"{}")
        except urllib.error.HTTPError as e:
            return e.code, {"error": e.read().decode("utf-8", "replace")[:800]}
    return call


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://127.0.0.1:4203")
    a = ap.parse_args()
    call = client(a.url)
    login_file = os.path.join(HERE, "admin-login.txt")
    if os.path.isfile(login_file):
        email, pw = open(login_file, encoding="utf-8").read().split()[:2]
    else:
        alphabet = string.ascii_letters + string.digits
        pw = "D1" + "".join(secrets.choice(alphabet) for _ in range(18))
        email = EMAIL
    st, setup = call("GET", "/setup")
    if setup.get("step") != "finished":
        st, res = call("POST", "/setup", {"email": email, "name": "Rowan", "password": pw})
        print("setup:", st, res if st >= 400 else "ok")
        if st >= 400:
            sys.exit(1)
        with open(login_file, "w", encoding="utf-8") as fh:
            fh.write("%s %s\n" % (email, pw))
    st, res = call("POST", "/login", {"email": email, "password": base64.b64encode(pw.encode()).decode(),
                                      "remember_me": True})
    print("login:", st, res.get("result") or res)
    if st >= 400:
        sys.exit(1)
    flows = {}
    for proc in ("new-system", "enhancement", "bug-fix", "feature-migration"):
        yml = open(os.path.join(HERE, "flows", proc + ".yml"), encoding="utf-8").read()
        st, imp = call("POST", "/apps/imports", {"mode": "yaml-content", "yaml_content": yml})
        if st == 202:
            st, imp = call("POST", "/apps/imports/%s/confirm" % imp["id"])
        app_id = imp.get("app_id")
        print("import %s: %s %s %s" % (proc, st, imp.get("status"), imp.get("error") or app_id))
        if not app_id:
            continue
        st, pub = call("POST", "/apps/%s/workflows/publish" % app_id, {"marked_name": "", "marked_comment": ""})
        print("  publish:", st, pub if st >= 400 else "ok")
        st, key = call("POST", "/apps/%s/api-keys" % app_id)
        print("  api key:", st, "ok" if key.get("token") else key)
        if key.get("token"):
            flows[proc] = key["token"]
            flows[proc + ":app"] = app_id
    with open(os.path.join(HERE, "flows.json"), "w", encoding="utf-8") as fh:
        json.dump(flows, fh, indent=1)
    print("flows.json:", sorted(k for k in flows if ":" not in k))


if __name__ == "__main__":
    main()

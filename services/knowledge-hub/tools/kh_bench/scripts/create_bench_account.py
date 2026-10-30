"""Create (or repair) the KH bench account on the BTP realm knowledge-hub, then prove its access.

Runs as agent-admin. Idempotent: an existing account keeps its password and is only re-checked.
Usage: python create_bench_account.py
"""
import json, secrets, sys, urllib.error, urllib.parse, urllib.request
import os
from pathlib import Path

SECRETS = Path(os.environ.get("KH_BENCH_SECRETS", Path.home() / ".claude_rowan" / "secrets")) / "kh-prod-accounts.json"
A = json.load(open(SECRETS, encoding="utf-8"))
KC, KH = A["keycloak"], A["kh"]
DEV = "https://kh-sso.cfapps.br10.hana.ondemand.com"
REALM = "knowledge-hub"
EMAIL = "kh-bench@kh-agent.invalid"
GRANTS = {"ticketing-system": "editable", "m360": "editable", "simplemdg-2.0": "editable", "solace-buzz": "editable"}
NO_ACCESS = ["simplemdg-support", "simplemdg-v2", "pdf-to-epub"]


def http(method, url, token=None, body=None, form=None):
    data, headers = None, {}
    if form is not None:
        data = urllib.parse.urlencode(form).encode()
        headers["Content-Type"] = "application/x-www-form-urlencoded"
    elif body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = "Bearer " + token
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            raw = r.read()
            return r.status, (json.loads(raw) if raw and raw[:1] in b"[{" else raw.decode(errors="replace"))
    except urllib.error.HTTPError as e:
        return e.code, e.read()[:300].decode(errors="replace")


def token(realm, client, user, password):
    s, b = http("POST", f"{KC}/realms/{realm}/protocol/openid-connect/token",
                form={"grant_type": "password", "client_id": client, "username": user, "password": password,
                      "scope": "openid"})
    assert s == 200, (s, b)
    return b["access_token"]


admin_pw = A["accounts"]["agent-admin"]["password"]
adm = token("master", "admin-cli", A["accounts"]["agent-admin"]["email"], admin_pw)
API = f"{KC}/admin/realms/{REALM}"

# 1. the user, in group kh-users (realm role member through the group), no tenant
acct = A["accounts"].get("kh-bench") or {"email": EMAIL, "password": secrets.token_urlsafe(18),
                                          "level": "kh-users (no tenant), bench account for KH measurements"}
s, found = http("GET", f"{API}/users?exact=true&username={urllib.parse.quote(EMAIL)}", adm)
if not found:
    s, b = http("POST", f"{API}/users", adm, {"username": EMAIL, "email": EMAIL, "enabled": True, "emailVerified": True,
                                              "firstName": "KH", "lastName": "Bench"})
    assert s in (201, 204), (s, b)
    s, found = http("GET", f"{API}/users?exact=true&username={urllib.parse.quote(EMAIL)}", adm)
uid = found[0]["id"]
s, b = http("PUT", f"{API}/users/{uid}/reset-password", adm, {"type": "password", "value": acct["password"],
                                                               "temporary": False})
assert s == 204, (s, b)
s, groups = http("GET", f"{API}/groups?search=kh-users&exact=true", adm)
gid = next(g["id"] for g in groups if g["name"] == "kh-users")
s, b = http("PUT", f"{API}/users/{uid}/groups/{gid}", adm)
assert s == 204, (s, b)
A["accounts"]["kh-bench"] = acct
open(SECRETS, "w", encoding="utf-8").write(json.dumps(A, indent=2))
print("user ok", uid)

# 2. project grants, given by agent-admin through the KH realm resource
ag = token(REALM, "kh-test-password", A["accounts"]["agent-admin"]["email"], admin_pw)
for pid, level in GRANTS.items():
    s, b = http("PUT", f"{KC}/realms/{REALM}/kh/projects/{pid}/members/{urllib.parse.quote(EMAIL)}", ag,
                {"level": level})
    print("grant", pid, level, s, "" if s in (200, 204) else b)

# 3. proof, signed in as the bench account, on prod and dev
bt = token(REALM, "kh-test-password", EMAIL, acct["password"])
ok = True
for name, base in (("prod", KH), ("dev", DEV)):
    s, me = http("GET", f"{base}/auth/me", bt)
    s2, pr = http("GET", f"{base}/projects", bt)
    ids = sorted((pr.get("projects") or {}).keys()) if isinstance(pr, dict) else pr
    print(name, "auth/me", s, "| projects", s2, ids)
    leaked = [p for p in NO_ACCESS if isinstance(ids, list) and p in ids]
    s3, _ = http("POST", f"{base}/vector/scroll", bt, {"scope": "log", "project": "simplemdg-support", "limit": 1})
    s4, _ = http("POST", f"{base}/vector/add", bt, {"scope": "knowledge", "text": "BENCH-PROBE must be refused",
                                                    "metadata": {"project": "knowledge"}})
    print(name, "leaked:", leaked, "| read simplemdg-support:", s3, "| write knowledge:", s4)
    ok &= not leaked and s3 == 403 and s4 == 403
print("ALL CHECKS PASS" if ok else "SOME CHECK FAILED")
sys.exit(0 if ok else 1)

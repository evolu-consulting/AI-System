"""Contract test: app/caps/principals.py and the 'ns' route kind in app/auth.py (stage F3).

  1. Attach provisions the namespace client ('local' provisioner): the secret is shown once, only its hash is
     stored; POST /v1/token exchanges it for a KH-signed admin token; wrong secrets are 401.
  2. The client creates an orchestrator; the orchestrator creates agents and gets their 15-minute EdDSA tokens.
  3. Isolation: a service token reaches /v1 only (legacy routes 403), only its own namespace (403 elsewhere);
     tampered and expired tokens are 401; people's Keycloak tokens keep working everywhere.
  4. Grants never widen: effective = principal AND namespace AND on_behalf_of; an orchestrator cannot hand out a
     project it lacks; an owner who loses a project takes it from every principal at the next refresh.
  5. Roles: agents cannot manage principals or read events; judges read events.
  6. Revocation: a revoked principal is refused within KH_NS_CACHE_S (1 s here, 5 s by default).
  7. Detach suspends principals and disables the client; reattach re-enables the client only.
  8. 'keycloak' provisioner: a missing /kh route or an unreachable Keycloak is a clear 503; success stores the
     client; a Keycloak client-credentials token of kh-ns-<ns> acts as namespace admin.
  9. RACE: the active-principal cap holds under concurrent creates.
 10. Sign-in off (local dev): principal tokens still work on /v1, no token = the local admin.

    .venv\\Scripts\\python tests\\caps\\test_principals.py
"""
import os
import time

from harness import ISSUER, KEY, H

import jwt  # noqa: E402

from app import config, sqldb  # noqa: E402
from app.caps import principals, registry  # noqa: E402

c = H.client()
OLGA = H.person("olga@x.io", owner=["alpha", "beta"])
MAX = H.person("max@x.io", member=["alpha"])


def bearer(tok):
    return {"Authorization": "Bearer " + tok}


# ── 1. attach + client credentials ───────────────────────────────────────────
r = c.put("/v1/admin/ns/line", json={"projects": ["alpha", "beta"]}, headers=OLGA)
client = r.json().get("client") or {}
H.check("attach provisions the namespace client and shows its secret once", r.status_code == 201
        and client.get("client_id") == "kh-ns-line" and len(client.get("client_secret", "")) > 30
        and client.get("provisioner") == "local", r.text)
with sqldb.connect() as conn:
    stored = conn.execute("SELECT secret_hash FROM kh_ns_client WHERE ns='line'").fetchone()[0]
H.check("only a PBKDF2 hash of the secret is stored", stored.startswith("pbkdf2-sha256$")
        and client["client_secret"] not in stored)
r = c.post("/v1/token", json={"grant_type": "client_credentials", "client_id": "kh-ns-line", "client_secret": "nope"})
H.check("a wrong client secret is 401", r.status_code == 401, r.text)
r = c.post("/v1/token", data={"grant_type": "client_credentials", "client_id": "kh-ns-line",
                              "client_secret": client["client_secret"]})
H.check("client credentials (form encoded) give a 15-minute admin token", r.status_code == 200
        and r.json()["expires_in"] == 900, r.text)
ADMIN = bearer(r.json()["access_token"])
hdr = jwt.get_unverified_header(r.json()["access_token"])
H.check("the token is EdDSA-signed with a kid", hdr["alg"] == "EdDSA" and hdr["kid"].startswith("ed-"), hdr)
me = c.get("/v1/me", headers=ADMIN).json()
H.check("/v1/me for the namespace client", me["kind"] == "client" and me["role"] == "admin" and me["ns"] == "line"
        and me["projects"] == ["alpha", "beta"], me)
r = c.put("/v1/line/manifest", headers=ADMIN, json={"types": [
    {"type": "step.done", "kind_of": "event"}, {"type": "audit", "kind_of": "event", "read_roles": ["grader"]}]})
H.check("the namespace client applies the manifest", r.status_code == 200, r.text)

# ── 2. principals and tokens ─────────────────────────────────────────────────
r = c.post("/v1/line/principals", json={"principal_id": "orch-1", "role": "orchestrator"}, headers=ADMIN)
H.check("the admin creates an orchestrator", r.status_code == 201 and r.json()["on_behalf_of"] == "olga@x.io", r.text)
ORCH = bearer(c.post("/v1/line/principals/orch-1/token", headers=ADMIN).json()["access_token"])
r = c.post("/v1/line/principals", json={"principal_id": "orch-2", "role": "orchestrator"}, headers=ORCH)
H.check("an orchestrator cannot create orchestrators", r.status_code == 403, r.text)
r = c.post("/v1/line/principals", json={"principal_id": "agent-1", "role": "agent", "projects": ["alpha"]}, headers=ORCH)
H.check("the orchestrator creates an agent on its own on_behalf_of", r.status_code == 201
        and r.json()["created_by"] == "orch-1" and r.json()["projects"] == ["alpha"], r.text)
r = c.post("/v1/line/principals", json={"role": "agent", "on_behalf_of": "boss@x.io"}, headers=ORCH)
H.check("... and cannot act on behalf of someone else", r.status_code == 403, r.text)
tok = c.post("/v1/line/principals/agent-1/token", headers=ORCH).json()
AGENT = bearer(tok["access_token"])
claims = jwt.decode(tok["access_token"], options={"verify_signature": False})
H.check("the agent token names ns, role, obo and sub", claims["sub"] == "line:agent-1" and claims["role"] == "agent"
        and claims["obo"] == "olga@x.io" and claims["exp"] - claims["iat"] == 900, claims)
me = c.get("/v1/me", headers=AGENT).json()
H.check("/v1/me for an agent: effective projects", me["principal"] == "agent-1" and me["projects"] == ["alpha"], me)
c.post("/v1/line/principals", json={"principal_id": "judge-1", "role": "judge"}, headers=ADMIN)
JUDGE = bearer(c.post("/v1/line/principals/judge-1/token", headers=ADMIN).json()["access_token"])

# ── 3. isolation ─────────────────────────────────────────────────────────────
H.check("a service token cannot call legacy routes", c.post("/messages/inbox", json={}, headers=AGENT).status_code == 403)
H.check("... nor /projects", c.get("/projects", headers=AGENT).status_code == 403)
c.put("/v1/admin/ns/other", json={"projects": ["alpha"]}, headers=OLGA)
r = c.get("/v1/other/leases", headers=AGENT)
H.check("a principal of namespace A gets 403 on namespace B", r.status_code == 403, r.text)
H.check("a service token cannot manage namespaces", c.put("/v1/admin/ns/line", json={}, headers=ADMIN).status_code == 403)
bad = tok["access_token"][:-4] + ("AAAA" if not tok["access_token"].endswith("AAAA") else "BBBB")
H.check("a tampered token is 401", c.get("/v1/line/leases", headers=bearer(bad)).status_code == 401)
expired = principals.issue("line", "agent-1", "agent", "olga@x.io", ttl_s=-120)["access_token"]
r = c.get("/v1/line/leases", headers=bearer(expired))
H.check("an expired token is 401", r.status_code == 401 and "expired" in r.text, r.text)
forged = jwt.encode({"iss": principals.ISSUER, "aud": "kh-v1", "iat": int(time.time()), "exp": int(time.time()) + 60,
                     "sub": "line:agent-1", "ns": "line", "pid": "agent-1", "role": "agent", "obo": "o"},
                    KEY, algorithm="RS256", headers={"kid": "k1"})
H.check("a token not signed by KH's principal key is 401", c.get("/v1/line/leases", headers=bearer(forged)).status_code == 401)
H.check("people pass the auth gate on legacy routes (this test app has none, so 404 rather than 401/403)",
        c.post("/messages/inbox", json={}, headers=MAX).status_code == 404)

# ── 4. grants never widen ────────────────────────────────────────────────────
r = c.post("/v1/line/events", json={"kind": "step.done", "project": "beta", "body": {}}, headers=AGENT)
H.check("an agent cannot write to a project outside its grant", r.status_code == 422 and "beta" in r.text, r.text)
r = c.post("/v1/line/events", json={"kind": "step.done", "project": "alpha", "body": {}}, headers=AGENT)
H.check("... and writes inside it", r.status_code == 200, r.text)
r = c.post("/v1/line/principals", json={"role": "agent", "projects": ["gamma"]}, headers=ORCH)
H.check("an orchestrator cannot give a project it does not have", r.status_code == 403, r.text)
c.post("/v1/line/principals", json={"principal_id": "agent-2", "role": "agent"}, headers=ADMIN)
A2 = bearer(c.post("/v1/line/principals/agent-2/token", headers=ADMIN).json()["access_token"])
H.check("an admin-created agent gets every namespace project the owner has",
        c.get("/v1/me", headers=A2).json()["projects"] == ["alpha", "beta"])
res = principals.refresh_owner_grants(fetch=lambda email: ["alpha"] if email == "olga@x.io" else None)
H.check("the owner-grant refresh re-reads every on_behalf_of person", res["refreshed"] == 1, res)
time.sleep(registry.CACHE_S + 0.1)
H.check("an owner who lost a project takes it from every principal", c.get("/v1/me", headers=A2).json()["projects"]
        == ["alpha"] and c.get("/v1/me", headers=ADMIN).json()["projects"] == ["alpha"])
principals.set_owner_projects("olga@x.io", ["alpha", "beta"], "test")

# ── 5. roles ─────────────────────────────────────────────────────────────────
H.check("an agent cannot create principals", c.post("/v1/line/principals", json={"role": "agent"},
                                                      headers=AGENT).status_code == 403)
H.check("an agent cannot read events", c.get("/v1/line/events", headers=AGENT).status_code == 403)
H.check("a judge reads events", c.get("/v1/line/events", headers=JUDGE).status_code == 200)
H.check("a principal reads itself", c.get("/v1/line/principals/agent-1", headers=AGENT).status_code == 200)
r = c.get("/v1/line/principals?role=agent", headers=ORCH)
H.check("list principals by role", sorted(p["principal_id"] for p in r.json()["principals"]) == ["agent-1", "agent-2"],
        r.text)

# ── 6. revocation ────────────────────────────────────────────────────────────
H.check("before revocation the agent works", c.get("/v1/line/leases", headers=AGENT).status_code == 200)
cur = c.get("/v1/line/principals/agent-1", headers=ADMIN)
r = c.patch("/v1/line/principals/agent-1", json={"state": "revoked"}, headers={**ADMIN, "If-Match": cur.headers["etag"]})
H.check("revoke with If-Match", r.status_code == 200 and r.json()["state"] == "revoked", r.text)
r = c.patch("/v1/line/principals/agent-1", json={"state": "active"}, headers=ADMIN)
H.check("a revoked principal stays revoked", r.status_code == 422, r.text)
t0 = time.monotonic()
while time.monotonic() - t0 < 7 and c.get("/v1/line/leases", headers=AGENT).status_code != 401:
    time.sleep(0.1)
took = time.monotonic() - t0
H.check(f"a revoked principal is refused within the cache bound ({took:.1f}s <= {registry.CACHE_S + 0.5}s)",
        took <= registry.CACHE_S + 0.5, took)
H.check("no new token for a revoked principal",
        c.post("/v1/line/principals/agent-1/token", headers=ADMIN).status_code == 403)

# ── 7. detach / reattach ─────────────────────────────────────────────────────
r = c.post("/v1/admin/ns/line:detach", headers=OLGA)
H.check("detach", r.status_code == 200, r.text)
H.check("after detach the namespace answers 404 to the client", c.get("/v1/line/leases", headers=ADMIN).status_code == 404)
H.check("after detach the client cannot get a token",
        c.post("/v1/token", json={"client_id": "kh-ns-line", "client_secret": client["client_secret"]}).status_code == 401)
c.post("/v1/admin/ns/line:reattach", headers=OLGA)
time.sleep(registry.CACHE_S + 0.1)
r = c.post("/v1/token", json={"client_id": "kh-ns-line", "client_secret": client["client_secret"]})
H.check("reattach re-enables the client", r.status_code == 200, r.text)
ADMIN = bearer(r.json()["access_token"])
H.check("... while the old principals stay suspended", c.get("/v1/line/leases", headers=JUDGE).status_code == 401
        and c.get("/v1/line/principals/judge-1", headers=ADMIN).json()["state"] == "suspended")

# ── 8. keycloak provisioner ──────────────────────────────────────────────────
import requests  # noqa: E402

os.environ["KH_NS_PROVISIONER"] = "keycloak"
real_post = requests.post


class _Resp:
    def __init__(self, status, body):
        self.status_code, self._body, self.content, self.text = status, body, b"x", str(body)

    def json(self):
        return self._body


requests.post = lambda *a, **k: (_ for _ in ()).throw(requests.ConnectionError("down"))
r = c.post("/v1/admin/ns/other:client", headers=OLGA)
H.check("keycloak unreachable: 503 provisioner_unavailable with a clear message", r.status_code == 503
        and r.json()["error"] == "provisioner_unavailable" and "KH_NS_PROVISIONER=local" in r.json()["detail"], r.text)
requests.post = lambda *a, **k: _Resp(404, {"error": "not found"})
r = c.post("/v1/admin/ns/other:client", headers=OLGA)
H.check("keycloak without the /kh namespace route: 503 naming the missing route", r.status_code == 503
        and "/kh/namespaces" in r.json()["detail"], r.text)
seen = {}
requests.post = lambda url, **k: seen.update(url=url, auth=k["headers"]["Authorization"]) or _Resp(
    201, {"client_id": "kh-ns-other"})
r = c.post("/v1/admin/ns/other:client", headers=OLGA)
H.check("keycloak provisioning relays the caller's own token to {issuer}/kh/namespaces", r.status_code == 201
        and seen["url"] == ISSUER + "/kh/namespaces" and seen["auth"] == OLGA["Authorization"]
        and r.json()["provisioner"] == "keycloak", (r.text, seen))
requests.post = real_post
os.environ["KH_NS_PROVISIONER"] = "local"
now = int(time.time())
kc_client = jwt.encode({"iss": ISSUER, "aud": "kh-api", "iat": now, "exp": now + 300, "azp": "kh-ns-other",
                        "clientId": "kh-ns-other"}, KEY, algorithm="RS256", headers={"kid": "k1"})
me = c.get("/v1/me", headers=bearer(kc_client)).json()
H.check("a Keycloak client-credentials token of kh-ns-<ns> is that namespace's admin", me.get("role") == "admin"
        and me.get("ns") == "other", me)
H.check("... and is refused on another namespace", c.get("/v1/line/leases", headers=bearer(kc_client)).status_code == 403)

# ── 9. race on the active-principal cap ──────────────────────────────────────
principals.MAX_ACTIVE = 8
with sqldb.connect() as conn:
    active = sqldb.counter_get(conn, "principals:active:line")
res = H.race(10, lambda i: c.post("/v1/line/principals", json={"principal_id": f"burst-{i}", "role": "agent"},
                                  headers=ADMIN).status_code)
H.check(f"RACE: 10 concurrent creates with {8 - active} slots left -> exactly that many 201, the rest 429",
        res.count(201) == 8 - active and res.count(429) == 10 - (8 - active), (active, res))
principals.MAX_ACTIVE = 2000

# ── 10. sign-in off ──────────────────────────────────────────────────────────
config.AUTH_ISSUER = ""
from fastapi.testclient import TestClient  # noqa: E402
local = TestClient(H.app())
H.check("sign-in off: no token is the local admin", local.get("/v1/me").json()["kind"] == "local"
        and local.get("/v1/line/leases").status_code == 200)
c2 = local.post("/v1/line/principals", json={"principal_id": "dev-agent", "role": "agent"})
dev = bearer(local.post("/v1/line/principals/dev-agent/token").json()["access_token"])
H.check("sign-in off: a principal token still carries its role", local.get("/v1/line/events", headers=dev).status_code
        == 403 and local.get("/v1/me", headers=dev).json()["role"] == "agent", c2.text)
row = {"ns": "line", "projects": ["p1", "p2"]}
H.check("sign-in off: the local owner grants the namespace its own projects",
        principals.owner_projects(config.MSG_LOCAL_USER) is None
        and principals.effective_projects(row, None, config.MSG_LOCAL_USER) == {"p1", "p2"})
config.AUTH_ISSUER = ISSUER
H.check("sign-in on: the name 'local' gets no implicit grant",
        principals.owner_projects(config.MSG_LOCAL_USER) is not None)

H.done()

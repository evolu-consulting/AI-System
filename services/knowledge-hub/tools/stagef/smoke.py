"""Stage F smoke over HTTP against a local dev KH (e.g. container kh-dev-f on :9102).

    KH_DEV_BOOTSTRAP_TOKEN=... python tools/stagef/smoke.py [--url http://127.0.0.1:9102] [--keep]
    <secret-source> | python tools/stagef/smoke.py --token-stdin

Steps (each prints ok/FAIL; exit 1 on the first failure):
  1. GET /health, GET /v1/capabilities (every capability has a version), GET /v1/openapi.json
  2. PUT /v1/admin/ns/<ns> as the dev maintainer (DEV-ONLY bootstrap token, docs/caps-dev.md section 11)
     -> 201 and the namespace client (KH_NS_PROVISIONER=local: client_id + client_secret)
  3. PUT /v1/<ns>/manifest: one event type with a JSON Schema
  4. POST /v1/token: the namespace client secret -> a KH-signed namespace admin token
  5. POST /v1/<ns>/principals (role agent) + POST /v1/<ns>/principals/<id>/token -> agent token
  6. POST /v1/<ns>/events as the agent, then (as admin: agents may not read events) GET /v1/<ns>/events/<id>
     and the cursor read
  7. detach the namespace again (unless --keep)

Secrets come only from the environment or stdin and are never printed. Python stdlib only.
"""
from __future__ import annotations

import argparse
import json
import os
import secrets
import sys
import urllib.error
import urllib.request

PREFIX = "khdev."


def call(base: str, method: str, path: str, token: str | None = None, body=None, headers=None):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(base.rstrip("/") + path, data=data, method=method)
    if data is not None:
        req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            raw = r.read()
            status = r.status
    except urllib.error.HTTPError as e:
        raw, status = e.read(), e.code
    try:
        return status, json.loads(raw or b"null")
    except ValueError:
        return status, raw.decode("utf-8", "replace")[:300]


def step(name: str, ok: bool, detail=None) -> None:
    print(("ok   " if ok else "FAIL ") + name + ("" if ok or detail is None else f"  -> {str(detail)[:400]}"))
    if not ok:
        sys.exit(1)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--url", default=os.getenv("KH_URL", "http://127.0.0.1:9102"))
    ap.add_argument("--ns", default="", help="namespace to create (default smoke_<random>)")
    ap.add_argument("--project", default="smoke", help="KH project id the namespace names")
    ap.add_argument("--token-stdin", action="store_true", help="read the dev bootstrap token from stdin")
    ap.add_argument("--keep", action="store_true", help="leave the namespace attached")
    a = ap.parse_args()

    raw = sys.stdin.readline().strip() if a.token_stdin else os.getenv("KH_DEV_BOOTSTRAP_TOKEN", "")
    if not raw:
        sys.exit("no dev bootstrap token: set KH_DEV_BOOTSTRAP_TOKEN or pipe it with --token-stdin")
    person = raw if raw.startswith(PREFIX) else PREFIX + raw
    ns = a.ns or f"smoke_{secrets.token_hex(3)}"
    base = a.url
    print(f"KH {base}, namespace {ns}, project {a.project}")

    # 1. health, discovery
    s, b = call(base, "GET", "/health")
    step("GET /health is 200", s == 200, (s, b))
    s, b = call(base, "GET", "/v1/me", person)
    step("the dev token is a maintainer person", s == 200 and b.get("kind") == "person" and b.get("maintainer"), (s, b))
    s, b = call(base, "GET", "/v1/capabilities", person)
    caps = b.get("capabilities") if isinstance(b, dict) else None
    step("GET /v1/capabilities lists capabilities with versions", s == 200 and isinstance(caps, list) and caps
         and all(c.get("name") and c.get("version") for c in caps), (s, b))
    print("     " + ", ".join(f"{c['name']} {c['version']}" for c in caps))
    s, b = call(base, "GET", "/v1/openapi.json", person)
    step("GET /v1/openapi.json loads", s == 200 and isinstance(b, dict) and b.get("paths"), (s, str(b)[:200]))

    # 2. attach the namespace
    s, ns_row = call(base, "PUT", f"/v1/admin/ns/{ns}", person, {"projects": [a.project], "display": "stage F smoke"})
    step("PUT /v1/admin/ns/{ns} as maintainer is 201 active", s == 201 and ns_row.get("state") == "active", (s, ns_row))
    client = ns_row.get("client") or {}
    step("the namespace client was provisioned locally (id + secret)",
         client.get("client_id", "").endswith(ns) and bool(client.get("client_secret")),
         {k: v for k, v in client.items() if k != "client_secret"})

    # 3. manifest
    manifest = {
        "schemas": [{"name": "smoke_ping", "version": 1, "schema": {
            "type": "object", "required": ["msg"], "properties": {"msg": {"type": "string"}, "n": {"type": "number"}}}}],
        "types": [{"type": "smoke.ping", "kind_of": "event", "schema": "smoke_ping", "index_fields": {"msg": "s"}}]}
    s, b = call(base, "PUT", f"/v1/{ns}/manifest", person, manifest)
    step("PUT /v1/{ns}/manifest is 200", s == 200 and b.get("manifest_rev", 0) >= 1, (s, b))

    # 4. client secret -> namespace admin token
    s, b = call(base, "POST", "/v1/token", None, {"grant_type": "client_credentials",
                                                   "client_id": client["client_id"],
                                                   "client_secret": client["client_secret"]})
    admin = b.get("access_token") if isinstance(b, dict) else None
    step("POST /v1/token exchanges the client secret for a KH-signed admin token", s == 200 and bool(admin),
         (s, {k: v for k, v in (b or {}).items() if k != "access_token"} if isinstance(b, dict) else b))
    s, b = call(base, "GET", "/v1/me", admin)
    step("the admin token is the namespace admin", s == 200 and b.get("ns") == ns and b.get("role") == "admin", (s, b))

    # 5. an agent principal and its token
    s, b = call(base, "POST", f"/v1/{ns}/principals", admin, {"role": "agent", "principal_id": "smoke-agent"})
    step("POST /v1/{ns}/principals creates an agent", s in (200, 201) and b.get("principal_id") == "smoke-agent", (s, b))
    s, b = call(base, "POST", f"/v1/{ns}/principals/smoke-agent/token", admin, {})
    agent = b.get("access_token") if isinstance(b, dict) else None
    step("POST /v1/{ns}/principals/smoke-agent/token issues an agent token", s in (200, 201) and bool(agent),
         (s, {k: v for k, v in (b or {}).items() if k != "access_token"} if isinstance(b, dict) else b))

    # 6. append + read back
    ev = {"kind": "smoke.ping", "project": a.project, "run_id": "smoke-run", "body": {"msg": "hello", "n": 1}}
    s, b = call(base, "POST", f"/v1/{ns}/events", agent, ev, {"X-KH-Unit": "smoke-unit"})
    acc = (b.get("accepted") or [{}])[0] if isinstance(b, dict) else {}
    step("POST /v1/{ns}/events as the agent is accepted (id, seq)", s == 200 and acc.get("id") and acc.get("seq", 0) >= 1,
         (s, b))
    s, b = call(base, "POST", f"/v1/{ns}/events", agent, {**ev, "body": {"n": 2}})
    step("an event that breaks the manifest schema is 422", s == 422, (s, b))
    s, b = call(base, "GET", f"/v1/{ns}/events/{acc['id']}", agent)
    step("the agent itself may not read events (role matrix: 403)", s == 403, (s, b))
    s, got = call(base, "GET", f"/v1/{ns}/events/{acc['id']}", admin)
    step("GET /v1/{ns}/events/{id} as admin reads it back (body, envelope, actor)", s == 200
         and got.get("body") == ev["body"] and got.get("unit_id") == "smoke-unit"
         and (got.get("actor") or {}).get("principal") == "smoke-agent", (s, got))
    s, b = call(base, "GET", f"/v1/{ns}/events?kind=smoke.ping&after_seq=0", admin)
    step("the cursor read lists exactly that event", s == 200 and [e.get("id") for e in b.get("events", [])] == [acc["id"]],
         (s, b))

    # 7. tidy up
    if not a.keep:
        s, b = call(base, "POST", f"/v1/admin/ns/{ns}:detach", person)
        step("detach the smoke namespace", s == 200 and b.get("state") == "detached", (s, b))
    print("\nsmoke passed")


if __name__ == "__main__":
    main()

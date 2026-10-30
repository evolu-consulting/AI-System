"""Seed a fresh KH with the Prod kernel: the hook rules, the every-project action policy table and the shared
projects the kernel names. Safe to run again: rules are upserted by (hook_type, name), the policy table is
replaced as a whole, and an existing project is left as it is.

Signs in as the automation maintainer (agent-admin, from local_setup.py) through a temporary password-grant
client, which is removed again at the end.

Usage:
    python seed_kh.py --keycloak http://localhost:8180 --kh http://localhost:9000 --secrets-dir <dir> --seed-dir <dir>
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "deploy" / "btp"))
from configure_realm import Admin  # noqa: E402

REALM = "knowledge-hub"
CLIENT = "kh-installer"
SCOPE = "kh-access"
# The projects the kernel refers to, with their Prod visibility (kh catalog 2026-10-16).
SHARED_PROJECTS = {"lesson-learned": "private", "market": "public", "kh-tools": "semi-public"}


def http(method: str, url: str, token: str | None = None, payload=None, form=None):
    data, headers = None, {}
    if form is not None:
        data = urllib.parse.urlencode(form).encode()
    elif payload is not None:
        data, headers["Content-Type"] = json.dumps(payload).encode(), "application/json"
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=300) as r:
            raw = r.read()
            return r.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        raw = e.read().decode(errors="replace")
        try:
            return e.code, json.loads(raw)
        except ValueError:
            return e.code, raw


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--keycloak", required=True)
    parser.add_argument("--kh", required=True)
    parser.add_argument("--secrets-dir", required=True, type=Path)
    parser.add_argument("--seed-dir", required=True, type=Path)
    args = parser.parse_args()
    base, kh = args.keycloak.rstrip("/"), args.kh.rstrip("/")
    secret = (args.secrets_dir / "keycloak-admin-client.txt").read_text(encoding="utf-8").strip()
    agent = json.loads((args.secrets_dir / "kh-accounts.json").read_text(encoding="utf-8"))["accounts"]["agent-admin"]
    hooks = json.loads((args.seed_dir / "kernel_hooks.json").read_text(encoding="utf-8"))["rules"]
    policy = json.loads((args.seed_dir / "policy_actions_every_project.json").read_text(encoding="utf-8"))

    admin = Admin(base, "kh-local-admin", secret)
    if not admin.call("GET", f"/clients?clientId={CLIENT}"):
        admin.call("POST", "/clients", {"clientId": CLIENT, "publicClient": True, "directAccessGrantsEnabled": True,
                                        "standardFlowEnabled": False, "fullScopeAllowed": False})
    cid = admin.call("GET", f"/clients?clientId={CLIENT}")[0]["id"]
    try:
        scopes = {s["name"]: s["id"] for s in admin.call("GET", "/client-scopes")}
        admin.call("PUT", f"/clients/{cid}/default-client-scopes/{scopes[SCOPE]}")

        def token() -> str:
            status, body = http("POST", f"{base}/realms/{REALM}/protocol/openid-connect/token",
                                form={"grant_type": "password", "client_id": CLIENT, "username": agent["email"],
                                      "password": agent["password"], "scope": "openid"})
            if status != 200:
                raise SystemExit(f"sign-in as {agent['email']} failed: {status} {body}")
            return body["access_token"]

        tok = token()
        for project, visibility in SHARED_PROJECTS.items():
            status, body = http("POST", f"{kh}/projects", tok, {"project_id": project, "visibility": visibility})
            print(f"project {project} ({visibility}): {status}")
            if status not in (200, 201, 409):
                raise SystemExit(f"POST /projects {project} -> {status} {body}")
        tok = token()   # the new projects are in the token from here on

        for rule in hooks:
            body = {k: rule[k] for k in ("hook_type", "name", "content", "position")}
            body["enabled"] = bool(rule["enabled"])
            status, answer = http("POST", f"{kh}/hooks/set", tok, body)
            if status == 422:   # a Prod rule over today's lint budget: kept as Prod has it
                body.update(allow_oversize=True, reason="seeded verbatim from KH Prod")
                status, answer = http("POST", f"{kh}/hooks/set", tok, body)
            if status != 200:
                raise SystemExit(f"POST /hooks/set {rule['hook_type']}/{rule['name']} -> {status} {answer}")
        status, answer = http("POST", f"{kh}/policy/actions/bulk", tok,
                              {"actions": policy["actions"], "rules": policy["rules"], "replace": True})
        if status != 200:
            raise SystemExit(f"POST /policy/actions/bulk -> {status} {answer}")

        _, listed = http("GET", f"{kh}/hooks/list", tok)
        _, menu = http("GET", f"{kh}/policy/actions", tok)
        print(json.dumps({"hook_rules": listed["count"], "actions": menu["count"],
                          "expected": {"hook_rules": len(hooks), "actions": len(policy["actions"]),
                                       "rules": len(policy["rules"])}}, indent=2))
        if listed["count"] < len(hooks) or menu["count"] < len(policy["actions"]):
            raise SystemExit("seed incomplete")
    finally:
        admin.call("DELETE", f"/clients/{cid}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

"""First-time setup of the docker Keycloak (deploy/docker), the same way BTP prod was set up.

Signs in with the temporary bootstrap admin of the first start, then:
  1. a master service-account client 'kh-docker-admin' (role admin) that every other script uses;
  2. the 'knowledge-hub' realm with the KH-wide roles of deploy/kh-auth/catalog.json;
  3. agent-admin@kh-agent.invalid: master admin and KH maintainer, with a permanent password;
  4. the Keycloak repo's configure_realm.py, configure_tenants.py (tenant kh-test), kh-auth/seed.py and
     configure_shared_roles.py;
  5. deletes the bootstrap admin.
Safe to run again: with the bootstrap admin gone it signs in with kh-docker-admin instead.
Secrets go to --secrets-dir only (never printed): keycloak-docker-admin-client.txt, kh-docker-accounts.json.

Usage (from Slaves/KnowledgeHub):
    python deploy/docker/setup_realm.py --url http://host.docker.internal:8180 \
        --keycloak-repo C:/Workspaces/Keycloak --service-key <key.json> \
        --bootstrap-password-file <file> --secrets-dir <dir>
"""
from __future__ import annotations

import argparse
import json
import secrets
import subprocess
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

REALM = "knowledge-hub"
ADMIN_CLIENT = "kh-docker-admin"
AGENT = "agent-admin@kh-agent.invalid"
TEST_TENANT = {"kh-test": {"domains": ["example.invalid"], "members": [], "admins": []}}


class Keycloak:
    def __init__(self, url: str, form: dict):
        self.url = url.rstrip("/")
        self.form = form
        self.sign_in()

    def sign_in(self) -> None:
        body = urllib.parse.urlencode(self.form).encode()
        with urllib.request.urlopen(f"{self.url}/realms/master/protocol/openid-connect/token", body, timeout=60) as r:
            self.token = json.load(r)["access_token"]

    def call(self, method: str, path: str, payload=None, retried: bool = False):
        request = urllib.request.Request(f"{self.url}/admin/realms{path}", method=method,
                                         data=None if payload is None else json.dumps(payload).encode(),
                                         headers={"Authorization": f"Bearer {self.token}",
                                                  "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(request, timeout=900) as r:   # realm creation over the WAN takes minutes
                raw = r.read()
                return json.loads(raw) if raw else None
        except urllib.error.HTTPError as e:
            if e.code == 409:
                return None
            if e.code == 401 and not retried:       # master tokens live 60 s; HANA over the WAN is slow
                self.sign_in()
                return self.call(method, path, payload, retried=True)
            raise RuntimeError(f"{method} {path} -> {e.code} {e.read().decode(errors='replace')}") from e

    def user_id(self, realm: str, username: str) -> str | None:
        found = self.call("GET", f"/{realm}/users?exact=true&username={urllib.parse.quote(username)}")
        return found[0]["id"] if found else None

    def ensure_user(self, realm: str, email: str, first: str, last: str, password: str) -> str:
        user = {"username": email, "email": email, "firstName": first, "lastName": last,
                "enabled": True, "emailVerified": True}
        uid = self.user_id(realm, email)
        if uid is None:
            self.call("POST", f"/{realm}/users", user)
            uid = self.user_id(realm, email)
        self.call("PUT", f"/{realm}/users/{uid}/reset-password",
                  {"type": "password", "value": password, "temporary": False})
        return uid

    def grant_realm_role(self, realm: str, user_id: str, role_name: str) -> None:
        role = self.call("GET", f"/{realm}/roles/{urllib.parse.quote(role_name)}")
        self.call("POST", f"/{realm}/users/{user_id}/role-mappings/realm", [role])


def sign_in(url: str, bootstrap_password: str, client_secret_file: Path) -> tuple[Keycloak, bool]:
    try:
        return Keycloak(url, {"grant_type": "password", "client_id": "admin-cli",
                              "username": "tmp-bootstrap-admin", "password": bootstrap_password}), True
    except urllib.error.HTTPError:
        secret = client_secret_file.read_text(encoding="utf-8").strip()
        return Keycloak(url, {"grant_type": "client_credentials", "client_id": ADMIN_CLIENT,
                              "client_secret": secret}), False


def ensure_admin_client(kc: Keycloak, secret_file: Path) -> None:
    if not kc.call("GET", f"/master/clients?clientId={ADMIN_CLIENT}"):
        kc.call("POST", "/master/clients", {"clientId": ADMIN_CLIENT, "name": "Docker test stack admin",
                                            "publicClient": False, "serviceAccountsEnabled": True,
                                            "standardFlowEnabled": False, "directAccessGrantsEnabled": False})
    cid = kc.call("GET", f"/master/clients?clientId={ADMIN_CLIENT}")[0]["id"]
    sa = kc.call("GET", f"/master/clients/{cid}/service-account-user")
    kc.grant_realm_role("master", sa["id"], "admin")
    secret = kc.call("GET", f"/master/clients/{cid}/client-secret")["value"]
    secret_file.write_text(secret, encoding="utf-8")


def run(script: Path, *args: str) -> None:
    subprocess.run([sys.executable, str(script), *args], check=True, cwd=script.parent)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--url", required=True)
    parser.add_argument("--keycloak-repo", required=True, type=Path)
    parser.add_argument("--service-key", required=True, type=Path)
    parser.add_argument("--bootstrap-password-file", required=True, type=Path)
    parser.add_argument("--secrets-dir", required=True, type=Path)
    args = parser.parse_args()
    secret_file = args.secrets_dir / "keycloak-docker-admin-client.txt"
    accounts_file = args.secrets_dir / "kh-docker-accounts.json"
    btp = args.keycloak_repo / "deploy" / "btp"
    catalog = json.loads((args.keycloak_repo / "deploy" / "kh-auth" / "catalog.json").read_text(encoding="utf-8"))

    kc, bootstrap = sign_in(args.url, args.bootstrap_password_file.read_text(encoding="utf-8").strip(), secret_file)
    if bootstrap:
        ensure_admin_client(kc, secret_file)

    kc.call("POST", "", {"realm": REALM, "enabled": True, "displayName": "Knowledge Hub (docker test)",
                         "registrationAllowed": False})
    for role in catalog["roles"]:
        kc.call("POST", f"/{REALM}/roles", {"name": role["code"], "description": role["description"]})

    accounts = json.loads(accounts_file.read_text(encoding="utf-8")) if accounts_file.exists() else {
        "keycloak": args.url, "kh": "http://localhost:9200", "accounts": {}}
    agent = accounts["accounts"].setdefault("agent-admin", {"email": AGENT, "password": secrets.token_urlsafe(18),
                                                            "level": "system-admin"})
    master_id = kc.ensure_user("master", AGENT, "Agent", "Admin", agent["password"])
    kc.grant_realm_role("master", master_id, "admin")
    realm_id = kc.ensure_user(REALM, AGENT, "Agent", "Admin", agent["password"])
    kc.grant_realm_role(REALM, realm_id, "maintainer")
    accounts_file.write_text(json.dumps(accounts, indent=2), encoding="utf-8")

    run(btp / "configure_realm.py", "--url", args.url, "--client-id", ADMIN_CLIENT, "--client-secret-file", str(secret_file))
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as plan:
        json.dump({"tenants": TEST_TENANT, "system_admins": [AGENT], "kh_users": []}, plan)
    run(btp / "configure_tenants.py", "--url", args.url, "--client-id", ADMIN_CLIENT,
        "--client-secret-file", str(secret_file), "--plan", plan.name)
    Path(plan.name).unlink()
    run(args.keycloak_repo / "deploy" / "kh-auth" / "seed.py", "--service-key", str(args.service_key),
        "--maintainer", AGENT)
    # The roles that open semi-public and public projects, carried by the tenant groups (fen 2026-10-13).
    run(btp / "configure_shared_roles.py", "--url", args.url, "--client-id", ADMIN_CLIENT,
        "--client-secret-file", str(secret_file))

    if bootstrap:
        uid = kc.user_id("master", "tmp-bootstrap-admin")
        if uid:
            kc.call("DELETE", f"/master/users/{uid}")
    print(f"realm {REALM} ready at {args.url}; secrets in {args.secrets_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

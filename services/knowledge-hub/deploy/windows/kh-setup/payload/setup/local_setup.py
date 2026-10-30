"""First-time setup of the local Keycloak (Windows install), the same way BTP prod was set up.

Signs in with the temporary bootstrap admin of Keycloak's first start, then:
  1. a master service-account client 'kh-local-admin' (role admin) that every other step uses;
  2. the 'knowledge-hub' realm with the KH-wide roles of deploy/kh-auth/catalog.json;
  3. agent-admin@kh-agent.invalid: master admin and KH maintainer with a permanent password (automation);
  4. the person installing: KH maintainer + system admin, with a ONE-TIME password (changed at first sign-in);
  5. configure_realm.py, configure_tenants.py (one tenant), kh-auth/seed_postgres.py, configure_shared_roles.py;
  6. deletes the bootstrap admin.
Safe to run again: with the bootstrap admin gone it signs in with kh-local-admin instead.
Secrets go to --secrets-dir only (never printed).

Usage:
    python local_setup.py --url http://localhost:8180 --bootstrap-password-file <f> --secrets-dir <dir>
        --db-file <db.json> --psql <psql.exe> --admin-email <email> --admin-first <first> --admin-last <last>
        --tenant <name> --tenant-domain <domain>
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

HERE = Path(__file__).resolve().parent
BTP = HERE / "deploy" / "btp"
KH_AUTH = HERE / "deploy" / "kh-auth"
REALM = "knowledge-hub"
ADMIN_CLIENT = "kh-local-admin"
AGENT = "agent-admin@kh-agent.invalid"


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
            with urllib.request.urlopen(request, timeout=300) as r:
                raw = r.read()
                return json.loads(raw) if raw else None
        except urllib.error.HTTPError as e:
            if e.code == 409:
                return None
            if e.code == 401 and not retried:       # master tokens live 60 s
                self.sign_in()
                return self.call(method, path, payload, retried=True)
            raise RuntimeError(f"{method} {path} -> {e.code} {e.read().decode(errors='replace')}") from e

    def user_id(self, realm: str, username: str) -> str | None:
        found = self.call("GET", f"/{realm}/users?exact=true&username={urllib.parse.quote(username)}")
        return found[0]["id"] if found else None

    def ensure_user(self, realm: str, email: str, first: str, last: str, password: str | None,
                    temporary: bool = False) -> str:
        uid = self.user_id(realm, email)
        if uid is None:
            self.call("POST", f"/{realm}/users", {"username": email, "email": email, "firstName": first,
                                                  "lastName": last, "enabled": True, "emailVerified": True})
            uid = self.user_id(realm, email)
        if password is not None:
            self.call("PUT", f"/{realm}/users/{uid}/reset-password",
                      {"type": "password", "value": password, "temporary": temporary})
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
        kc.call("POST", "/master/clients", {"clientId": ADMIN_CLIENT, "name": "Local install admin",
                                            "publicClient": False, "serviceAccountsEnabled": True,
                                            "standardFlowEnabled": False, "directAccessGrantsEnabled": False})
    cid = kc.call("GET", f"/master/clients?clientId={ADMIN_CLIENT}")[0]["id"]
    sa = kc.call("GET", f"/master/clients/{cid}/service-account-user")
    kc.grant_realm_role("master", sa["id"], "admin")
    secret_file.write_text(kc.call("GET", f"/master/clients/{cid}/client-secret")["value"], encoding="utf-8")


def run(script: Path, *args: str) -> None:
    subprocess.run([sys.executable, str(script), *args], check=True, cwd=script.parent)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--url", required=True)
    parser.add_argument("--bootstrap-password-file", required=True, type=Path)
    parser.add_argument("--secrets-dir", required=True, type=Path)
    parser.add_argument("--db-file", required=True, type=Path)
    parser.add_argument("--psql", required=True)
    parser.add_argument("--admin-email", required=True)
    parser.add_argument("--admin-first", default="KH")
    parser.add_argument("--admin-last", default="Admin")
    parser.add_argument("--tenant", required=True)
    parser.add_argument("--tenant-domain", required=True)
    args = parser.parse_args()
    secret_file = args.secrets_dir / "keycloak-admin-client.txt"
    accounts_file = args.secrets_dir / "kh-accounts.json"
    email = args.admin_email.strip().lower()
    catalog = json.loads((KH_AUTH / "catalog.json").read_text(encoding="utf-8"))

    kc, bootstrap = sign_in(args.url, args.bootstrap_password_file.read_text(encoding="utf-8").strip(), secret_file)
    if bootstrap:
        ensure_admin_client(kc, secret_file)

    kc.call("POST", "", {"realm": REALM, "enabled": True, "displayName": "Knowledge Hub",
                         "registrationAllowed": False})
    for role in catalog["roles"]:
        kc.call("POST", f"/{REALM}/roles", {"name": role["code"], "description": role["description"]})

    accounts = json.loads(accounts_file.read_text(encoding="utf-8")) if accounts_file.exists() else {
        "keycloak": args.url, "accounts": {}}
    agent = accounts["accounts"].setdefault("agent-admin", {"email": AGENT, "password": secrets.token_urlsafe(18)})
    kc.grant_realm_role("master", kc.ensure_user("master", AGENT, "Agent", "Admin", agent["password"]), "admin")
    kc.grant_realm_role(REALM, kc.ensure_user(REALM, AGENT, "Agent", "Admin", agent["password"]), "maintainer")

    # The person's one-time password is written once; a rerun leaves their own password alone.
    person = accounts["accounts"].get("admin")
    first_time = person is None
    if first_time:
        person = accounts["accounts"]["admin"] = {"email": email, "one_time_password": secrets.token_urlsafe(12)}
    for realm, role in (("master", "admin"), (REALM, "maintainer")):
        uid = kc.ensure_user(realm, email, args.admin_first, args.admin_last,
                             person["one_time_password"] if first_time else None, temporary=True)
        kc.grant_realm_role(realm, uid, role)
    accounts_file.write_text(json.dumps(accounts, indent=2), encoding="utf-8")

    client = ["--url", args.url, "--client-id", ADMIN_CLIENT, "--client-secret-file", str(secret_file)]
    run(BTP / "configure_realm.py", *client)
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as plan:
        json.dump({"tenants": {args.tenant: {"domains": [args.tenant_domain], "members": [], "admins": []}},
                   "system_admins": [AGENT, email], "kh_users": []}, plan)
    run(BTP / "configure_tenants.py", *client, "--plan", plan.name)
    Path(plan.name).unlink()
    run(KH_AUTH / "seed_postgres.py", "--db-file", str(args.db_file), "--psql", args.psql, "--maintainer", email)
    run(BTP / "configure_shared_roles.py", *client)

    if bootstrap:
        uid = kc.user_id("master", "tmp-bootstrap-admin")
        if uid:
            kc.call("DELETE", f"/master/users/{uid}")
    print(f"realm {REALM} ready at {args.url}; secrets in {args.secrets_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

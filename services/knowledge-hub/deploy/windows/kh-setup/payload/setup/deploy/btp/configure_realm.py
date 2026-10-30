"""Configure the 'knowledge-hub' realm for Knowledge Hub sign-in. Safe to run again: every step checks first.

  * Tokens: access token 5 minutes; offline (refresh) session up to 90 days, which is the credential the
    local helper keeps. Revoking it, or disabling the person, stops access at the next refresh.
  * Client scope 'kh-access': the 'kh' permission claim and the 'kh-api' audience KH checks.
  * Client 'kh-cli': public client for the local helper: authorization code + PKCE on a 127.0.0.1
    loopback redirect (no consent screen), and the device grant for machines without a browser.
  * First broker login flow 'kh-first-broker-login': Google or Entra may only sign in a person who already
    exists in the realm (matched by e-mail); nobody is created on the fly.
  * Identity providers 'google' and 'microsoft', when --idp-file gives their client ids and secrets.
  * Keycloak self-service for KH users is read-only (fen 2026-09-28): the Account Console shows the
    person's own profile (view-profile) and changes nothing (no manage-account). Keycloak
    is administered only by people in the master realm.

Authenticates with a service-account admin client of the master realm.

Usage: python configure_realm.py --url <keycloak url> --client-id <id> --client-secret-file <file>
                                 [--idp-file <json with google/microsoft client_id, client_secret, tenant>]
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

REALM = "knowledge-hub"
DAYS = 24 * 3600
TOKEN_SETTINGS = {
    "accessTokenLifespan": 300,
    "offlineSessionIdleTimeout": 90 * DAYS,
    "offlineSessionMaxLifespanEnabled": True,
    "offlineSessionMaxLifespan": 90 * DAYS,
    "oauth2DeviceCodeLifespan": 600,
    "oauth2DevicePollingInterval": 5,
    "registrationAllowed": False,
    "loginWithEmailAllowed": True,
    "duplicateEmailsAllowed": False,
}
SCOPE = "kh-access"
AUDIENCE = "kh-api"
CLI_CLIENT = "kh-cli"
BROKER_FLOW = "kh-first-broker-login"


class Admin:
    def __init__(self, url: str, client_id: str, secret: str):
        self.url = url.rstrip("/")
        self._credentials = {"grant_type": "client_credentials", "client_id": client_id, "client_secret": secret}
        self.authenticate()

    def authenticate(self) -> None:
        # Master realm admin tokens live 60 seconds, so long runs sign in again when one expires.
        body = urllib.parse.urlencode(self._credentials).encode()
        with urllib.request.urlopen(f"{self.url}/realms/master/protocol/openid-connect/token", body, timeout=60) as r:
            self.token = json.load(r)["access_token"]

    def call(self, method: str, path: str, payload=None, ok_conflict: bool = False, retried: bool = False):
        request = urllib.request.Request(f"{self.url}/admin/realms/{REALM}{path}", method=method,
                                         data=None if payload is None else json.dumps(payload).encode(),
                                         headers={"Authorization": f"Bearer {self.token}",
                                                  "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(request, timeout=60) as r:
                raw = r.read()
                return json.loads(raw) if raw else None
        except urllib.error.HTTPError as e:
            if ok_conflict and e.code == 409:
                return None
            if e.code == 401 and not retried:
                self.authenticate()
                return self.call(method, path, payload, ok_conflict, retried=True)
            raise RuntimeError(f"{method} {path} -> {e.code} {e.read().decode(errors='replace')}") from e


def ensure_scope(admin: Admin) -> str:
    scopes = {s["name"]: s for s in admin.call("GET", "/client-scopes")}
    if SCOPE not in scopes:
        admin.call("POST", "/client-scopes", {"name": SCOPE, "protocol": "openid-connect",
                                              "attributes": {"include.in.token.scope": "false"}})
        scopes = {s["name"]: s for s in admin.call("GET", "/client-scopes")}
    scope_id = scopes[SCOPE]["id"]
    existing = {m["name"] for m in admin.call("GET", f"/client-scopes/{scope_id}/protocol-mappers/models")}
    wanted = [
        {"name": "kh access", "protocol": "openid-connect", "protocolMapper": "kh-access-claim-mapper",
         "config": {"access.token.claim": "true", "introspection.token.claim": "true"}},
        {"name": "kh audience", "protocol": "openid-connect", "protocolMapper": "oidc-audience-mapper",
         "config": {"included.custom.audience": AUDIENCE, "access.token.claim": "true",
                    "introspection.token.claim": "true"}},
    ]
    for mapper in wanted:
        if mapper["name"] not in existing:
            admin.call("POST", f"/client-scopes/{scope_id}/protocol-mappers/models", mapper)
    return scope_id


def ensure_cli_client(admin: Admin, scope_id: str) -> None:
    found = admin.call("GET", f"/clients?clientId={CLI_CLIENT}")
    client = {
        "clientId": CLI_CLIENT, "name": "Knowledge Hub helper", "publicClient": True, "protocol": "openid-connect",
        # The helper signs in with authorization code + PKCE on a loopback port (like gh and gcloud): one
        # browser page, no consent screen. Keycloak ignores the port of a 127.0.0.1 redirect (RedirectUtils),
        # so one registered URI covers any free port. The device grant stays for machines without a browser;
        # Keycloak always shows a consent screen there (RFC 8628 section 5.4) - fen 2026-09-26.
        "standardFlowEnabled": True, "implicitFlowEnabled": False, "directAccessGrantsEnabled": False,
        "serviceAccountsEnabled": False, "fullScopeAllowed": False, "consentRequired": False,
        "redirectUris": ["http://127.0.0.1/callback"], "webOrigins": [],
        "attributes": {"oauth2.device.authorization.grant.enabled": "true", "pkce.code.challenge.method": "S256"},
    }
    if found:
        client_id = found[0]["id"]
        admin.call("PUT", f"/clients/{client_id}", {**found[0], **client})
    else:
        admin.call("POST", "/clients", client)
        client_id = admin.call("GET", f"/clients?clientId={CLI_CLIENT}")[0]["id"]
    admin.call("PUT", f"/clients/{client_id}/default-client-scopes/{scope_id}")
    offline = next(s for s in admin.call("GET", "/client-scopes") if s["name"] == "offline_access")
    admin.call("PUT", f"/clients/{client_id}/default-client-scopes/{offline['id']}")


def ensure_broker_flow(admin: Admin) -> None:
    flows = {f["alias"] for f in admin.call("GET", "/authentication/flows")}
    if BROKER_FLOW in flows:
        return
    admin.call("POST", "/authentication/flows", {
        "alias": BROKER_FLOW, "providerId": "basic-flow", "topLevel": True, "builtIn": False,
        "description": "Sign in through Google or Entra only as a person who already exists in the realm."})
    for provider in ("idp-detect-existing-broker-user", "idp-auto-link"):
        admin.call("POST", f"/authentication/flows/{BROKER_FLOW}/executions/execution", {"provider": provider})
    for execution in admin.call("GET", f"/authentication/flows/{BROKER_FLOW}/executions"):
        admin.call("PUT", f"/authentication/flows/{BROKER_FLOW}/executions",
                   {**execution, "requirement": "REQUIRED"})


def ensure_identity_providers(admin: Admin, idp: dict) -> list[str]:
    existing = {p["alias"] for p in admin.call("GET", "/identity-provider/instances")}
    done = []
    common = {"enabled": True, "trustEmail": True, "firstBrokerLoginFlowAlias": BROKER_FLOW,
              "storeToken": False, "linkOnly": False}
    if "google" in idp:
        body = {**common, "alias": "google", "providerId": "google", "displayName": "Google",
                "config": {"clientId": idp["google"]["client_id"], "clientSecret": idp["google"]["client_secret"],
                           "defaultScope": "openid email profile", "syncMode": "IMPORT"}}
        admin.call("PUT" if "google" in existing else "POST",
                   "/identity-provider/instances" + ("/google" if "google" in existing else ""), body)
        done.append("google")
    if "microsoft" in idp:
        body = {**common, "alias": "microsoft", "providerId": "microsoft", "displayName": "Microsoft",
                "config": {"clientId": idp["microsoft"]["client_id"],
                           "clientSecret": idp["microsoft"]["client_secret"],
                           "tenantId": idp["microsoft"].get("tenant", "common"),
                           "defaultScope": "openid email profile", "syncMode": "IMPORT"}}
        admin.call("PUT" if "microsoft" in existing else "POST",
                   "/identity-provider/instances" + ("/microsoft" if "microsoft" in existing else ""), body)
        done.append("microsoft")
    return done


def ensure_read_only_account_console(admin: Admin) -> None:
    """KH users see their own profile after signing in, and change nothing (fen 2026-09-28).

    With the Account Console switched off, a person who signed in at Keycloak got 'Client disabled' and
    believed the sign-in had failed. Now the console is on, the default roles hold only account:view-profile
    (no manage-account), so the page shows who they are and every edit is refused.
    """
    clients = {c["clientId"]: c for c in admin.call("GET", "/clients?max=500")}
    account = clients["account"]["id"]
    default = admin.call("GET", f"/roles/{urllib.parse.quote('default-roles-' + REALM)}")
    composites = admin.call("GET", f"/roles-by-id/{default['id']}/composites")
    drop = [r for r in composites if r.get("containerId") == account and r["name"] != "view-profile"]
    if drop:
        admin.call("DELETE", f"/roles-by-id/{default['id']}/composites", drop)
    if not any(r.get("containerId") == account and r["name"] == "view-profile" for r in composites):
        admin.call("POST", f"/roles-by-id/{default['id']}/composites",
                   [admin.call("GET", f"/clients/{account}/roles/view-profile")])
    console = clients["account-console"]
    if not console.get("enabled"):
        admin.call("PUT", f"/clients/{console['id']}", {**console, "enabled": True})


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--url", required=True)
    parser.add_argument("--client-id", required=True)
    parser.add_argument("--client-secret-file", required=True, type=Path)
    parser.add_argument("--idp-file", type=Path)
    args = parser.parse_args()

    admin = Admin(args.url, args.client_id, args.client_secret_file.read_text(encoding="utf-8").strip())
    realm = admin.call("GET", "")
    admin.call("PUT", "", {**realm, **TOKEN_SETTINGS})
    scope_id = ensure_scope(admin)
    ensure_cli_client(admin, scope_id)
    ensure_broker_flow(admin)
    ensure_read_only_account_console(admin)
    idps = ensure_identity_providers(admin, json.loads(args.idp_file.read_text(encoding="utf-8"))) \
        if args.idp_file else []

    realm = admin.call("GET", "")
    print(json.dumps({key: realm[key] for key in TOKEN_SETTINGS} | {"client": CLI_CLIENT, "scope": SCOPE,
                     "broker_flow": BROKER_FLOW, "identity_providers": idps}, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())

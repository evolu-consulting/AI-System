"""Create (or refresh) the kh-sidecar's KH identity on Keycloak, then prove it works against KH (2026-10-24).

What it makes in realm 'knowledge-hub':
  1. client 'kh-agent-distill': confidential, direct access grants ONLY (no browser flow, no service account),
     with the same default client scopes as 'kh-cli', so its tokens carry aud kh-api and the kh claim
     (the pattern of the chatbot's kh-agent-chatbot);
  2. user KH_WORKER_USERNAME (default kh-distill@kh-agent.invalid): enabled, e-mail verified, a random
     permanent password, realm role 'maintainer' (the distil routes are maintainer routes).
Then it signs in exactly as the sidecar will (password grant on that client) and checks GET /auth/me says
role maintainer and GET /distill/cursor answers. Secrets go to --out only (an env fragment, never printed);
paste its lines into the sidecar's env file or the CF user-provided service.

Run it with a Keycloak admin of the master realm (the client that setup_realm.py / configure_realm.py use):
    python deploy/btp/kh-worker/create_sidecar_account.py \
        --keycloak https://kh-keycloak.cfapps.br10.hana.ondemand.com --kh https://<kh-app-route> \
        --client-id <master admin client> --client-secret-file <file> --out <dir outside the repo>/kh-sidecar.secrets.env
Safe to run again: the client and user are kept; the password is rotated (re-deploy the new one).
"""
from __future__ import annotations

import argparse
import json
import secrets
import sys
import urllib.parse
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "docker"))
from setup_realm import REALM, Keycloak  # noqa: E402  (the admin REST helper of the docker stack)

CLIENT = "kh-agent-distill"
TEMPLATE_CLIENT = "kh-cli"
DEFAULT_USER = "kh-distill@kh-agent.invalid"


def ensure_client(kc: Keycloak) -> str:
    if not kc.call("GET", f"/{REALM}/clients?clientId={CLIENT}"):
        kc.call("POST", f"/{REALM}/clients", {
            "clientId": CLIENT, "name": "kh-sidecar (nightly distil)", "enabled": True, "publicClient": False,
            "standardFlowEnabled": False, "implicitFlowEnabled": False, "serviceAccountsEnabled": False,
            "directAccessGrantsEnabled": True, "frontchannelLogout": False})
    cid = kc.call("GET", f"/{REALM}/clients?clientId={CLIENT}")[0]["id"]
    tpl = kc.call("GET", f"/{REALM}/clients?clientId={TEMPLATE_CLIENT}")
    if not tpl:
        raise SystemExit(f"client '{TEMPLATE_CLIENT}' not found in realm {REALM}: cannot copy its scopes")
    tid = tpl[0]["id"]
    have = {s["id"] for s in kc.call("GET", f"/{REALM}/clients/{cid}/default-client-scopes") or []}
    for scope in kc.call("GET", f"/{REALM}/clients/{tid}/default-client-scopes") or []:
        if scope["id"] not in have:
            kc.call("PUT", f"/{REALM}/clients/{cid}/default-client-scopes/{scope['id']}")
    return kc.call("GET", f"/{REALM}/clients/{cid}/client-secret")["value"]


def check(keycloak: str, kh: str, client_secret: str, username: str, password: str) -> dict:
    form = urllib.parse.urlencode({"grant_type": "password", "client_id": CLIENT, "client_secret": client_secret,
                                   "username": username, "password": password, "scope": "openid"}).encode()
    with urllib.request.urlopen(f"{keycloak}/realms/{REALM}/protocol/openid-connect/token", form, timeout=60) as r:
        token = json.load(r)["access_token"]

    def get(path: str) -> dict:
        req = urllib.request.Request(kh.rstrip("/") + path, headers={"Authorization": f"Bearer {token}"})
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.load(r)

    me = get("/auth/me")
    if me.get("role") != "maintainer":
        raise SystemExit(f"signed in, but KH says role {me.get('role')!r}, not maintainer (check KH_AUTH grants)")
    patterns = get("/distill/patterns?days=1")
    return {"email": me.get("email"), "role": me.get("role"),
            "consented_projects": [p.get("project") for p in patterns.get("projects") or []]}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--keycloak", required=True)
    ap.add_argument("--kh", required=True)
    ap.add_argument("--client-id", required=True, help="master-realm admin client (client credentials)")
    ap.add_argument("--client-secret-file", required=True, type=Path)
    ap.add_argument("--username", default=DEFAULT_USER)
    ap.add_argument("--out", required=True, type=Path, help="env fragment with the secrets (outside the repo)")
    args = ap.parse_args()
    keycloak = args.keycloak.rstrip("/")

    kc = Keycloak(keycloak, {"grant_type": "client_credentials", "client_id": args.client_id,
                             "client_secret": args.client_secret_file.read_text(encoding="utf-8").strip()})
    client_secret = ensure_client(kc)
    password = secrets.token_urlsafe(24)
    uid = kc.ensure_user(REALM, args.username, "KH", "Sidecar", password)
    kc.grant_realm_role(REALM, uid, "maintainer")

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text("\n".join([
        f"KH_WORKER_KC_TOKEN_URL={keycloak}/realms/{REALM}/protocol/openid-connect/token",
        f"KH_WORKER_KC_CLIENT_ID={CLIENT}",
        f"KH_WORKER_KC_CLIENT_SECRET={client_secret}",
        f"KH_WORKER_USERNAME={args.username}",
        f"KH_WORKER_PASSWORD={password}", ""]), encoding="utf-8")

    print(json.dumps({"client": CLIENT, "user": args.username, "secrets": str(args.out),
                      "check": check(keycloak, args.kh, client_secret, args.username, password)}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

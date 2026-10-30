"""Roles that open semi-public and public KH projects (fen 2026-10-13). Safe to run again: every step checks first.

A semi-public or public project is an ordinary project with KH_AUTH_PROJECT.VISIBILITY set; whoever holds
the matching realm role holds a level on it (deploy/kh-auth/catalog.json 'visibility_access':
semi.read -> readonly on semi-public, public.read -> readonly and public.write -> editable on public).

Who holds the roles:
  * every tenant group /tenants/<tenant> carries them, so its people (and its tenant admins, through the
    parent group) get them, including people created later in the admin console;
  * a tenant marked excluded (group attribute kh.shared_projects = off) does not: its people cannot read
    semi-public projects nor use public ones, unless a project grants them a level the ordinary way;
  * a person in no tenant gets them directly (KhUserProvisioner does the same for new people), and a direct
    copy is taken away from anyone who is in a tenant, so an exclusion is never bypassed by a leftover.

Usage: python configure_shared_roles.py --url <keycloak url> (--client-id <master admin client> --client-secret-file <f>
           | --admin-user <master admin> --admin-password-file <f>) [--exclude TENANT ...] [--include TENANT ...] [--dry-run]
--exclude / --include record the choice on the tenant group, so it holds on the next run without the flag.
"""
from __future__ import annotations

import argparse
import json
import urllib.parse
from pathlib import Path

from configure_tenants import TENANT_ADMINS, TENANTS, RealmAdmin, realm_role, top_group

CATALOG = Path(__file__).resolve().parent.parent / "kh-auth" / "catalog.json"
EXCLUDED_ATTRIBUTE = "kh.shared_projects"


class PasswordAdmin(RealmAdmin):
    """A master-realm admin PERSON (admin-cli password grant), for a deployment with no admin client secret at hand."""

    def __init__(self, url: str, user: str, password: str):
        self.url = url.rstrip("/")
        self._credentials = {"grant_type": "password", "client_id": "admin-cli", "username": user, "password": password}
        self.authenticate()


def roles_of_catalog() -> list[str]:
    return list(json.loads(CATALOG.read_text(encoding="utf-8"))["visibility_roles"])


def ensure_roles(admin, names: list[str], dry: bool) -> None:
    have = {r["name"] for r in admin.call("GET", "/roles?max=500")}
    for name in names:
        if name not in have and not dry:
            admin.call("POST", "/roles", {"name": name, "description": "KH shared-project role - see "
                                          "deploy/kh-auth/catalog.json visibility_access"})


def users(admin) -> list[dict]:
    out, first = [], 0
    while True:
        page = admin.call("GET", f"/users?first={first}&max=200&briefRepresentation=true") or []
        out += page
        if len(page) < 200:
            return out
        first += 200


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--url", required=True)
    parser.add_argument("--client-id")
    parser.add_argument("--client-secret-file", type=Path)
    parser.add_argument("--admin-user")
    parser.add_argument("--admin-password-file", type=Path)
    parser.add_argument("--exclude", action="append", default=[], help="tenant kept out of shared projects")
    parser.add_argument("--include", action="append", default=[], help="tenant let back in")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    if args.admin_user:
        admin = PasswordAdmin(args.url, args.admin_user, args.admin_password_file.read_text(encoding="utf-8").strip())
    else:
        admin = RealmAdmin(args.url, args.client_id, args.client_secret_file.read_text(encoding="utf-8").strip())
    names = roles_of_catalog()
    dry = args.dry_run
    ensure_roles(admin, names, dry)
    roles = [realm_role(admin, n) for n in names] if not dry else []

    root = top_group(admin, TENANTS)
    tenants = admin.call("GET", f"/groups/{root['id']}/children?briefRepresentation=false&max=500") or []
    report = {"tenants": {}, "direct_added": [], "direct_removed": [], "dry_run": dry}
    tenant_group_ids = set()
    for tenant in tenants:
        tenant_group_ids.add(tenant["id"])
        for child in admin.call("GET", f"/groups/{tenant['id']}/children?max=50") or []:
            if child["name"] == TENANT_ADMINS:
                tenant_group_ids.add(child["id"])
        attrs = dict(tenant.get("attributes") or {})
        if tenant["name"] in args.exclude:
            attrs[EXCLUDED_ATTRIBUTE] = ["off"]
        if tenant["name"] in args.include:
            attrs.pop(EXCLUDED_ATTRIBUTE, None)
        if attrs != (tenant.get("attributes") or {}) and not dry:
            admin.call("PUT", f"/groups/{tenant['id']}", {**tenant, "attributes": attrs})
        excluded = (attrs.get(EXCLUDED_ATTRIBUTE) or [""])[0] == "off"
        have = {r["name"] for r in admin.call("GET", f"/groups/{tenant['id']}/role-mappings/realm")}
        if not dry:
            if excluded and have & set(names):
                admin.call("DELETE", f"/groups/{tenant['id']}/role-mappings/realm",
                           [r for r in roles if r["name"] in have])
            if not excluded and set(names) - have:
                admin.call("POST", f"/groups/{tenant['id']}/role-mappings/realm",
                           [r for r in roles if r["name"] not in have])
        report["tenants"][tenant["name"]] = "excluded" if excluded else "shared"

    for user in users(admin):
        uid = user["id"]
        in_tenant = any(g["id"] in tenant_group_ids
                        for g in admin.call("GET", f"/users/{uid}/groups?briefRepresentation=true&max=100") or [])
        direct = {r["name"] for r in admin.call("GET", f"/users/{uid}/role-mappings/realm")}
        who = user.get("email") or user.get("username")
        if not in_tenant and set(names) - direct:
            report["direct_added"].append(who)
            if not dry:
                admin.call("POST", f"/users/{uid}/role-mappings/realm", [r for r in roles if r["name"] not in direct])
        if in_tenant and direct & set(names):
            report["direct_removed"].append(who)
            if not dry:
                admin.call("DELETE", f"/users/{uid}/role-mappings/realm", [r for r in roles if r["name"] in direct])
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

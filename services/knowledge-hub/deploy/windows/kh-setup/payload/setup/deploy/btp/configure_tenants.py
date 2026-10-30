"""Groups and tenants for Knowledge Hub (fen 2026-09-28). Safe to run again: every step checks first.

Three kinds of account, and they never mix:

  system-admin   Everything, on Keycloak and on KH. Group 'system-admin' in the master realm (role admin)
                 and group 'system-admin' in the knowledge-hub realm (KH role maintainer + realm-admin).
  tenant-admin   Opens the knowledge-hub admin console and manages the people of THEIR tenant only.
                 Group /tenants/<tenant>/tenant-admins. In KH: owner level on every project of the tenant
                 (schema.sql, KH_AUTH_TENANT_PROJECT). Not a maintainer.
  kh-users       Uses KH and nothing else. Group 'kh-users' (KH role member). No admin console, no
                 account console (configure_realm.py).

A tenant is a company: /tenants/<tenant>, with the attribute 'domains' (comma separated) that places a
newly invited person by e-mail domain (KhUserProvisioner). Tenant admins are held to their tenant by
fine-grained admin permissions (v2): they may view and manage the members of their tenant group and put
people into their tenant and into kh-users - nothing else in the realm.

Usage: python configure_tenants.py --url <keycloak url> --client-id <master admin client> --client-secret-file <f>
                                   --plan <plan.json>
plan.json: {"tenants": {"laidon": {"domains": ["laidon.com"], "members": [...], "admins": [...]}},
            "system_admins": ["..."], "kh_users": ["..."]}   (every e-mail must already exist in the realm)
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.parse
from pathlib import Path

from configure_realm import REALM, Admin

TENANTS = "tenants"
KH_USERS = "kh-users"
SYSTEM_ADMIN = "system-admin"
TENANT_ADMINS = "tenant-admins"
TENANT_ADMIN_ROLE = "tenant-admin"


class RealmAdmin(Admin):
    """The same admin client, for any realm: path starts with /<realm>."""

    def any(self, method: str, path: str, payload=None):
        saved = sys.modules["configure_realm"].REALM
        realm, _, rest = path.lstrip("/").partition("/")
        sys.modules["configure_realm"].REALM = realm
        try:
            return self.call(method, "/" + rest if rest else "", payload)
        finally:
            sys.modules["configure_realm"].REALM = saved


# What each kind of account may do, kept as the group's own description so it can be edited in the admin
# console; GET /realms/knowledge-hub/kh/catalog serves it to assistants live. Set only when empty.
DESCRIPTIONS = {
    KH_USERS: "Uses Knowledge Hub and nothing else: no Keycloak admin console, no account console; changes their own password with `kh password`. Sees the "
              "projects they created or were added to, reads the orchestrator, may create projects.",
    SYSTEM_ADMIN: "Everything, on Keycloak and on Knowledge Hub, without limit (KH role maintainer).",
    TENANT_ADMINS: "Opens the Keycloak admin console and manages the people of this tenant only. In Knowledge "
                   "Hub: owner level on every project created by someone in this tenant, orphans included.",
    TENANTS: "One subgroup per company (tenant). Attribute 'domains' places a newly invited person by e-mail domain.",
}


def describe(admin: Admin, group: dict, kind: str) -> None:
    if not group.get("description") and DESCRIPTIONS.get(kind):
        admin.call("PUT", f"/groups/{group['id']}", {**group, "description": DESCRIPTIONS[kind]})


def top_group(admin: Admin, name: str) -> dict:
    for g in admin.call("GET", f"/groups?search={urllib.parse.quote(name)}&exact=true&briefRepresentation=false") or []:
        if g["name"] == name:
            return g
    admin.call("POST", "/groups", {"name": name})
    return top_group(admin, name)


def child_group(admin: Admin, parent: dict, name: str, attributes: dict | None = None) -> dict:
    for g in admin.call("GET", f"/groups/{parent['id']}/children?briefRepresentation=false&max=500") or []:
        if g["name"] == name:
            if attributes is not None and g.get("attributes") != attributes:
                admin.call("PUT", f"/groups/{g['id']}", {**g, "attributes": attributes})
            return g
    admin.call("POST", f"/groups/{parent['id']}/children", {"name": name, "attributes": attributes or {}})
    return child_group(admin, parent, name)


def realm_role(admin: Admin, name: str) -> dict:
    return admin.call("GET", f"/roles/{urllib.parse.quote(name)}")


def client_roles(admin: Admin, client_id: str, names: list[str]) -> tuple[str, list[dict]]:
    cid = admin.call("GET", f"/clients?clientId={client_id}")[0]["id"]
    return cid, [admin.call("GET", f"/clients/{cid}/roles/{n}") for n in names]


def give_group_roles(admin: Admin, group: dict, realm_roles: list[str], client: str | None = None,
                     client_role_names: list[str] | None = None) -> None:
    if realm_roles:
        have = {r["name"] for r in admin.call("GET", f"/groups/{group['id']}/role-mappings/realm")}
        want = [realm_role(admin, r) for r in realm_roles if r not in have]
        if want:
            admin.call("POST", f"/groups/{group['id']}/role-mappings/realm", want)
    if client:
        cid, roles = client_roles(admin, client, client_role_names or [])
        have = {r["name"] for r in admin.call("GET", f"/groups/{group['id']}/role-mappings/clients/{cid}")}
        want = [r for r in roles if r["name"] not in have]
        if want:
            admin.call("POST", f"/groups/{group['id']}/role-mappings/clients/{cid}", want)


def user_id(admin: Admin, email: str) -> str:
    found = admin.call("GET", f"/users?email={urllib.parse.quote(email)}&exact=true")
    if not found:
        raise SystemExit(f"not in realm {REALM}: {email}")
    return found[0]["id"]


def join(admin: Admin, email: str, group: dict) -> None:
    admin.call("PUT", f"/users/{user_id(admin, email)}/groups/{group['id']}")


def ensure_fgap(admin: Admin, tenant: dict, admins_group: dict, kh_users: dict, root: dict) -> None:
    """Fine-grained admin permissions v2: this tenant's admins manage this tenant's members, nothing else."""
    clients = admin.call("GET", "/clients?clientId=admin-permissions")
    if not clients:
        raise SystemExit("admin-permissions client missing: the realm needs adminPermissionsEnabled")
    base = f"/clients/{clients[0]['id']}/authz/resource-server"
    policy_name = f"members of {tenant['name']}/{TENANT_ADMINS}"
    policies = {p["name"]: p for p in admin.call("GET", f"{base}/policy?max=500") or []}
    if policy_name not in policies:
        admin.call("POST", f"{base}/policy/group", {"name": policy_name, "logic": "POSITIVE",
                                                   "groups": [{"id": admins_group["id"], "extendChildren": False}]})
        policies = {p["name"]: p for p in admin.call("GET", f"{base}/policy?max=500")}
    policy_id = policies[policy_name]["id"]
    existing = {p["name"] for p in admin.call("GET", f"{base}/permission?max=500") or []}
    wanted = [
        (f"{tenant['name']}: manage its people", [tenant["id"]],
         ["view", "view-members", "manage-members", "manage-membership"]),
        (f"{tenant['name']}: add people to kh-users", [kh_users["id"]], ["manage-membership"]),
        # Group paths (/tenants/<tenant>) resolve from the top: without seeing 'tenants' the admin console
        # cannot find the admin's own tenant when creating a person in it. Tenant names are public anyway.
        (f"{tenant['name']}: see the tenants group", [root["id"]], ["view"]),
    ]
    for name, resources, scopes in wanted:
        if name in existing:
            continue
        admin.call("POST", f"{base}/permission/scope", {
            "name": name, "resourceType": "Groups", "resources": resources, "scopes": scopes,
            "policies": [policy_id], "decisionStrategy": "UNANIMOUS"})


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--url", required=True)
    parser.add_argument("--client-id", required=True)
    parser.add_argument("--client-secret-file", required=True, type=Path)
    parser.add_argument("--plan", required=True, type=Path)
    args = parser.parse_args()
    plan = json.loads(args.plan.read_text(encoding="utf-8"))
    admin = RealmAdmin(args.url, args.client_id, args.client_secret_file.read_text(encoding="utf-8").strip())

    realm = admin.call("GET", "")
    if not realm.get("adminPermissionsEnabled"):
        admin.call("PUT", "", {**realm, "adminPermissionsEnabled": True})

    # Keycloak 26 drops attributes the user profile does not declare; kh.invited_by / kh.invited_at
    # (KhUserProvisioner) must be kept, visible to admins and never to the person themselves.
    profile = admin.call("GET", "/users/profile")
    if profile.get("unmanagedAttributePolicy") not in ("ADMIN_VIEW", "ADMIN_EDIT", "ENABLED"):
        admin.call("PUT", "/users/profile", {**profile, "unmanagedAttributePolicy": "ADMIN_VIEW"})

    # 'tenant-admin' is a KH role like maintainer and member (deploy/kh-auth/catalog.json decides what it
    # may do); the tenant-admins groups carry it, so the rights follow group membership.
    if not any(r["name"] == TENANT_ADMIN_ROLE for r in admin.call("GET", "/roles?max=500")):
        admin.call("POST", "/roles", {"name": TENANT_ADMIN_ROLE,
                                      "description": "KH tenant admin - rights in deploy/kh-auth/catalog.json"})

    kh_users = top_group(admin, KH_USERS)
    give_group_roles(admin, kh_users, ["member"])
    system_admin = top_group(admin, SYSTEM_ADMIN)
    give_group_roles(admin, system_admin, ["maintainer"], "realm-management", ["realm-admin"])
    root = top_group(admin, TENANTS)
    for group, kind in ((kh_users, KH_USERS), (system_admin, SYSTEM_ADMIN), (root, TENANTS)):
        describe(admin, group, kind)

    done = {"tenants": {}}
    for name, spec in plan.get("tenants", {}).items():
        tenant = child_group(admin, root, name, {"domains": [",".join(spec.get("domains", []))]})
        # Being in the tenant makes a person a KH user by itself, so a tenant admin can create someone in
        # the admin console with only their own tenant group - no rights over kh-users, which holds everyone.
        give_group_roles(admin, tenant, ["member"])
        admins = child_group(admin, tenant, TENANT_ADMINS)
        describe(admin, admins, TENANT_ADMINS)
        # Opening the admin console and searching need these; what they may SEE and CHANGE is limited by
        # the fine-grained permissions below (v2 filters every result to what the admin may view).
        give_group_roles(admin, admins, ["member", TENANT_ADMIN_ROLE], "realm-management",
                         ["query-users", "query-groups"])
        ensure_fgap(admin, tenant, admins, kh_users, root)
        for email in spec.get("members", []):
            join(admin, email, tenant)
            join(admin, email, kh_users)
        for email in spec.get("admins", []):
            join(admin, email, admins)
            join(admin, email, tenant)
            join(admin, email, kh_users)
        done["tenants"][name] = {"members": len(spec.get("members", [])), "admins": spec.get("admins", [])}
    for email in plan.get("kh_users", []):
        join(admin, email, kh_users)
    for email in plan.get("system_admins", []):
        join(admin, email, system_admin)
        join(admin, email, kh_users)

    # master realm: the Keycloak system administrators, as a group rather than one-off role grants.
    master_group = next((g for g in admin.any("GET", "/master/groups?search=system-admin&exact=true") or []
                         if g["name"] == SYSTEM_ADMIN), None)
    if master_group is None:
        admin.any("POST", "/master/groups", {"name": SYSTEM_ADMIN})
        master_group = next(g for g in admin.any("GET", "/master/groups?search=system-admin&exact=true")
                            if g["name"] == SYSTEM_ADMIN)
    have = {r["name"] for r in admin.any("GET", f"/master/groups/{master_group['id']}/role-mappings/realm")}
    if "admin" not in have:
        admin.any("POST", f"/master/groups/{master_group['id']}/role-mappings/realm",
                  [admin.any("GET", "/master/roles/admin")])
    for email in plan.get("system_admins", []):
        found = admin.any("GET", f"/master/users?email={urllib.parse.quote(email)}&exact=true")
        if found:
            admin.any("PUT", f"/master/users/{found[0]['id']}/groups/{master_group['id']}")
    done["system_admins"] = plan.get("system_admins", [])
    print(json.dumps(done, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())

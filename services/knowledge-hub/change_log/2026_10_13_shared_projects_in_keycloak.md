# 2026-10-13 - Semi-public and public projects are decided by Keycloak, not by a KH-side override

| Release | What changed | Where it runs |
|---|---|---|
| KH server (main `cc3cb5a`) | `auth.can` checks the token alone; `PUT /projects/{id}/visibility` and `POST /projects {visibility}` go to Keycloak first, KH keeps a copy for display. | prod `knowledge-hub`, uploaded 12:22 +07 |
| Keycloak fork (personal/main `1af186eade`) | `KH_AUTH_PROJECT.VISIBILITY`, table `KH_AUTH_VISIBILITY_ACCESS`, view rule 6; roles `semi.read`, `public.read`, `public.write`; `PUT /kh/projects/{id}/visibility`; `POST /kh/projects` takes `visibility`; admin-console users land in a tenant. | prod `kh-keycloak`, uploaded 12:15 +07 |
| KH auth DB (`keycloak-hana`) | `seed.py --replace-views`: new column, table and view rule; `configure_shared_roles.py`: tenants kh-test, laidon, simplemdg carry the roles, 11 people in no tenant hold them directly. | prod |

## What was wrong

`rowan.hoang@simplemdg.com` read the semi-public projects `designer` and `kh-investigate` fine, but
`kh_members people` answered 403 "missing permission project.read" and `kh_me` did not list them. The
2026-10-09 visibility lived in KH's `project_access` table only and widened the token inside KH; Keycloak,
which serves people lists, members and project deletion, and puts the levels into the token, never knew.

## How it works now

- A semi-public or public project is an ordinary project. Keycloak records its visibility and, through
  `KH_AUTH_VISIBILITY_ACCESS`, gives `readonly` (semi.read / public.read) or `editable` (public.write) to
  whoever holds the role. The levels are in the token, so kh_me, people lists and every check agree.
- The roles are carried by the tenant groups. To keep a company out of the shared projects:
  `configure_shared_roles.py --exclude <tenant>` (records `kh.shared_projects = off` on the group and
  takes the roles off it); `--include` lets it back. A person in no tenant gets the roles directly.
- New people: invited ones follow their tenant (or get the roles directly with none). Someone created in
  the admin console with no tenant ticked joins the creating admin's tenant, else their domain's tenant,
  else gets the roles directly (`KhUserCreatedListener`). A tenant admin cannot create anyone outside
  their own tenant (Keycloak FGAP).
- Visibility changes reach other people at their next token (a few minutes).
- `designer`, `kh-tools`, `kh-investigate` were set semi-public at Keycloak before KH was pushed, so their
  readers never lost access.

## Tests

- Docker stack on the local HANA express: `test_access.py` 44/44, `e2e_shared_projects.py` 64/64,
  `e2e_multi_user.py` 73/73, upgrade from the old schema rehearsed.
- Prod: `test_access.py` 0 failed (rolled back), `e2e_shared_projects.py` 64/64 (own people, tenant and
  projects, deleted after), and the standing accounts test-kh-user, test-kh-user2, test-tenant-admin,
  test-system-admin, kh-bench, agent-admin: all read the three shared projects and their people, only the
  maintainers write them.

## Notes for the next deploy

- Deploy order: `seed.py --replace-views` before a new extension jar (the jar reads the new column).
- `deploy/btp/assemble.sh` now puts the rebuilt `model/jpa` jar (HANA FGAP fix of 2026-09-28) into the
  droplet, like the docker stack's `stage.py`.
- Rollback: KH = push main `ac348bd`; the DB change is additive.

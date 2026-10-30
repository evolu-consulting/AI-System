# 2026-10-15 - personal projects at the identity service, quieter Stop hook, kh password (kh-helper 1.13.1)

| Change | What it does | Where |
|---|---|---|
| Personal projects at Keycloak | `/kh/projects/{personal-id}/members` and `/people` answered 403 for everyone because personal projects are never registered there. The owner and a maintainer now pass; a tenant admin never does. Member changes and visibility answer 409; personal ids cannot be registered. | KeyCloak-Hana e361bb17fd, kh-keycloak pushed 21:13 +07 |
| Stop hook | No Stop block when the turn already stored its work log (POST /vector/add scope log, MCP or helper CLI); POST /context/step, /vector/query, /vector/scroll count as reads. | kh-helper 1.13.1 |
| `kh password` | Change your own password through Keycloak's `kc_action=UPDATE_PASSWORD` on the sign-in page; no account console. The kh-users catalog description says so. | kh-helper 1.13.1, KH pushed 21:21 +07 |

Verified on prod: personal-project access 12/12 (maintainer, owner, other member, tenant admin of the owner's tenant, regressions on designer and kh-investigate); `kh password` flow 5/5 as test-kh-user (password restored afterwards); /health 200, /auth/config serves kh_helper-1.13.1.

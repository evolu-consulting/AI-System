# 2026-10-12 - /vector/add takes a top-level `project`; prod now deploys from main

| Release | What changed | Where it runs |
|---|---|---|
| KH server (main `635eb94`) | `POST /vector/add` accepts `project` at the top of the body, like `/vector/query` and `/vector/delete`; the 403 for a write naming no project says where it went. | prod `knowledge-hub` |
| Policy `store worklog` / `store` | Says project goes inside metadata, not top-level. | KH prod policy, every project |

## Correction: where prod KH comes from

The change_logs of 2026-10-06 and 2026-10-07 say "Deployed `kh-btp-hana` at ... to `knowledge-hub`".
That stopped being true on 2026-10-11:

- During the 2026-10-11 SDLC prod upgrade, `kh-roadmap-e5` (`567e189`) was merged into main
  (`1bf3e98`, 16:24 +07) and prod `knowledge-hub` was uploaded at 18:10 +07 from that code. Checked by
  matching prod's OpenAPI route list against candidate commits: prod served the main-only routes
  (`/sync/*`, `/home/login/*`, `/projects/{id}/visibility`) that `kh-btp-hana` never had.
- `kh-btp-hana` was merged into main on 2026-10-12 (`635eb94`). It added nothing: its last fix
  (`3ced53a`, distill routes off the event loop) was already in main.
- **From now on prod deploys from main.** Do not deploy `kh-btp-hana`: it would drop every route added
  since 2026-10-09.
- There is no BTP dev app any more (`kh-sso` is gone; dev is the local container in `deploy/docker`).

Target: BTP br10, org `ticketing-system-simplemdg`, space `app`, app `knowledge-hub`, HANA service
`kh-hana-v2`, sign-in `https://kh-keycloak.cfapps.br10.hana.ondemand.com/realms/knowledge-hub`.

## What was wrong

Worklog writes came back 403 "missing permission project.log on this project". Callers wrote
`{"project": ...}` at the top of the `/vector/add` body, the same place `/vector/query` and
`/vector/delete` take it. `VectorAddRequest` had no such field, so pydantic dropped it silently. With
no project named, the auth rule fell back to `orchestrator`, which members may read but not change.
The 403 said "this project" without naming it, so callers looked for a grant they already had.

## What changed

- `app/schemas.py`: `VectorAddRequest.project`, documented in OpenAPI.
- `main.py`: before the embedding, a top-level `project` is checked against `metadata.project` and
  then `metadata.source_id` (the order the auth rule reads them, skipping blanks). If they disagree,
  the request gets a 422 that names the field. Otherwise `metadata.project` is set to the top-level
  value. A blank `metadata.project` is overwritten, so the row lands in the project the permission
  check cleared and not in the shared store.
- `app/auth_rules.json`: `POST /vector/add` reads `body.project` after `body.metadata.project` and
  `body.metadata.source_id`.
- `app/auth.py`: when the request names no project, the 403 says it fell back to the default project
  and lists where to name one.

## Checks

- New `tests/test_vector_add_project.py`: 11 ok. It runs the real route and covers a top-level
  project alone, a blank or whitespace `metadata.project`, disagreement with `metadata.project` and
  with `metadata.source_id` (422, nothing stored), agreement, and the 403 with no project.
- `test_auth.py` gains 3 checks (56 ok). Also passing on main: personal 23, hotlog 14,
  project_access 28, chunks 16, vector_delete 31, distill 110, embed_remote 41, turn_context 26.

## Prod rollout (2026-10-12)

- Deployed main `635eb94` to `knowledge-hub` (`push.ps1 -ExpectOrg ticketing-system-simplemdg
  -HanaService kh-hana-v2 -AuthIssuer ...`), uploaded 14:44 +07.
- The rest of main since `567e189` is off by default: `KH_EMBEDDER` defaults to `local` and is not
  set on prod; the principals change applies only with sign-in off.
- Live: `/health` 200. A worklog written with the project only at the top level landed in
  `kh-investigate` with `metadata.project` set. Top-level and `metadata.project` disagreeing returned
  422. The no-project 403 was not seen live: the probe ran as a maintainer, who may write to the
  orchestrator, so it was stored and then deleted.
- Rollback: redeploy `567e189`.
- cf on the deploying machine may be logged into another landscape. Run the KH deploy in its own
  `CF_HOME` so that login is left alone.

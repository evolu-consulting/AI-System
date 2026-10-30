# Local docker test stack: KH + Keycloak

Where KH changes are tested before BTP prod (fen 2026-10-05, after the BTP dev app `kh-sso` was
removed). The local KH on port 9000 is fen's working memory and is not a test target.

| Service | URL | Store |
|---|---|---|
| `kh` (sign-in on) | http://localhost:9200 | SQLite, Chroma, Kuzu on the docker volume `kh-test_kh-data` |
| `keycloak` (HANA fork + KH extension) | http://host.docker.internal:8180 | a HANA schema: the local HANA express container (`KH_KEYCLOAK_DEV`, since 2026-10-13) or a BTP schema service |

Keycloak needs HANA because the fork's access tables and the KH extension are written for it. The
schema service uses no Cloud Foundry memory. KH runs on its local stores, so it is fast here; its HANA
code path is covered by the e2e run on prod.

## First time

```bash
# BTP: the Keycloak database (once)
cf create-service hana schema keycloak-docker-hana
cf create-service-key keycloak-docker-hana docker-local
cf service-key keycloak-docker-hana docker-local   # save the JSON as <key.json>, outside the repo

# Stage and start (from Slaves/KnowledgeHub)
python deploy/docker/stage.py --keycloak-repo C:/Workspaces/Keycloak --service-key <key.json> \
    --bootstrap-password-file <file with a temporary admin password>
docker compose -f deploy/docker/docker-compose.yml up -d --build

# Realm, admin client, agent-admin, tenants, KH_AUTH tables (after Keycloak answers /health/ready)
python deploy/docker/setup_realm.py --url http://host.docker.internal:8180 --keycloak-repo C:/Workspaces/Keycloak \
    --service-key <key.json> --bootstrap-password-file <same file> --secrets-dir <dir outside the repo>
```

## Testing a change

```bash
python deploy/docker/stage.py ...                      # same arguments as above
docker compose -f deploy/docker/docker-compose.yml up -d --build kh
python <Keycloak repo>/deploy/btp/e2e_multi_user.py --keycloak http://host.docker.internal:8180 \
    --kh http://localhost:9200 --client-id kh-docker-admin \
    --client-secret-file <dir>/keycloak-docker-admin-client.txt --accounts-file <dir>/kh-docker-e2e-accounts.json
```

Then deploy prod with `deploy/btp/push.ps1` and run the same e2e there.

Secrets: `.stage/.env` (git-ignored) holds the Keycloak database password; the admin client secret
and the agent-admin password live only in `--secrets-dir`.

## Local HANA express (2026-10-13)

The BTP service `keycloak-docker-hana` is gone; the stack runs on the HANA express container `hana`
(tenant HXE, port 39041), user/schema `KH_KEYCLOAK_DEV`. Its key file sets `"encrypt": false` (seed.py and
test_access.py honour it) and a JDBC url `jdbc:sap://host.docker.internal:39041/?currentschema=KH_KEYCLOAK_DEV&distribution=OFF`.
Keycloak's changeset `15.0.0-KEYCLOAK-18467` cannot run on HANA 2.0 express (CLOB to NCLOB): on a fresh schema,
recreate `REALM_LOCALIZATIONS.TEXTS` as NCLOB and mark the changeset run (DATABASECHANGELOG, MD5SUM
`7:b06356d66c2790ecc2ae54ba0458397a`); HANA Cloud is not affected.

Learn back runs with `KH_LEARNBACK_LLM=dry` here (no Claude CLI in the container).

## kh-sidecar: the nightly distil as its own instance (2026-10-24)

`kh-sidecar.Dockerfile` is kh-worker plus the Claude Code CLI. It runs on a Claude subscription token
(`claude setup-token` -> `CLAUDE_CODE_OAUTH_TOKEN`) and signs in to KH as a technical user
(`KH_WORKER_AUTH=person`, `worker/kh_worker/person.py`), so the KH it serves needs no `kh_people`. When it
runs comes from the env: `KH_WORKER_DISTIL_AT=02:00` (every day) or `sat 03:00` (weekly), in `KH_WORKER_TZ`.
Each run reads only logs past KH's cursor per project (`/distill/cursor`), so a night handles that day's logs.

```bash
cp deploy/docker/kh-sidecar.env.example <outside the repo>/kh-sidecar.env      # fill it in
docker compose -f deploy/docker/kh-sidecar.compose.yml --env-file <...>/kh-sidecar.env up -d --build
docker compose -f deploy/docker/kh-sidecar.compose.yml --env-file <...>/kh-sidecar.env run --rm kh-sidecar \
    python -m kh_worker check                                      # effective config, secrets masked
docker compose -f deploy/docker/kh-sidecar.compose.yml --env-file <...>/kh-sidecar.env run --rm kh-sidecar \
    python -m kh_worker once --job distil                          # one run now, outside the schedule
```

Before the first run: a technical user in the `knowledge-hub` realm with the maintainer role, and a confidential
client with direct access grants only and kh-cli's default scopes (the `kh-agent-chatbot` pattern).
`deploy/btp/kh-worker/create_sidecar_account.py` makes both with a master admin client, writes the five
`KH_WORKER_KC_*` / `KH_WORKER_USERNAME` / `KH_WORKER_PASSWORD` lines to `--out`, and signs in once as the sidecar
to check KH says maintainer. `CLAUDE_CODE_OAUTH_TOKEN` comes from `claude setup-token` (a browser sign-in). Start with
`KH_WORKER_ENABLED=1 KH_WORKER_MODE=dry` (KH writes nothing; `/data/runs.jsonl` shows what would be written),
then `KH_WORKER_MODE=on`. Items land as `proposed` for review on /home > Lesson learn unless
`KH_WORKER_AUTO_APPROVE=1` (never policy proposals or shares). Lease, spend ledger and run log live in `/data`.

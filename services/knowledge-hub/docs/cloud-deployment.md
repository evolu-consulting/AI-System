# KnowledgeHub on SAP BTP Cloud Foundry

A cloud copy of KH runs every store in one HANA schema, so its container disk holds nothing
that matters. The local install is unchanged: with none of the variables below set, KH keeps
using `hooks.db`, `chroma_data` and Kùzu beside the exe.

## Where it runs

| | |
|---|---|
| Subaccount | Ticketing System (`58eb60e2-c50e-44ff-ba52-cc78c2632412`) |
| CF API | `https://api.cf.br10.hana.ondemand.com` |
| Org / space | `ticketing-system-simplemdg` / `app` |
| App | `knowledge-hub` (8 GB memory, 4 GB disk, 1 instance) |
| URL | `https://knowledge-hub.cfapps.br10.hana.ondemand.com` |
| Database | service `kh-hana` (offering `hana`, plan `schema`), its own schema on the shared HANA Cloud instance |

The `schema` plan matters. Its user owns its schema, so KH creates its own tables. An
`hdi-shared` user has no DDL rights. KH's schema is separate from the ticketing schemas;
nothing in it is shared with `ticketing-system` or `ticketing-system-qas`.

## Backend switches

`KH_DB_BACKEND=hana` sets all three backends below at once (`local` = Kùzu + SQLite +
Chroma, no HANA probe). A backend's own variable, when set, wins over it.

| Variable | Local default | Cloud | What moves |
|---|---|---|---|
| `KH_STORE_BACKEND` | `sqlite` | `hana` | `hook_rules`, `policy_actions`, `policy_rules`, `projects` (via `app/sqldb.py`) |
| `KH_VECTOR_BACKEND` | `chroma` | `hana` | every vector collection (via `app/vector_hana.py`) |
| `GRAPH_BACKEND` | `auto` / `kuzu` | `hana` | the property graph (`app/graph_db/hana_adapter.py`) |
| `KH_API_KEY` | unset (open) | set | every route except `/health` needs `X-KH-Key: <key>` or `Authorization: Bearer <key>` |

HANA credentials come from the `kh-hana` binding in `VCAP_SERVICES`. An explicit
`HANA_HOST / HANA_PORT / HANA_USERNAME / HANA_PASSWORD / HANA_SCHEMA` variable still wins, so
the same code runs against a service key from a laptop. A binding also turns `HANA_ENCRYPT`
on, because HANA Cloud accepts TLS only.

## Connection and table settings

All optional; the default is what KH used before these became variables.

| Variable | Default | Meaning |
|---|---|---|
| `HANA_POOL_SIZE` | `5` | connections kept open, per pool (stores, graph) |
| `HANA_MAX_OVERFLOW` | `0` | extra connections allowed under load, closed again on return |
| `HANA_POOL_RECYCLE` | `0` | seconds after which a connection is replaced; 0 = never |
| `HANA_POOL_TIMEOUT` | `30` | seconds a store call waits for a free connection |
| `HANA_GRAPH_POOL_TIMEOUT` | `10` | the same, for the graph pool |
| `HANA_CONNECT_TIMEOUT_MS` | `0` | connect timeout passed to hdbcli; 0 = driver default |

An instance that serves stage F agents needs more than the default 5 store connections: a `/v1` append takes up
to three short transactions (idempotency claim, insert, idempotency answer) and every one waits for a free
connection. Measured on one dev instance with 30 agents (~230 requests/s, `tools/stagef/consumer_sim`):
`POST /v1/{ns}/events` p95 160 ms with `HANA_POOL_SIZE=5` and 99 ms with `20`. Size it so that
instances x pool stays under 70% of the schema's connection limit (design 2.4).
| `HANA_SSL_VALIDATE` | `true` | check the server certificate when `HANA_ENCRYPT` is on |
| `KH_SQLITE_TIMEOUT` | `10` | seconds a local SQLite write waits on a lock |
| `KH_SQLITE_WAL` | `true` | run `hooks.db` in WAL mode |
| `KH_GRAPH_TABLE_PREFIX` | `KH_` | graph tables; project graphs use `<prefix>P_<project>_...` |
| `KH_HANA_VEC_COLLECTIONS_TABLE` | `KH_VEC_COLLECTIONS` | vector collections table |
| `KH_HANA_VEC_ROWS_TABLE` | `KH_VEC_ROWS` | vector rows table |
| `KH_DOCS_TABLE` | `kh_docs` | document store table |

Table names must be bare SQL identifiers (letters, digits, underscore); anything else stops
startup. Renaming a table on a live install points KH at an empty one, so migrate first.
A blank value (`KEY=`) means the default.

## How the vector store maps onto HANA

`app/vector_hana.py` answers the Chroma collection calls KH makes (`get`, `query`, `upsert`,
`update`, `delete`, `count`), so no caller changed. Two tables:

- `KH_VEC_COLLECTIONS(NAME, META, CREATED_AT)`: one row per collection.
- `KH_VEC_ROWS(COLL, ID, SEQ, EMB REAL_VECTOR, DOC, META)`: primary key `(COLL, ID)`, with
  `SEQ` keeping insertion order for paging.

Ranking runs in HANA with `COSINE_SIMILARITY`. The distance returned is `1 - similarity`,
the same value Chroma's cosine space gives, so scores do not move.

**Ceiling.** `where` and `where_document` filters are evaluated in Python over a
collection's metadata, then the ranking is restricted to the ids that passed. That is exact
and quick at KH's scale (hundreds to low tens of thousands of rows per collection).
**Upgrade path** when a collection outgrows it: translate `where` into
`JSON_VALUE(META, '$.field')` predicates so HANA filters before it ranks.

## Deploy

From the KH folder on the operator's machine, logged in with `cf login -a
https://api.cf.br10.hana.ondemand.com --sso`:

```powershell
pwsh -NoProfile -File deploy/btp/push.ps1 -ExpectOrg ticketing-system-simplemdg
```

The script refuses to push if `cf` targets another org. It creates `kh-hana` when missing,
stages the app with CPU-only torch and the bundled `bge-small-en-v1.5` model, and pushes
without starting. Then it sets `KH_API_KEY` from `~/.kh/btp_api_key.txt` (generated on first
run, never in git) and starts the app. Cloud Foundry builds the Python app itself, so no
container registry is involved.

## Seeding policy + knowledge from a local install

`tools/migrate_to_hana.py` copies the policy tables and the shared (orchestrator) knowledge
from a local install, carrying ids, embeddings, documents and metadata. What moves is the
`RELATIONAL_SELECTION` and `VECTOR_SELECTION` tables at the top of the script. Projects,
worklogs and the C4 project registry stay behind by design. Read from a snapshot, never
from the live `chroma_data`:

```bash
# credentials of a service key:  cf create-service-key kh-hana kh-local
export HANA_HOST=... HANA_PORT=443 HANA_USERNAME=... HANA_PASSWORD=... HANA_SCHEMA=... HANA_ENCRYPT=true
.venv/Scripts/python tools/migrate_to_hana.py --chroma <snap>/chroma_data --hooks-db <snap>/hooks.db
```

It is an upsert: running it twice gives the same result, and it never deletes on the target.

## Nothing is left on the container disk

Every piece of state lives in the `kh-hana` schema (2026-09-23, second pass):

| State | Local | Cloud (HANA) |
|---|---|---|
| hook rules, policy table, project registry | `hooks.db` | tables `HOOK_RULES`, `POLICY_ACTIONS`, `POLICY_RULES`, `PROJECTS` |
| vectors | `chroma_data` | `KH_VEC_COLLECTIONS`, `KH_VEC_ROWS` |
| default graph (orchestrator) | Kùzu `kuzu_projects/orchestrator` | `KH_DOCUMENTS`, `KH_GRAPH_NODES`, `KH_GRAPH_EDGES` + workspace `KH_GRAPH_WORKSPACE` |
| a project's graph | Kùzu `kuzu_projects/<id>` | `KH_P_<ID>_<hash>_DOCUMENTS / _GRAPH_NODES / _GRAPH_EDGES` + `_GRAPH_WS` |
| feedback counter, project descriptor, orchestrator manifest | JSON files | table `KH_DOCS`, keyed by the file's relative path |

Per-project graphs keep their physical isolation: each project has its own tables, and
deleting a project drops them. `app/docstore.py` holds the JSON documents; locally it
reads and writes the same files as before.

## Embeddings in their own app (KH_EMBEDDER)

The embedding model normally runs inside every KH instance. When the embedder takes more than 50% of an
instance's CPU (design 2.5), or to run KH instances without the model in memory, move it to the
`kh-embed` app (`app/embed_server.py`, same code and model). Nothing else in KH changes.

| Variable (KH side) | Default | Meaning |
|---|---|---|
| `KH_EMBEDDER` | `local` | `local` = model in this process (unchanged); `remote` = embed service only, no model loaded here, a service that is down gives 503 `embedder_unavailable`; `auto` = service first, local model loaded once on the first failure |
| `KH_EMBED_URL` | none | base URL of the service; required for `remote` / `auto` (no default host) |
| `KH_EMBED_TOKEN` | none | shared bearer secret, set with `cf set-env` on both apps, never in a file |
| `KH_EMBED_TIMEOUT_S` / `KH_EMBED_RETRIES` | `15` / `2` | per request; retries on 429, 5xx and timeouts |
| `KH_EMBED_BATCH_MAX` | `64` | texts per request (longer lists are split) |
| `KH_EMBED_FAIL_THRESHOLD` / `KH_EMBED_COOLDOWN_S` | `3` / `60` | `auto`: after this many failures in a row stay local this long, then probe the service again |

| Variable (service side) | Default | Meaning |
|---|---|---|
| `KH_EMBED_TOKEN` | none | required; the service refuses to start without it (only `KH_EMBED_ALLOW_NO_TOKEN=true` on a loopback host skips it, for development) |
| `KH_EMBED_BATCH_WINDOW_MS` / `KH_EMBED_MAX_BATCH` | `5` / `64` | micro-batching: requests arriving within the window share one forward pass |
| `KH_EMBED_MAX_TEXTS` / `KH_EMBED_MAX_CHARS` / `KH_EMBED_MAX_BODY` | `256` / `20000` / 8 MB | request limits; the character cut is above anything 512 tokens cover, so it never changes a vector |
| `KH_EMBED_THREADS` | `0` | torch threads; 0 = torch default |

Safety: at startup KH reads `GET /embed/info` and refuses to start when the service runs another model or
dimension than `KH_EMBEDDING_MODEL` (vectors of two models are not comparable). A service that is merely
down does not stop KH in `remote` mode; the handshake is retried before the first vector.

Measured 2026-10-11 (bge-small, CPU, one machine): 32 concurrent short queries took 365-539 ms one by one
in process and 117-180 ms through the service with micro-batching (about 3x). Service vectors equal local
ones (cosine > 0.9999).

Switch on (BTP):

```
pwsh -NoProfile -File deploy/btp/push.ps1 -ExpectOrg <org> -AuthIssuer <realm>   # stages deploy/btp/.build
cf push -f deploy/btp/kh-embed/manifest.yml -p deploy/btp/.build
cf set-env kh-embed KH_EMBED_TOKEN <secret>; cf restage kh-embed
cf add-network-policy knowledge-hub kh-embed --port 8080 --protocol tcp
cf set-env knowledge-hub KH_EMBEDDER auto
cf set-env knowledge-hub KH_EMBED_URL http://kh-embed.apps.internal:8080
cf set-env knowledge-hub KH_EMBED_TOKEN <secret>
cf restage knowledge-hub
```

Start with `auto` (falls back to the local model). Move to `remote` only to drop the model from the KH
instances' memory, once the service runs more than one instance. Rollback: `cf set-env knowledge-hub
KH_EMBEDDER local` and restage. Docker: run the same image a second time with
`command: python -m app.embed_server --port 8010` and point KH at `http://<service>:8010`.

## Tests

```powershell
.venv\Scripts\python tests\test_store_backends.py                 # offline part
$env:KH_TEST_HANA="1"; <HANA_* from a service key>; .venv\Scripts\python tests\test_store_backends.py
```

The live part writes only to a throwaway collection and hook type, and removes both.

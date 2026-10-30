# Knowledge Hub stage F: a pluggable, multi-instance RAG platform for many concurrent agents

Design 2026-10-10 (lead architect). This replaces the earlier F draft, which was written around one
consumer. Stage F turns Knowledge Hub (KH) into a standalone, structured, optimized RAG product that a
demanding consumer can attach at runtime, use with hundreds of concurrent agents across 2-3 KH
instances, and detach again without any KH redeploy. The first consumer is an autonomous software-delivery
(SDLC) line in which many agents work at once. KH and the consumer are separate products. KH defines
generic capabilities: an append-only event store, leases with fencing epochs, revisions and
idempotency, typed records, a rule graph, versioned document packs, a knowledge-item lifecycle, keyed
retrieval, a sealed vault, redaction, metrics and subscriptions. A consumer configures these
capabilities with data: schemas, kinds, keys, retention, quotas and webhooks. KH contains no code,
table, endpoint or step name that belongs to one consumer.

| # | Goal | Number to check |
|---|---|---|
| G1 | Correct with 3 instances under agent load | load test with 100 simulated agents on 3 instances: 0 double message deliveries, 0 lost updates, 0 accepted writes with a stale epoch, 0 duplicate side effects per idempotency key; e2e 73/73 on every instance |
| G2 | Fast enough that agents never wait on KH | `POST /v1/{ns}/events` p95 < 150 ms at 200 events/s sustained; `/v1/{ns}/context/step` p95 < 2 s; 3-hop rule query p95 < 500 ms on 50k rules |
| G3 | Plug-in and plug-out without a redeploy | attach-to-first-write < 60 s; after a detach, every `/v1/{ns}/*` route answers 404 on every instance within 5 s; export, then re-import into a clean KH, gives identical row counts and sha256 per table |
| G4 | Isolation holds | isolation suite: 0 vault reads by any non-grader principal, 0 cross-namespace reads, 100% of planted canaries detected on write |
| G5 | People do not pay for agents | the tier-2 bench on the F build is no worse than prod (tokens and answer score within 2%) |

## 1. Principles

**Loose coupling rules**

1. **Configuration is data, never code.** A consumer exists in KH only as rows: a namespace, schemas,
   kinds, keys, ACLs, retention, quotas and subscriptions. KH never imports, loads or evaluates
   consumer code. The only consumer-supplied logic KH runs is JSON Schema validation and regex
   redaction patterns.
2. **Generic nouns only.** KH uses words such as run, unit, session, attempt, epoch, record, decision,
   rule, pack, item, vault and metric. Step names, role names and stack names belong to the consumer
   and reach KH only as values of keys the consumer registered.
3. **Namespaces isolate.** Every row the consumer creates carries `ns`. Every `/v1/{ns}/` route checks
   the namespace state and the caller's grant on that namespace before it touches any data.
4. **Discoverable and versioned.** `GET /v1/capabilities` states what KH can do, each capability at a
   semver version. Breaking changes ship under a new path prefix after a deprecation window.
5. **The consumer stays independent.** The contract requires the consumer to keep a port/adapter in
   front of KH and to run degraded without it (section 6.4). KH never calls the consumer except
   through webhooks the consumer subscribed.
6. **Every concurrency rule is SQL in `app/sqldb.py`.** Each rule is a conditional UPDATE, a
   primary-key insert or a counter row inside one transaction. Each one is tested on SQLite and on HANA
   Express in Docker. No correctness rule depends on a process lock.

**KH never:** decides who confirms consumer knowledge (the consumer configures it); widens a grant
beyond the owner's grant; serves vault content through retrieval, search, graph or export without an
explicit grader or admin grant; deletes consumer data outside configured retention or an explicit
purge; puts a consumer's raw events, records, metrics or vault into people's `/context/step` packs
(only its findings and items of the same project are shared, D20 revised);
blocks a consumer flow with a human gate the consumer did not configure.

## 2. Multi-instance correctness (survey 2026-10-10, kept from the previous draft)

| Where | Problem with 2+ instances | Fix (slice F1) |
|---|---|---|
| `app/messages.py` inbox | SELECT unread, then rewrite the `users_read` JSON under `threading.Lock`: two instances can both deliver, and one write can drop the other's reader | table `message_receipt(message_id, reader, read_at, PK(message_id, reader))`; the inbox inserts a receipt per candidate and returns only the inserts that succeeded; `users_read` becomes derived. Message v2 adds `kind`, `task_id` and `reply_to` |
| `app/feedback.py` counters | JSON read-modify-write in `kh_docs`: increments are lost | rows `kh_counter(name PK, n)` updated with `SET n = n + 1` |
| `app/projects_store.py` `save_all` | whole-set delete: a project created on A is deleted by a stale save on B | `upsert_one` and `delete_one`; `save_all` kept only for the startup migration |
| `app/distill.py` cursor and batch | process `_LOCK` only | the batch claim and the cursor move become conditional UPDATEs on `distill_batch` and `distill_cursor` |
| crons in `main.py` `lifespan` (line 192) | feedback and message crons start on every instance | each run first takes a lease (2.1) |
| `app/project_access.py` cache | changes are seen up to 5 s late | accepted: bounded at 5 s, and the namespace state cache uses the same 5 s bound |
| knowledge rows, cards, policy rules | last writer wins, silently | `rev` plus If-Match (2.3) |
| embedder | bge-small loaded per instance (~130 MB) | fine; move it to a separate worker only if the load test shows CPU > 80% at p95 |

### 2.1 Leases with fencing epochs

`kh_lease(ns, name, holder, epoch, until_ms, PK(ns, name))`. KH's own jobs use `ns = '_kh'`.

- Acquire or renew: `UPDATE kh_lease SET holder=?, until_ms=:now+:ttl, epoch = CASE WHEN holder=? THEN epoch ELSE epoch+1 END WHERE ns=? AND name=? AND (until_ms < :now OR holder=?)`. If the update changes one row, the caller holds the lease and gets back the new epoch. For a missing lease row, the first INSERT wins and the rest see a duplicate key.
- `:now` always comes from the database clock, never from the instance clock. A new helper `sqldb.now_ms_sql()` returns `CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)` on SQLite and `NANO100_BETWEEN(TO_TIMESTAMP('1970-01-01'), CURRENT_UTCTIMESTAMP)/10000` on HANA. Reason: instance clocks drift, and leases must agree across instances.
- TTL from 5 s to 300 s (default 30 s). The holder renews at TTL/3.
- **Fencing:** a write to a fenced type or kind must carry `X-KH-Lease: <name>` and `X-KH-Epoch: <n>`. The write statement includes `AND EXISTS (SELECT 1 FROM kh_lease WHERE ns=? AND name=? AND epoch=? AND until_ms >= :now)` in the same transaction. If that check fails, KH answers 409 `stale_epoch` and writes a `kh.stale_epoch` event.
- `holder` is the principal for consumer leases and `CF_INSTANCE_GUID` for KH crons.

### 2.2 Revisions and If-Match

Every mutable row in a `/v1` table has `rev BIGINT`. An update runs `UPDATE ... SET ..., rev=rev+1 WHERE
pk=? AND rev=?`. If no row changes, KH answers 409 with the current row and its ETag and writes a
`kh.write_conflict` event. Create uses `If-None-Match: *` (a duplicate key gives 409). For types the
consumer registers with `require_if_match: true`, a write without If-Match gets 428. Legacy routes keep
last-writer-wins when If-Match is absent, so people's sessions keep working. The same rule extends to
knowledge rows, entity cards (`app/entities.py`) and policy rules (`app/policy.py`).

### 2.3 Idempotency

`kh_idem(ns, principal, idem_key, request_sha256, state, status_code, response_json, created_ms, PK(ns, principal, idem_key))`.

- Before work, KH inserts the row with `state='pending'`. A duplicate key with the same request hash
  replays the stored response, or answers 409 `in_progress` with `Retry-After: 1` while the first call
  is still pending. A different hash gets 422 `idempotency_mismatch`.
- A pending row older than 60 s is taken over through a conditional UPDATE.
- Retention defaults to 24 h. A namespace may set up to 7 d so that a degraded consumer can replay its
  buffer. Every replay writes a `kh.duplicate` event.

**External side effects** use the effects ledger: `kh_effect(ns, effect_key, holder, state
claimed|done|failed, result_json, rev, PK(ns, effect_key))`. `POST /v1/{ns}/effects/{key}:claim`
answers 201 to the first caller and 409 with the recorded state to everyone else. The holder then
calls `:complete` or `:fail`. A claim expires after a TTL the caller sets (default 300 s), so a crashed
holder does not block the effect forever.

### 2.4 Capacity

- 3 instances x 3 GB (`push.ps1 -Memory 3G`, `cf scale -i 3`) use 9 GB of the 30 GB BTP org quota. That
  is about the 8 GB the single instance reserves today.
- `HANA_POOL_SIZE` is sized so that 3 x pool stays under 70% of the schema's connection limit.
- `/health` stays cheap, and long routes stay off the event loop (lesson from the 2026-10-09 incident).
- Agents and people share the same 3 instances in F. Per-namespace quotas (3.6) protect people. A
  second CF app from the same image is created only if the G5 bench guard trips.

### 2.5 Scaling past the first consumer (owner decision 2026-10-11)

Agents and people stay on one shared KH: shared experience between people's assistants and autonomous
agents is the reason KH exists, so splitting them into two servers is not an option. KH must therefore
grow with traffic instead of being sized for a handful of users. 3 instances is the starting point,
not the ceiling. Every step below is triggered by a measured number, never by guess.

| Pressure | Trigger (measured in F14 or prod metrics) | Step |
|---|---|---|
| Request load | CPU p95 > 70% or `/v1/{ns}/context/step` p95 > 2 s for 15 min | `cf scale -i N`; all state is already in the database and every cron runs under a lease, so N is a number. The 30 GB org quota allows about 8 instances at 3 GB next to the other apps |
| Embedding CPU | embedder > 50% of instance CPU | move the embedder into a separate CF worker app behind a small internal route; instances keep a fallback in-process copy |
| Database connections | pool wait p95 > 50 ms | lower per-instance `HANA_POOL_SIZE` and add instances, or move to a larger HANA Cloud size; total pool stays under 70% of the schema limit |
| Event append serialization | `kh_counter('ev:'+ns)` wait p95 > 20 ms | shard the counter per (ns, project), so `seq` is gapless per project (fallback already named in section 9) |
| Retrieval reads | key tier p95 > 150 ms | per-instance read cache of active items by `(project, key_sha)` with the 5 s bound used elsewhere |
| People slowed by agents | G5 tier-2 guard trips | second CF app from the same image for namespace traffic, same database (D19) |

The load test (section 7) gets a second profile at 3x the G1/G2 numbers (300 agents, 600 events/s) to
find the first bottleneck before production does.

## 3. Architecture

### 3.1 Capability modules

New code lives in the package `app/caps/`, with one module per concern. Each module exposes `NAME`,
`VERSION`, `init(conn)` (dual DDL through `sqldb.create_table`) and `attach(app)`. `main.py` gets one line,
`caps.attach_all(app)`, after the existing `attach` block (lines 348-434). Each capability can be switched
off with `KH_CAP_<NAME>=off` through `config._flag`. A disabled capability is missing from discovery, and
its routes answer 404.

| Module | Concern | Reuses |
|---|---|---|
| `caps/registry.py` | namespaces, schemas, kinds, keys, ACLs, retention, quotas, lifecycle, discovery | `app/sqldb.py`, the 5 s cache pattern from `app/project_access.py` |
| `caps/principals.py` | service principals, KH principal tokens, roles | `app/auth.py` middleware, `auth_rules.json`, PyJWT (already in `requirements.txt`) |
| `caps/coord.py` | leases, epochs, idempotency, effects, counters | `app/sqldb.py` |
| `caps/events.py` | append-only event store, cursors | `app/sqldb.py` |
| `caps/records.py` | typed records (decision ledger, guard registry, any registered type) | `app/sqldb.py`, `jsonschema` |
| `caps/rules.py` | rule graph | `app/graph_db/base.py` `traverse_logic`/`fetch_graph`, `project_graph.get_project_graph`, both adapters |
| `caps/packs.py` | versioned document packs, quotes, assumptions, duplicate questions | `app/chunker.py`, `app/vector_store.py`/`app/vector_hana.py`, embedder |
| `caps/items.py` | knowledge-item lifecycle (lessons and other kinds) | `app/distill.py` schema, leak gate, contradiction check, `/distill/patterns` |
| `caps/retrieval.py` | keyed per-step retrieval for namespaces | `app/step.py` tiers and budget |
| `caps/vault.py` | sealed holdout vault, canaries | `caps/redact.py` scanner |
| `caps/redact.py` | secret and PII scanner, pattern packs | `config.DISTILL_LEAK_PATTERNS` becomes the default pack |
| `caps/metrics.py` | outcome metrics, baselines, comparisons | `app/sqldb.py` |
| `caps/outbox.py` | subscriptions, webhooks, pull cursors | `caps/coord.py` leases |

**Migrations:** a new table `kh_schema_migration(module, version, applied_ms)`. Each module's `init`
applies its numbered steps only once. Reason: the DDL for both backends is already handwritten in
`sqldb.create_table`, and Alembic would add a SQLAlchemy HANA dialect dependency for no gain.

Type mapping, applied to every table below: `TEXT` on SQLite becomes `NVARCHAR(n)` on HANA (or
`NCLOB` for `*_json` and bodies); `INTEGER`/`BIGINT` stay `BIGINT`; `REAL` becomes `DOUBLE`. Times are
`*_ms BIGINT` (UTC epoch ms). HANA tables are `COLUMN` tables.

### 3.2 Consumer registration (plug-in model)

A consumer is attached as a **namespace** (`ns`, `[a-z][a-z0-9_]{2,31}`; the prefixes `kh` and `_` are
reserved). A namespace is one installation of a consumer. The same consumer product attached twice
gets two namespaces. KH projects stay orthogonal: a namespace lists the KH projects it may use, and
every consumer row also carries `project`.

Tables (all `PK` includes `ns`):

- `kh_ns(ns, display, state, owner_email, projects_json, config_json, created_ms, detached_ms, purge_after_ms, rev)`. `state` is one of `active`, `suspended`, `detached` or `purged`.
- `kh_schema(ns, name, version, json_schema, sha256, created_ms)`. Versions are immutable. Reason: stored rows carry their `schema_ver`, so they always validate against the schema they were written with.
- `kh_type(ns, type, kind_of, schema_name, current_ver, index_fields_json, read_roles_json, write_roles_json, fenced, require_if_match, retention_days, confirm_policy_json, rev)`. `kind_of` is `record`, `event`, `item` or `metric`.
- `kh_keyspace(ns, keyspace, dims_json, rev)`. `dims_json` is an ordered list of key dimensions, for example `["role","step","stack"]` (the values are the consumer's own).
- `kh_quota(ns, name, limit_value, window_s)`.
- `kh_subscription(ns, sub_id, kinds_json, url, secret_ref, state, rev)`.

Registration is one idempotent document. `PUT /v1/admin/ns/{ns}` registers the namespace itself;
`PUT /v1/{ns}/manifest` takes a manifest with `If-Match` that declares the schemas, types, keyspaces,
quotas, retention and subscriptions together. KH validates the whole manifest (every JSON Schema must
compile, each schema ≤ 64 KB, ≤ 8 index fields per type, ≤ 200 types per namespace) and applies it in
one transaction. `GET /v1/{ns}/manifest` returns the manifest as it is now. Adding types is allowed at
any time. Removing a type is only allowed when it has no rows, or with `?archive=true`, which exports
the type and then hides it.

**Index fields.** JSON bodies are stored as `NCLOB`, which HANA cannot index or filter fast. A type may
therefore promote up to 8 fields from its body into typed columns: `ix_s1..ix_s4` (NVARCHAR 256),
`ix_n1..ix_n2` (DOUBLE) and `ix_t1..ix_t2` (BIGINT ms). The registry maps names to columns, and queries
filter only on these columns. Reason: `vector_hana` already shows the cost of filtering in Python, and
promoted columns keep queries in SQL on both backends.

**Validation.** `jsonschema` (MIT) uses Draft 2020-12, and compiled validators are cached per
`(ns, schema, version)`. Target p95 < 1 ms per body ≤ 16 KB. A failed validation gets 422 with the JSON
pointer of each error. Body size limit: 256 KB per record or event.

**Namespace state cache.** Each instance caches `kh_ns.state` for 5 s. A request for a namespace that is
not `active` gets 404 (`detached` or `purged`) or 423 (`suspended`). This 5 s cache is where the G3
bound comes from.

### 3.3 Discovery and API versioning

- `GET /v1/capabilities` (authenticated) returns `{kh_version, api_versions:["v1"], capabilities:[{name, version, status: stable|beta|deprecated, sunset?, limits:{...}}]}`. Its source is the module list. Nothing is hand-maintained.
- `GET /version` stays as it is. `GET /v1/{ns}/manifest` describes what one namespace configured.
- Every new route is under `/v1/`. Existing unprefixed routes stay unchanged for people's CLIs. Reason: moving them is churn with no value for the consumer.
- Capability semver: minor versions only add things. A breaking change ships as `/v2/...` with a 180-day overlap. Old routes send `Deprecation` and `Sunset` headers (RFC 8594), and `/v1/capabilities` lists `sunset`. The FastAPI OpenAPI document is published at `/v1/openapi.json`, filtered to `/v1`.

### 3.4 Authentication and authorization for agents

**Keycloak approach (decided).** Keycloak creates one confidential client per namespace, with the
client-credentials grant, through a new maintainer route of the existing Keycloak `/kh` extension. That
client is the namespace administrator. Agents are not Keycloak users. They are **KH service
principals** that KH stores in its own table and authenticates with short-lived tokens that KH signs.
Reason: hundreds of agents are created and dropped per run. One Keycloak client each would put
Keycloak on the hot path and create thousands of clients, while a KH row is created in under 10 ms and
can be revoked instantly.

- `kh_principal(ns, principal_id, role, on_behalf_of, projects_json, state, created_ms, expires_ms, rev)`. `role` is one of `orchestrator`, `agent`, `judge`, `grader`, `distiller`, `confirmer`.
- `POST /v1/{ns}/principals` (namespace admin or orchestrator) creates a principal. `POST /v1/{ns}/principals/{id}/token` returns an EdDSA JWT valid for 15 minutes with `sub = ns:principal_id`, `ns`, `role`, `obo` and `kid`. The signing key comes from the environment, and old `kid`s stay valid for 24 h when the key rotates.
- `app/auth.py` accepts both Keycloak JWTs (people, namespace clients) and KH principal tokens, and builds the same `Principal` object with new fields `ns`, `svc_role` and `on_behalf_of`. `auth_rules.json` gains the route kind `ns`: the token's `ns` must equal the path `{ns}`, and the role must be allowed by the type ACL.
- **Grants never widen.** Effective projects = principal.projects ∩ ns.projects ∩ the projects of `on_behalf_of` (or of the namespace owner). A KH cron fetches those projects from Keycloak every 10 minutes under a lease. If an owner loses a project, every principal in the namespace loses it at the next refresh, so the window is at most 10 minutes plus one token lifetime.
- Every write is stamped with `actor_json = {principal, role, on_behalf_of, run_id, unit_id, session_id}`, taken from the token and the headers `X-KH-Run`, `X-KH-Unit` and `X-KH-Session`.

Default role matrix (a type's ACL can narrow it; it can widen it only up to these maxima):

| Role | events | records | rules | packs | items | retrieval | vault | metrics | admin |
|---|---|---|---|---|---|---|---|---|---|
| orchestrator | append, read | read, write | read, write | read, write | read | read | none | write, read | principals, leases |
| agent | append | per type ACL | read, write | read | read, propose (findings, 2026-10-11) | read | **none** | write | none |
| judge | append, read | write decisions, read | read | read | read | read | **none** | read | none |
| grader | append, read | read | read | read | read | none | **read** | write, read | none |
| distiller | read | read | read | read | propose, write | read | **none** | read | none |
| confirmer (model or human) | read | read | confirm validity | confirm assumptions | confirm, withdraw | read | none | read | none |
| namespace admin (Keycloak client) | all | all | all | all | all | all | admin only | all | all |

A human confirmer uses a normal Keycloak login and is listed by e-mail in the type's
`confirm_policy`. A model confirmer is a `confirmer` principal. KH treats the two the same way.

### 3.5 Event kinds that KH writes itself

The `kh.` prefix is reserved for KH: `kh.write_conflict`, `kh.stale_epoch`, `kh.lease_lost`,
`kh.duplicate`, `kh.quota`, `kh.served`, `kh.redacted`, `kh.canary_hit`, `kh.vault_read`,
`kh.item_rollback`, `kh.item_promoted`, `kh.ns_state`. These events go into the namespace's own event
store, so the consumer can learn from its own conflicts. Conflicts become experience, as the previous
draft required.

### 3.6 Quotas, retention, subscriptions and lifecycle

- **Quotas** (defaults, per namespace): 1,200 requests per minute per principal; 20,000 requests per minute per namespace; 5 M events per month; 2 M records; 10 GB of bodies. Rate limits use a token bucket per instance sized `limit / instance_count`. Reason: a database hit per request costs more than a ±1-bucket imprecision. Storage quotas are counted by a nightly cron. When a quota is exceeded, KH answers 429 with `Retry-After` and writes a `kh.quota` event.
- **Retention** is set per type: `retention_days` (default 365 for events, never for records and items). A purge cron under a lease deletes in batches of 5,000. Events older than retention are rolled up into `kh_event_week(ns, project, kind, week, n)` before they are deleted.
- **Subscriptions** use the outbox (4.12). Delivery is at least once, with an HMAC signature and a pull fallback.
- **Lifecycle:** `active` -> `suspended` (reads only; used for quota abuse) -> `detached` (all namespace routes answer 404; data kept for `grace_days`, default 30) -> `purged`. Section 6 walks through it.

## 4. Capabilities

### 4.1 Registry and discovery (`caps/registry.py`)

**Purpose:** attach and detach consumers and describe what is registered. **Data:** 3.2.
**Routes:** `PUT/GET/DELETE /v1/admin/ns/{ns}` (KH maintainer, or a project owner for the projects
they own); `PUT/GET /v1/{ns}/manifest`; `POST /v1/admin/ns/{ns}:detach`, `:reattach`, `:purge`,
`GET :export`, `POST /v1/admin/ns:import`; `GET /v1/capabilities`. **Rules:** a manifest apply is one
transaction with `If-Match`. **Generic use:** a consumer ships its manifest as a file in its own
repository and applies it on deploy. Applying the same manifest twice changes nothing.

### 4.2 Principals (`caps/principals.py`)

**Purpose:** gives every agent its own identity, a role, least privilege and an audit trail. **Data
and routes:** 3.4, plus `GET /v1/{ns}/principals?role=`, `PATCH /v1/{ns}/principals/{id}` (state
`revoked`), and `GET /v1/me`. **Rules:** at most 2,000 active principals per namespace; tokens last
15 minutes; a revoked principal is refused at the next request (the `kh_principal` state is cached
for 5 s). **Reuse:** the `app/auth.py` Principal object and the `auth_rules.json` route kinds.

### 4.3 Coordination (`caps/coord.py`)

**Purpose:** leases, fencing, idempotency and side-effect claims for any consumer. **Data:** 2.1-2.3.
**Routes:** `POST /v1/{ns}/leases/{name}:acquire {ttl_s}` -> `{epoch, until_ms}` or 409 `{holder, until_ms}`;
`:renew`; `:release`; `GET /v1/{ns}/leases?prefix=`; `POST /v1/{ns}/effects/{key}:claim|:complete|:fail`.
The `Idempotency-Key` header is accepted on every `/v1` POST, PUT and PATCH. **Rules:** a lease name is
≤ 200 characters and free-form, for example `unit/<id>`. Losing a lease writes `kh.lease_lost`.
**Reuse:** the same table serves KH's own crons (`ns='_kh'`) for feedback, messages, distil, purge,
outbox and principal refresh.

### 4.4 Event store (`caps/events.py`)

**Purpose:** a structured, append-only log of what agents and KH did.

**Data:** `kh_event(ns, seq, id, project, kind, ts_ms, received_ms, run_id, unit_id, session_id,
attempt, epoch, actor_json, schema_ver, ix_s1..ix_s4, ix_n1, ix_n2, body_json, PK(ns, seq))`, plus
unique `(ns, id)` and indexes `(ns, run_id)`, `(ns, kind, ts_ms)` and `(ns, unit_id)`.

- The envelope columns (run, unit, session, attempt, epoch) are generic orchestration coordinates. A namespace can mark any of them required per kind.
- Every other required field lives in the kind's JSON Schema with `required: [...]`. For the first consumer those are agent version, model snapshot, lesson ids and spec hash. KH has no knowledge of what they mean.
- `seq` comes from `kh_counter('ev:'+ns)` in the same transaction as the insert. The counter row lock makes commit order equal `seq` order, so a cursor reader never skips a row. Reason: IDENTITY columns can commit out of order.

**Routes:**

- `POST /v1/{ns}/events` takes one event or a batch of up to 500. The response is `{accepted:[{id, seq}], rejected:[{index, errors}]}`. A batch is all or nothing unless `?partial=true`.
- `GET /v1/{ns}/events?after_seq=&kind=&run_id=&unit_id=&limit≤1000`. A long poll waits up to 25 s.
- `GET /v1/{ns}/events/{id}`.
- `GET /v1/{ns}/events:stats?group_by=kind,ix_s1&since=` serves the counted-in-code layer, extending `/distill/patterns`.

**Rules:**

- Events are append only. There is no update or delete route; only the retention purge removes rows.
- An event missing a required field gets 422.
- A fenced kind needs a lease and an epoch (2.1).
- `id` is client-supplied (ULID) or generated, and a repeated `id` is a duplicate (200 with the original `seq`).
- Bodies pass through redaction (4.11) before they are stored.
- Throughput target: 200 events/s sustained and 1,000 events/s burst for 60 s on 3 instances.

### 4.5 Typed records (`caps/records.py`)

**Purpose:** structured rows that code writes, of any type the consumer registers. Uses include a
decision ledger, a guard registry, a human-baseline table or an assumption list.

**Data:** `kh_record(ns, type, id, project, schema_ver, rev, state, ix_*, body_json, actor_json,
created_ms, updated_ms, PK(ns, type, id))` and `kh_record_rev(ns, type, id, rev, body_json,
actor_json, at_ms, PK(ns, type, id, rev))`. Every revision is kept, so a ledger stays auditable after
later fields are filled in.

**Routes:**

- `PUT /v1/{ns}/records/{type}/{id}` creates (`If-None-Match: *`) or updates (`If-Match`).
- `PATCH` applies a JSON merge patch.
- `GET /v1/{ns}/records/{type}/{id}[?rev=]`.
- `POST /v1/{ns}/records/{type}:query {where:{ix_field: value|{gte,lte,in}}, order, limit≤500, decay:{field:"created_ms", half_life_days}, partition_by:"ix_s2"}` -> rows with `weight = 0.5^(age_days/half_life)`.

**Rules:** reads and writes follow the type's ACL. Records are immutable once their state is
`final`.

**Decision-ledger pattern (generic):** a type `decision` with index fields `case_kind`, `model_id`,
`model_version`, `attribution` and `scored`. Body fields: case features, options, chosen option,
expected outcome, scored outcome and attribution flag. Code writes the record, then later patches in
the scored outcome with If-Match. A query `where case_kind=X, model_version=V` with `half_life_days`
down-weights older decisions. Versioning per judge model is the `model_version` index field.

**Guard registry pattern:** a type with `write_roles:[admin]` and
`read_roles:[agent, judge, distiller]`. It is read-only to those roles by ACL, with no special code.

### 4.6 Rule graph (`caps/rules.py`)

**Purpose:** rules of the running system as
`(entity, attribute, condition, effect, source quote, validity)`, with multi-hop queries.

**Data:** the system of record is SQL, for If-Match and fencing:
`kh_rule(ns, project, rule_id, entity, attribute, condition, effect, quote_id, source_text, validity
unverified|verified|contradicted|retired, confidence, origin bootstrap|scan|write_back, run_id, rev,
updated_ms, PK(ns, rule_id))`, with a unique hash on `(ns, project, entity, attribute, condition,
effect)` for dedupe, and `kh_rule_link(ns, from_rule, relation, to_entity, PK(...))`.

The graph is a projection written after commit through `get_project_graph(<ns>__<project>)`: on Kuzu, a
per-(namespace, project) database; on HANA, the table prefix `KH_<NS>_`. The projection is node
`entity_type='rule'` in `KH_GRAPH_NODES` (attributes JSON holds the fields above), with edges
`APPLIES_TO`, `AFFECTS` and `DEPENDS_ON` in `KH_GRAPH_EDGES`, where `confidence` is the rule
confidence. `POST /v1/{ns}/rules:reproject` rebuilds the projection from SQL. Reason: Kuzu cannot take
part in a SQL transaction, so the rule that decides correctness stays in `sqldb`.

**Routes:**

- `PUT /v1/{ns}/rules/{id}` (If-Match).
- `POST /v1/{ns}/rules:bulk` takes up to 5,000 rules with `validity` defaulting to `unverified`, deduped by hash. This is the bootstrap route for rules a consumer extracted from legacy tests or code.
- `POST /v1/{ns}/rules:query {start_entities[], hops≤3, relations[], validity_in[], min_confidence}` calls `traverse_logic` (`app/graph_db/base.py:95`) with `max_hops = min(hops, 3)`.
- `POST /v1/{ns}/rules/scans {scan_id, project, entities_scanned[]}` -> `{coverage_any, coverage_verified}`, where coverage = entities with ≥ 1 rule (any or verified) / entities scanned. Each scan is stored in `kh_rule_scan`.
- `POST /v1/{ns}/rules:gate {run_id, entities[]}` -> `{pass, missing[]}`. It passes when every listed entity has a rule written or confirmed in that run.

**Rules:** a query p95 < 500 ms at 3 hops on 50k rules per project; entity names are normalized the
same way as entity cards (`app/entities.py`); moving validity to `verified` requires the type's
`confirm_policy`. **Generic use:** the consumer calls `:gate` as its own completion gate, and KH only
answers pass or fail.

### 4.7 Versioned document packs (`caps/packs.py`)

**Purpose:** versioned bundles of source documents, such as specifications, contracts or manuals,
with stable citations.

**Data:**

- `kh_pack(ns, pack_id, version, addendum, sha256, state draft|frozen|superseded, rev, PK(ns, pack_id, version, addendum))`. The version label is `vN.k`. `sha256` is computed over the normalized parts, sorted by path.
- `kh_pack_part(ns, pack_id, version, addendum, path, page, text_ref, sha256)`.
- `kh_quote(ns, quote_id, pack_id, version, path, page, offset, length, text, sha256)`, where `quote_id = path#page#offset`.
- `kh_quote_map(ns, old_quote_id, new_quote_id, pack_id, from_ver, to_ver)`. When a new version is frozen, KH re-anchors every quote whose exact text appears again.
- `kh_assumption(ns, pack_id, code, text, status open|confirmed|refuted|superseded, quote_id, rev)`. `code = ASSUMED-n`, where `n` comes from `kh_counter('asm:'+ns+':'+pack)`, so codes are never reused.
- Questions are records of the system type `kh.question`, with vectors in the collection `ns_<ns>_questions`.

**Routes:**

- `POST /v1/{ns}/packs/{id}/versions` uploads parts and returns the version and hash.
- `POST .../{ver}:freeze`, `POST .../addenda`.
- `GET /v1/{ns}/packs/{id}?version=`.
- `GET /v1/{ns}/quotes/{quote_id}` follows the quote map to the latest version.
- `POST/PATCH /v1/{ns}/packs/{id}/assumptions`.
- `POST /v1/{ns}/packs/{id}/questions:lookup {text}` -> `{duplicate_of, score}` when cosine ≥ 0.92, else stores the question and returns `{question_id}`.

**Rules:** frozen versions are immutable. Parts are chunked with `app/chunker.py` into vectors
carrying the metadata `ns, pack_id, version, quote_id`, so retrieval can cite quotes. The 0.92
duplicate threshold must be tuned on 200 labelled pairs to a precision of at least 0.95 before GA.

### 4.8 Knowledge-item lifecycle (`caps/items.py`)

**Purpose:** distilled items (lesson, fact, procedure, habit, pattern, policy_proposal) for a
namespace, with keys, provenance, TTL, staged scope, lint and automatic rollback.

**Data:** a SQL system of record is new for namespaces. Today `app/distill.py` items exist only as
vector rows, which cannot be updated conditionally.
`kh_item(ns, item_id, kind, keyspace, key_json, key_sha, project, scope project|cross, status
proposed|active|contested|superseded|withdrawn, text, provenance_json{runs[], event_ids[]},
evidence_count, support_projects_json, guard_names_json, guard_metric, metric_dir, expires_ms,
activated_ms, superseded_by, rev)`, with an index on `(ns, key_sha, status)`. The vector row
(collection `ns_<ns>_knowledge`) is a search index written after commit. Legacy people's items stay in
the vector store unchanged. The consumer's "unproven" status maps to KH `proposed`, documented in the
manifest docs.

**Routes:**

- `POST /v1/{ns}/items` proposes an item. It runs the distil schema, the leak gate, duplicate detection and contradiction detection from `app/distill.py` submit.
- `PATCH /v1/{ns}/items/{id}` changes status with If-Match. Confirm and withdraw follow `confirm_policy`.
- `GET /v1/{ns}/items?key=&status=`.
- `GET /v1/{ns}/items:patterns` returns counts per key and kind, computed in code.

**Rules:**

- **TTL.** A per-keyspace default of 90 days. An active item whose `expires_ms` passes without `last_confirmed` being refreshed moves to `withdrawn` with the reason `expired`.
- **Staged scope.** An item starts at `scope=project`. KH promotes it to `cross` when ≥ N distinct projects (N = 3 by default, configurable per keyspace) give independent support. Independent means evidence from different runs with different `on_behalf_of` or project. Each promotion writes `kh.item_promoted`.
- **Lint** runs before `active`. Text ≤ 400 characters. The first word must be on the imperative-verb list or start with "Never" or "Always". No hedges ("maybe", "might", "probably"). Every name in `guard_names` must exist in the namespace's guard type (4.5). A failure gets 422 with the list of lint errors.
- **Automatic rollback.** Each active item may name a `guard_metric` (4.10). Every 6 hours a cron compares the metric's success rate on units where the item was served (the `kh.served` join) against the 14 days before `activated_ms`. If both sides have n ≥ 30 and the result is worse by ≥ 10% relative with a two-proportion z-test p < 0.05, the item moves to `contested` and then `withdrawn` without a human. KH writes `kh.item_rollback` and notifies subscribers. Reason: fully automated, as the owner requires.
- **Who confirms** is the consumer's `confirm_policy`: `{roles:[confirmer], emails:[...], quorum:1, auto_after_evidence:k?}`. KH enforces the policy and adds no gate of its own. For the first consumer the owner chose a model confirmer (a `confirmer` principal backed by the strongest model) for inferred conflict causes, so no human gate sits in that flow.

**Findings and triggers (owner decision 2026-10-11).** Most valuable findings belong to one project:
its business rules, its systems and its people (for example: "when the service crashes in project X,
check first whether a member just ordered the child processes to be killed"). Generic findings, such as
a shell that fails in a certain way on Windows, are the minority. Items therefore carry two more fields:

- `trigger`: the situation in which the item is served, as values of a shared keyspace `situation`
  (`crash`, `tool_call:<tool>`, `deploy`, `test`, `step:<consumer value>`...). Retrieval serves an item
  when the caller's key or query names that situation, not on every turn.
- `bound`: `generic` (tool, OS, stack) or `project` (business, system or people). Only `generic` items
  may be promoted to `cross` by staged scope. A `project` item never leaves its project, never enters
  `lesson-learned`, and is readable only by members of that project.

Items about people use `bound: people` (project-bound like `project`) and follow three more rules: they
state what happened and its effect, never a judgement of the person; their TTL is capped at 90 days
whatever `ttl_days` says (enforced in code, `items.PEOPLE_TTL_DAYS`); and an item that stops being
supported by new evidence is withdrawn by the same expiry as other items.

### 4.9 Keyed retrieval (`caps/retrieval.py`)

**Purpose:** a per-step context pack for a key, within a character budget, with what was served logged.

**Route:** `POST /v1/{ns}/context/step {project, keyspace, key{...}, query?, situation?, budget_chars
(default 6000, max 20000), tiers?}` -> `{pack_text, served:[{tier, id, chars}], serve_id}`.

**People's side:** `POST /context/step` gains the tier `agents` (after `distilled`, behind
`KH_STEP_NS_ITEMS`, default off until the tier-2 bench passes): items of consumer namespaces attached to
the step's project whose trigger the step names (its `context` tag or a word of its text, e.g. "crash"),
then items close by meaning, at most `KH_STEP_NS_SHARE` (0.4) of the budget, each line prefixed with its
namespace. Every serve writes `kh.served` (lane `people`) into that namespace, so the rollback (D12) sees
people's use too.

**Worklog:** `POST /v1/{ns}/worklog {project, subject, text}` (roles orchestrator, agent, judge; area
`worklog: append`) writes one line into the project's own worklog lane, the one people's assistants read,
redacted first, author `ns:<ns>/<principal>`, id a hash of namespace, project and text (a replay writes
the same row). First use: a consumer with human questions switched off records every question its model
decided, with the options, the choice and the reason, so a person can check it later.

**Intake:** `POST /v1/{ns}/projects:match {text}` -> the literal project match of
`/orchestrator/project_match`, limited to the namespace's projects (or the owner's when the namespace is
unscoped) and the caller's grant, with each candidate's descriptor and aliases. The consumer's intake
agent reads it, together with KH knowledge, and decides itself whether work belongs to an existing
project or a new one (owner decision 2026-10-11); KH only answers.

**Rules:**

- The tiers come from `app/step.py`, in this order: entity cards; namespace items by exact `key_sha` (status active; scope project first, then cross); a wildcard match on the last key dimension; knowledge by meaning (floor 0.68, `step.py` default); rules for the named entities (4.6, 1 hop); packs (quotes); worklog.
- Every response writes one `kh.served` event with the run, unit and session headers and the served ids. The consumer copies `served[].id` into its own event as lesson ids.
- **The boundary is the project, not people versus agents** (D20, revised 2026-10-11). People reach KH through assistant CLIs with hooks, so they are semi-autonomous agents too; experience must flow both ways inside a project.
  - Shared both ways inside one project: findings, active items, worklogs and entity cards. A namespace pack for project X includes people's lanes of X; a person's `/context/step` for project X includes the namespace's active items and findings for X. Rows carry `actor_json`, so each served row says whether an agent or a person wrote it.
  - Not shared: raw namespace events, records, leases, metrics and the vault. They stay in the namespace and are read only through `/v1/{ns}/*`.
  - Volume guard: namespace rows may take at most 40% of a person's pack budget and people's rows at most 40% of a namespace pack budget (`settings.retrieval.cross_share`, default 0.4); `proposed` items rank below `active` ones and are labelled unverified.
  - Across projects: only `bound=generic` items promoted to `cross` (4.8).
  - `include_people_lanes` defaults to `true`; a namespace may set it to `false` to opt out.
- p95 < 2 s; key tier alone p95 < 150 ms.

### 4.10 Metrics and baselines (`caps/metrics.py`)

**Purpose:** outcome metrics and a human baseline, the inputs for rollback and for consumer
dashboards.

**Data:** `kh_metric(ns, project, series, ts_ms, value, unit_id, run_id, dims_json, is_baseline, PK(ns,
series, ts_ms, unit_id))` and `kh_metric_day(ns, project, series, day, n, sum, sumsq)` as a rollup.

**Routes:**

- `POST /v1/{ns}/metrics` (batch ≤ 1,000).
- `GET /v1/{ns}/metrics:aggregate?series=&group_by=&from=&to=`.
- `POST /v1/{ns}/metrics:compare {series, a:{filter}, b:{filter}}` -> `{n_a, n_b, mean_a, mean_b, rel_delta, p}`.

**Rules:** baselines are rows with `is_baseline=1` (a human or reference run), and the comparison
helper is the same one the item rollback uses.

### 4.11 Redaction (`caps/redact.py`)

**Purpose:** mask secrets and PII before anything is stored.

**Data:** `kh_redact_pack(pack_id, version, patterns_json, vectors_json, sha256)`. Each pattern is
`{name, regex, mode mask|refuse, kind secret|pii}`, and `vectors_json` holds conformance test
strings. The default pack `kh-default` is seeded from `config.DISTILL_LEAK_PATTERNS`, plus
high-entropy token detection (Shannon entropy ≥ 4.0 over ≥ 24 characters) and email/phone/IBAN
patterns.

**Routes:** `GET /v1/redaction/packs/{id}@{ver}` (any authenticated caller);
`PUT /v1/{ns}/redaction` selects the packs for a namespace (KH default plus the consumer's own);
`POST /v1/{ns}/redaction:scan {text}` -> `{masked, findings}`.

**Rules:**

- Masking runs on every `/v1` write path (event bodies, records, items, rules `source_text`, pack parts, metrics `dims_json`) before validation and storage. A masked value becomes `[REDACTED:<name>]`, and KH writes `kh.redacted` without the value.
- Mode `refuse` gets 422.
- The same scanner is guaranteed by data: the consumer's verifier gate loads the same pack version, and both sides must pass 100% of `vectors_json` in contract tests. Reason: KH cannot share code with a separate product, but it can share a versioned pattern pack.
- Legacy routes (`/vector/add`, worklogs, entities, messages, `/graph/add`) get masking behind `KH_REDACT_LEGACY` (on by default from F14 if the overhead is p95 < 2 ms).

### 4.12 Sealed vault (`caps/vault.py`)

**Purpose:** a holdout set that only graders can read, with leak detection.

**Data:** `kh_vault(ns, vault_id, refresh_days, rev)` and `kh_vault_item(ns, vault_id, item_id, version,
body_json, canaries_json, created_ms, refreshed_ms, rev)`. Vault rows are never embedded, never
projected into the graph, and never included in retrieval or search.

**Routes (grader or namespace admin only):** `PUT /v1/{ns}/vault/{vault}/items/{id}`;
`GET /v1/{ns}/vault/{vault}/items[?ids=]` (every read writes `kh.vault_read`);
`POST /v1/{ns}/vault/{vault}:refresh`.

**Rules:**

- **Canaries.** Each item gets ≥ 1 KH canary `khc-` plus 16 hex characters, and may add up to 20 custom strings of ≥ 12 characters. The canary scanner runs on every write in the namespace (the same hook as redaction): a regex for `khc-[0-9a-f]{16}` followed by a set lookup, plus a substring scan for custom strings. That is O(text) with no new dependency.
- **On a canary hit** KH still stores the write but masks the canary, writes `kh.canary_hit {vault, item, principal, run_id}` and pushes it to subscribers. Reason: the consumer decides whether the run is invalid, and refusing the write would hide the evidence.
- **Refresh.** Every `refresh_days` (default 30) the cron rotates canaries (retired canaries are still detected for 180 days) and writes a `vault.refresh_due` event so the consumer adds new holdout items. KH never invents holdout content.
- **Export.** Export leaves the vault out unless the namespace admin passes `include_vault=true`.

### 4.13 Subscriptions and outbox (`caps/outbox.py`)

**Purpose:** push events to the consumer without coupling KH to it.

**Data:** `kh_outbox(ns, delivery_id, sub_id, event_seq, attempts, next_ms, state
pending|claimed|done|dead, claim_token, claimed_until_ms, last_status, PK(ns, delivery_id))`.

**Rules:**

- Rows are written in the same transaction as a matching event.
- A worker on any instance claims up to 100 rows with `UPDATE ... SET state='claimed', claim_token=?, claimed_until_ms=:now+30000 WHERE state='pending' AND next_ms<=:now` (HANA: `UPDATE ... WHERE delivery_id IN (SELECT ... LIMIT 100)`; SQLite the same).
- Each delivery is a POST with `X-KH-Delivery`, `X-KH-Signature: sha256=HMAC(secret, body)` and a 10 s timeout.
- Retries back off exponentially from 1 s to 1 h. After 12 attempts the row is `dead`. Delivery is at least once, and the consumer dedupes by (`X-KH-Namespace`, `X-KH-Delivery`): a delivery id `<sub>:<seq>` is unique only within its namespace (the signed body carries both `ns` and `delivery_id`).
- Webhook URLs must be https, on a per-namespace host allowlist, and never resolve to a private or link-local address (SSRF guard).
- Pull fallback: `GET /v1/{ns}/events?after_seq=` with a long poll, so the consumer works without inbound reachability.

## 5. Mapping: consumer needs to KH capabilities

| # | Need (priority) | KH capability | Route(s) | Status |
|---|---|---|---|---|
| 1 | Structured append-only event store, required fields enforced (P0) | 4.4 events + registry kinds | `POST/GET /v1/{ns}/events` | new |
| 2 | Lease, fencing epoch, If-Match on every write (P0) | 2.1, 2.2, 4.3 | `/v1/{ns}/leases/*`, `X-KH-Epoch`, `If-Match` on all `/v1` writes | new; extends messages, feedback, projects_store, distill |
| 3 | Idempotency keys, side effects, outbox (P1) | 2.3, 4.3 effects, 4.13 | `Idempotency-Key`, `/effects/{key}:claim`, subscriptions | new |
| 4 | Rule graph, 3 hops, coverage, write-back gate, unverified bootstrap (P0) | 4.6 | `/rules`, `:bulk`, `:query`, `/scans`, `:gate` | extends `app/graph_db` |
| 5 | Versioned spec packs, addenda, assumptions, quote ids, duplicate questions (P0) | 4.7 | `/packs/*`, `/quotes/*`, `/assumptions`, `/questions:lookup` | new; reuses chunker and vectors |
| 6 | Judge decision ledger (P0) | 4.5 records, decision pattern | `/records/{type}`, `:query` with decay and partition | new |
| 7 | Lesson lifecycle: key, provenance, status, TTL, staged scope, lint, auto-rollback (P0) | 4.8 + 4.10 | `/items`, `:patterns`, rollback cron | extends `app/distill.py` |
| 8 | Keyed per-step retrieval with budget, served ids logged (P0) | 4.9 | `/v1/{ns}/context/step`, `kh.served` | extends `app/step.py` |
| 9 | Isolated holdout vault, canaries, refresh (P0) | 4.12 + 3.4 roles | `/vault/*` | new |
| 10 | Agent identities, role permissions, read-only guard registry (P1) | 3.4, 4.2, 4.5 guard pattern | `/principals`, type ACLs | new; extends `app/auth.py` |
| 11 | Secret/PII redaction, same scanner as the verifier (P0) | 4.11 | `/redaction/packs`, write-path hook | extends the leak gate |
| 12 | Outcome metrics and human baseline (P1) | 4.10 | `/metrics`, `:aggregate`, `:compare` | new |

## 6. Plug-in and plug-out walkthrough

### 6.1 Attach

1. A KH maintainer, or the owner of the target projects, calls `PUT /v1/admin/ns/c1 {projects, owner_email}`. KH creates the `kh_ns` row (state `active`) and asks the Keycloak `/kh` extension for the namespace client. The response holds the client id; the secret is delivered once through Keycloak.
2. The consumer calls `GET /v1/capabilities` and checks that each capability it needs is at its required minor version or later. If one is missing, the consumer starts in degraded mode.
3. The consumer calls `PUT /v1/{ns}/manifest` with its schemas, event kinds, keyspaces, record types and ACLs, retention, quotas, redaction packs, vaults and subscriptions.
4. The orchestrator creates principals per run and hands each agent a 15-minute token.

Target: attach to first accepted event < 60 s, with no KH redeploy or restart.

### 6.2 Run

Agents acquire leases per unit, write with epoch and If-Match, append events with idempotency keys,
call `/context/step` with their key, record decisions and metrics, and propose items. Graders read
the vault. KH writes `kh.*` events, and subscribers receive them through the outbox.

### 6.3 Detach, re-attach, export, import, purge

- **Detach** (`:detach`): one transaction sets the state to `detached` and does the following.
  - Every lease in the namespace gets `epoch=epoch+1, holder=NULL`, so any in-flight fenced write fails with `stale_epoch` even if it was already authorized.
  - All principals are set to `suspended`.
  - Pending outbox rows become `dead` with the reason `detached`.
  - The namespace client is disabled in Keycloak.
  - Within 5 s, every `/v1/{ns}/*` route answers 404 on every instance.
  - Data stays in place for `grace_days` (default 30). Idempotency rows expire normally. Crons skip detached namespaces.
- **Re-attach** within grace (`:reattach`) restores state `active`, re-enables the client and resumes leases at `epoch+1` (holders must acquire again). Principals stay suspended until the orchestrator re-creates them. Reason: their tokens and runs belong to the old session.
- **Export** (`GET /v1/admin/ns/{ns}:export`, namespace admin or KH maintainer, allowed in any state before `purged`) streams a zip containing:
  - `manifest.json` (schemas with versions);
  - one NDJSON file per table, filtered by `ns`;
  - the `_kh` event rollups;
  - `checksums.json` with sha256 per file.
  Vectors are exported as text plus metadata, not embeddings, and are re-embedded on import. The vault is included only with `include_vault=true`. Target: 1 GB in ≤ 10 min, streamed with no full copy in memory.
- **Import** (`POST /v1/admin/ns:import`) restores into a clean KH under the same or a new namespace id. Acceptance: row counts and checksums are equal.
- **Purge** runs after grace, or on `:purge` with a confirmation token from a prior `:export` or an explicit `force=true`. It deletes every row with that `ns` in batches, drops the Kuzu databases `<ns>__*` (or the HANA prefix tables) and the `ns_<ns>_*` collections, and writes `kh.ns_state` into the `_kh` audit namespace.

### 6.4 Degraded mode (contract expectations for the consumer)

The consumer keeps a KH port/adapter. KH's contract promises:

- an idempotent replay window of up to 7 days;
- client `ts_ms` accepted for out-of-order events (`received_ms` is stamped separately);
- answers with stable error codes: `stale_epoch`, `write_conflict`, `idempotency_mismatch`, `in_progress`, `quota`, `ns_not_active`.

The consumer is expected to:

- time out KH calls after 2 s;
- open a circuit after 3 consecutive failures;
- buffer events and metrics locally with their idempotency keys and replay them on recovery;
- serve the last retrieval packs it fetched;
- stop fenced writes while it cannot hold a lease (its own single-writer fallback is its own design).

## 7. Measurement and acceptance

1. **Load test** (`tools/kh_bench/scripts/loadtest.py`, new). It runs 100 simulated agents in one namespace, each with its own principal, on 3 instances (BTP, or 3 Docker containers on one HANA Express). The mix is: events (70%), leases with fenced writes, records with If-Match, retried writes with the same key, effect claims, message send and read, `/context/step`, 3-hop rule queries, two crons per instance, and one forced lease steal per minute.
   **Pass:** G1 and G2 numbers; every 409, duplicate and stale epoch has its `kh.*` event; counter totals are exact; 0 lost projects.
2. **Contract tests per capability** (`tests/caps/test_<module>.py`, run on SQLite in CI and on HANA Express in Docker before release). Each concurrency rule has a two-connection race test:
   - two acquires give one winner;
   - a stale epoch write is rejected;
   - If-Match races give one 409;
   - a duplicate idempotency key replays;
   - concurrent `seq` allocation is gapless and in commit order;
   - only one outbox claim succeeds;
   - two concurrent message receipts give one delivery.
   Schema validation, lint, rollback statistics (with a synthetic metric), quote re-anchoring and the duplicate-question threshold are covered as well.
3. **Isolation tests:**
   - roles agent, judge and distiller get 403 on every vault route and see 0 vault rows through retrieval, search, graph, records or export;
   - a principal of namespace A gets 404 or 403 on namespace B;
   - after a detach, every `/v1/{ns}` route answers 404 within 5 s on all instances;
   - a revoked principal is refused within 5 s;
   - 100% of planted canaries (KH-format and custom) are detected across all write paths;
   - the redaction conformance vectors pass 100%;
   - an owner who loses a project means the principals lose it within 10 min.
4. **Plug-out e2e:** attach, run 10 minutes of load, export, detach, check 404, import into a clean Docker KH, compare checksums, re-attach, and check that old epochs fail.
5. **e2e** 73/73 on each instance (existing suite).
6. **Tier-2 bench guard (G5):** the F build against prod. Fail if tokens or score are more than 2% worse.
7. **Learning signal:** after the first consumer week, `events:stats` shows `kh.*` counts per kind, and at least one automated rollback test fires on a synthetic regressing item in staging.

## 8. Build plan

Hours follow the KH standard (Claude Code at about 0.49 of a conventional estimate; small 2.4, medium
5.2, multi-round tuning 10.4, new tooling 16). Fixed cycle times are separate and not included: the
Keycloak extension release, BTP pushes, the HANA Express Docker refresh and review rounds.

| Slice | Content | Hours | Depends on |
|---|---|---|---|
| F1 | `sqldb` helpers (`now_ms_sql`, conditional update, `kh_counter`, `kh_schema_migration`); leases with epoch; message receipts and v2 fields; atomic feedback counters; per-row `projects_store`; conditional distil claim; crons under lease; race tests on both backends | 10.4 | - |
| F2 | `app/caps` package and `attach_all`; registry, manifest, JSON Schema validation, index fields, namespace state cache with 404, `/v1/capabilities`, `/v1/openapi.json` | 16.0 | F1 |
| F3 | principals: KH-signed tokens, `auth.py` and `auth_rules.json` `ns` kind, role matrix, owner-grant refresh cron; Keycloak `/kh` route for namespace clients | 16.0 | F2 (Keycloak repo) |
| F4 | event store with gapless `seq`, required fields, fencing hook, generic If-Match, `Idempotency-Key`, effects ledger, `kh.*` events | 10.4 | F1, F2 |
| F5 | redaction scanner, packs, conformance vectors, write-path hook, canary hook point | 7.6 | F2 |
| F6 | typed records with revisions, query with decay and partition, type ACLs (guard registry) | 7.6 | F3, F4 |
| F7 | `kh_item` lifecycle (keys, provenance, TTL, staged scope, lint, `confirm_policy`) plus namespace `/context/step` with `kh.served` | 15.6 | F4, F6 |
| F8 | metrics, baselines, `:compare`; automated rollback cron | 10.4 | F7 |
| F9 | rule graph: SQL system of record, Kuzu/HANA projection, `:bulk` bootstrap, 3-hop query, scans with coverage, `:gate` | 16.0 | F4 |
| F10 | packs: versions, addenda, hashes, quotes and re-anchoring, assumptions, duplicate-question lookup with threshold tuning | 10.4 | F4, F5 |
| F11 | sealed vault, canary generation, scan, rotation, `refresh_due` | 10.4 | F3, F5 |
| F12 | outbox, webhooks with HMAC and SSRF guard, long-poll pull | 10.4 | F4 |
| F13 | detach, re-attach, export, import, purge; retention purge and weekly rollups | 10.4 | F2-F12 |
| F14 | load test tool (16.0) plus 3 x 3 GB on BTP, isolation suite, e2e, tier-2 bench, tuning (10.4) | 26.4 | MVP slices |
| F15 | (2026-10-11, built on dev) D20 revised: item `bound` and `triggers` (migration 2), agent `propose`, proposed served and marked, people lanes on with `cross_share`, `situation`, people-side `agents` tier behind `KH_STEP_NS_ITEMS`, `projects:match` | 7.6 | F7 |
| F16 | (open) 3x load profile (2.5); tier-2 bench with `KH_STEP_NS_ITEMS=1` before it is turned on (the 90-day cap on `bound: people` items is done) | 7.6 | F15 |

**Total: 178.0 h** (about 22.3 build days).

**MVP cut (unblocks every P0 need of the first consumer):** F1, F2, F3, F4, F5, F6, F7, F8, F9, F10,
F11, plus F14 = **157.2 h**. F3 is in the MVP although identities are P1, because vault isolation (P0)
needs roles. F4 brings idempotency (P1) at almost no extra cost. A minimal detach (state and 404) ships
with F2. Recommended order: F1 -> F2 -> F4 -> F3 -> F5 -> F6 -> F7 -> F9 -> F10 -> F11 -> F8 -> F14.
After the MVP: F12 (the consumer uses the long-poll pull until then) and F13 (full export and import),
20.8 h.

## 9. Five lenses

| Lens | Trade-off |
|---|---|
| Security | Least privilege, with grants intersected with the owner's and refreshed every 10 min. Tokens last 15 min with per-principal revocation. The vault sits in separate tables with a role gate and is excluded from retrieval, graph and export; canaries make leaks visible. Redaction runs before storage. Webhooks are HMAC-signed, https-only and SSRF-guarded. Consumer bodies are untrusted data, never instructions. `actor_json` on every write. Risk: a namespace client secret leak exposes that namespace only, mitigated by Keycloak rotation and per-namespace quotas. |
| Licensing | New dependency: `jsonschema` (MIT). Already present: PyJWT (MIT), Keycloak (Apache-2.0), Chroma (Apache-2.0), Kuzu (MIT), HANA client (SAP developer license as today). No copyleft. Consumer data stays the consumer's own, exportable at any time. |
| Performance | Concurrency rules are single-row conditional writes. If-Match adds no extra read (the rowcount tells). Events are appends plus one counter-row update, and that counter row is the serialization point per namespace: measured target 200/s sustained, with sharding the counter per project as the fallback (`seq` then per (ns, project)). Validation uses cached compiled schemas. Retrieval keeps the 2 s budget, and the key tier is indexed SQL. |
| Scalability | Instance count is a `cf scale` number. All state is in the database, and every cron runs under a lease. Event volume is bounded by retention with weekly rollups. Per-namespace quotas cap noisy consumers. A second CF app from the same image is the escape hatch if the people guard trips. |
| Maintainability | One module per capability with its own migrations and contract tests. Every correctness rule is SQL in `app/sqldb.py`, tested on SQLite and HANA Express. No consumer names in code. Consumers change behaviour through manifests, not KH releases. Capability semver and `/v1` let KH evolve without breaking attached consumers. |

### Decisions log

| # | Decision | Reason |
|---|---|---|
| D1 | Consumers are namespaces configured by a declarative manifest; KH never loads consumer code | plug-in and plug-out without a redeploy, and no consumer code inside KH |
| D2 | One Keycloak confidential client per namespace; agents are KH service principals with 15-minute EdDSA tokens signed by KH | hundreds of short-lived agents should not live in Keycloak; KH-side rows are created and revoked instantly |
| D3 | Effective grants = principal ∩ namespace ∩ owner (`on_behalf_of`), refreshed every 10 min | grants are never wider than the owner's, and Keycloak stays the source of the people's grants |
| D4 | Every correctness rule is SQL in `app/sqldb.py` (conditional UPDATE, primary-key insert, counter row) using the database clock | works the same on SQLite and HANA, testable, independent of instances and their clocks |
| D5 | SQL is the system of record for rules and namespace items; the graph and vectors are projections rebuilt from SQL | Kuzu and the vector store cannot take part in conditional transactions |
| D6 | Index fields (≤ 8 typed columns per type) instead of JSON queries | HANA cannot filter NCLOB JSON fast; filtering in Python does not scale |
| D7 | Event `seq` from a counter row inside the insert transaction | commit order equals seq order, so cursor readers never skip rows |
| D8 | New routes only under `/v1`; legacy routes unchanged; breaking changes go to `/v2` with a 180-day overlap and Sunset headers | consumers get a stable contract, and people's CLIs keep working |
| D9 | The redaction "same scanner" is a shared, versioned pattern pack with conformance vectors | KH and the consumer are separate products and cannot share code, but they can share data |
| D10 | A canary hit stores the write masked and raises an event; it does not refuse | refusing would hide the evidence; the consumer decides what the run is worth |
| D11 | Confirmation is the consumer's `confirm_policy` (human e-mails or confirmer principals, quorum); KH adds no gate | full automation, with the decision owned by the consumer |
| D12 | Automatic rollback: n ≥ 30 per side, ≥ 10% relative worsening, two-proportion z-test p < 0.05, every 6 h | measurable and fast enough, while resistant to noise on small samples |
| D13 | Staged scope moves to cross-project at ≥ 3 independent projects (configurable per keyspace) | matches the consumer's rule while staying generic |
| D14 | Item TTL defaults to 90 days, refreshed by confirmation | removes stale lessons with no human sweep |
| D15 | Duplicate-question threshold cosine 0.92, tuned to precision ≥ 0.95 on 200 labelled pairs before GA | a false duplicate hides a real question, so precision comes first |
| D16 | Detach bumps every lease epoch and suspends principals; data is kept 30 days, then purged | in-flight writes fail safely, and re-attach stays possible |
| D17 | Export carries text and metadata, not embeddings; vault only on explicit opt-in | portable across embedder versions, and the vault stays sealed by default |
| D18 | Webhooks deliver at least once with HMAC and a long-poll pull fallback; at-most-once is not offered | exactly-once over HTTP is not achievable; consumers dedupe by delivery id |
| D19 | Agents and people share 3 instances in F; per-namespace quotas, with a second CF app only if the tier-2 guard trips | cheapest option that still protects people, with a measured trigger |
| D20 | (revised 2026-10-11) The boundary is the project. Inside one project, findings, active items, worklogs and entity cards are shared both ways between people and namespace agents, each side capped at 40% of the other's pack budget; raw events, records, metrics and the vault stay in the namespace. Only `generic` items cross projects | people use KH through assistant CLIs, so they are agents too; shared experience is KH's reason to exist; the cap keeps the original concern (agent rows crowding people's packs, see the 2026-10-10 bench where 3 off-topic items cut P2 from 1.0 to 0.4) |
| D21 | Per-instance token buckets sized limit / instance count for rate quotas | no database hit per request; the imprecision is bounded and harmless |
| D22 | Small per-module migration ledger instead of Alembic | the DDL for both backends is already handwritten; Alembic adds a dialect dependency |
| D23 | Masking (not only refusing) on all `/v1` writes; legacy routes behind `KH_REDACT_LEGACY`, on when overhead p95 < 2 ms | protects stored data without breaking people's flows unmeasured |
| D24 | KH does not extract rules from legacy tests or code itself; it offers `:bulk` with validity `unverified` and dedupe | extraction is language- and consumer-specific and belongs to the consumer |
| D25 | (2026-10-11) Items carry `bound` (`generic` or `project`, default `project`) and `triggers`; only `generic` items are promoted cross-project; a triggered item is served only in its situation | most valuable findings are project business, systems or people; a finding is useful at the moment its situation happens, not on every step |
| D26 | (2026-10-11) Agents may propose items (findings); they start `proposed` and are served after active ones, marked `[unverified]`; a confirmer (for the first consumer a model) activates them | agents write findings by policy after repeated failures, as people's assistants already do; marking keeps unconfirmed rows from passing as fact |
| D27 | (2026-10-11) Agents and people stay on one shared KH; scaling follows measured triggers (section 2.5), not a second server | shared experience is the product; the database-held state already allows N instances |
| D28 | (2026-10-11) Whether incoming work is an existing project or a new one is decided by the consumer's intake agent reading KH (`projects:match`, knowledge); KH adds no gate | the owner asked for one agent to decide; KH only answers. Service principals never create KH projects: a new project is created only when the consumer's process starts, by a real Keycloak account the consumer runs as (normal `POST /projects`, the same way a person asks their assistant to init a project), which then owns it and attaches it to the namespace (`PUT /v1/admin/ns/{ns}` projects). No new KH route is needed |

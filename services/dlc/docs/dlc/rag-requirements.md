# What the engine needs from a RAG system

The engine works **without** a RAG system (`LINE_RAG=off`): its SQLite store is the source of
truth and a local adapter answers every RAG call (retrieval returns nothing). A RAG system adds
shared memory across runs and people: a durable replica of the event log, records, frozen spec
versions, retrieval of lessons and findings for prompts, metrics, and a project worklog.

This page is the contract **from the engine's side**. Any RAG system that meets it can be plugged
in; nothing in the engine depends on a particular product.

## 1. Integration options

| Option | Effort | When |
|---|---|---|
| A. Speak the engine's HTTP wire protocol v1 (section 5) | server side | the RAG system can expose (or proxy) these routes |
| B. Put a small translating proxy in front of the RAG system that speaks protocol v1 to the engine | one small service on your side | the RAG system has a different API |
| C. No RAG system | none | `LINE_RAG=off` |

The engine's HTTP client always runs in resilient mode: degraded mode per capability and an outbox that
replays queued writes when the RAG system is back.

## 2. Capabilities

The engine discovers capabilities at start and per probe. **Each is optional**; a missing or
failing one degrades on its own while the others keep working.

| Capability | Engine operations | Used for | Priority |
|---|---|---|---|
| `events` | `append_events(batch, idem_key)`, `events_after(seq, limit)` | durable, ordered replica of every engine event | recommended |
| `retrieve` | `retrieve(role, step, stack, max_chars)`; `write_worklog(subject, text, idem_key)` | context for prompts (planner, builder, fixer, feature graph, decider); decision log in the project worklog | recommended |
| `packs` | `freeze_pack(files, idem_key) -> version` | immutable copy of each spec version | useful |
| `quote` | `quote(path, text, version) -> span or none` | remote check that a quote is literal in a frozen pack | optional (the engine also checks locally) |
| `records` | `put_record(type, id, body, if_match, idem_key) -> etag`, `get_record(type, id)` | mirror of run / unit / digest / test / graph rows (`LINE_RAG_RECORDS`), system rule graph, published lessons | optional |
| `leases` | `lease_acquire(name, ttl_s, owner)`, `lease_renew`, `lease_release` | cross-process lease authority (`LINE_RAG_LEASES`) | optional |
| `metrics` | `metric(name, value, dims)` | outcome metrics (`LINE_OBS`), per-unit metrics | optional |

`write_worklog` is counted under `retrieve` (same degrade switch).

## 3. Semantics the engine relies on

**Auth and tenancy**
- Client credentials: the engine exchanges `LINE_RAG_CLIENT_ID` / `LINE_RAG_CLIENT_SECRET` for a
  bearer token, refreshes it 90 s before expiry, retries once on an expired-token 401.
- **Namespace** (`rag_ns`, default `sdlc_line`; lower case, digits, `_`): all raw engine data
  (events, records, leases, packs, metrics) lives in it. One engine deployment = one namespace.
- **Project** (`project` in the wire config, default = namespace): the scope for packs, retrieval,
  worklog and metrics. Create it in the RAG system and grant the engine's client access **before**
  the first run; the engine never creates projects.
- The engine runs as one client identity. People who should see the worklog and findings are
  members of the project on the RAG side.

**Writes**
- Every write carries an idempotency key and is replayed with the **same** key after an outage.
  The RAG system must deduplicate by key for at least `idempotency_hours` (manifest, default 168).
- Event ids are `<run>-<seq>-<hash16>` (`[A-Za-z0-9_-]`, <= 64 chars) and must be deduplicated by
  id. Batch keys are `ev-<first>-<last>-<digest>`; two engine databases both start at seq 1.
- Events of one engine must be stored in the order sent and readable by `after_seq`.
- Records use optimistic concurrency: create with `If-None-Match: *`, update with
  `If-Match: <etag>`; answer the new etag. Update without a precondition may be refused (428).

**Leases** (only with `LINE_RAG_LEASES=1`)
- One live holder per name, a fencing epoch that only goes up, `lease_held` when taken,
  `lease_lost` / `stale_epoch` on renew with a stale epoch.
- The engine computes expiry from its **own** clock and never trusts the remote `until_ms`.
- If the RAG system names the holder after the calling identity, the engine separates its own
  owners itself.

**Retrieval**
- Keyed lookup: keyspace `step`, key `{role, step, stack}`, budget in characters; the answer is
  ready-to-insert text plus the ids that were served. Keys the engine asks for today:
  `(fgraph, understand)`, `(planner, plan)`, `(builder|fixer, build)`, `(decider, understand)`;
  `stack` is `python` (or `*`).
- Content is whatever the RAG system holds for that key (lessons, findings, guides). The engine
  treats it as advisory context, never as instructions that override its guards.

**Manifest** (apply once at setup, see [setup.md](setup.md#5-rag-system-optional))
- The engine ships a declarative manifest (applied with `dlc rag-manifest apply`): schemas, the closed list of
  event kinds (with required envelope `run_id` and body `agent_version`, `model`, `spec_hash`),
  record types `run unit digest test graph rules_graph lesson` (If-Match required), metric series,
  keyspace `step` with dims `role, step, stack`, idempotency retention. Applying it twice changes
  nothing.

## 4. Degraded mode (what happens when the RAG system is absent or down)

| Situation | Engine behaviour |
|---|---|
| `LINE_RAG=off` | local adapter: packs and quotes local, retrieval empty, worklog kept in events only, leases local |
| capability missing at discovery | that capability is degraded from the start; others work |
| call fails (transport, 5xx, 423, 429, auth, route absent) | capability degraded, `rag.degraded {capability, error}` event |
| writes while degraded | queued in the store outbox with their idempotency key; later writes of the same capability queue behind them (order kept) |
| reads while degraded | `retrieve` -> empty; `get_record`, `events_after`, `quote` -> local answers |
| recovery | probe every 30 s while degraded; outbox replayed in order with the same keys; `rag.restored {capability, replayed}` |
| leases during an outage | a run admitted with remote lease authority keeps it: no new dispatch, renew holds until the local expiry, then `LEASE_LOST` (no silent switch to local fencing). Runs admitted while leases were down use local leases for their whole life. |

A run never fails because the RAG system is down. Verified in dry chaos tests and in a live outage
test (all queued events delivered, gapless).

## 5. HTTP wire protocol v1 (option A)

Base URL `rag_url`; `{ns}` = namespace. Paths for token and capabilities are configurable
(`token_path`, `capabilities_path`), capability names can be remapped (`capability_map`), header
names too (`header_run`, `header_unit`, `header_attempt`, `header_lease`, `header_epoch`; defaults
`X-Line-Run`, `X-Line-Unit`, `X-Line-Attempt`, `X-Line-Lease`, `X-Line-Epoch`).

| Method and path | Body / query | Answer |
|---|---|---|
| `POST /v1/token` | `{grant_type: "client_credentials", client_id, client_secret}` | `{access_token, expires_in}` |
| `GET /v1/capabilities` | | `{capabilities: [{name, version, status}], version?}`; `status: "off"` = absent |
| `GET` / `PUT /v1/{ns}/manifest` | manifest document; `If-Match` on update | 200 + `ETag`; 404 when none yet |
| `POST /v1/{ns}/events` | `{events: [{id, kind, project, run_id, unit_id, attempt, epoch, ts_ms, body}]}` | `{accepted: [{id, seq}], rejected}`; header `Idempotent-Replay: true` on a replay |
| `GET /v1/{ns}/events?after_seq=&limit=` | | `{events: [...], next_after_seq}` |
| `POST /v1/{ns}/leases/{name}:acquire` | `{ttl_s, owner}` | `{epoch, until_ms}`; 409 `lease_held` |
| `POST /v1/{ns}/leases/{name}:renew` | `{epoch, ttl_s}` | `{epoch, until_ms}`; 409 `lease_lost` / `stale_epoch` |
| `POST /v1/{ns}/leases/{name}:release` | `{epoch}` | 200 (404/409 tolerated) |
| `PUT /v1/{ns}/records/{type}/{id}?project=` | record body; `If-None-Match: *` or `If-Match`; optional lease headers | `ETag` (or `{rev}`); 409 `write_conflict` / 412 / 428 |
| `GET /v1/{ns}/records/{type}/{id}` | | `{body}` or the body itself + `ETag`; 404 with JSON error = absent |
| `POST /v1/{ns}/packs/{pack}/versions` | `{project, parts: [{path, page, text}], freeze: true}` | `{version, state}` |
| `POST /v1/{ns}/packs/{pack}/versions/{v}:freeze` | `{}` | only when the create did not freeze |
| `POST /v1/{ns}/packs/{pack}/quotes` | `{version?, path, text}` | `{quote_id, version?}`; 404/422 = no match |
| `GET /v1/{ns}/packs/{pack}?version=&text=true` | | `{parts: [{path, text}]}` |
| `POST /v1/{ns}/context/step` | `{project, keyspace, key: {role, step, stack}, budget_chars}` | `{pack_text, serve_id, served: [{id}]}` |
| `POST /v1/{ns}/worklog` | `{project, subject, text}` | `{id}` |
| `POST /v1/{ns}/metrics` | `{observations: [{series, value, dims, project, run_id?, unit_id?, ts_ms?}]}` | 200 |

Every `POST`/`PUT` carries `Idempotency-Key`. `{pack}` = `pack_id` (default `spec`).

Error mapping the engine applies:

| Answer | Engine code |
|---|---|
| transport error, 5xx, 423, 429, auth failure, 404 without a JSON error body (route absent) | `RAG_DEGRADED` (capability degraded, writes queued) |
| 409 `stale_epoch` / `lease_lost` | `LEASE_LOST` |
| 409 `write_conflict`, 412 | `VERSION_CONFLICT` |
| 409 `duplicate`, 428 | `PRECONDITION_REQUIRED` |
| 400, 413, 422 (`errors` / `rejected[].errors` with pointer + message) | `SCHEMA_INVALID` |

Check a connection end to end: start the engine with `LINE_RAG=http`, run `dlc rag-manifest apply`, then a
short real run; the board shows `rag.degraded` / `rag.restored` events if the connection drops.

## 6. Data the engine sends (for the RAG side's privacy review)

Spec text (frozen packs), event bodies (states, codes, failure evidence such as failing test ids
and short error excerpts), mirrored rows (digests with spec quotes, test metadata, unit graph),
decisions with reasons, lessons, metrics. The engine never sends credentials; builders run with a
scrubbed environment and the verifier blocks diffs that add secret-like lines. Optional
server-side redaction: list redaction pack ids in `redaction_packs` (wire config); they go into the
manifest.

## 7. Checklist for a RAG system owner

1. Expose the capabilities you support (section 2), at least `events` and `retrieve` recommended.
2. Create the namespace and a client-credentials client for the engine.
3. Create the project, give the engine's client write access and add the people who read the
   worklog.
4. Hand the engine operator: base URL, namespace, project id, client id and secret.
5. Operator applies the manifest (`dlc rag-manifest apply`) and checks one run end to end.

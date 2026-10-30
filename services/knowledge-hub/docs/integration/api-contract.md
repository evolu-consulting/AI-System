# API contract (`/v1`)

Conventions used below:

- `$KH` is the KH base URL, `$NS` your namespace, `$TOKEN` a bearer token ([auth-and-tenancy.md](auth-and-tenancy.md)).
- All bodies are JSON (`Content-Type: application/json`), UTF-8. Times are epoch milliseconds (`*_ms`).
- Every `/v1/{ns}/...` call needs `Authorization: Bearer $TOKEN`. "Role" means the minimum role from the
  role matrix; admin always passes.
- Full machine-readable schemas: `GET $KH/v1/openapi.json`.

## Cross-cutting rules

### Errors

Capability errors have the body `{"error": "<code>", "detail": "<text>", ...extra}`. Validation errors add
`errors: [{pointer, message}]` (JSON Pointer into your body). Codes are stable:

| Code | Status | When | Retry? |
|---|---|---|---|
| `invalid` | 422 | malformed input (bad id, missing field, wrong type) | no, fix the request |
| `validation_failed` | 422 | body does not match the manifest's JSON Schema | no |
| `invalid_manifest` | 422 | manifest refused (`errors` lists each problem) | no |
| `too_large` | 413 | batch or body over the limit | no, split |
| `idempotency_mismatch` | 422 | same Idempotency-Key, different request | no, new key |
| `unauthorized` | 401 | bad / expired token, disabled client, revoked principal | refresh once |
| `forbidden` | 403 | role, ACL, project grant or namespace mismatch | no |
| `not_found` | 404 | the object does not exist (an unknown route answers 404 without `error`) | no |
| `ns_not_active` | 404 | namespace detached / purged / unknown | degraded mode |
| `ns_suspended` | 423 | namespace is read-only | buffer writes |
| `precondition_required` | 428 | If-Match required by the type / manifest exists; fenced write without lease headers | add the header |
| `write_conflict` | 409 | If-Match revision is stale (`current` + `ETag` returned) | re-read, merge, retry |
| `stale_epoch` | 409 | the lease is no longer held at your epoch (`lease`, `epoch`, `current_epoch`) | stop this unit's writes |
| `lease_held` | 409 | someone else holds the lease (`holder`, `until_ms`) | wait / pick other work |
| `lease_lost` | 409 | renew failed: the lease expired or was taken | stop, re-acquire |
| `duplicate` | 409 | create-only target exists (`ETag` of the existing row) | read it instead |
| `in_progress` | 409 | the first request with this Idempotency-Key is still running (`Retry-After: 1`) | wait, retry same key |
| `effect_claimed` | 409 | side effect already claimed / done (`effect` state) | read the result |
| `record_final` | 409 | the record's state is `final` (immutable) | no |
| `pack_immutable` | 409 | the pack version is frozen | create an addendum |
| `schema_immutable`, `type_in_use` | 409 | manifest tried to change a schema version / remove a used type | bump the schema version / `?archive=true` |
| `quota` | 429 | rate quota exceeded (`Retry-After`, `quota`) | back off |
| `approval_required` | 428 | effect key needs a human approval first | wait for approval |
| `embedder_unavailable`, `provisioner_unavailable` | 503 | KH dependency down | retry later |

Other codes exist for optional capabilities (`redaction_refused`, `leak_refused`, `lint_failed`,
`invalid_transition`, `version_order`, `assumption_final`, `vault_not_declared`, `canary_conflict`,
`unsafe_target`, `secret_external`). Treat any unknown 4xx code as "do not retry blindly".

### Idempotency (`Idempotency-Key`)

Send it on every POST / PUT / PATCH (max 255 chars). Scope: (namespace, calling principal, key).

- First call runs; its response (2xx, 400, 403, 404, 413, 422) is stored.
- Same key + same method/path/query/body: the stored response is replayed with header `Idempotent-Replay: true`
  (and KH writes a `kh.duplicate` event).
- Same key while the first call still runs: `409 in_progress`, `Retry-After: 1`. A pending key older than 60 s is
  taken over.
- Same key, different request: `422 idempotency_mismatch`.
- 409 / 423 / 428 / 429 / 5xx are **not** stored: the key is freed so a retry can succeed.
- Retention: 24 h by default, up to 168 h via manifest `retention.idempotency_hours`. Set it at least as long as
  your longest offline buffering window.
- Build keys deterministically from your own data (for example `ev-<first>-<last>-<hash of ids>`), so a replay
  after a crash reuses the same key.

### Revisions (ETag / If-Match)

Writable objects have an integer `rev`; responses carry `ETag: "<rev>"`. `If-Match: "<rev>"` makes an update
conditional (409 `write_conflict` on mismatch); `If-None-Match: *` makes a PUT create-only (409 `duplicate`
if it exists). A type with `require_if_match: true` refuses updates without If-Match (428).

### Fencing

Send `X-KH-Lease: <lease name>` + `X-KH-Epoch: <epoch>` on a write to make it valid only while you still hold
that lease at that epoch. KH checks it inside the write transaction: a stale writer gets `409 stale_epoch` and
nothing is stored. A type with `fenced: true` requires the headers (428 without them).

### Rate limits

Token bucket per KH instance: 1,200 requests/min per principal and 20,000 requests/min per namespace by default
(manifest `quotas` override by the same names `requests_per_min_principal` / `requests_per_min_ns`).
Exceeded: `429 quota` with `Retry-After` seconds.

## Discovery

### `GET /v1/capabilities` (any authenticated caller)

```json
{"kh_version": "...", "api_versions": ["v1"],
 "capabilities": [{"name": "events", "version": "1.0.0", "status": "beta",
                   "limits": {"batch_max": 500, "body_bytes": 262144, "read_limit": 1000, "long_poll_s": 25}}, ...]}
```

Capability names: `registry, coord, events, principals, records, rules, redact, items, retrieval, vault,
packs, metrics, outbox, lifecycle` (plus deployment-specific ones that are off by default). Check every name
you need at startup; a missing one means that feature runs degraded on your side.

### `GET /v1/me`

`{kind: person|client|service|local, ns?, principal, role, on_behalf_of?, projects?}`.

## Namespace and manifest

### `PUT /v1/admin/ns/{ns}` / `GET /v1/admin/ns/{ns}` / `GET /v1/admin/ns`

Person only (see auth). Row: `{ns, display, state, owner_email, projects, config, manifest_rev, created_ms,
detached_ms, purge_after_ms, rev}`. States: `active`, `suspended`, `detached`, `purged`.

State changes (person): `POST /v1/admin/ns/{ns}:suspend | :resume | :detach | :reattach`
(`DELETE /v1/admin/ns/{ns}` = detach).

### `PUT /v1/{ns}/manifest` (admin) / `GET /v1/{ns}/manifest`

Applied in one transaction. Re-applying an identical document returns `changed: false` and touches nothing.
Once a manifest exists, `PUT` needs `If-Match` with the manifest ETag (from GET); `If-Match: *` = apply
regardless. `?archive=true` allows removing a type that still has rows.

```
GET  -> 200 {"ns": "...", "manifest_rev": 3, "manifest": {...}}   ETag: "3"   (manifest_rev 0 = none yet)
PUT  -> 200 {"ns": "...", "changed": true, "manifest_rev": 4, "sha256": "...", "types": 42, ...}
```

Manifest sections (unknown top-level keys are refused):

| Key | Shape | Notes |
|---|---|---|
| `manifest_version`, `consumer`, `description` | any | stored as given |
| `schemas` | `[{name, version, schema}]` | JSON Schema 2020-12, <= 64 KB each; a (name, version) is immutable |
| `types` | `[{type, kind_of, schema?, schema_version?, index_fields?, read_roles?, write_roles?, fenced?, require_if_match?, retention_days?, confirm_policy?, required_envelope?}]` | <= 200 types; `kind_of`: `record` (default), `event`, `item`, `metric`; `type` matches `[a-z][a-z0-9_.-]{0,127}`, `kh.` reserved |
| `keyspaces` | `[{keyspace, dims: [1-8 names], config?}]` | keys for keyed retrieval and items |
| `quotas` | `[{name, limit, window_s}]` | rate quota overrides |
| `retention` | object | `idempotency_hours` (<= 168), `events_days`, `grace_days` |
| `redaction` | `{packs: ["id" \| "id@ver"]}` | redaction pattern packs |
| `vaults` | `[{vault_id, refresh_days?, retire_days?, fenced?, project?}]` | sealed holdout sets |
| `subscriptions` | `[{sub_id, kinds: [...], url: "https://...", secret_ref?, state?}]` | webhooks; `kinds` exact, `prefix.*` or `*` |
| `settings` | object | per-capability policy, e.g. `retrieval`, `items`, `metrics`, `packs`, `rules`, `effects`, `webhook_hosts`, `include_people_lanes` |

`index_fields`: `{field: "s" | "n" | "t"}` (string / number / time), <= 8 per type; events allow `s` and `n`
only. They are the only fields you can filter on in queries. `required_envelope` is a subset of
`run_id, unit_id, session_id, attempt, epoch`. Events default to `retention_days: 365`; records keep forever.

Minimal example:

```json
{
  "manifest_version": 1,
  "schemas": [{"name": "evt", "version": 1, "schema": {"type": "object", "required": ["agent_version"]}},
              {"name": "doc", "version": 1, "schema": {"type": "object"}}],
  "types": [
    {"type": "run.started", "kind_of": "event", "schema": "evt", "required_envelope": ["run_id"],
     "index_fields": {"agent_version": "s"}},
    {"type": "unit", "kind_of": "record", "schema": "doc", "require_if_match": true,
     "index_fields": {"run": "s", "state": "s"}},
    {"type": "unit_attempts", "kind_of": "metric"}
  ],
  "keyspaces": [{"keyspace": "step", "dims": ["role", "step", "stack"]}],
  "retention": {"idempotency_hours": 168},
  "settings": {"include_people_lanes": false}
}
```

## Events

### `POST /v1/{ns}/events` (role: append)

Body: one event, or `{"events": [...]}` (<= 500). All-or-nothing unless `?partial=true`.

```json
{"id": "r42-17-9f2c1a0b3d4e5f60", "kind": "run.started", "project": "<p>", "ts_ms": 1760000000000,
 "run_id": "r42", "unit_id": "u7", "session_id": null, "attempt": 1, "epoch": 3,
 "body": {"agent_version": "1.4.0"}}
```

- `kind` must be an event type in the manifest; `kh.*` is KH's own.
- `id` optional, `[A-Za-z0-9_-]{1,64}`; a repeated id is a duplicate (no new row, original `seq` returned). Make
  ids deterministic and unique across all your writers.
- Envelope fields default from `X-KH-Run/Unit/Session/Attempt`; `epoch` from `X-KH-Epoch`. `project` may be
  omitted when the namespace has exactly one project. `ts_ms` is your clock (out-of-order is fine);
  `received_ms` is KH's.
- Body <= 256 KB, validated against the type's schema, passed through redaction first.

```
200 {"accepted": [{"index": 0, "id": "...", "seq": 1042, "duplicate": false}], "rejected": []}
422 {"error": "validation_failed", "detail": "no event was stored ...", "accepted": [],
     "rejected": [{"index": 0, "errors": [{"pointer": "/body/agent_version", "message": "..."}]}]}
```

### `GET /v1/{ns}/events?after_seq=&kind=&run_id=&unit_id=&limit=&wait_s=` (role: read)

`kind` comma-separated; `limit` 1-1000 (default 100); `wait_s` <= 25 long poll.
`200 {"events": [{seq, id, project, kind, ts_ms, received_ms, run_id, unit_id, session_id, attempt, epoch,
schema_ver, actor, body}], "next_after_seq": n}`.

Ordering guarantee: `seq` is gapless per namespace and commits in order, so a cursor reader using
`after_seq = next_after_seq` never skips an event. Kinds hidden by a type ACL are filtered out.

Also: `GET /v1/{ns}/events/{id}`, `GET /v1/{ns}/events:stats?group_by=kind[,run_id,...]&since=`.

## Records

| Route | Notes |
|---|---|
| `PUT /v1/{ns}/records/{type}/{id}?project=&state=` | create (`If-None-Match: *`) -> 201; update (`If-Match`) -> 200; neither = upsert (refused when the type requires If-Match) |
| `PATCH /v1/{ns}/records/{type}/{id}?state=` | JSON merge patch (RFC 7386) on the current body |
| `GET /v1/{ns}/records/{type}/{id}[?rev=]` | current record or one stored revision |
| `GET /v1/{ns}/records/{type}/{id}:revisions` | audit trail, <= 1000 |
| `POST /v1/{ns}/records/{type}:query` | filter on index fields |

- `id`: `[A-Za-z0-9_.-]{1,128}`; `state`: `[a-z][a-z0-9_]{0,31}`, default `open`; `final` makes the record
  immutable. Body <= 256 KB, validated by the type schema. A record's project cannot change.
- Response: `{type, id, rev, state, schema_ver, body, actor, project, created_ms, updated_ms}` + `ETag`.
- Query body: `{where: {field: value | {eq, ne, gt, gte, lt, lte, in}}, project?, state?, order?: "-field" | [..],
  limit? (<= 500), offset?, decay?: {field, half_life_days}, partition_by?, per_partition?}`.

## Leases and side effects

```
POST /v1/{ns}/leases/{name}:acquire  {"ttl_s": 30}            -> 200 {"name", "epoch", "until_ms"} | 409 lease_held {holder, until_ms}
POST /v1/{ns}/leases/{name}:renew    {"epoch": 3, "ttl_s": 30} -> 200 {"name", "epoch", "until_ms"} | 409 lease_lost
POST /v1/{ns}/leases/{name}:release  {"epoch": 3}             -> 200 {"name", "released": true|false}
GET  /v1/{ns}/leases?prefix=   GET /v1/{ns}/leases/{name}
```

- Name: 1-200 chars, slashes allowed (`unit/42`). `ttl_s` 5-300 (default 30).
- **The holder is the calling identity** (principal), not a value in the body. The same identity acquiring a
  lease it holds just extends it (same epoch). A different identity taking a free or expired lease bumps the
  epoch, which fences every in-flight write of the old holder.
- Detach and re-attach bump every epoch of the namespace.

Side-effect ledger (exactly-once external actions):

```
POST /v1/{ns}/effects/{key}:claim    {"ttl_s": 300} -> 201 {key, holder, state: "claimed", ...} | 409 effect_claimed {effect}
POST /v1/{ns}/effects/{key}:complete {"result": {...}}   POST /v1/{ns}/effects/{key}:fail {"error": "..."}
GET  /v1/{ns}/effects/{key}
```

An expired claim or a failed effect can be claimed again (`attempts` increments). Keys under configured
high-risk prefixes (manifest `settings.effects`) return 428 `approval_required` until a listed human approves via
`:approve {decision: approve|reject, note?}`.

## Retrieval

### `POST /v1/{ns}/context/step` (role: retrieval read)

```json
{"project": "<p>", "keyspace": "step", "key": {"role": "builder", "step": "implement", "stack": "python,react"},
 "query": "optional free text, <= 4000 chars", "budget_chars": 6000,
 "tiers": ["entity", "key", "key-wildcard", "meaning", "rules", "packs", "log"],
 "entities": ["optional names, <= 20"], "limit": 10, "situation": "optional, e.g. crash"}
```

- `key`: object or `"dim=value;dim=value"`; a missing dimension means `*`. Values 1-128 printable chars.
- `budget_chars` 200-20000 (default 6000); `limit` per tier 1-50 (default 10).
- Tiers are packed in that order until the budget is used: entity cards, items with the exact key, items whose
  last dimension is `*`, items by meaning (score floor configurable in `settings.retrieval.floor`), rules of the
  named entities (1 hop), pack quotes, the project worklog.

```json
{"serve_id": "sv_...", "project": "<p>", "keyspace": "step", "key": {...}, "key_sha": "...",
 "pack_text": "ready-to-prompt text", "served": [{"tier": "key", "id": "...", "chars": 312}],
 "item_ids": ["..."], "items": [...], "tiers": ["key", "meaning"], "budget_chars": 6000, "used_chars": 4810,
 "cut_at_budget": false, "dropped": [{"tier": "log", "id": "...", "reason": "..."}], "people_lanes": false,
 "failed_tiers": ["..."]}
```

Every call writes one `kh.served` event (serve_id, key, served ids, run/unit from your headers). Copy
`serve_id` / `item_ids` into your own outcome events so results can be traced to the knowledge used.
`failed_tiers` appears only when a tier provider failed; the rest of the pack is still valid.

People's knowledge of the same project (entity cards, knowledge, worklog) is included unless the manifest sets
`settings.include_people_lanes: false` (or `settings.retrieval.include_people_lanes`); it takes at most 40 % of
the budget by default (`cross_share`).

### `POST /v1/{ns}/worklog` (role: worklog append)

`{"project": "<p>", "subject": "1-128 chars", "text": "<= 4000 chars"}` -> `{id, project, subject, ts}`.
A line in the project's worklog that people of the project read too. Write in English. The id is a hash of
namespace, project and text, so a replay writes the same row. Needs the embedder (503 otherwise).

### `POST /v1/{ns}/projects:match` (role: retrieval read)

`{"text": "<= 4000 chars"}` -> candidate KH projects of the namespace with their descriptors and aliases, so
your intake can decide where a piece of work belongs. KH only answers; your engine decides.

## Items (lessons)

| Route | Notes |
|---|---|
| `POST /v1/{ns}/items` | propose: `{kind, project, keyspace, key, text, title?, attrs?, guard_names?, guard_metric?, metric_dir?, ttl_days?, triggers?, bound?, updates?, contradicts?, provenance?: {runs, event_ids}}` |
| `GET /v1/{ns}/items?keyspace=&key=&status=&kind=&project=&scope=&limit=&offset=` | list |
| `GET /v1/{ns}/items/{id}`, `PATCH /v1/{ns}/items/{id}` | read; status change `{status, reason?, superseded_by?}` with If-Match |
| `POST /v1/{ns}/items/{id}:support` | independent support from another project / run |
| `POST /v1/{ns}/items:lint` | dry-run lint `{text, guard_names?}` |

Status: `proposed -> active | contested | superseded | withdrawn`. Who confirms is the item type's
`confirm_policy` `{roles, emails, quorum, auto_after_evidence}`. Active items expire after `ttl_days` (default 90).
An item proposed in one project becomes cross-project after support from 3 distinct projects (configurable).
Before activation, text is linted (<= 400 chars, starts with an imperative verb or Never / Always, no hedges).
Retrieval serves `active` items first and `proposed` ones marked `[unverified]` (`settings.retrieval.serve_proposed`).

## Packs (source documents)

| Route | Notes |
|---|---|
| `POST /v1/{ns}/packs/{pack}/versions` | `{project?, title?, base?, parts: [{path, page?, text}], remove?, freeze?}` -> 201 `{pack_id, version: "vN.0", sha256, state, ...}` |
| `POST /v1/{ns}/packs/{pack}/versions/{ver}:freeze` | freeze a draft (immutable afterwards) |
| `POST /v1/{ns}/packs/{pack}/versions/{ver}/addenda` | `vN.(k+1)` over a frozen version |
| `GET /v1/{ns}/packs/{pack}?version=vN.k\|latest&text=true` | parts, optionally with text |
| `POST /v1/{ns}/packs/{pack}/quotes` | `{version?, path, page?, offset?, length?, text?}` -> `{quote_id: "path#page#offset", ...}` |
| `GET /v1/{ns}/quotes/{quote_id}` | follows re-anchoring to the latest version |
| `/v1/{ns}/packs/{pack}/assumptions`, `/questions`, `/questions:lookup` | `ASSUMED-n` codes; duplicate-question detection |

Pack id `[A-Za-z0-9_.-]{1,64}`; <= 2000 parts, 512 K chars per part. Quotes are only taken from frozen
versions; freezing re-anchors quotes of the previous version.

## Rules (rule graph)

`PUT/GET /v1/{ns}/rules/{id}`, `GET /v1/{ns}/rules?project=&entity=&attribute=&validity=`,
`POST /v1/{ns}/rules:bulk` (<= 5000), `POST /v1/{ns}/rules:query {project, start_entities, hops <= 3, ...}`
(returns rules, edges, conflict pairs), `POST /v1/{ns}/rules/{id}:confirm`, `POST /v1/{ns}/rules/scans`,
`POST /v1/{ns}/rules:gate {run_id, project, entities}` -> `{pass, missing, orphans}`. A rule is
`(entity, attribute, condition, effect, source quote, validity)`.

## Metrics

`POST /v1/{ns}/metrics` `{"observations": [{series, value, ts_ms?, unit_id?, run_id?, project?, dims?, baseline?}]}`
(<= 1000) -> `{accepted: [{index, series, ts_ms, unit_id, status: created|duplicate|conflict}], created,
duplicates, conflicts}`. Series must be manifest types with `kind_of: metric`. Primary key
`(series, ts_ms, unit_id)`: the first write wins. Reads: `GET /v1/{ns}/metrics`, `GET /v1/{ns}/metrics:aggregate`,
`POST /v1/{ns}/metrics:compare` (two-proportion z-test or Mann-Whitney).

## Subscriptions (webhooks and pull)

Declared in the manifest. Delivery is at least once:

```
POST <your https url>
X-KH-Delivery: <sub_id>:<seq>   X-KH-Namespace: <ns>   X-KH-Subscription: <sub_id>
X-KH-Event-Seq: <seq>   X-KH-Timestamp: <epoch ms>
X-KH-Signature: sha256=<hex HMAC-SHA256(secret, "<timestamp>." + raw body)>
{"delivery_id": "...", "ns": "...", "sub_id": "...", "event": {...same shape as GET events...}}
```

Answer 2xx to acknowledge; otherwise KH retries (1 s, 2 s, 4 s ... capped at 1 h, 12 attempts, then `dead`).
Dedupe on `(ns, delivery_id)`. Verify the signature and reject old timestamps. Targets must be https and
publicly routable (optional host allowlist `settings.webhook_hosts`).

Pull alternative: `GET /v1/{ns}/subscriptions/{sub_id}/pull?after_seq=&limit=&wait_s=` ->
`{sub_id, events, next_after_seq, acked_seq}`, then `POST .../ack {"after_seq": n}`.
Admin: `GET /v1/{ns}/subscriptions`, `GET|POST .../secret[/rotate]`, `GET /v1/{ns}/outbox`, `POST /v1/{ns}/outbox/{id}/retry`.

## Redaction and vault

- Every write body (events, records, items, rules, metrics, worklog, packs) is scanned and secrets / PII are
  masked before storage; `kh.redacted` records where (never the value). `POST /v1/{ns}/redaction:scan {text}`
  shows what would be masked. Select packs in the manifest (`redaction.packs`) or via `PUT /v1/{ns}/redaction`.
- Vault (`/v1/{ns}/vault/...`): grader / admin only; holds evaluation holdouts with canary strings; a canary
  seen in any other write is masked and reported as `kh.canary_hit`.

## Lifecycle (person: namespace owner or maintainer)

| Route | Effect |
|---|---|
| `POST /v1/admin/ns/{ns}:detach` | all `/v1/{ns}/*` answer 404 within 5 s; leases fenced; principals suspended; client disabled; data kept `grace_days` (default 30) |
| `POST /v1/admin/ns/{ns}:reattach` | back to active within grace; create new principals and re-acquire leases |
| `GET /v1/admin/ns/{ns}:export[?include_vault=true]` | streamed zip: manifest, NDJSON per table, vectors as text, sha256 checksums |
| `POST /v1/admin/ns:import?ns=<id>` | restore a zip into a clean namespace id |
| `POST /v1/admin/ns/{ns}:purge` | delete everything (detached namespaces only; confirmation token from an export, or force) |

## KH's own events (`kh.*`)

Written into your namespace's event log so you can learn from them: `kh.write_conflict`, `kh.stale_epoch`,
`kh.lease_lost`, `kh.duplicate`, `kh.quota`, `kh.served`, `kh.redacted`, `kh.canary_hit`, `kh.vault_read`,
`kh.item_rollback`, `kh.item_promoted`, `kh.ns_state`, plus capability-specific ones (`kh.pack_version`,
`kh.pack_frozen`, `kh.assumption`, `kh.question_duplicate`, `kh.intervention`).

## Examples

```bash
# token
TOKEN=$(curl -s -X POST "$KH/v1/token" -H 'Content-Type: application/json' \
  -d "{\"grant_type\":\"client_credentials\",\"client_id\":\"kh-ns-$NS\",\"client_secret\":\"$SECRET\"}" | jq -r .access_token)

# append an event, idempotently
curl -s -X POST "$KH/v1/$NS/events" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: ev-1-1-0a1b2c' -H 'X-KH-Run: r42' \
  -d '{"events":[{"id":"r42-1-0a1b2c3d4e5f6a7b","kind":"run.started","body":{"agent_version":"1.4.0"}}]}'

# create a record under a lease
curl -s -X POST "$KH/v1/$NS/leases/unit/u7:acquire" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -H 'Idempotency-Key: lease-u7-1' -d '{"ttl_s":60}'
curl -s -X PUT "$KH/v1/$NS/records/unit/u7?project=$PROJECT" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -H 'If-None-Match: *' -H 'X-KH-Lease: unit/u7' -H 'X-KH-Epoch: 1' \
  -H 'Idempotency-Key: rec-u7-create' -d '{"run":"r42","state":"building"}' -i

# context for one step
curl -s -X POST "$KH/v1/$NS/context/step" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -H 'X-KH-Run: r42' -H 'X-KH-Unit: u7' \
  -d "{\"project\":\"$PROJECT\",\"keyspace\":\"step\",\"key\":{\"role\":\"builder\",\"step\":\"implement\",\"stack\":\"python\"},\"budget_chars\":4000}"
```

## Appendix: the people surface

People and their CLIs use unprefixed routes with personal sign-in: `POST /context/step`, `POST /vector/query`,
`POST /vector/add`, `POST /vector/scroll`, `GET /log/recent`, `POST /entities`, `GET /entities/match`,
`GET /orchestrator/project_match`, `GET /projects`, `GET /policy/plan`. Namespace tokens are refused there
(403). An engine that runs **as a signed-in person** (for example a local assistant acting for one user) may
use them with that person's rights, but it then gets no namespace isolation, leases, events, records or
idempotency. For a multi-agent engine, use `/v1`.

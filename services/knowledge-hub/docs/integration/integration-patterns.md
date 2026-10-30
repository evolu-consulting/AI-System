# Integration patterns

How to wire an engine (an SDLC/DLC engine, an agent pipeline, any multi-agent system) to KH so that it gets
good context, writes knowledge back, stays correct under concurrency and keeps running when KH is down.

## 1. Keep KH behind a port

Define, in your engine, a small interface (a "RAG port") with the operations you need, for example:

| Port operation | KH route |
|---|---|
| `capabilities()` | `GET /v1/capabilities` |
| `apply_manifest()` | `GET` + `PUT /v1/{ns}/manifest` |
| `retrieve(key, budget, query?)` | `POST /v1/{ns}/context/step` |
| `append_events(batch, key)` / `events_after(seq)` | `POST` / `GET /v1/{ns}/events` |
| `put_record` / `get_record` | `PUT` / `GET /v1/{ns}/records/{type}/{id}` |
| `lease_acquire` / `renew` / `release` | `/v1/{ns}/leases/{name}:...` |
| `write_worklog(subject, text)` | `POST /v1/{ns}/worklog` |
| `propose_lesson(...)` | `POST /v1/{ns}/items` |
| `freeze_pack(files)` / `quote(path, text)` | `/v1/{ns}/packs/...` |
| `metric(series, value, dims)` | `POST /v1/{ns}/metrics` |

Ship two adapters: an HTTP adapter for KH and a local one (your own store) with the same interface. Your
engine logic only ever sees the port. This is what makes KH pluggable: switch adapters by configuration, point
the HTTP adapter at another KH, or implement the same contract on another RAG system.

Keep deployment-specific wire details in configuration, not code: base URL, namespace, project, keyspace name,
header names, capability-name mapping, token path.

## 2. Startup sequence

1. Fetch a token (`POST /v1/token`). Cache it; refresh 60-90 s before expiry.
2. `GET /v1/capabilities`; record which capabilities you need are present. Missing = that feature runs on the
   local adapter.
3. Apply your manifest: `GET /v1/{ns}/manifest` for its ETag, then `PUT` with `If-Match`. Ship the manifest as
   data in your engine and apply it on every start; an identical manifest is a no-op.
4. Optionally create principals per run (orchestrator, agents, judges) and hand each its own token.

## 3. Per-step retrieval

Call `POST /v1/{ns}/context/step` once per agent step, not once per run:

- **Key** = the dimensions that decide which lessons apply, declared as a keyspace, e.g.
  `{"role": "builder", "step": "implement", "stack": "python,react"}`. Keep values stable and low-cardinality;
  a missing dimension acts as a wildcard.
- **Query** = a short English description of what the step must do (task title, error message). It drives the
  meaning tier.
- **Budget** = the characters you can afford in the prompt (200-20000). Put `pack_text` into the prompt as is.
- Send `X-KH-Run` / `X-KH-Unit` so the `kh.served` event is tied to your run and unit.
- Store `serve_id` and `item_ids` on your own step record or event. This is what lets KH (and you) correlate
  outcomes with the knowledge served, and roll back lessons that make outcomes worse.
- If you do not want people's project knowledge mixed into agent packs, set `settings.include_people_lanes: false`.

## 4. Writing knowledge back

| What you have | Where it goes | Why |
|---|---|---|
| Something happened (state change, test result, decision, error) | event | append-only history, cursor-readable, feeds metrics and webhooks |
| Current state of one of your entities (run, unit, plan, graph) | record | revisioned, conditional updates, queryable by index fields |
| Progress a human should read | worklog line | appears in the project's worklog next to people's own |
| A reusable lesson ("Always pin X when Y") | item (proposed) | keyed, confirmed by policy, expires, served by key |
| Source documents (spec, contract) | pack version (frozen) | stable quote ids for citations |
| Facts about the target system's rules | rules | graph queries, coverage, gate before shipping |
| An outcome number (first-pass green, cost, lead time) | metric | aggregates, A/B compare, lesson rollback |

Write everything in **English**: retrieval, dedupe and lint work on English text, and people of every language
share the project. Keep names, ids, code and quoted errors verbatim.

Do not put secrets in any body. KH masks known secret and PII patterns, but masking is a safety net, not a design.

## 5. Event stream with a local outbox

1. Write each event to your local store first, with a local `seq`.
2. A sender drains the local outbox in batches (<= 500) to `POST /v1/{ns}/events` with:
   - a deterministic event `id` per event, unique across all your writers (e.g. `<run>-<seq>-<hash16 of the
     event>`, only `[A-Za-z0-9_-]`, <= 64 chars). A re-created local database restarts `seq` at 1, so the hash part
     matters;
   - an `Idempotency-Key` per batch derived from the ids in it (e.g. `ev-<first>-<last>-<hash of ids>`).
3. Mark sent only on 200. On `in_progress` wait `Retry-After` and resend the same key. On 422 the batch is wrong:
   park it and alert (or use `?partial=true` and park only the rejected ones).
4. Replays are safe: a repeated id returns its original `seq` with `duplicate: true`.
5. Readers use `GET /v1/{ns}/events?after_seq=` with the last `next_after_seq`; gapless seq means nothing is
   skipped. Or subscribe to webhooks / pull (at-least-once, dedupe on `(ns, delivery_id)`).

## 6. Leases and fencing

Use a lease when only one worker may act on something at a time (a unit of work, a branch, a shared record):

1. `:acquire` the lease (`ttl_s` 5-300) -> `epoch`.
2. Send `X-KH-Lease` + `X-KH-Epoch` on every write that depends on owning it. Mark such types `fenced: true`
   in the manifest so a write without the headers is refused.
3. Renew at about a third of the TTL. On `lease_lost` / `stale_epoch`: stop all work on that unit immediately,
   do not retry the write; another worker owns it now.
4. `:release` when done.

The lease holder is the **calling identity**. If several workers share one token (e.g. all run as the
namespace client), KH sees them as the same holder: a second worker's acquire succeeds at the same epoch. Either
give each worker its own principal (recommended), or track the owner per lease inside your adapter and refuse a
second local owner yourself, fencing on (owner, epoch).

## 7. Conditional updates

For records you update repeatedly, keep the ETag from the last read or write and send `If-Match`. On
`write_conflict` the response carries the current record and ETag: merge your change into it and retry, or
give up if your change is no longer valid. Use `If-None-Match: *` to create; a `duplicate` means it already
exists: read it. Set `require_if_match: true` on types where a lost update would be a bug.

## 8. Exactly-once side effects

For an external action (open a PR, send a message, deploy), claim it first:
`POST /v1/{ns}/effects/{key}:claim` -> act -> `:complete {result}` or `:fail {error}`. A second worker gets
`effect_claimed` with the state and the result. Use a key derived from the action's identity.

## 9. Degraded mode (KH unreachable or refusing)

Treat KH as a dependency that can disappear. What KH promises: idempotent replay for up to 7 days (when the
manifest sets `retention.idempotency_hours: 168`), client `ts_ms` accepted out of order, stable error codes.
What the consumer should do:

| Signal | Action |
|---|---|
| transport error, timeout, 5xx, 429, 423, 404 `ns_not_active`, route missing (404 without `error`) | count as unavailable; after ~3 consecutive failures open a circuit and switch to the local adapter |
| while degraded | buffer events, metrics and worklog lines locally with their idempotency keys; serve the last retrieval packs you fetched or local lessons; take leases locally (single writer) or stop fenced work |
| probe | every ~30 s, `GET /v1/capabilities`; on success close the circuit |
| recovery | drain the outbox in order with the original keys; reconcile leases (local leases are not valid remotely: re-acquire) |
| 401 after one refresh, 403 | not an outage: stop the affected operation and alert (credentials, grants or manifest ACL are wrong) |
| 409 / 413 / 422 / 428 | not an outage: handle per the error table; never switch to degraded for these |

Timeouts: keep KH calls short (a few seconds) so a slow KH never blocks an agent; measured p95 on a single dev
instance was about 200 ms for event appends and about 400 ms for `context/step`.

## 10. Quotas and sizing

- Default rate quotas: 1,200 requests/min per principal, 20,000/min per namespace. Batch events (<= 500 per call)
  and metrics (<= 1,000 per call) instead of one call per item.
- Body limits: 256 KB per event or record body, 4,000 chars per worklog line, 20,000 chars per retrieval budget.
- On `429 quota` honour `Retry-After`.

## 11. Plug-out

Your engine must keep working when the namespace is detached: it is the same as KH being unreachable
(`404 ns_not_active`). To move to another KH: export the namespace zip, import it on the target, point your
adapter at the new base URL and credentials. To leave KH entirely: switch the port to your local adapter; nothing
else in your engine changes.

# Consumer simulator: results (stage F, 2026-10-10)

The simulator plays an autonomous software-delivery line in which many agents work at once. It drives the live
dev KH over HTTP only: container `kh-dev-f` on `http://127.0.0.1:9102`, HANA schema `KH_STAGEF`, image
`kh-dev:stagef` built from branch `kh-stage-f` at `f94400a`. KH and the consumer are separate products, so
everything here uses generic names (namespace `sim1`, project `simline`).

## How to run

```
.venv\Scripts\python tools\stagef\consumer_sim\run_all.py            # all 11 scenarios, about 3.5 min
.venv\Scripts\python tools\stagef\consumer_sim\run_all.py --only S04 --load-s 40
.venv\Scripts\python tools\stagef\consumer_sim\s06_lessons.py        # one scenario, with S01 first
```

- **Authentication.** The dev bootstrap token is read from `docker inspect kh-dev-f`. It attaches the namespace,
  and the namespace client secret is exchanged for the admin token, which creates the principals. Secrets stay
  in process memory, and every reported detail passes through `scrub()`. The report goes to
  `out/run-<utc>.json`, which git ignores.
- **Clean start.** Every run first detaches and purges `sim1` and `sim1copy`.
- **Webhook receiver.** `receiver.py` runs inside the KH container on 127.0.0.1. The SSRF guard allows plain
  http only to 127.0.0.1 (`KH_OUTBOX_ALLOW_LOCAL=1`) and refuses the Docker host's private address.
- **Files.** `simlib.py` is the client library (token refresh, per-route latency, checks), `manifest.py` holds
  the line's manifest as data, there is one `sNN_*.py` per scenario, and `run_all.py` runs them all.

## Result: 11/11 scenarios pass, 202 checks (run `out/run-20261010T174800Z.json`, 216 s)

| # | Scenario | Result | Checks | Key numbers |
|---|---|---|---|---|
| S01 | attach: namespace, manifest, receiver | PASS | 13 | attach to first accepted event: **0.22 s** (G3 < 60 s); applying the same manifest twice changes nothing |
| S02 | 24 agents: leases, fencing, If-Match, idempotency, required fields, seq | PASS | 27 | 24 units x (fenced create + 5 If-Match updates), each at rev 6 under its epoch; 24-way lease race: 1 x 200, 23 x 409; 24-way If-Match race: 1 x 200, 23 x 409 `write_conflict`, 23 `kh.write_conflict`; forced steal: zombie record and event writes 409 `stale_epoch` (2 `kh.stale_epoch`), renew 409 `lease_lost`; 24 idempotent replays (`Idempotent-Replay: true`, 24 `kh.duplicate`); missing `spec_hash` 422 `/body`, missing `attempt` 422 `/attempt`; seq 1..100 gapless |
| S03 | spec pack | PASS | 24 | v1.0 frozen in 224 ms; stable quote ids `path#page#offset`; ASSUMED-1/2; paraphrase duplicate score **0.961**; "below the limit" vs "above the limit": cosine **0.989**, kept apart by the contrast guard (`opposite:below/above`); a human answer becomes addendum **v1.1** and is cited; amendment v1.2 re-anchors a v1.0 quote to its shifted offset and orphans a removed sentence |
| S04 | rule graph | PASS | 14 | `:bulk` stored 4 legacy rules (unverified, origin bootstrap) plus 1 dedupe; 3-hop query (graph path) **42.6 ms** returns the pair credit-limit -> blocked vs VIP -> auto-approved (`overlap: possible`), same on the SQL path; disjoint `weight < 5 kg` / `>= 5 kg` not flagged; coverage any **0.75** / verified **0.25**; gate fails (missing entity), then fails (dangling DEPENDS_ON), then passes |
| S05 | judge ledger + guard registry | PASS | 16 | 5 decisions, scored later with If-Match (rev 2, both revisions kept); decay 1.0 / 0.5 / 0.25 at 0 / 30 / 60 days (half-life 30 d); partitions by judge model: A n=3 weight 1.75, B n=2 weight 1.79; agent write and read of the ledger 403; guard registry write by agent, judge or orchestrator 403, agent read 200 |
| S06 | lessons | PASS | 20 | distiller proposes, keyed (role, step, stack); agent and distiller cannot confirm (403); judge confirms (confirm_policy roles [judge]); `/context/step` serves it in the key tier and writes 1 `kh.served` with run and unit; rollback: served 0.50 (n 40) vs control 0.90 (n 80), rel -44 %, p = 1.0e-6 -> **withdrawn, auto_rollback**; the not-worse lesson (0.90 vs 0.70) stays active |
| S07 | vault + canaries | PASS | 12 | grader writes 2 holdout items (KH canary `khc-` + 16 hex, plus a custom one); agent and judge get 403 on all 7 vault routes; KH canary in an agent event and custom canary in a record are stored masked; 2 `kh.canary_hit` (vault, item, principal, run; never the canary); retrieval with the holdout question returns no vault text |
| S08 | redaction | PASS | 10 | conformance vectors 100 %; access key, e-mail and `password=` masked in events, records (create and merge patch, every revision), rule `source_text`, item text and metric dims; 6 `kh.redacted` across events, records, rules, items, metrics, none carrying the value |
| S09 | outbox | PASS | 12 | **20/20** subscribed events pushed exactly once (0 duplicate delivery ids or seqs), all HMAC signatures valid, no `step.*` pushed, `X-KH-Namespace` matches the signed body; pull as judge 200, agent 403; ack moves the cursor; long poll returned the next event in about 0.8 s |
| S10 | plug-out | PASS | 21 | every probed `/v1/sim1/*` route 404 `ns_not_active` **0.03 s** after detach (G3 <= 5 s); in-flight fenced writer: 14 writes landed before the detach, none after (all later writes 404); export 41 files, 44,950 bytes, every sha256 matches, no vault tables; re-attach: old principals 401, pre-detach epoch 409 `stale_epoch`, new lease at epoch 4 writes; import into `sim1copy`: 201, `match: true`; re-export of the copy **identical in rows and sha256 for all 40 files** (857 rows) |
| S11 | load: 30 agents x 180 s | PASS | 13 | **36,120 requests (200/s), 0 unexpected errors**; 20,134 events accepted (112/s), 25,024 in the namespace, **0 seq gaps**, every id once; **5,488/5,488 webhooks, 0 duplicates**, all signatures valid; 87 contended 409s = 87 `kh.write_conflict`; 4 forced steals, each zombie write 409 `stale_epoch`; all idempotent retries replayed |

### S11 latency per route (one instance, `HANA_POOL_SIZE=5` as configured on kh-dev-f)

| Route | n | p50 ms | p95 ms | max ms |
|---|---|---|---|---|
| POST /events | 7,171 | 87.3 | **198.4** | 400.2 |
| POST /events (batch of 5) | 1,882 | 101.1 | 219.9 | 392.8 |
| POST /events (fenced, with lease + epoch) | 3,553 | 40.3 | 86.9 | 286.5 |
| POST /events (idempotent retry, replay) | 893 | 50.2 | 102.4 | 211.9 |
| POST /context/step | 3,662 | 86.9 | **415.7** | 1,037.4 |
| PUT /records/unit-state (fenced) | 7,106 | 34.7 | 78.3 | 244.4 |
| PUT /records/work-board (If-Match) | 1,677 | 34.6 | 84.0 | 253.8 |
| PUT /records/work-board (contended) | 713 | 35.0 | 106.1 | 229.2 |
| GET /records/work-board | 713 | 24.1 | 75.0 | 245.9 |
| POST /leases/{name}:acquire | 3,553 | 32.7 | 83.0 | 278.7 |
| POST /leases/{name}:release | 3,553 | 24.2 | 69.4 | 235.0 |
| POST /metrics | 1,614 | 33.6 | 91.2 | 203.9 |

G2 is defined for 3 sized instances at 200 events/s. The simulator reports it but does not assert it:

- `/context/step` p95 416 ms is within the 2 s budget.
- `POST /events` p95 198 ms misses the 150 ms budget on this single dev instance with the default 5 store
  connections.
- With `HANA_POOL_SIZE=20` the same 30-agent load measured p50 44 ms and p95 99 ms (issue 3). The
  `docs/cloud-deployment.md` row for that variable now says so.

## Issues found

Each fix is one commit on `kh-stage-f` (not pushed) and has a regression test in `tests/caps/`. After every fix
the image was rebuilt and `kh-dev-f` recreated from its own `docker inspect` config: the same env, volume
`kh-dev-f-data`, port and command. The env values were passed only through the child process environment and
never written to a file.

1. **A purged namespace id could never be attached again.** (`3e874d4`, found by S01)
   - Root cause: `PUT /v1/admin/ns/{ns}` answered 404 `ns_not_active` for a purge tombstone, while `:import`
     already treats a finished tombstone (`state purged, purge_after_ms NULL`) as clean. A consumer that purges
     and re-installs under its own name was locked out.
   - Fix: a finished tombstone is now a fresh attach through a conditional UPDATE, with the owner check and a
     new client. A purge that is still running answers 409 `invalid_transition`.
   - Verified: `test_lifecycle.py` (re-attach 201, needs the owner, mid-purge 409), and S01 attaches the purged
     `sim1` on every run.
2. **Rule conflicts missed independent conditions.** (`414c8c6`, found by S04)
   - Root cause: `rules.overlap()` returned "no conflict" unless one clause set contained the other. Same
     entity and attribute with contradicting effects under different triggers ("total exceeds the credit limit"
     vs "customer is VIP") was never a candidate, because "no proof both apply" was read as "cannot both apply".
   - Fix: such pairs are now `possible` candidates, unless the text proves the conditions disjoint: ranges on
     the same left side, `is` vs `is not`, `not p` vs `p`, `= a` vs `= b`.
   - Verified: `test_rules.py` (overlap cases, HTTP pair, graph and SQL paths agree) and S04.
3. **Event appends queued on the namespace counter row.** (`18dd12f`, found by S11)
   - Root cause: under 30 agents every route that appends an event (user events, replays writing
     `kh.duplicate`, `/context/step` writing `kh.served`) ran at p50 180 ms / p95 294 ms, while record writes
     stayed at 15 ms. The counter-row lock was held for 7-8 round trips: an early UPDATE +0 taken only so the
     duplicate check was race-free, one duplicate SELECT per event, UPDATE, SELECT, INSERTs, fence, COMMIT. The
     DB clock was also read on an extra pooled connection.
   - Fix: one batched duplicate SELECT before the lock. A same-id race is resolved by the unique index
     `ux_kh_event_id` with a retry, and the rolled-back counter burns no seq. The lock now covers UPDATE,
     SELECT, INSERT and fence, and the clock is read inside the insert transaction.
   - Verified: `test_events.py` (statement order under the lock, one connection per append, same-id race,
     in-batch repeat). Measured (40 s, 30 agents): p50/p95 went from 180/294 to 64/160 ms with pool 5, and to
     44/99 ms with pool 20 (on a temporary second instance, since removed).
4. **Webhook dedupe key was not unique across namespaces.** (`cf3237b`, found by S09)
   - Root cause: delivery ids are `<sub>:<seq>`. A receiver serving two namespaces (an imported copy keeps the
     manifest's url) got `line-hooks:1` from both, yet the contract said to dedupe by `X-KH-Delivery` alone, so
     real deliveries could be dropped.
   - Fix: deliveries carry `X-KH-Namespace`, mirroring the signed body's `ns`, and the docs name
     (namespace, delivery id) as the dedupe key. The change is additive.
   - Verified: `test_outbox.py` and S09/S11 header checks.
5. **Flaky `test_packs.py`: "hnsw segment reader: Nothing found on disk".** (`98e3c36`)
   - Root cause: chromadb 1.5.9 (local Rust executor) raises it from `query()` while a collection's *first*
     upsert is in flight. The dimension is already set but the HNSW segment folder does not exist yet
     (`LocalHnswSegmentReader::from_segment` -> `UninitializedSegment`), and knn does not treat that as empty.
   - Reproduced in isolation: readers on a fresh collection during its first upserts gave 4 errors in 500
     rounds.
   - Ruled out by experiment: a cache that is too small (300 collections fine), sequential upsert-then-query
     (4,500 ops), and filtered queries racing a write on an existing collection.
   - Effect in KH: `questions:lookup` silently fell back to exact matching and stored a true duplicate as a new
     question; items search and the retrieval meaning tier degraded the same way.
   - Fix: `vector_store.query_vt` retries exactly this error (4 tries, about 0.3 s); any other error is raised
     at once. The same reproduction gives 0 errors in 1,000 rounds.
   - Verified: `test_packs.py` injects the error (retried and found; bounded; other errors not retried).
   - Caveat: the flake depends on timing, and test_packs itself did not show it on this machine in 26 runs
     before the fix (16 in parallel, 3 on HANA). The evidence for the cause is the isolated reproduction above.
6. **Export carried instance-local projection state.** (`0a0edf5`, found by S10)
   - Root cause: `kh_rule_proj` (rule graph projection state, error, `updated_ms`) was exported, and the
     import's graph rebuild rewrites it, so the G3 "identical sha256 per table" check failed for every namespace
     with rules.
   - Fix: modules declare `LOCAL_TABLES`, which export skips and purge still empties. Rules declares
     `kh_rule_proj`. An import marks rule projections stale until its rebuild, so queries use the SQL path.
   - Verified: `test_lifecycle.py` (namespace with rules: not exported, copy rebuilt, re-export identical,
     copy answers queries) and S10 (40/40 files identical).
7. **Re-attach never delivered the webhooks the detach stopped.** (`f94400a`, found by S11)
   - Root cause: detach turns pending and claimed outbox rows dead (reason `detached`); re-attach left them
     dead. `line-hooks:241`, a `run.finished` from just before S10's detach, was never pushed (5,515/5,516),
     which breaks at-least-once delivery across a plug-out.
   - Fix: on detached -> active, exactly those rows are pending again. Rows dead for other reasons stay dead.
   - Verified: `test_outbox.py` (revived, delivered to healthy targets, other dead rows untouched) and S11
     (5,488/5,488).

**Simulator-side problems, fixed in the simulator:**

- The receiver could restart before the old one released the port; it now waits for the port to close.
- During development, old namespaces still pushed to the same receiver; the simulator now filters by
  `X-KH-Namespace`, which is what led to issue 4.

**Observations, by design, not changed:**

- Agents hold `items: read` only (design 3.4), so an agent's own `POST /items` is 403 and the line's distiller
  principal proposes lessons for it (S06 asserts both).
- A `127.0.0.1` webhook target (dev only) means the local host of whichever instance runs the delivery cron. A
  temporary second instance on the same schema once claimed deliveries for a receiver it did not have.

## Test suites (after the last fix, `f94400a`)

Every stage F test passes on both backends (`tests/caps/test_*.py` and `tests/test_stage_f1.py`). Check counts
are SQLite / HANA:

| Test | Checks | Test | Checks | Test | Checks |
|---|---|---|---|---|---|
| coord | 45 / 45 | events | 36 / 36 | items | 94 / 94 |
| lifecycle | 80 / 80 | metrics | 65 / 65 | outbox | 78 / 78 |
| packs | 103 / 103 | principals | 50 / 50 | records | 82 / 82 |
| redact | 59 / 59 | registry | 50 / 50 | retrieval | 36 / 36 |
| rules | 93 / 93 | vault | 89 / 89 | stage_f1 | 41 / 42 |

**SQLite, all `tests/test_*.py` and `tests/caps/test_*.py`: 46/47 files pass.**

- The one failure is `test_project_match_weak.py` (6/7). It reads this machine's real project registry and
  fails on a case it labels as a known "GAP". It fails the same way on the baseline `82635e9`.

**HANA (`KH_TEST_HANA=1 KH_STORE_BACKEND=hana HANA_SCHEMA=KH_STAGEF_TEST`, password read from
`docker inspect kh-dev-hana` at run time): 42/47 files pass.** None of the five failures is a stage F test:

- `test_policy_actions`, `test_project_match_weak`, `test_store_backends` and `test_vector_delete` fail
  identically on the baseline `82635e9`. Causes: HANA Express has no `REAL_VECTOR`, and some tests read local
  machine state.
- `test_project_registry` does not use the caps harness, so it never wipes the schema and sees rows earlier test
  files left behind. Its order-dependent failure ("a second sync writes nothing") disappears on a freshly wiped
  `KH_STAGEF_TEST`: 27/27, twice.

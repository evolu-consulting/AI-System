# Conformance checklist

Run these against a non-production KH with a throwaway namespace. Each line is a pass / fail check. An
integration is ready when every **required** line passes; **optional** lines apply only to the capabilities you
use.

## A. Setup (required)

- [ ] A person who owns the target project(s) attached the namespace: `PUT /v1/admin/ns/{ns}` -> 201 with
      `client.client_id` = `kh-ns-<ns>` and a `client_secret`. The secret is in your secret store, not in code,
      config files under version control, logs or prompts.
- [ ] `POST /v1/token` with the client credentials -> 200 with `access_token` and `expires_in`.
- [ ] `GET /v1/me` with that token -> `kind: client`, `role: admin`, `ns` = your namespace.
- [ ] `GET /v1/capabilities` -> every capability your engine needs is listed and not `status: off`.
- [ ] `PUT /v1/{ns}/manifest` -> 200 `changed: true`; repeating the same PUT (with `If-Match` from GET) -> 200
      `changed: false`.
- [ ] A PUT without `If-Match` after the manifest exists -> 428 `precondition_required`.

## B. Auth and isolation (required)

- [ ] Token refresh happens before expiry; a forced expired token gets 401 and the adapter recovers with one
      refresh.
- [ ] The token on another namespace's path (`/v1/<other>/events`) -> 403.
- [ ] The token on a people route (`POST /context/step` without `/v1`) -> 403.
- [ ] Your adapter treats 403 as final (no retry loop, an alert is raised).
- [ ] (if you use principals) an `agent` principal: `POST /v1/{ns}/principals` -> 201; its token works;
      `PATCH` to `revoked` -> its next call within 5 s is 401.

## C. Retrieval (required)

- [ ] Seed one active item for a key (or use existing project knowledge), then `POST /v1/{ns}/context/step`
      with that key -> non-empty `pack_text`, `served` lists the item, `used_chars <= budget_chars`.
- [ ] An unknown key dimension -> 422 `invalid`; your adapter surfaces it as a configuration error.
- [ ] `GET /v1/{ns}/events?kind=kh.served` shows one `kh.served` per retrieval call, with your `X-KH-Run` /
      `X-KH-Unit` in `run_id` / `unit_id`.
- [ ] Your engine stores `serve_id` / `item_ids` with the step that used the pack.

## D. Events (required if you write events)

- [ ] Append a batch of 3 with deterministic ids and an `Idempotency-Key` -> 200, 3 accepted, increasing `seq`.
- [ ] Resend the identical request -> 200 with header `Idempotent-Replay: true`, same body.
- [ ] Same key, different body -> 422 `idempotency_mismatch`.
- [ ] Same ids under a new key -> 200, every entry `duplicate: true`, original `seq`.
- [ ] An event missing a schema-required field -> 422 with `rejected[].errors[].pointer`; nothing stored.
- [ ] `GET /v1/{ns}/events?after_seq=0` returns them in `seq` order; paging with `next_after_seq` reaches the end
      with no gaps.

## E. Records and revisions (required if you write records)

- [ ] `PUT` with `If-None-Match: *` -> 201 + `ETag: "1"`; repeat -> 409 `duplicate`.
- [ ] `PUT` with `If-Match: "1"` -> 200 `rev: 2`; again with `If-Match: "1"` -> 409 `write_conflict` carrying
      `current` and the new ETag; the adapter merges and retries.
- [ ] A type with `require_if_match: true`: update without If-Match -> 428.
- [ ] `GET ...:revisions` lists every revision.

## F. Leases and fencing (required if more than one worker can touch the same thing)

- [ ] Identity A acquires `unit/x` -> epoch e. Identity B acquires -> 409 `lease_held`.
- [ ] A fenced write by A with `X-KH-Lease: unit/x`, `X-KH-Epoch: e` -> 2xx.
- [ ] Let A's lease expire, B acquires -> epoch e+1. A's fenced write with epoch e -> 409 `stale_epoch`, nothing
      stored; A's renew -> 409 `lease_lost`. Your engine stops A's work on that unit.
- [ ] If all workers share one identity: your adapter refuses a second local owner of a held lease.

## G. Write-back (required)

- [ ] `POST /v1/{ns}/worklog` -> 200 with an id; the line is visible in the project's worklog.
- [ ] (optional) Propose an item -> `status: proposed`; confirming it by a role outside its `confirm_policy`
      -> 403; by an allowed role -> `active`; it is then served by `context/step` for its key.
- [ ] (optional) `POST /v1/{ns}/metrics` -> `created: 1`; repeat with the same `ts_ms` and `unit_id` -> `duplicates: 1`.
- [ ] A body containing a fake secret (e.g. `password=hunter2`) is stored masked and a `kh.redacted` event exists.

## H. Degraded mode (required)

- [ ] Point the adapter at an unreachable URL: the engine keeps running on its local adapter; events are
      buffered with their keys.
- [ ] Restore the URL: within one probe interval the circuit closes and the buffer drains; the remote event
      count equals the local count, no duplicates, `seq` gapless.
- [ ] Detach the namespace (person): calls get 404 `ns_not_active`; the engine degrades instead of failing.
      Re-attach: the engine recovers after re-acquiring leases (old epochs are refused).
- [ ] `429 quota` is honoured with `Retry-After`.

## I. Optional capabilities

- [ ] Packs: create + freeze a version; quote an exact sentence -> `quote_id` `path#page#offset`; a draft cannot
      be quoted (409 `version_order`).
- [ ] Webhooks: a subscribed kind is delivered once per event with a valid `X-KH-Signature`; your receiver
      dedupes on `(ns, delivery_id)` and rejects a tampered body.
- [ ] Effects: two workers claim the same key -> one 201, one 409 `effect_claimed`.
- [ ] Export: `GET /v1/admin/ns/{ns}:export` -> zip whose `checksums.json` matches its files.

## Minimal smoke script outline

```
1  token        POST /v1/token                                  expect 200
2  discover     GET  /v1/capabilities                           expect names you need
3  manifest     GET  /v1/{ns}/manifest ; PUT with If-Match      expect 200 (changed true, then false)
4  event        POST /v1/{ns}/events  (Idempotency-Key k1)      expect accepted[0].seq = s
5  replay       POST same request                               expect Idempotent-Replay: true
6  read         GET  /v1/{ns}/events?after_seq=s-1              expect the event
7  record       PUT  /v1/{ns}/records/T/x (If-None-Match: *)    expect 201, ETag "1"
8  conflict     PUT  ... If-Match: "0"                          expect 409 write_conflict
9  lease        POST /v1/{ns}/leases/l:acquire                  expect epoch
10 retrieve     POST /v1/{ns}/context/step                      expect pack_text, serve_id
11 worklog      POST /v1/{ns}/worklog                           expect id
12 served       GET  /v1/{ns}/events?kind=kh.served             expect >= 1
```

Print no secrets and no tokens in the smoke output.

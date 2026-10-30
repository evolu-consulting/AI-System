# Knowledge Hub integration contract

This folder is the contract for any engine that wants to use Knowledge Hub (KH) as its RAG and knowledge
backend: an SDLC/DLC engine, an agent pipeline, a workflow runner, or anything else that runs many agents and
needs shared memory. It is self-contained. You should not need to read KH's source to integrate.

KH knows nothing about any particular consumer. A consumer exists in KH only as data (a namespace, a manifest,
principals and the rows it writes). The contract is the plug point: a consumer that codes against these
routes, behind its own port/adapter, can be pointed at another KH instance, or at a different RAG system that
implements the same contract, without changing its own logic.

## What you receive

You receive a running KH, never its source code: either a **hosted KH endpoint** operated by the vendor, or the
**delivered KH package / container image** installed on your own host by the vendor or by your operator from
the delivered artefact. Either way you get a base URL and, when sign-in is enabled, the identity settings or
the client credentials for your namespace. Consumers integrate over HTTP only, with the routes in this folder;
`GET /v1/openapi.json` on your KH is the machine-readable contract of the installed version.

## What KH gives a consumer

| Capability | What it is for | Main routes |
|---|---|---|
| registry | attach a namespace, declare schemas / types / keyspaces / quotas in one manifest | `PUT /v1/admin/ns/{ns}`, `PUT /v1/{ns}/manifest` |
| principals | machine identity: namespace client (client credentials) and per-agent short-lived tokens | `POST /v1/token`, `POST /v1/{ns}/principals` |
| coord | leases with fencing epochs, idempotency keys, side-effect claims | `/v1/{ns}/leases/*`, `/v1/{ns}/effects/*` |
| events | append-only event log, gapless `seq`, cursor reads, long poll | `/v1/{ns}/events` |
| records | typed JSON documents with revisions, ETag / If-Match, query | `/v1/{ns}/records/{type}/{id}` |
| retrieval | one keyed, budgeted context pack per step; agent worklog; project matching | `/v1/{ns}/context/step`, `/v1/{ns}/worklog` |
| items | knowledge items (lessons) with key, status lifecycle, TTL, confirmation | `/v1/{ns}/items` |
| packs | versioned source documents (specs) with stable quote ids, assumptions, questions | `/v1/{ns}/packs/*` |
| rules | a rule graph of the target system, up to 3 hops, coverage and a write-back gate | `/v1/{ns}/rules*` |
| metrics | outcome observations, aggregates, A/B compare, automatic item rollback | `/v1/{ns}/metrics*` |
| outbox | signed webhooks and a pull cursor over the event log | manifest `subscriptions`, `/v1/{ns}/subscriptions/*` |
| redact | secret / PII masking on every write, shared pattern packs | `/v1/{ns}/redaction*` |
| vault | a sealed holdout set only graders can read, with canary leak detection | `/v1/{ns}/vault/*` |
| lifecycle | detach, re-attach, export, import, purge | `/v1/admin/ns/{ns}:*` |

A minimal RAG integration needs only: **registry, principals, retrieval, events, records** (and coord for
idempotency, which every write uses). Everything else is optional; discover it at runtime (below).

## Mechanism in one page

1. **Namespace.** A consumer gets one namespace id (`[a-z][a-z0-9_]{2,31}`, not starting with `kh`). Every row
   it writes carries that id. A namespace is attached to one or more KH **projects** (the unit of knowledge
   ownership in KH). Isolation: a token bound to namespace A gets 403 on namespace B.
2. **Manifest.** The consumer declares, as one JSON document, which event kinds, record types, item kinds and
   metric series exist, their JSON Schemas, index fields, ACLs, fencing and If-Match rules, keyspaces for keyed
   retrieval, quotas, retention and webhooks. KH runs no consumer code; only JSON Schema validation and regex
   redaction.
3. **Identity.** Attaching a namespace provisions a **namespace client** (client id `kh-ns-<ns>` + a secret shown
   once). The client exchanges its credentials at `POST /v1/token` for a 15-minute admin token. The admin may
   create **principals** (orchestrator, agent, judge, grader, distiller, confirmer), each with its own 15-minute
   token and a role matrix that limits what it can do.
4. **Knowledge in.** The consumer writes events (what happened), records (current state of its entities),
   worklog lines (human-readable progress shared with people of the project), items (reusable lessons),
   packs (source documents) and rules.
5. **Knowledge out.** Per step, the consumer calls `POST /v1/{ns}/context/step` with a key (for example role,
   step, stack) and a character budget, and gets one ready-to-prompt `pack_text` plus the ids it served. KH logs
   what it served (`kh.served`), so outcomes can be traced back to the knowledge that was used.
6. **Correctness under concurrency.** Leases with fencing epochs, ETag / If-Match revisions, Idempotency-Key
   replay, gapless event `seq`. All stable error codes are listed in [api-contract.md](api-contract.md#errors).
7. **Plug-out.** Detach makes every `/v1/{ns}/*` route answer 404 within 5 s; data is kept for a grace period,
   can be exported as a zip and imported elsewhere.

## Files

| File | Read it for |
|---|---|
| [auth-and-tenancy.md](auth-and-tenancy.md) | getting credentials, tokens, roles, project grants, 401 / 403 semantics, isolation |
| [api-contract.md](api-contract.md) | every route a consumer uses: request, response, headers, limits, errors, examples |
| [integration-patterns.md](integration-patterns.md) | how to wire a consumer: adapter, per-step retrieval, write-back, outbox, fencing, degraded mode |
| [conformance-checklist.md](conformance-checklist.md) | step-by-step checks and smoke tests that prove an integration works |
| [FRONTEND-INTEGRATION.md](FRONTEND-INTEGRATION.md) | connecting a customer's own frontend (through its backend) to a deployed KH: projects, search, worklog, knowledge, entities, messages, an in-app assistant |

## Versioning and stability

- All consumer routes live under `/v1/`. `GET /v1/capabilities` lists each capability with a semver
  `version`, a `status` (`stable` | `beta` | `deprecated`), optional `sunset` and its `limits`. A capability
  switched off on a deployment is absent from that list and its routes answer 404.
- Rule: a minor version only adds (new optional fields, new routes, new error codes). A breaking change ships as
  `/v2/...` with an overlap period. Ignore unknown response fields; never depend on field order.
- Error codes (`error` field) are stable and never renamed. Branch on the code, not on `detail` text.
- `GET /v1/openapi.json` (authenticated) is the machine-readable schema of every `/v1` route on that server.
- At the time of writing every capability reports `status: beta` and `version: 1.0.0`. Treat `beta` as "the
  contract above holds; new optional fields may appear".
- Not yet implemented, stated as policy only: `Deprecation` / `Sunset` response headers on old routes.

## Out of scope for this contract

KH also has an older, unprefixed API for people and their CLIs (`/context/step`, `/vector/*`, `/log/*`,
`/entities`, `/policy/*`). It uses personal sign-in, not machine credentials. A machine consumer should use the
`/v1` surface only; a short note on the people surface is at the end of
[api-contract.md](api-contract.md#appendix-the-people-surface).

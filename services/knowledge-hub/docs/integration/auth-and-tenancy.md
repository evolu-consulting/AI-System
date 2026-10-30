# Authentication, authorization and tenancy

## Actors

| Actor | How it authenticates | What it may do |
|---|---|---|
| Person (owner of the target projects, or a KH maintainer) | personal sign-in to KH (an OIDC access token) | attach / change / detach a namespace, rotate the namespace client, export, purge |
| Namespace client (`kh-ns-<ns>`) | client credentials -> 15-minute bearer token | role `admin` inside its namespace: manifest, principals, every capability |
| Principal (one per agent, judge, ...) | 15-minute KH-signed token issued by the admin or an orchestrator | what its role allows (matrix below), narrowed by type ACLs and project grants |

When a KH deployment runs with sign-in switched off (local, single-user install), every call is treated as the
local user with role `admin`; principal tokens still work. Do not rely on this outside local development.

## 1. Attach a namespace (once, done by a person)

```
PUT /v1/admin/ns/{ns}
Authorization: Bearer <person token>
{"projects": ["<kh-project-id>", ...], "display": "My engine", "owner_email": "<optional>", "config": {}}
```

- `ns` must match `[a-z][a-z0-9_]{2,31}`, must not start with `kh`, and must not be one of
  `admin, me, capabilities, token, redaction, openapi, health, version`.
- The caller must be a KH maintainer or own **every** listed project. Service tokens can never manage namespaces.
- `201` on first attach, `200` on update (`If-Match` with the namespace ETag is optional on update).
- The `201` body carries `client`: `{client_id, client_secret, provisioner, token_url, note}`.
  **The secret is shown once**; KH stores only a hash. Put it in your secret store immediately.
- With the identity-service provisioner (deployment option), `token_url` points at the identity service's token
  endpoint instead of `/v1/token`, and the secret may be delivered by that service. Always use the `token_url`
  you were given.
- Lost or leaked secret: `POST /v1/admin/ns/{ns}:client` (same person rights) rotates it and returns a new one.

## 2. Get a token (the consumer, at runtime)

```
POST /v1/token            (public route; JSON or form-encoded)
{"grant_type": "client_credentials", "client_id": "kh-ns-<ns>", "client_secret": "<secret>"}

200 {"access_token": "...", "token_type": "Bearer", "expires_in": 900, "expires_at": <epoch s>}
401 {"error": "unauthorized", "detail": "invalid client" | "the namespace client is disabled"}
```

- Lifetime 900 s by default (deployment setting). Refresh about 60-90 s before `expires_at`; do not request a
  token per call.
- A 401 whose text contains `expired` means refresh once and retry once.
- The client is disabled while the namespace is detached; re-attach re-enables it.

## 3. Principals (optional, recommended for many agents)

Give each agent its own identity so actions are attributed, roles are enforced and one agent can be revoked.

```
POST /v1/{ns}/principals      (admin, or an orchestrator for non-orchestrator roles)
{"principal_id": "run42-builder-1", "role": "agent", "projects": ["<p>"], "ttl_s": 7200}
-> 201 {principal_id, role, on_behalf_of, projects, state: "active", ...}

POST /v1/{ns}/principals/{id}/token   -> {access_token, token_type, expires_in, expires_at, principal_id, role}
PATCH /v1/{ns}/principals/{id}  {"state": "suspended" | "active" | "revoked"}   (If-Match optional)
GET /v1/{ns}/principals[?role=&state=]     GET /v1/{ns}/principals/{id}
GET /v1/me                                  who the current token is
```

- `principal_id`: `[A-Za-z0-9][A-Za-z0-9_.-]{0,95}`; generated when omitted. `ttl_s` >= 60 or omitted (no expiry).
- Roles: `orchestrator, agent, judge, grader, distiller, confirmer`. Only the admin creates orchestrators.
- At most 2,000 active principals per namespace (deployment setting); beyond that `429 quota`.
- Revocation is seen by every KH instance within 5 s. `revoked` is final; create a new principal instead.
- **Grants never widen.** Effective projects = principal.projects AND namespace.projects AND the projects of
  the person the namespace acts on behalf of (refreshed periodically). A principal can never get a project its
  creator does not have.

If you run all agents under the namespace client token instead, everything works, but every write is
attributed to `client` and every lease holder is the same identity (see
[integration-patterns.md](integration-patterns.md#leases-and-fencing)).

## Role matrix

Admin may do everything. A type's `read_roles` / `write_roles` in the manifest can only narrow this.

| Role | events | records | rules | packs | items | retrieval / worklog | metrics | leases, effects | other |
|---|---|---|---|---|---|---|---|---|---|
| orchestrator | append, read | read, write | read, write | read, write | read | read / append | write, read | use | create principals |
| agent | append | read, write | read, write | read | read, propose | read / append | write | use | |
| judge | append, read | read, write | read | read | read | read / append | read | use | |
| grader | append, read | read | read | read | read | none | write, read | use | vault read |
| distiller | read | read | read | read | propose, write, read | read / none | read | none | |
| confirmer | read | read | read, confirm | read, confirm | read, confirm, withdraw | read / none | read | none | |

## Request headers KH reads

| Header | Purpose |
|---|---|
| `Authorization: Bearer <token>` | every call except `POST /v1/token` |
| `Idempotency-Key: <1-255 chars>` | on POST / PUT / PATCH; replay protection (see api-contract) |
| `If-Match: "<rev>"` / `If-None-Match: *` | conditional update / create-only |
| `X-KH-Lease`, `X-KH-Epoch` | fencing: both or neither |
| `X-KH-Run`, `X-KH-Unit`, `X-KH-Session`, `X-KH-Attempt` | envelope stamped on every write (`actor`), default for event envelope fields |

## 401, 403, 404, 423 semantics

| Status | Body | Meaning | What the consumer does |
|---|---|---|---|
| 401 | `{"detail": "sign-in required" \| "token expired" \| ...}` or `{"error": "unauthorized", ...}` | no / bad / expired token, disabled client, revoked or expired principal | refresh the token once; if it repeats, stop and alert (credentials problem) |
| 403 | `{"detail": "..."}` or `{"error": "forbidden", "detail": "..."}` | the identity is valid but has no right: other namespace, role not allowed, project not granted, service token on a non-`/v1` route | do **not** retry; it is an answer, not an outage. Fix the role / grant / manifest ACL |
| 404 `ns_not_active` | `{"error": "ns_not_active"}` | namespace detached, purged or never attached | treat as KH unavailable for this namespace (degraded mode) and alert |
| 423 `ns_suspended` | `{"error": "ns_suspended"}` | namespace is read-only (suspended by an admin, or a global agent stop) | stop writes, keep reading, buffer writes locally |

Auth middleware refusals carry only `detail`; capability refusals carry `error` + `detail`. Handle both.

## Isolation guarantees

- Every row carries the namespace id; every `/v1/{ns}/...` route resolves the namespace state and the caller
  before touching data. A service token on another namespace's path gets 403.
- Service tokens may call `/v1` routes only, never the people API.
- Records, events and metrics of a namespace are never served to people's own retrieval. Only items (lessons)
  and worklog lines of the same project are shared with people of that project (and the other way round, see
  `settings.retrieval.include_people_lanes` in the api contract).
- Vault content is readable only by `grader` and `admin`, and never appears in retrieval, search or export
  (export includes it only with an explicit admin flag).
- Every write stores `actor = {principal, role, on_behalf_of, run_id, unit_id, session_id}`.

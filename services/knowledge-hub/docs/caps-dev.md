# Writing a KH capability module (stage F)

How to add a module under `app/caps/` (records, rules, packs, items, vault, metrics, ...) without touching
shared code. Design: `docs/multi-agent-instance-design.md`. Reference modules: `coord.py`, `events.py`.

## 1. Plug in: one line

```python
# app/caps/__init__.py
MODULES = ["app.caps.registry", "app.caps.coord", "app.caps.events", "app.caps.principals",
           "app.caps.records"]          # <- your only edit to a shared file
```

Your module exposes:

| Name | Meaning |
|---|---|
| `NAME`, `VERSION` | capability name and semver; minor = additive only, breaking = new `/v2` path |
| `STATUS`, `SUNSET`, `LIMITS` | optional; listed by `GET /v1/capabilities` (`beta` by default) |
| `init(c)` | migrations: `sqldb.migrate(c, NAME, [(1, _m1), (2, _m2)])` - each step runs once |
| `attach(app)` | routes and hook registration |
| `CRONS` | optional `[(lease_name, interval_s, fn)]`, run under a `_kh` lease on one instance |

`KH_CAP_<NAME>=off` hides the module from discovery and its routes answer 404. `main.py` already calls
`caps.attach_all(app)` and `caps.start_crons()`.

## 2. Tables: dual DDL, migrations, SQL-only concurrency

```python
def _m1(c):
    sqldb.create_table(c, "kh_record",
        """CREATE TABLE IF NOT EXISTS kh_record (ns TEXT NOT NULL, type TEXT NOT NULL, id TEXT NOT NULL,
             rev INTEGER NOT NULL, body_json TEXT NOT NULL, PRIMARY KEY (ns, type, id))""",
        """CREATE COLUMN TABLE kh_record (ns NVARCHAR(32) NOT NULL, type NVARCHAR(128) NOT NULL,
             id NVARCHAR(128) NOT NULL, rev BIGINT NOT NULL, body_json NCLOB NOT NULL, PRIMARY KEY (ns, type, id))""")
    sqldb.create_index(c, "ix_kh_record_type", "kh_record", "ns, type")      # unique=True for unique
```

- Type map: `TEXT` -> `NVARCHAR(n)` (`NCLOB` for `*_json` and bodies), `INTEGER` -> `BIGINT`, `REAL` -> `DOUBLE`,
  times are `*_ms BIGINT` (UTC epoch ms). Every PK starts with `ns`.
- A later column: a new step with `sqldb.add_column(c, table, col, sqlite_type, hana_type)`. HANA DDL
  autocommits, so steps must be idempotent (these helpers check the catalogue).
- Never a process lock for correctness. Use only:
  - `sqldb.update(c, sql, params) -> rowcount` (conditional UPDATE / DELETE decides);
  - `sqldb.insert_new(c, table, row) -> bool` (first PK insert wins);
  - `sqldb.counter_add(c, name, delta)` inside the write transaction (gapless numbers);
  - `sqldb.now_ms_sql()` / `sqldb.now_ms(c)` for time: the database clock, never `time.time()` in a rule.
- Keep blocking DB work off the event loop: `await asyncio.to_thread(fn, ...)` in `async def` routes.

## 3. A namespace route

```python
from fastapi import Depends, Request
from app import sqldb
from app.caps import core, registry
from app.caps.core import CapError, Ctx, ns_ctx

def attach(app):
    @app.put("/v1/{ns}/records/{rtype}/{rid}", tags=["v1 records"])
    @core.idempotent                                  # Idempotency-Key on every POST/PUT/PATCH
    async def put_record(request: Request, ns: str, rtype: str, rid: str, ctx: Ctx = Depends(ns_ctx)):
        t = registry.type_of(ctx, rtype, kind_of="record")     # 404 / 422 when not in the manifest
        ctx.require("records", "write", type_row=t)            # role matrix + the type's write_roles
        body = await request.json()
        errors = registry.validate(ns, t, body)                # JSON Schema of the type's current version
        if errors:
            raise CapError("validation_failed", "body does not match the schema", extra={"errors": errors})
        return await asyncio.to_thread(_write, ctx, t, rid, body)
```

`ns_ctx` already did: namespace state from the 5 s cache (404 `ns_not_active`, 423 `ns_suspended` for writes
of a suspended namespace), the caller (person, namespace client, KH principal or the local user), the rate
quota (429 `quota`), and the envelope headers `X-KH-Run/Unit/Session/Attempt`.

`ctx` gives: `ctx.ns`, `ctx.ns_row` (projects, config, types, quotas), `ctx.role`, `ctx.is_admin`,
`ctx.caller` (`principal`, `kind`, `on_behalf_of`, effective `projects`), `ctx.actor()` (store it as
`actor_json` on every write), `ctx.require_admin()`, `ctx.require_project(p)` (403 outside the caller's grant).

Routes under `/v1/{ns}/...` need **no** `auth_rules.json` edit (the catch-all `ns` rule covers them and service
tokens are bound to their namespace). Only a new non-namespace `/v1/...` route needs a rule line.

## 4. Roles and ACLs from the manifest

- `core.ROLE_MATRIX` is design 3.4 (areas: events, records, rules, packs, items, retrieval, vault, metrics,
  admin, leases, effects). Add an area for a new concern in your PR to `core.py` only if no area fits.
- A type's `read_roles` / `write_roles` narrow the matrix: `ctx.require(area, action, type_row=t, op="read")`.
  `core.acl_allows(t, role, op)` filters lists (see `events._hidden_kinds`). Admin passes everything.
- Vault-like data: check `ctx.require("vault", "read")`; only grader and admin have it.

## 5. Fencing and If-Match

```python
def _write(ctx, t, rid, body):
    expected = core.require_if_match(ctx.request, t)          # 428 if the type demands If-Match
    with sqldb.connect() as c:
        if core.if_none_match_star(ctx.request):              # create-only
            if not sqldb.insert_new(c, "kh_record", {...}):
                raise CapError("duplicate", f"{rid} exists")
        else:
            rev = core.cas_update(ctx, c, "kh_record", {"ns": ctx.ns, "type": t["type"], "id": rid},
                                  {"body_json": core.jdump(body)}, expected)   # 409 write_conflict + event
        core.fence(ctx, c, required=t["fenced"])              # 409 stale_epoch + kh.stale_epoch, 428 if missing
    return core.reply(200, {...}, {"ETag": core.etag(rev)})
```

- `core.fence` checks `X-KH-Lease` + `X-KH-Epoch` inside your transaction; call it after the guarded write
  (a failure rolls the write back). Or AND `sqldb.fence_sql()` (params: ns, lease, epoch) into the statement.
- `cas_update` with `expected=None` is last-writer-wins (legacy behaviour); with a rev it is conditional.

## 6. Idempotency

`@core.idempotent` (below `@app.post(...)`, handler params named `request` and `ctx`) gives: replay of the
stored status and body with `Idempotent-Replay: true` and `kh.duplicate`; 422 `idempotency_mismatch` for a
different body; 409 `in_progress` + `Retry-After: 1` while the first call runs; take-over after 60 s.
2xx and 400/403/404/413/422 are stored; 409/423/428/429/5xx free the key so a retry can succeed.
Retention: 24 h, up to 7 d via manifest `retention.idempotency_hours`.

## 7. `kh.*` events

- After your transaction committed: `core.emit(ctx, "kh.my_thing", {...})` (own transaction, never raises).
- Inside a transaction: **do not** call `emit` (on SQLite it waits on your own write lock). Raise
  `CapError(code, detail, kh_events=[(ctx.ns, "kh.x", body, ctx.actor())])`; the error handler writes them
  after the rollback. `cas_update`, `fence`, quotas and lease loss already do this.
- Reserved names (design 3.5): `kh.write_conflict`, `kh.stale_epoch`, `kh.lease_lost`, `kh.duplicate`,
  `kh.quota`, `kh.served`, `kh.redacted`, `kh.canary_hit`, `kh.vault_read`, `kh.item_rollback`,
  `kh.item_promoted`, `kh.ns_state`. Add new ones to that list in the design doc.

## 8. Errors

Raise `CapError(code, detail, extra=..., headers=...)`. Body: `{"error": code, "detail": ..., **extra}`.
Codes and statuses live in `core.CODES` (stable: never rename; add new ones there). Consumers branch on
`stale_epoch`, `write_conflict`, `idempotency_mismatch`, `in_progress`, `quota`, `ns_not_active`.

## 9. Hooks into other modules (register in `attach`, guard against double registration)

| Hook | Use |
|---|---|
| `registry.TYPE_USAGE.append(fn(c, ns, type_row) -> rows)` | blocks removing a type that still has rows |
| `registry.ON_STATE.append(fn(c, ns, old, new))` | detach / reattach side effects, same transaction |
| `registry.ON_ATTACH.append(fn(ns, owner) -> dict)` | after a namespace is created |
| `core.CALLER_RESOLVERS` | identity sources (principals uses it; tests add a header resolver) |

Read manifest config through `ctx.ns_row["config"]` (`retention`, `redaction`, `vaults`, `settings`) and
`registry.index_values(t, body)` for the `ix_*` columns of a type (`ix_s1..4`, `ix_n1..2`, `ix_t1..2`).

## 10. Tests

One standalone script per module: `tests/caps/test_<module>.py`, printing `N checks, all passed`.

```python
from harness import H                     # throwaway SQLite, local RSA key, sign-in on, KH_NS_CACHE_S=1
c = H.client()                            # auth middleware + caps.attach_all
OWNER = H.person("olga@x.io", owner=["alpha"])
c.put("/v1/admin/ns/acme", json={"projects": ["alpha"]}, headers=OWNER)
c.put("/v1/acme/manifest", json={...}, headers=OWNER)
res = H.race(6, lambda i: c.post(..., headers=...).status_code)      # two-connection race test
H.check("RACE: one winner", sorted(res) == [201] + [409] * 5, res)
H.done()
```

- Real principals: create them with the admin client token (see `test_principals.py`); for quick role
  checks add a header resolver to `core.CALLER_RESOLVERS` (see `test_coord.py`).
- Every concurrency rule needs a race test (threads, one connection each). HTTP races are real races only
  when the route does its DB work in `asyncio.to_thread`.
- HANA: guard a live part with `KH_TEST_HANA=1` (see `tests/test_stage_f1.py`).
- Whole suite on HANA: `KH_TEST_HANA=1 KH_STORE_BACKEND=hana GRAPH_BACKEND=hana HANA_SCHEMA=KH_STAGEF_TEST`
  plus `HANA_HOST/PORT/USERNAME/PASSWORD` (`tests/hana_test_env.py`). Without both switches the tests force
  SQLite as before. The schema name must contain `TEST`: it is wiped at the start of every test file.
  Never issue `PRAGMA` or SQLite-only DDL from a test; use `sqldb.create_table` / the `SYS` catalogue on HANA.
- Before a commit run every `tests/test_*.py` and `tests/caps/test_*.py`.

## 11. Dev bootstrap (local Docker dev only)

A local dev KH (e.g. container `kh-dev-f`) signs people in against the production Keycloak realm, so a
script cannot get a person token and cannot reach `PUT /v1/admin/ns/{ns}`. `app/dev_bootstrap.py` adds ONE
static maintainer token for such a dev box:

```
KH_DEV_BOOTSTRAP=1
KH_DEV_BOOTSTRAP_TOKEN=<random, >= 32 chars; generate per run, never store>
KH_DEV_BOOTSTRAP_EMAIL=dev-admin@kh.local        # optional
Authorization: Bearer khdev.<KH_DEV_BOOTSTRAP_TOKEN>
```

- Off by default. With `KH_DEV_BOOTSTRAP=1` it is still REFUSED (an error is logged, the token is not
  accepted) on Cloud Foundry (`VCAP_*` / `CF_INSTANCE_GUID`), with a token shorter than 32 characters, or
  when the store is prod-like: HANA with the default schema `KNOWLEDGE_HUB` or a HANA Cloud host. It is
  allowed only on SQLite or on a non-default HANA schema (e.g. `KH_STAGEF`) of a local HANA.
- It changes nothing else: Keycloak tokens, KH principal tokens and `auth_rules.json` work as before. The token
  is compared in constant time; the startup log says `dev bootstrap ON` when it is active.
- Never set it in `deploy/btp/*`, a manifest or a committed env file.

Smoke over HTTP: `tools/stagef/smoke.py` (attach a namespace with the dev token, apply a manifest, exchange the
namespace client secret at `POST /v1/token`, append and read back an event). It reads the token from
`KH_DEV_BOOTSTRAP_TOKEN` or stdin and prints no secret.

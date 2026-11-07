# CR-125 — wave review + security (CR-122 tail, CR-123, CR-124, CR-125, arch a1–a10)

Range: `d19419e59..platform/gd0` (d19419e59 = last prod deploy). Review only, no code changes. Date 2026-11-07.
Scope: migrations hub 0112–0124, pack contracts 0082–0088, admin 0038–0039; public `/partner-reply/:token`; new endpoints; run-state changes; prod deploy readiness. UI styling not read.

**Counts:** Blocker 0 · High 2 · Medium 9 · Low 9

## Findings

| # | Sev | Where | Issue | Fix |
|---|---|---|---|---|
| H1 | High | `packages/db/src/migrate-hub.ts:68`, `migrate-packs.ts:49` (drizzle-orm 0.45.3 `pg-core/dialect.js migrate`) | Drizzle runs **all pending migrations of a folder in ONE transaction**. Splitting `ADD … NOT VALID` and `VALIDATE` into separate files (hub 0115/0116, 0122/0123, contracts 0085/0086) gives no lock benefit: ACCESS EXCLUSIVE on `hub.process_defs/process_runs/stage_runs/process_outputs/process_back_events` (hub 0115) and `contracts.contracts` (contracts 0085) is held through the VALIDATE scans and every later migration in the batch, until commit. `setup.sh:14` migrates while the old hub-api/admin-api keep running (`up -d` only at `:33`), so hub workers queue behind or deadlock with the migration. The hub batch has no `lock_timeout`. | For this deploy, stop `hub-api admin-api agent-runtime` before `migrate.ts`, or accept a short freeze after checking the row counts (checklist B). Later: add `SET LOCAL lock_timeout` at the top of hub 0115 and fix the "VALIDATE separately" comments, or run each migration in its own transaction. |
| H2 | High | `packages/db/migrations-pack-contracts/0088_stage_decided_once.sql:2` | `CREATE UNIQUE INDEX` (not CONCURRENTLY, inside the pack tx) on `contracts.contract_events`, a large prod table. It holds a SHARE lock (blocks all event writes) for the whole build. It **fails the deploy** if duplicate `stage_decided` rows already exist (the writer is new in this range, so that is unlikely but unchecked). `SET LOCAL lock_timeout='5s'` from 0083 carries over in the same tx, so a busy table makes the batch fail and roll back, not hang. | Run checks A1 and B before deploy. If the table is big, build the index CONCURRENTLY by hand first (`IF NOT EXISTS` then no-ops), or deploy with apps stopped. |
| M1 | Medium | `apps/hub-api/src/modules/packs/contracts/partner-routes.mount.ts:72-134`, `adapters/partner-send.tool.ts` (`run`) | Feature `contracts-partner-confirm` gates only the nav item (`nav.mount.ts:50`). No `/partner/*` route (inbox, invites accept/block, sends, record, settings) and not the `contracts-partner-send` tool checks it. A tenant with the feature off can still call the partner API and send. | Add `r.use("/partner/*")` with a `tenantFeatureOn(PARTNER_FEATURE)` check (404 when off), and the same check at the start of tool `run`. |
| M2 | Medium | `apps/hub-api/src/modules/packs/contracts/partner-mailbox.mount.ts:4`, `modules/processes/processes.mount.ts:264` | When `HUB_PARTNER_MAILBOX=off` (the prod default), the send tool still writes `hub.partner_mailbox` rows, but nothing moves them (no mover, no email loop, no public page). Flows using "Gửi đối tác xác nhận" wait until expiry and the user sees no reason. | Make the tool fail fast with a clear error when the mailbox is off, or keep the feature off for every tenant (checklist C3). |
| M3 | Medium | `apps/hub-api/src/modules/packs/contracts/application/esign-switch.ts:76-92` | Race: the old envelope is voided at the provider (`:82`) before the row is marked voided (`voidClaimed`, `:90`). A voided webhook or sync in that window sees a `sent` row and runs `onStatus('voided')`, so the waiting run leaves the signing step. The switch then still resends, because the `voidClaimed` false return is ignored. Result: a live new envelope that no step waits for. | In `sync`/`finalHook`, skip rows whose `expire_claimed_at` switch lease is held. Abort the resend when `voidClaimed` returns false. |
| M4 | Medium | `apps/hub-api/src/modules/processes/adapters/runs/step.repo.ts:65` (`branchesOf`) | Changes routing for in-flight runs. Snapshots with `after.branch: []` (Library templates) now fall back to approve/reject/return and wait-event rules, so a Reject or wait outcome can jump steps mid-run. | Accept the change and list the affected runs (A4). Otherwise apply it only to snapshots created after the deploy. |
| M5 | Medium | `application/runs/settle-step.usecase.ts:68`, `adapters/runs/flow-step.repo.ts:63` | Changes routing for in-flight runs. An If on a blank `input`/`fact` now stops at `needs_decision{missing_fact}` instead of taking the else branch. | Tell operators. List affected runs (A5). |
| M6 | Medium | `packages/db/migrations-hub/0116_validate_stages_ck.sql`, `0123`, contracts `0086` | A VALIDATE fails the whole batch if any existing row breaks the new check. This only happens if earlier constraints were missing or NOT VALID. | Run check A2 (must return 0 rows). |
| M7 | Medium | `apps/hub-api/src/modules/partners/adapters/partner-public.routes.ts:65,109-111` + `deploy/prod-sohoptac2/gen-env.sh:45,101` | In tunnel mode, `TRUST_PROXY_HOPS=1` makes every visitor to the public page share one IP bucket (the tunnel or nginx peer). One client sending 10 bad tokens locks the page for everyone for 10 min (`badTokenPerIp10Min`), and `perIpMinute=60` is shared. In tunnel mode `HUB_NOTIFY_BASE_URL=http://localhost:…`, so email links do not work for outside partners. | Turn on the email channel (`HUB_PARTNER_MAILBOX=on`) only in domain mode (`TRUST_PROXY_HOPS=3`, public https `HUB_NOTIFY_BASE_URL`), per checklist C. |
| M8 | Medium | `packages/db/migrations-pack-contracts/0085_partner_send.sql:9-13` | DROP and ADD of `contracts_deal_source_ck` on `contracts.contracts` take ACCESS EXCLUSIVE, then 0086 scans the table in the same tx (see H1). | Covered by H1/H2. Check the row count (B). |
| M9 | Medium | `apps/hub-api/src/modules/packs/contracts/application/esign-node.usecase.ts:76`, e-sign node send path | Changes behaviour for stored defs. `checkNode` no longer checks the provider, and the e-sign node now sends with provider `undefined` (the signer chooses). A `provider` saved in existing defs is silently ignored. | Record it in the spec Delta. List affected defs (A8) and tell those tenants. |
| L1 | Low | `packages/db/migrations-hub/0122_partner_hold.sql:75-87` | `partner_send` now creates a `held` row to **any** tenant uuid, even with no link row and no directory check. Rows never deliver but take up storage (no rate limit). B's `partner_mailbox_mine` ('in', no status filter, `0117:247`) lists these held rows with the sender's uuid. | Require a link row with `requested_at` before `held`, or filter `status <> 'held'` from 'in' in `partner_mailbox_mine`. |
| L2 | Low | `packages/db/migrations-hub/0118_partner_links_fn.sql:74-88,118-120` | `partner_link_block` accepts any existing tenant uuid. `partner_links_mine` then shows that tenant's `legal_name`/`tax_code` to the blocker even if the tenant is not listed in the directory. Needs the uuid, so low impact. | In `partner_links_mine`, show the other side's name only when it is listed or it sent a request. |
| L3 | Low | `packages/db/migrations-hub/0115_platform_settings_stages.sql:24-41` | `hub.set_platform_setting` is granted to `hub_rw` with no DB-side caller check. Only the route (`requirePlatformAdmin`) enforces platform_admin. | Acceptable (stated in comment). Optionally check `app.scope='platform'` like `admin.directory_set_verified`. |
| L4 | Low | all new hub/admin DEFINER fns | Tenant trust rests on the `app.tenant_id` / `app.scope` session GUCs, which any session of the role can set. This is the existing platform pattern (like `emit_flow_event`). The functions are otherwise correct: `search_path = pg_catalog, pg_temp`, REVOKE PUBLIC, minimal grants, `partner_reply_apply` has no EXECUTE grant, and tables have RLS on with a system-only policy. FORCE RLS is not set, which DEFINER owner access needs. | None. Noted for completeness. |
| L5 | Low | `apps/hub-api/src/modules/packs/contracts/partner-routes.mount.ts:107` | The `recordManual` route ignores the `partner_reply` boolean, so it returns `{ok:true}` even when nothing was recorded. | Return 409 when the result is false. |
| L6 | Low | `apps/hub-api/src/modules/packs/contracts/application/esign-switch.ts:69` | `s.signed_at !== null` treats a missing key as "signed", so the switch is wrongly refused. The SQL claim uses `coalesce` correctly. | Use `!= null`. Check A7. |
| L7 | Low | `apps/hub-api/src/modules/processes/adapters/runs/step.repo.ts:102` (`canonicalCondValue`) | Old snapshots with `"true"`/`"false"` strings on fact conditions are now read as booleans, so an If that never matched can now match mid-run. | List affected runs (A6). |
| L8 | Low | `packages/db/migrations-hub/0116_validate_stages_ck.sql:1` | The comment contains a literal `\n`. Harmless (the whole line is a comment), but the file hash is now fixed in prod. | Leave as is (do not edit after apply). |
| L9 | Low | `packages/db/migrations-hub/0112_contract_id_key.sql`, `0114` | Defs that declare both `contract-id` and `contract_id` are skipped and need manual handling. In-flight runs keep the old key through `inputKeyOf`. | Run A3 and fix those defs by hand. |

**Checked clean:**
- **Journals.** All three folders have file count = entry count (hub 108, pack-contracts 82, main 40), with no missing entry or file. `when` increases and `idx` has no gaps in the new range; the old pack-contracts idx gaps at 0005/0006/0026/0059/0069 were already there.
- **Migration edits.** No previously applied migration file was edited.
- **`migrate-guard`** runs before every folder.
- **Public page.** 256-bit token, stored only as a hash. Per-IP and per-token limits in Redis, with an in-process fallback. Double-submit CSRF plus `Sec-Fetch-Site`, a 16 KB body limit, `no-store`/`noindex`/strict CSP/`no-referrer`, and a PDF sha256 match. The token is redacted in hub logs, the nginx access log and the edge log, and OTel uses the route pattern. The route is mounted only when `HUB_PARTNER_MAILBOX=on`.
- **AuthZ.** Invites, settings (`owner_user_id` checked by `partner_is_member`), directory (listed: tenant_admin of the same tenant; verify: platform_admin at route, service and DB), my-work signing, `PUT /process-editor/limits` (platform_admin) and company-flows apply (`companyAccess` plus a `tid` filter on every query) are all clean.
- **Boot `moduleRegistry.verify`** (`kit/adapters/module-registry.ts`, `packs.modules-check.ts`) compares only the code-level `MODULES` declarations with the bindings registered at mount. It does **not** read stored defs, so no prod data can fail boot. The e-sign validator is bound under the same condition as `mountContracts`.
- **elk worker.** `apps/admin-web/rsbuild.config.ts:71` copies `elk-worker.min.js` to `dist/static/elk/`, and the Dockerfile copies `dist` to `/srv/admin`. Only admin-web (`ProcessCanvas`) uses it.

## Pre-deploy checklist

### A. SQL on prod (read-only; run as `s2_owner` on `ai_system`)
```sql
-- A0 migration tracking: last applied `when` must be < first new `when`, and the counts must match the journal before this deploy
select 'hub' t, count(*), max(created_at) from drizzle.__drizzle_migrations_hub            -- expect 95, max < 1806200000000
union all select 'main', count(*), max(created_at) from drizzle.__drizzle_migrations        -- expect 38, max < 1803500000000
union all select 'pack_contracts', count(*), max(created_at) from drizzle.__drizzle_migrations_pack_contracts; -- expect 78, max < 1806600000000
-- A1 0088: duplicates block the unique index (must be 0 rows)
select tenant_id, data->>'task_id' task, count(*) from contracts.contract_events
 where type='stage_decided' and data ? 'task_id' group by 1,2 having count(*)>1;
-- A2 0116 / 0123 / 0086 VALIDATE (every count must be 0)
select 'defs',count(*) from hub.process_defs where not (jsonb_typeof(stages)='array' and jsonb_array_length(stages) between 1 and 50)
union all select 'runs',count(*) from hub.process_runs where current_stage_idx not between 0 and 49 or current_step not between 0 and 49
union all select 'stage_runs',count(*) from hub.stage_runs where stage_idx not between 0 and 49 or round<1 or (back_to_step is not null and back_to_step not between 0 and 49)
union all select 'outputs',count(*) from hub.process_outputs where not (stage_idx between 0 and 49 and version>=1 and attempt>=1)
union all select 'back',count(*) from hub.process_back_events where not (from_stage_idx between 0 and 49 and to_step>=0 and to_step<from_step and from_step<=49 and round_after>=2 and char_length(feedback) between 1 and 4000)
union all select 'deal_source',count(*) from contracts.contracts where not ((source is null or source in ('invoice','verbal','message','quote','other','partner_inbox')) and (doc_type<>'deal' or (source is not null and deal is not null and kind='contract')));
-- A3 defs declaring both input keys (0112/0114 skip these; fix by hand)
select id, tenant_id, key from hub.process_defs where strpos(inputs::text,'"contract-id"')>0 and strpos(inputs::text,'"contract_id"')>0;
-- A4 in-flight runs whose routing changes (after.branch = [])   [adjust the terminal status set if isTerminal differs]
select r.id, r.status, s.ord-1 stage_idx from hub.process_runs r, jsonb_array_elements(r.snapshot->'stages') with ordinality s(st,ord)
 where r.status not in ('done','cancelled','failed') and jsonb_typeof(st->'after'->'branch')='array' and jsonb_array_length(st->'after'->'branch')=0;
-- A5 in-flight If on input/fact (blank value now stops at needs_decision)
select distinct r.id, r.status from hub.process_runs r, jsonb_array_elements(r.snapshot->'stages') st, jsonb_array_elements(st->'executor'->'when'->'conds') c
 where r.status not in ('done','cancelled','failed') and st->'executor'->>'kind'='if' and c->'from'->>'kind' in ('input','fact');
-- A6 in-flight If fact with "true"/"false" string values
select distinct r.id from hub.process_runs r, jsonb_array_elements(r.snapshot->'stages') st, jsonb_array_elements(st->'executor'->'when'->'conds') c
 where r.status not in ('done','cancelled','failed') and st->'executor'->>'kind'='if' and c->'from'->>'kind'='fact' and jsonb_typeof(c->'value')='string' and c->>'value' in ('true','false');
-- A7 open envelopes: switch lease already set, or signer missing the signed_at key
select id, contract_id, expire_claimed_at from contracts.esign_envelopes
 where status in ('sent','delivered') and (expire_claimed_at is not null or exists (select 1 from jsonb_array_elements(signers) s where not (s ? 'signed_at')));
-- A8 stored e-sign defs whose saved provider is now ignored
select id, tenant_id, key from hub.process_defs where stages::text like '%contracts-esign-send%' and stages::text like '%"provider"%';
-- A9 role exists for pack grants (0085 grants hub fns to contracts_rw)
select rolname from pg_roles where rolname in ('contracts_rw','hub_rw','hub_ro','admin_rw');
```

### B. Lock or size risk (decides whether to stop the apps during migrate)
```sql
select relname, n_live_tup, pg_size_pretty(pg_total_relation_size(oid::regclass)) from pg_stat_user_tables
 join pg_class using (relname) where schemaname in ('hub','contracts')
  and relname in ('process_runs','stage_runs','process_defs','process_outputs','process_back_events','contracts','contract_events','esign_envelopes');
```
If `contract_events` or `contracts` is more than about 1M rows, or `stage_runs` more than about 5M: stop `hub-api admin-api agent-runtime` before `migrate.ts` (planned downtime of a few minutes). Otherwise, prebuild `contract_events_stage_decided_uq` CONCURRENTLY by hand.

### C. Env (`deploy/prod-sohoptac2/.env`, read by hub-api and admin-api)
1. `TRUST_PROXY_HOPS`: 3 in domain mode, 1 in tunnel mode. Check with `grep -E 'TRUST_PROXY_HOPS|S2_DOMAIN|HUB_NOTIFY_BASE_URL' .env`.
2. `HUB_PARTNER_MAILBOX`: leave unset/`off` for this deploy (default off). Turn it `on` only in domain mode with a public https `HUB_NOTIFY_BASE_URL` and the notify SMTP transport configured (otherwise the log shows `partner-email-disabled`).
3. Feature `contracts-partner-confirm` must stay unassigned while the mailbox is off (M1/M2): `select e.tenant_id from admin.feature_entitlements e join admin.features f on f.id=e.feature_id where f.key='contracts-partner-confirm' and e.revoked_at is null;` should return 0 rows.
4. After deploy: `curl -sI https://<admin-host>/static/elk/elk-worker.min.js` must return `200` and `Content-Type: application/javascript`, about 1.5 MB. An HTML response means `try_files` fell back to index.html and the flow editor layout is broken.
5. Prod divergence (memory 2026-10-30): check `VERSION` and A0 hashes against the journal. `migrate-guard` fails hard on a mismatch.

# CR-125 — Solution Architect review (read-only, platform/gd0 @ c950033d8, 2026-11-08)

Scope: code structure sampled, not read in full. Started from `docs/platform/architecture.md`, CODEMAP/INDEX, ADR titles, CLAUDE.md "Luật GỐC", then sampled hub-api modules (packs/kit, packs/contracts, processes, notify, ops, partners), packages (contracts, web-kit, i18n), web apps, admin-api and tooling. Paths under `hub/` mean `apps/hub-api/src/modules/`. Line numbers are the ones at that commit.

## Summary

**Strengths**
- The gates are enforced by tools, not by discipline. The `check` chain runs 18 checks (size, depcruise, boundaries, modules, i18n, error-codes, fn…). lefthook has a 20 s affected-depcruise budget. The depcruise baseline holds 15 known violations, all of them DLC.
- The layering inside layered modules is clean. No domain or application file imports adapters or the db. No `public.ts` uses `export *`.
- Pack tenancy is solid. `packs.secure_table` (`packages/db/migrations-packs/0001_kit.sql:26-49`) applies ENABLE + FORCE RLS with `tenant_id NOT NULL`. `packages/test-kit/src/rls-suite.ts:174-194` catches pack tables that skip it.
- Migrations and purge are well guarded. `packages/db/src/migrate-guard.ts` checks hash drift, `when` ordering and `ACCEPTED_EDITS`, and `verify:predeploy`/`verify:prod` check prod divergence. Tenant purge derives its table list from the catalog and fails on unknown references (`tools/scripts/src/tenant-purge.db.ts:35`).
- Operability is unusually mature. ops-watch has 14 checks, including drift checks between duplicate sources (`hub/ops/adapters/checks/registry.ts:18-33`). The repo has 65 `*.perf.int.test.ts` files, a bundle budget in every web app, zod-validated env, and an idempotent YAML tenant onboard.

**Counts:** Blocker 1 · High 5 · Medium 8 · Low 6.

## Findings

### Blocker

**B1. Hub tables that hold tenant data have no RLS, and nothing would catch a new one.**
- **Evidence:**
  - These tables have `tenant_id`, are granted to `hub_rw`, and have no `ENABLE ROW LEVEL SECURITY` or policy in any migration: `hub.jobs`, `hub.usage_logs` (`packages/db/migrations-hub/0000_hub_core.sql:456-460`), `hub.cli_sessions` (`0002_h2a_dify.sql:143`), `hub.audit_log` and `hub.agent_grants` (`0009_h3b_agent_grants.sql:2,56-58`; only `admin.audit_log` has RLS, `migrations/0007_m4_ops.sql:84`), `tenant_agent_defaults` and `agent_entitlements` (`0018_cr054_agent_defaults.sql:24,63`), `agent_team_entitlements`, `ai_token_holds`, `dify_runs`.
  - The hub/admin RLS tests pin hard-coded lists (`packages/db/src/hub-rls.int.test.ts:238-256`; `tests/acceptance/M2|M3/db-rls.int.test.ts` asserts exactly 23 tables). They do not check the rule "has `tenant_id` ⇒ must have RLS".
  - hub-api has no superuser/BYPASSRLS/owner guard at startup. admin-api has one (`apps/admin-api/src/lib/db-guard.ts:15-26`); a search for `rolbypassrls|rolsuper` in `apps/hub-api/src` finds nothing.
- **Impact:** Isolation on these tables depends only on `WHERE` clauses. One missing filter, or about 130 `kind:"system"` call sites, can leak data across tenants, including audit, entitlements and token holds. Every new hub table is a fresh chance for this.
- **Fix:**
  - (a) Add a migration that applies `secure_table`-style ENABLE + FORCE RLS with tenant policies to the 10 tables, keeping a system-scope branch like `0019_pa_process_engine.sql`.
  - (b) Replace the pinned lists with a catalog-derived int test: every table in a hub/admin schema with a `tenant_id` column must have FORCE RLS and at least one policy, with an explicit allowlist for exceptions.
  - (c) Port `db-guard.ts` to hub-api `server.ts`.
- **Effort:** M. This is a full-lane change (Opus review).

#### B1 verification (read-only, 2026-11-08, migrations-hub up to `0126`)

Method: parsed every `CREATE TABLE hub.*` plus `ADD COLUMN tenant_id` in `packages/db/migrations-hub`, every `ENABLE ROW LEVEL SECURITY`/`CREATE POLICY`/`GRANT`, then extracted every SQL literal in `apps/**` (non-test) that touches these tables and flagged the ones without a tenant predicate. There is no local DB, so this is static. Confirm it against `pg_class` in the int test below.

**Facts that change the picture**
- 11 tables, not 10. `hub.orchestrator_settings` gained `tenant_id` in `0006_h2b_routing.sql:39` (NULL = platform default row) and has no RLS either.
- **No hub table uses `FORCE ROW LEVEL SECURITY`.** That includes the ~60 that are ENABLEd. This is safe today only because the runtime role is not the table owner (see the role finding).
- No request-scoped query that actually misses its tenant filter was found. Every statement without `tenant_id` is a worker or system path (agent-runtime `jobs_sql.py`/`apply_sql.py`/`resolve_sql.py`, sweeps, ops-watch), a platform_admin-only route (Studio, admin `overview.runs24h`, `workflows.runs`), or a lookup by an unguessable job id/token hash (`attachments.repo.ts:249-286`, `internal/autofix.repo.ts:54`). The tenant_admin path in admin `usage.repo.ts` relies on `usage.service.ts:47` to force a concrete `tenantId`: `scopeWhere(null)` = `true`.

| Table | Grants (direct) | Touched from | Class |
|---|---|---|---|
| `audit_log` | hub_rw S,I | user requests: `my-history.repo.ts:157`, `run-detail.repo.ts:146`, `history.repo.ts:78`, `view.service.ts:283`, plus 7 insert sites | **a** |
| `agent_grants` | hub_rw S,I,D · admin_rw S | tenant admin `agent-grants.repo.ts:105-199`; Studio (platform) `entitlements.repo.ts`; admin `groups.hub.ts`, `workflow-tools.repo.ts:78` | **a** |
| `agent_entitlements` | hub_rw S,I,U(cols) | `agent-settings.repo.ts:59-142`, `agent-spec.service.ts:27`, `teams.repo.ts:110`, `room-post.repo.ts:97` | **a** |
| `tenant_agent_defaults` | hub_rw S,I,U | `agent-settings.repo.ts:84,101`; Studio `agents.repo.ts:346` (all tenants, boolean only) | **a** |
| `agent_team_entitlements` | hub_rw S,I,U(cols) | `teams.repo.ts:32`, `team-load.ts:168` | **a** |
| `orchestrator_settings` | hub_rw S,I,U,D | tenant request `agent-settings.repo.ts:52-61` and `agent-grants.repo.ts:51` read every tenant's row (agent_id only); Studio `orchestrator.repo.ts` | **a** |
| `jobs` | hub_rw S,I,U · agent_runtime S,U | request inserts (`runner.repo.ts:52`, `workflow-job.repo.ts:48`), run trace/detail reads; worker claim/heartbeat with no tenant (by design) | **a** |
| `usage_logs` | hub_rw S · agent_runtime S,I · admin_rw S | admin-api tenant_admin reports (`usage.repo.ts`, `quotas.repo.ts`, `daily-limits.repo.ts`), hub `runner.repo.ts:141` (by job id) | **a** |
| `cli_sessions` | hub_rw S,I,U · agent_runtime S,I,U,D | user-scope tx: `launcher-session.ts:124,211`, `dify-agent.repo.ts:64-87`, `agent-call.service.ts:194` (all filter tenant) | **a** |
| `ai_token_holds` | none (REVOKE PUBLIC) | only the SECURITY DEFINER fns in `0043`/`0045`, which filter `p_tenant_id` | **b** |
| `dify_runs` | admin_rw S only; hub_rw reads an aggregate view without tenant columns (`0100`) | writes via DEFINER `hub.log_dify_run`; reads platform_admin-only (`workflows.runs.ts`, `usage.repo.ts:30` → 403 for tenant_admin) | **b** |

Class c: none of the 11. The 25 hub tables without `tenant_id` (providers, agents, agent_teams, kh_connections, agent_hooks, ops_*, process_slots, platform_settings, partner_* …) are platform config. The partner_* tables already have system-only RLS.

**Role finding.**
- hub-api connects as `hub_api` in every environment: `.env.example:92`, `.env.production.example:46`, `deploy/stg-cr118/gen-env.sh:37`, `deploy/stg-sohoptac2/gen-env.sh:36`, `deploy/prod-sohoptac2/gen-env.sh:34`. Env validation is in `apps/hub-api/src/config/env.ts:25`.
- `hub_api` is created and re-asserted `NOSUPERUSER NOBYPASSRLS` in `0000_hub_core.sql:13,21`. Tables are owned by the migration role (`s2_owner` in prod: `setup.sh:22`), so ENABLE alone binds hub_api.
- The superuser/owner claim is therefore a **missing guard, not a live bypass**. Nothing stops a DSN typo (for example the owner `DATABASE_URL`) from silently disabling every hub policy.
- `hub_api` is also a member of the pack roles `<k>_rw` (`WITH INHERIT FALSE, SET TRUE`, `migrations-packs/0001_kit.sql:96`). `pg_has_role(..,'MEMBER')` counts these, so the guard must scope its owner check to the `hub` (+`admin`) schemas.

**Prod exposure today:** no confirmed leak. The 9 class-a tables (audit, grants, entitlements, agent defaults, jobs payloads, usage, CLI sessions) are isolated only by hand-written `WHERE tenant_id`, which are correct at every current call site. The risk is latent: one missing predicate in a request path would leak them, and nothing would catch it.

#### B1 fix plan

**S1a · migration `packages/db/migrations-hub/0127_hub_rls_gap.sql`** (next free: last is `0126_flow_triggers_backfill`, journal idx 109, `when` 1806900800000 → use idx 110, `when` 1806900900000; re-check open slice worktrees for a claimed 0127 before starting). Not written yet.
- Use the same predicates as `0019:665-670`. `T` = `scope='system' OR (scope='user' AND tenant_id = app.tenant_id)`. Write it idempotently (`IF NOT EXISTS pg_policies`).
- `ENABLE` + policy `TO hub_rw`, using T for `FOR ALL` unless noted:
  - `audit_log`, `agent_grants`, `agent_entitlements`, `tenant_agent_defaults`, `agent_team_entitlements`, `cli_sessions`, `jobs`, `usage_logs`.
  - `orchestrator_settings`: SELECT = T OR `tenant_id IS NULL`. Write = system only, the same as `process_defs`.
    - First change `agent-settings.repo.ts:52-61` and `agent-grants.repo.ts:51` to go through a DEFINER fn `hub.orchestrator_agent_ids()` that returns only agent ids. Otherwise the tenant UI loses the "is orchestrator" flag for other tenants' orchestrators.
- Other roles that need policies, or they lose access once RLS is enabled:
  - `agent_runtime` on `jobs`, `cli_sessions`, `usage_logs`: `USING (true)`. The worker is a trusted system process and claims across tenants. Document this in the migration header, the same as `0022_pb_runs_grant.sql`.
  - `admin_rw` on `usage_logs`, `agent_grants`: SELECT with the `usage_daily` predicate (`0049:67-70`: `app.scope='platform' OR (scope='tenant' AND tenant_id=app.tenant_id)`).
- Before merge, grep every caller of the 9 tables for the scope it runs in. Any path that runs with no `app.scope` set would now see 0 rows. The main suspects are the Studio repos, `hub-audit.ts`, ops checks and the seed (seed runs as owner, so it is unaffected without FORCE). Add `withSystem` where that is missing.
- FORCE (whether to add it, and its owner problem) is covered under S1c below.
- Leave `ai_token_holds` and `dify_runs` without RLS, on the allowlist. Their access is DEFINER-only, and FORCE would break those fns.
- Perf: the policies are the same scalar `current_setting` predicates already used on hot tables. The `jobs` claim path runs as agent_runtime `USING (true)`, so its plan is unchanged. Re-run `claim_scale_int_test.py` and the hub claim perf test once.

**S1b · startup guard `apps/hub-api/src/lib/db-guard.ts`** (port `apps/admin-api/src/lib/db-guard.ts`).
- Fail when `current_user` is MEMBER of any `rolsuper OR rolbypassrls` role, or owns (MEMBER of the owner of) any table in schemas `hub`/`admin`.
- Leave `packs` out: the pack roles are SET-able members, and the packs side has its own `secure_table`.
- Call it in `server.ts` right after `connectDb` and before mounting routes; on failure, `exit 1`. Do the same for the `KNOWLEDGE_DATABASE_URL` pool, with schema `knowledge`.
- Tests: unit, owner DSN → throws (int, one file).

**S1c · catalog-derived RLS coverage test**
- Replace the pinned list in `packages/db/src/hub-rls.int.test.ts:238-256` with a single query over `pg_class` ⨝ `pg_namespace` ⨝ `pg_attribute`. It selects every ordinary or partitioned table in `hub` and `admin` that has a `tenant_id` column.
- Each such table must have `relrowsecurity` and at least one `pg_policies` row, unless it is listed in `HUB_RLS_ALLOWLIST = { table: reason }` in the test file. Initial entries:
  - `ai_token_holds`: no direct grant; DEFINER fns only.
  - `dify_runs`: no hub_rw grant; DEFINER writes; platform-only reads.
- The allowlist test also fails when an entry has become stale: the table is gone, or now has RLS.
- FORCE (`relforcerowsecurity`) is the strict target. Today the test asserts NOT owned-by-runtime-role instead, for two reasons:
  - S1b's guard already covers what FORCE protects against.
  - FORCE on tables written by owner-run SECURITY DEFINER fns (`log_dify_run`, the room-post fn in `0016`, the partner_* fns, the ai_token fns) would hide rows from those fns unless they set `app.scope='system'`.
- Follow-up `0128` adds FORCE where no DEFINER fn writes. The test then requires FORCE for every table except a second allowlist, `FORCE_EXEMPT = { table: "owner-definer fn <name>" }`.
- Do the same for `tests/acceptance/M2|M3/db-rls.int.test.ts` (exact-23 count → derived).

Lane: full (RLS). Sonnet high writes S1a–c; Opus low reviews the policy/grant diff and the "no scope set" caller list.

### High

**H1. The CR-125 node model covers only part of the engine; there are two registries.**
- **Evidence:**
  - Only 3 `node.ts` files exist (`contracts/esign`, `contracts/partner-send`, `community/show-post`), plus core inline in `packages/contracts/src/modules/core/index.ts:63`.
  - The engine's own registry is `hub/processes/nodes/registry.ts:20-33`, with 12 `ExecutorKind`s and dispatch in `registry.launch.ts`.
  - The core binding only "records" existing executors (`hub/packs/core/nodes/core-nodes.binding.ts:2,19-30`). It covers approve/if/notify/set/wait_until/wait_for. **agent, team, apply, tool, form and wait_event have no declaration**, so AI steps, tools/webhooks, forms and event waits bypass the ports, `requires`, `exits` and `moduleIssues`.
  - On the web, `FE_NODES` is still the built-in registry (`apps/admin-web/src/features/processes/nodes/registry.ts:69`, used in 5 files). That contradicts architecture.md §3, which says `FE_NODES` was removed.
  - `NODE_CONFIGS = {"contracts.esign": ESIGN_CODEC}` sits outside `modules/` (`apps/admin-web/src/features/processes/lib/node-config.ts:37-39`).
  - `StageForm.tsx` (332 lines) branches on executor kind at lines 159-170, 169, 261-273, 264-318 and 320-328.
- **Impact:** "Add a node = one folder per layer" only holds for pack nodes. Built-in kinds still need edits in shared files: the engine registry, `FE_NODES`, StageForm and node-summary/stage-label switches. A 3rd app adding a non-trivial step will touch the engine.
- **Fix:**
  - Declare the remaining 6 kinds as `core` `FeatureNodeDecl`s with ports and exits.
  - Make `processes/nodes/registry.ts` derive its kind list from the module index, and have `moduleRegistry.verify` assert both registries are equal.
  - Move `NODE_CONFIGS` into `panel-registry`.
  - Replace the StageForm ladders with a per-kind editor-section registry.
  - Fix the doc drift in architecture.md.
- **Effort:** L. Split it into H1a (contracts and verify, M), H1b (admin-web editor registry, M) and H1c (docs, S).

**H2. Status state machines are not owned in one place.**
- **Evidence:**
  - There are 103 `set status =` statements across 49 non-test files, 19 of them in processes: `gates/gates.repo.ts` (7), `adapters/runs/step.repo.ts` (4), `adapters/runs/flow-step.repo.ts` (4), `runs/expire.ts` (3), and the `nodes/*/launch.ts` files.
  - Contract status is written from `hub/packs/contracts/approval.repo.ts:184,212,229`, `approval-engine.repo.ts:129` (the same `active` transition as `approval.repo.ts:184`), `approval-sweep.repo.ts:50,83`, `extraction.repo.ts:131,152`, `cks/adapters/cks-write.repo.ts:260`, `reopen.repo.ts` and `review.repo.ts`.
  - There is no transition table or `canTransition` guard. `processes/domain/runs/run-timeline.rules.ts` covers only the view.
- **Impact:** An illegal transition (for example terminated → active through a reopen race) is only caught if each SQL statement happens to carry the right `WHERE status IN (...)`. This is the area CLAUDE.md flags as the main source of bugs (CR-103, CR-122).
- **Fix:**
  - Add pure `domain/*-status.rules.ts` transition tables for the run, stage and contract machines in `packages/contracts` or the module domain.
  - Add one repo helper per machine, `transition(id, from[], to)`, that emits `UPDATE … WHERE status = ANY($from) RETURNING`, and route the writers through it.
  - Add an int test that greps for direct `set status` outside the helper, as a check script.
- **Effort:** L. Split into H2a (contracts, M) and H2b (runs/steps, M, Opus medium).

**H3. Engine side effects after commit are best-effort.**
- **Evidence:** `hub/processes/adapters/outbox.ts:1-3` publishes the unit-of-work events after commit (kick, `post_thread`, `user_events`). Its own comment says a failed event is only logged. The only durable outbox tables are `hub.flow_events` (the trigger dispatcher) and `packs.index_outbox` (`migrations-packs/0001_kit.sql:67`).
- **Impact:** A crash or Redis blip between commit and publish leaves a run that is committed but not kicked, or a missing thread post. Recovery then depends on sweeps or timers, and this review did not verify that every case is covered.
- **Fix:**
  - First confirm whether a periodic sweep re-kicks runs that are ready but idle.
  - If it does not, persist kicks and thread posts to a `hub.process_outbox` table in the same transaction. Drain it with `FOR UPDATE SKIP LOCKED` (reusing the dispatcher pattern) and add a perf test.
- **Effort:** M. Opus medium (run state).

**H4. Business labels cross the API as Vietnamese strings, and the web compares against them.**
- **Evidence:**
  - `hub/packs/contracts/domain/approval-step-label.rules.ts:23-31` returns "Từ chối", "Đã duyệt", "Chờ ${who} ký"…
  - `apps/workspace-web/src/features/contracts-list/lib/row-view.ts:39` tests `stepLabel === "Đã duyệt"`.
  - The notify module hard-codes contract mail copy and the kind: `hub/notify/domain/sign-invite-mail.rules.ts:5,9,91,98,107`.
  - Other server-side label maps: `apps/admin-api/src/modules/packs/packs.rules.ts:20` (`ROLE_LABEL`), `hub/packs/contracts/application/esign-flow.usecase.ts:81`.
- **Impact:** This breaks Luật GỐC 1 and 2 (one source, one name). Editing a label breaks logic silently. A second locale, or a 3rd app reusing notify, needs code edits in platform modules.
- **Fix:**
  - The API returns codes (`outcome: "approved" | "rejected" | "waiting_sign"`, `who`). The web renders them through `@ai/i18n`, and the comparison uses the code.
  - Move the sign-invite mail template and kind into the contracts pack, behind a notify template port.
  - Add a `check:` rule that flags VI literals in hub `domain/**/*.rules.ts` return values.
- **Effort:** M.

**H5. There is no shared shell or HTTP/auth client, so a new app copies an old one.**
- **Evidence:**
  - `packages/web-kit/src` has auth, http and ui, but no shell or settings layout.
  - Each app has its own shell: admin-web `features/shell/components/AppShell.tsx`, chat-web `AppShell.tsx` (166 lines), studio-web `AppShell.tsx`, workspace-web `features/shell/pages/Shell.tsx` (113) plus `modules/community/ui/Shell.tsx`.
  - The settings layout exists only in `apps/workspace-web/src/shared/ui/settings-layout.tsx` (285 lines).
  - admin-web and studio-web each keep their own `lib/http.ts` (133 and 131 lines; admin's is imported by 129 files) and `lib/auth/session.ts` (200 and 154 lines), next to `web-kit/http` and `web-kit/auth/session.ts`.
  - `X_APP_HEADER` is defined 4 times: `packages/contracts/src/auth.ts:25`, `packages/web-kit/src/http.ts:16`, `apps/admin-web/src/lib/http.ts:5`, `apps/studio-web/src/lib/http.ts:6`.
- **Impact:** Luật GỐC 2 ("every app uses the shared shell and settings layout") is not supported by the code. Auth and refresh-lock fixes have to be made three times, and the 3rd app's template is whichever app gets copied.
- **Fix:**
  - Move `AppShell` and `SettingsLayout` into `@ai/web-kit/shell`.
  - Migrate admin-web and studio-web to `@ai/web-kit/http` and auth, then delete the local copies.
  - Import `X_APP_HEADER` from contracts only.
  - Add a depcruise rule forbidding `apps/*/src/lib/http.ts`.
- **Effort:** L. Split into H5a (web-kit shell plus workspace, M), H5b (admin-web http, M) and H5c (studio-web http, S).

### Medium

**M1. Clean Architecture is applied unevenly.**
- **Evidence:**
  - processes has 197 of about 300 non-test files outside `domain/`, `application/` and `adapters/` (in `runs/`, `gates/`, `core/`, `defs/`, `library/`, `asks/`, `bridge/`, `triggers/`, `usage/`, `notify/`, `nodes/`).
  - admin-api has only 4 of 30 modules layered (identity-import, mgmt-import, tenant-onboard, workflow-tools). The rest are flat routes/service/repo, for example `apps/admin-api/src/modules/groups`.
  - `hub/partners` has no `application/`.
  - `hub/packs/contracts` has 36 top-level `*.mount.ts` files (`esign.mount.ts` 341 lines, `extraction.mount.ts` 382).
- **Impact:** The ca-* depcruise rules cannot see unlayered folders. Onboarding requires learning two styles.
- **Fix:** Do not do a big-bang refactor. Keep the Luật 4 exception, and add a `check:layers` ratchet: a count of unlayered files per module that may only go down. Move the processes `runs/` and `gates/` folders first, since they are the state-machine owners (pairs with H2).
- **Effort:** M per module.

**M2. Composition roots reach into other modules' internals, and the depcruise exemption hides it.**
- **Evidence:**
  - `hub/processes/processes.mount.ts:7,8,11,12,13` imports `../kh/kh.writer`, `../mcp/adapters/workflow-invoker`, `../partners/mailbox-mover`, `../rooms/messages/messages.service`, `../sources/resolve.bridge`.
  - `hub/processes/bridge/bridge.mount.ts:7` imports `../../agents/agent-spec.service`.
  - `hub/notify/notify.mount.ts:8-9` imports secrets internals.
  - `hub/packs/contracts/esign.mount.ts:20` imports `../packs.filebox`, which is not `kit/public`.
  - `*.mount.ts` files are exempt from `cross-module-deep` (architecture.md §1).
- **Impact:** A module's real public surface is larger than its `public.ts`, so renaming internals breaks other modules.
- **Fix:** Export those builders and types from each module's `public.ts`, then drop the mount exemption, keeping only `app.ts`. Expose filebox through `kit/public`.
- **Effort:** S–M.

**M3. There are two notification inboxes.**
- **Evidence:** `hub/notify/adapters/inbox.repo.ts:22` reads `hub.notifications`, while `hub/processes/notify/inbox.repo.ts:92` reads `hub.process_notices`. Each has its own `inbox.service.ts`, and `NoticeKind` comes from different sources.
- **Impact:** This breaks Luật GOC 1: one concept, two stores and two counts. A 3rd app will not know which one to use.
- **Fix:** Pick `hub.notifications` as the source. Have the process module write notices through the notify public port, backfill, and remove `process_notices` reads, following D6.
- **Effort:** M.

**M4. UI pieces and constants are duplicated across apps.**
- **Evidence:**
  - The run status → tone map exists 3 times: `apps/admin-web/src/features/processes/components/run/RunStatusBadge.tsx:6-16`, `apps/chat-web/src/features/processes/shared/lib/status.ts:6-16` (with a different tone vocabulary), and `admin-web …/run-detail/StepDrawer.tsx:15`.
  - The `Apply*` components exist in both admin-web (`components/run/apply/*`) and chat-web (`shared/apply/*`). For example, `ApplyResult` (126 lines) differs by only 11 lines.
  - Boot error text is duplicated: `apps/admin-web/src/app/boot.ts:21`, `apps/studio-web/src/app/boot.ts:17`.
- **Fix:** Create `@ai/web-kit/process` with the status badge and apply components, and use one tone vocabulary in `web-kit/ui`.
- **Effort:** S.

**M5. CI does not run several gates the rules depend on.**
- **Evidence:**
  - `.github/workflows/ci.yml` does not run `test:perf`, `openspec:check` or `test:all`.
  - `check:case` is in lefthook but not in the root `check` chain.
  - The bundle budget is built only for admin-web in CI.
  - There is no lint for destructive migrations (DROP, TRUNCATE, RENAME, `NOT NULL` without default); `check:pack-sql` only checks schema boundaries.
- **Impact:** Luật 4c perf thresholds and the SDD Delta rule are enforced only when `slice:merge` runs locally. A direct push, or the fast lane in Luật 0d.6, skips them.
- **Fix:**
  - Add a CI job for `openspec:check`, `check:bundle` across all apps, and a nightly `test:perf`.
  - Add `check:case` to `check`.
  - Add a `check:migration-safety` regex lint with an `-- allow-destructive: <reason>` escape.
- **Effort:** S.

**M6. Some hot paths have no perf test.**
- **Evidence:** There is no perf test for the engine stage-driver or launcher advance, or for partner email dispatch (`hub/partners/email-dispatch.ts`); only mailbox-mover has one. Pack `index_outbox` is measured only in N1 pkdemo.
- **Impact:** The run advance is the main hot path as tenants and runs grow.
- **Fix:** Add `stage-advance.perf.int.test.ts` (a batch of 100 runs, counting SQL statements per batch) and an `email-dispatch` perf test.
- **Effort:** S–M.

**M7. Many files sit just under the size limit, and the component limit is not enforced.**
- **Evidence:**
  - Files at 360–385 lines include `hub/processes/runs/pack-runs-view.ts` (385), `runs/team-runner.ts` (385), `runs/pack-runs.ts` (382), `gates/gates.service.ts` (381), `runs/start.service.ts` (380), `defs/defs.service.ts` (378), `hub/packs/contracts/application/esign.usecase.ts` (377).
  - 50 non-test `.tsx` files are over 200 lines, for example `StageForm.tsx` 332, `apps/workspace-web/src/modules/community/ui/Composer.tsx` 345 and `PostCard.tsx` 336.
  - `check:size` (`tools/scripts/src/check-size.ts`) enforces 400/600 only.
- **Impact:** The next feature in these files either breaks the gate or forces a split mid-slice, which blows the 60-minute budget.
- **Fix:** Add a 200-line component limit to `check:size` with a frozen baseline, and plan splits for the 380+ files alongside H2 and M1.
- **Effort:** S (gate) or M (splits).

**M8. The e2e layout is hard to navigate.**
- **Evidence:**
  - There are 342 files under `e2e/` but only 64 use `*.spec.ts`. The rest use suffixes `.cw`, `.pa`, `.deployed`, `.chat`, among others.
  - There are 25 Playwright configs.
  - Skip and fixme markers sit in `e2e/deployed/15-user-bugs.deployed.ts` (7) and `e2e/contracts-web/hd2-flow.cw.ts` (3). The second one targets an app that no longer exists (see L1).
- **Impact:** It is slow to answer "which suite covers this journey", and new team members misplace tests.
- **Fix:** Write a one-page `e2e/README` mapping suffix → config → app, prune suites for removed apps, and fail `check` on `test.skip` without an issue reference.
- **Effort:** S.

### Low

**L1. Ghost app folders.**
- **Evidence:** `apps/community-web`, `apps/contracts-web` and `apps/sohoptac-web` contain only `.turbo`, `dist` and `node_modules` (no `src`, no `package.json`). The prompt and older docs still name them.
- **Fix:** Delete them locally, and add a `check:` rule that every `apps/*` folder has a `package.json`.
- **Effort:** S.

**L2. The CLAUDE.md header is stale.**
- **Evidence:** CLAUDE.md line 3 says "Chưa có code; thiết kế v0.4 đã xong" ("no code yet; design v0.4 is done").
- **Impact:** It misleads onboarding.
- **Fix:** Replace it with one line linking to architecture.md.
- **Effort:** S.

**L3. Node outputs are listed twice.**
- **Evidence:** `CORE_WRITTEN_OUTPUTS` in `hub/packs/core/nodes/core-nodes.binding.ts:13-17` and `APPROVE_OUTPUTS` in `packages/contracts/src/modules/core/index.ts:32`. The registry cross-checks them, so the risk is low.
- **Fix:** Derive the binding list from the contracts list (folds into H1a).
- **Effort:** S.

**L4. Demo data in production UI.**
- **Evidence:** `apps/workspace-web/src/modules/community/ui/Composer.tsx:17` imports `DEMO_PRODUCTS` from domain.
- **Fix:** Load the products from the API or a seed.
- **Effort:** S.

**L5. A component calls a mutation directly.**
- **Evidence:** `apps/workspace-web/src/features/contract-approval/components/EsignStepRow.tsx:29` calls `useMutation` in the component, and `components/use-approval-ui.tsx` (206 lines) is a hook stored under `components/`.
- **Fix:** Move both to `hooks/`.
- **Effort:** S.

**L6. Bundle chunking is inconsistent.**
- **Evidence:** `splitChunks` cacheGroups exist only in `apps/admin-web/rsbuild.config.ts:41` and `apps/workspace-web/rsbuild.config.ts:65`. chat-web and studio-web rely on defaults, although budgets exist.
- **Fix:** Move a shared rsbuild preset to `packages/config`.
- **Effort:** S.

## Scaling and onboarding risks (a 3rd app or more tenants)
1. **Tenancy (B1).** Every new hub feature table is a fresh chance to leak data until the catalog-derived RLS test exists.
2. **App template (H5, M4, L1).** No shared shell or HTTP client exists, and ghost apps confuse the starting point. A 3rd app will copy admin-web or workspace-web and fork auth again.
3. **Engine extensibility (H1, H2).** A pack can add a node without touching the engine only if it fits an existing executor kind. New kinds or new status values touch the engine registry, `FE_NODES`, StageForm and scattered `SET status`.
4. **Localisation and copy (H4).** A second language or a different brand per app means editing hub domain rules and the notify module.
5. **Onboarding cost (M1, M8, L2).** There are two code styles (layered and flat), 25 e2e configs with mixed suffixes, and a stale CLAUDE.md header. The docs are good (architecture.md, CODEMAP), but the code does not yet match them everywhere.

## Fix slices (independent, no shared files)

| Slice | Findings | Files (exclusive) | Lane / model | Effort |
|---|---|---|---|---|
| S1 hub-RLS | B1 | new `packages/db/migrations-hub/01xx_hub_rls_gap.sql`, `packages/db/src/hub-rls.int.test.ts` → catalog-derived test, `apps/hub-api/src/lib/db-guard.ts` + `server.ts` | full · Sonnet high + Opus low | M |
| S2 node-registry | H1a, L3 | `packages/contracts/src/modules/core/**`, `hub/packs/core/nodes/**`, `hub/processes/nodes/registry.ts`, `hub/packs/kit/adapters/module-registry.ts` | Opus medium (engine dispatch) | M |
| S3 editor-registry | H1b | `apps/admin-web/src/features/processes/{nodes,lib/node-config.ts,components/editor/StageForm.tsx,lib/node-summary.ts,lib/stage-label.ts,modules/**}` | fast · Sonnet | M |
| S4 contract-status | H2a | `hub/packs/contracts/domain/contract-status.rules.ts` (new), `approval*.repo.ts`, `extraction.repo.ts`, `reopen.repo.ts`, `review.repo.ts`, `cks/adapters/cks-write.repo.ts` | full · Opus medium | M |
| S5 run-status | H2b, M1 (runs/gates) | `hub/processes/{runs,gates,adapters/runs}/**`, `hub/processes/domain/runs/run-status.rules.ts` (new) | full · Opus medium; serialise after S2 (same module) | L |
| S6 durable-kick | H3, M6 (stage-advance perf) | `hub/processes/adapters/outbox.ts`, `hub/processes/adapters/hub-uow.ts`, new migration, new perf test | full · Opus medium; serialise after S5 | M |
| S7 label-codes | H4 | `hub/packs/contracts/domain/approval-step-label.rules.ts`, `apps/workspace-web/src/features/contracts-list/**`, `packages/i18n` contracts keys, `hub/notify/domain/sign-invite-mail.rules.ts` → contracts pack | fast · Sonnet | M |
| S8 web-kit shell + http | H5, M4, L6 | `packages/web-kit/src/{shell,process}/**`, `apps/admin-web/src/lib/{http.ts,auth/**}`, `apps/studio-web/src/lib/**`, app shells, rsbuild preset in `packages/config` | fast · Sonnet (split by app if needed) | L |
| S9 inbox-merge | M3 | `hub/processes/notify/**`, `hub/notify/adapters/inbox.repo.ts`, migration/backfill | Sonnet high + Opus low | M |
| S10 mount-publics | M2 | `public.ts` of kh/mcp/partners/rooms/sources/agents/secrets, `*.mount.ts` importers, `.dependency-cruiser.cjs` (drop mount exemption) | fast · Sonnet; after S5/S6 (`processes.mount.ts`) | S–M |
| S11 CI and gates | M5, M7 (gate only), M8, L1 | `.github/workflows/ci.yml`, root `package.json` `check`, `tools/scripts/src/check-size.ts`, new `check-migration-safety.ts`, `e2e/README`, ghost app folders | fast · Sonnet | S |
| S12 small hygiene | L2, L4, L5 | `CLAUDE.md` header line, `apps/workspace-web/src/modules/community/ui/Composer.tsx`, `apps/workspace-web/src/features/contract-approval/{components,hooks}/**` | direct-fix lane | S |

Order: S1, S11 and S12 first, since they are independent and cheap. S2 and S4 can run in parallel. S5 → S6 → S10 run in series because they share processes. S3, S7, S8 and S9 can run in parallel with the hub slices.

# CR-125 — wave review 2 + security (e232e5ef0..32ca68cb5)

Scope: quick-sign link, c5b template-fixes, hub 0125/0126, pack-contracts 0089/0090, ops `flow_flag`, G1 error codes, G7 partner nav count, template readiness, plus a Luật GỐC 1–3 pass. Read-only review; nothing was edited.

**Counts:** Blocker 0 · High 2 · Medium 6 · Low 7

## High

**H1 — `?ky=1` signs a demo (selfsign) contract on page load, with no click**
- Files: `apps/workspace-web/src/features/contract-esign/components/EsignPanel.tsx:246-259`, `apps/hub-api/src/modules/packs/contracts/application/esign.usecase.ts:343-346`, `adapters/esign.selfsign.ts:17-19`.
- Scenario: a tenant has only `selfsign` ("Ký thử"). The signer opens the invite email or bell, and the effect calls `signNowOf(...)()`, which calls `es.signNow()` and then `POST /esign/sign-url`. For a `demo` provider, `signUrl` itself writes `status: completed`. The contract becomes "Đã ký" and the flow moves on before the user has seen it. Anyone in the company can do the same thing on purpose: send a pending signer a `/contracts/c/<id>?ky=1` link (a CSRF-like auto-action), and one click signs the contract. With DocuSign the ceremony still needs a click, so only demo or one-step providers are exposed.
- Fix: auto-open only providers whose `recipientView` is a real ceremony (`!provider.demo`). For demo providers, `?ky=1` should only scroll to and focus the "Ký ngay" button. A better general rule: `?ky=1` never calls a state-changing endpoint, it only opens the picker or a confirm. Add a unit test on `decideAutoSign` that takes the `demo` flag into account.

**H2 — publish errors point to the wrong step (off by one)**
- Files: hub `apps/hub-api/src/modules/processes/library/library-publish.messages.ts:20-27` sends `step` **1-based** (`steps.2.*` ⇒ `step: 3`). Web `apps/admin-web/src/features/processes/lib/publish-issues.ts:22` reads a numeric `step` as a **0-based** index, then shows `index + 1` and jumps to `steps[index]`.
- Scenario: the error is on step 3. The status bar shows "Bước 4: …", and clicking it jumps to step 4, or to nothing if it was the last step. The unit tests on both sides pass because each one uses its own convention (`publish-issues.test.ts:24` sends `step: 0`, and the hub test expects `step: 1`).
- Fix: choose one convention in `SlotIssueSchema` (`packages/contracts/src/hub-admin/process-library.ts:71`). The recommended option is a 1-based `step` documented in the schema, with web using `s - 1`. Add a contract test that feeds `explainIssue()` output into `parsePublishIssues()`.

## Medium

**M1 — the auto-sign "right turn" check ignores signing order**
- `apps/workspace-web/src/features/contract-esign/lib/esign-view.ts:54-56`. `mine` means "any of my signer rows is unsigned", and `signUrl` (`esign.usecase.ts:323`) does not check `order` either. Signer #2 who opens the link before #1 has signed is auto-sent to sign. DocuSign rejects that out of turn and an error shows on page load. With selfsign, the whole envelope completes (see H1).
- Fix: `mine` should also require `nextSigner(e)?.is_you === true` for sequential envelopes, and `signUrl` should reject `ESIGN_NOT_YOUR_TURN` server-side.

**M2 — readiness reasons are still Vietnamese text, and web parses that text (two sources, against G1)**
- `packages/contracts/src/modules/template-readiness.ts:135-150` builds `reasons`/`copyReasons` as vi sentences. `notReadyError` (`apps/hub-api/.../template-readiness.ts:69-80`) returns them as the error message (en users get vi). `apps/admin-web/src/features/tenants/flows/lib/readiness-view.ts:47` gets the locked stage name by regex `«…»` on `copyReasons[0]`.
- Fix: expose `missing.locked: string[]` (data already exists in `needs.locked`). Web reads data only. `FLOW_TEMPLATE_NOT_READY` returns `{code, params}` like G1, and the vi sentences move to i18n. Add these codes to `check:error-codes`.

**M3 — `SLOT_LOCKED` is outside the one-source code list**
- `apps/hub-api/src/modules/processes/defs/defs.service.ts:239` sends `rule: "SLOT_LOCKED"`, which is not in `PUBLISH_ISSUE_CODES` (`packages/contracts/src/pack-contracts/publish-issue-codes.ts`). Web falls back to `err.unknown` ("Không hợp lệ (SLOT_LOCKED)…"), which shows a technical code and doesn't say how to fix it. `check:error-codes` did not catch this emitter.
- Fix: add `SLOT_LOCKED` to `PUBLISH_ISSUE_EXTRA_RULES` with a key such as "Bước cố định của nền tảng — không sửa được; dùng bản dùng chung hoặc chọn mẫu khác". Extend `check:error-codes` to scan every `libError(..., { issues })` literal.

**M4 — when readiness fails to load, Gán/Sao chép is disabled with no reason**
- `apps/admin-web/src/features/tenants/flows/components/ReadinessPanel.tsx:60`. If the query errors (hub down, 403, `PUBLIC_HUB_URL` unset at `readiness-api.ts:17`), the panel renders `null` and `onState(false)`. The button stays disabled and nothing says why (Luật GỐC 3).
- Fix: show the error state with a retry ("Chưa kiểm được mẫu — thử lại"), mapped by `ApiError.code`.

**M5 — the fix button failure is one generic line**
- `ReadinessPanel.tsx:104-108` shows `readiness.fixFailed` for every error. `FEATURE_NOT_NEEDED` (`template-fixes.service.ts:49`, a hard-coded vi message in admin-api), `HUB_UNREACHABLE`, `CORE_FEATURE_PROTECTED` and `NOT_FOUND` need different next steps.
- Fix: one i18n key per code. Drop the vi message in the admin-api error, since web owns the text.

**M6 — the `flow_flag` ops check fires forever on a deliberate "Tạm dừng"**
- `apps/hub-api/src/modules/ops/adapters/checks/flow-flag.check.ts:15-27,31-38`. Pausing (`flow-settings.service.ts` sets `flow_triggers=false`) is a real control, but the check reports it as half-config. The hint tells the admin to un-assign flows to silence the check, which destroys configuration. Hub 0126 also re-enables every paused tenant on deploy (user decision 2026-11-08, accepted). Check the prod list of paused tenants before you deploy.
- Fix: store the pause reason (`paused_by`/`paused_at`) and exclude deliberate pauses from the check, or count them as a separate `info` line. Remove the "gỡ gán" hint.

## Low

- **L1** — `apps/admin-api/src/modules/template-fixes/template-fixes.routes.ts:51-56` / `service.ts:59-63`: `create-group` accepts any valid `group_key`. It is not narrowed to the template's `missing.groups`, unlike `enable-feature`. Platform-only, so it is not an escalation, but it is inconsistent with the "narrow one-tap fix" intent. Fix: require `flow_id` and check it against readiness.
- **L2** — `template-fixes.routes.ts:36-41`: the caller's `Authorization` header is relayed to `ADMIN_HUB_URL`. That is fine while the URL is env-only, but document that it must never come from the DB or request (a token-leak path).
- **L3** — `apps/hub-api/src/modules/packs/kit/application/pack-nav.ports.ts:44`: a count error turns into `0` silently, with no log or metric, so a broken count is invisible to ops. Fix: `catch((e) => { log.warn(...); return 0; })`.
- **L4** — `packages/contracts/src/modules/template-readiness.ts:96-98`: the "same cluster" test is `prev.node === cur.node`. Two separate consecutive instances of the same multi-stage node (for example two Ký số blocks) are treated as one cluster, so the second one is exempt from "needs approval before". Fix: also compare a node-instance id (or `stage.key` prefix) if one exists.
- **L5** — `ReadinessPanel.tsx:39`: the group item shows the raw group code (`«contracts-admin»`). Also, `suggestGroup` (`template-readiness.ts:162-165`) names the group from the code in vi only. Fix: label it from `suggestGroup(key).name`, add `en`.
- **L6** — `packages/db/migrations-pack-contracts/0090_partner_inbox_pending_idx.sql:3`: plain `CREATE INDEX` (no `CONCURRENTLY`) blocks writes on `partner_inbox` while it builds. The table is small today, so this is OK. Note it in the pre-deploy checklist.
- **L7** — Admin locale has leftover English or technical words in Vietnamese UI added or moved in this range: "Workflow mới", "Chưa có group nào. Tạo group để cấp feature…", "Cờ quy trình công ty" (ops label). Fix: "Quy trình mới", "Chưa có nhóm nào. Tạo nhóm để cấp tính năng cho cả phòng ban."

## Checked clean
- `safeNext` (`apps/workspace-web/src/platform/auth/domain/next.ts`) is unchanged and still blocks `//`, `/\`, control chars and `/login` loops. `?ky=1` survives `/login?next=` (query kept by `canonicalHref`). `signInviteLink` builds a same-origin relative path from a server value only.
- Wrong-user signing: the server binds `signUrl` to `client_user_id === who.userId` (`esign.usecase.ts:323`), and web uses `is_you`. A different logged-in user gets no auto-action.
- Template-fixes gate: `requireAuth` + `requireRole("platform_admin")` on the route, re-checked in the service. The tenant comes from the path only. It reuses `grantEntitlement`/`createGroup`, so lock, audit and NOTIFY are shared. `featureIdByKey` goes through `features.entitlements`.
- Hub readiness: `companyAccess(u, tid)` before the system-scope tx, with an explicit `tenant_id` in every query.
- 0126: set-based, idempotent, touches only tenants with an enabled `company_flows` row. 0125 `notify.enqueue` keeps the tenant guard and `admin.users` tenant check, and drops `data` for manager copies.
- G7 partner count: `packTenantOnly` + explicit `tenant_id` + RLS, the same `read` gate as `/partner/inbox`, external users excluded, and it runs in parallel with the review cap.

# modules/studio — Agent Studio API (HUB-FR-72, HUB-FR-60, HUB-FR-62, HUB-FR-90)

API cấu hình Hub cho Agent Studio (H4a). Chỉ `platform_admin` (`requirePlatformAdmin` gắn ở `app.h4a.ts` cho `/studio/api/*`, sau JWT ⇒ 401 → 403 trước parse). Mount ở `app.h4a.ts`; `/studio/api` trong `PROTECTED_PREFIXES` của `app.ts`.

| File | Vai trò |
|---|---|
| `studio.routes.ts` | `GET me` + 5 catalog đọc: parse query strict (400) → service. Không logic |
| `studio-read.service.ts` | Mỗi request một transaction REPEATABLE READ read only (scope `system`, P6) ⇒ item + `hub_config_version` cùng ảnh |
| `studio-read.repo.ts` | SELECT catalog; R13: không chọn `providers.secret_id` (chỉ `IS NOT NULL`), không chọn `provider_state.last_error` |
| `studio-read.map.ts` | Hàm thuần: `toList` (lọc `q`, `limit`, `total`/`truncated`), `usableFor` (QB3), `toProviderItem` (danh sách trắng trường) |
| `studio-static.ts` | Phục vụ dist Studio ở `/studio` (P12, §5.4): 308 `/studio`→`/studio/`, SPA fallback không đuôi, 404 JSON có đuôi, header bảo mật, chặn `..` |
| `studio-write.ts` | `withConfigWrite`: MỌI ghi Studio — scope `system` → khoá `config_meta` → `fn` → bump → audit (`AppDeps.hubAudit` tiêm được, P7) → NOTIFY, một transaction (R09) |
| `agents/agents.routes.ts` | `GET/POST /agents`, `GET /agents/:id`, `PUT /agents/:id`, `PATCH /agents/:id/enabled`, `DELETE /agents/:id?version=` |
| `agents/agents.service.ts` | POST: `KEY_TAKEN` → tham chiếu (profile, agent_type, workflow) → Bash ack → INSERT + `agent_workflows` → audit `create`. PUT/PATCH/DELETE: khoá hàng → `VERSION_CONFLICT{current, updated_at}` → chặn (Orchestrator → lịch sử → quyền) → ghi + đồng bộ `agent_workflows`. Đọc REPEATABLE READ |
| `agents/agents.repo.ts` | SQL agent (list một câu + `count(*) over()`; `workflow_count` suy từ `workflow_key` cho dify-* seed cũ — P11) |
| `agents/agents.map.ts` | Hàng DB → `Agent`/`AgentListItem`, `auditSnapshot`, `changedFields` |
| `agents/agents.rules.ts` | Luật thuần plan §4.1 (QC test `tests/acceptance/H4a/rules/agents-rules.test.ts`) |

| `orchestrator/orchestrator.routes.ts` | `GET /orchestrator`, `PUT/DELETE /orchestrator/default` (DELETE ⇒ 409 protected), `POST /orchestrator/tenants`, `PUT/DELETE /orchestrator/tenants/:tenant_id` |
| `orchestrator/orchestrator.service.ts` | Qua `withConfigWrite`: khoá hàng → `VERSION_CONFLICT{current, updated_at}` → kiểm agent (`AGENT_NOT_ORCHESTRATABLE`) / tenant (`TENANT_INACTIVE`, `ORCHESTRATOR_EXISTS`) → ghi → audit tenant (null = mặc định) |
| `orchestrator/orchestrator.repo.ts` | SQL `hub.orchestrator_settings` (+ agent, tenant) |
| `orchestrator/orchestrator.map.ts` | Hàng DB → `Orchestrator`, `orchVersionConflict`, ảnh audit, `orchChangedFields`, `entity_name` |
| `studio-params.ts` | H4b-2 · `parseUuidParam`/`uuidParams`: path param không uuid ⇒ 400 `VALIDATION_ERROR` (route Models/Quyền agent; H4a giữ 404) |
| `models/providers.routes.ts` | H4b-2 · `POST /providers`, `GET/PUT/DELETE /providers/:id?version=`, `PATCH /providers/:id/enabled`; middleware `/providers/:id/*` chặn 400 cả path con |
| `models/providers.service.ts` | Hình dạng (400) → `withConfigWrite`: khoá hàng → readonly (`dify`) 409 → `VERSION_CONFLICT{current, updated_at}` → secret ref → ghi (không đổi ⇒ không bump) → audit `provider` |
| `models/providers.repo.ts` · `providers.map.ts` | SQL provider (chi tiết JOIN tên secret + state + slots; profile dùng = jsonb `@>`) · hàng → `ProviderDetail` (`last_error` qua `redactKey`), `editableOf` |
| `models/provider-check.ts` · `provider-check.repo.ts` | H4b-2 B4 · `POST /providers/:id/check`: api ⇒ `useSecret` + `fetch` tiêm (10 s, `redirect:"error"`, `redactKey`), `fake` trong tiến trình; subscription ⇒ xoá `last_probe_at`/`last_ok_at`, chờ probe ≤ 10 s (`sleep` tiêm) ⇒ `requested`; audit `check` không bump, không `message` |
| `models/profiles.routes.ts` · `profiles.service.ts` | H4b-2 B5 · `POST /model-profiles`, `GET/PUT/DELETE /model-profiles/:id?version=`: `withConfigWrite` khoá hàng → `VERSION_CONFLICT` → `stepsProblem` (400 `INVALID_REFERENCE` steps/`steps.<i>`) → giống hệt ⇒ không bump → audit `model_profile`; DELETE còn agent ⇒ `PROFILE_IN_USE{agents}`. `profileItems` dùng cho list |
| `models/profiles.repo.ts` · `profiles.map.ts` | SQL profile + providers⋈state + đếm agent · hàng → item/`ModelProfile` (`active_step` = `pickStep(…, false)`, `all_subscription`, `normSteps`) |
| `models/models.errors.ts` | `modelError`: mã `STUDIO_MODEL_ERRORS` (không sửa `STUDIO_ERRORS`) |
| `models/models.rules.ts` · `provider-check.rules.ts` | Luật thuần H4b-2 (plan §2.1–§2.2) |

| `orchestrator/orchestrator-settings.rules.ts` | Luật thuần runtime Orchestrator (`ORCHESTRATOR_RUNTIMES` từ `@ai/contracts/studio`, cảnh báo "Chậm") |

Luật:
- Mọi `/studio/api/*` đi qua `requirePlatformAdmin` ở gốc ⇒ route chưa mount vẫn 401/403 đúng thứ tự, path lạ ⇒ 404 JSON (không rơi vào SPA).
- Tĩnh chỉ mount khi `HUB_STUDIO_DIST`/`AppDeps.studioDist` có `index.html`.

Phụ thuộc: `lib/{admin-role.middleware,http,errors}`, `dify/dify.rules` (`difyAgentInput`), `@ai/contracts/studio`, `@ai/db/hub-scope`.

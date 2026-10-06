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
| `agents/agents.routes.ts` | `GET/POST /agents`, `GET /agents/:id` (B4); PUT/PATCH/DELETE ở B5 |
| `agents/agents.service.ts` | POST: `KEY_TAKEN` → tham chiếu (profile, agent_type, workflow) → Bash ack → INSERT + `agent_workflows` → audit `create`; đọc REPEATABLE READ |
| `agents/agents.repo.ts` | SQL agent (list một câu + `count(*) over()`; `workflow_count` suy từ `workflow_key` cho dify-* seed cũ — P11) |
| `agents/agents.map.ts` | Hàng DB → `Agent`/`AgentListItem`, `auditSnapshot`, `changedFields` |
| `agents/agents.rules.ts` | Luật thuần plan §4.1 (QC test `tests/acceptance/H4a/rules/agents-rules.test.ts`) |

Sắp có (B6): `orchestrator/`.

Luật:
- Mọi `/studio/api/*` đi qua `requirePlatformAdmin` ở gốc ⇒ route chưa mount vẫn 401/403 đúng thứ tự, path lạ ⇒ 404 JSON (không rơi vào SPA).
- Tĩnh chỉ mount khi `HUB_STUDIO_DIST`/`AppDeps.studioDist` có `index.html`.

Phụ thuộc: `lib/{admin-role.middleware,http,errors}`, `dify/dify.rules` (`difyAgentInput`), `@ai/contracts/studio`, `@ai/db/hub-scope`.

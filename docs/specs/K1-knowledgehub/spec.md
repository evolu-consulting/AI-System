---
id: K1-knowledgehub
title: K1 · KnowledgeHub làm RAG ngoài (Hub proxy) + quy trình mẫu AISDLC
milestone: K1
status: plan
requirements: [HUB-FR-131, HUB-FR-132, HUB-FR-133, HUB-FR-134, HUB-FR-137, HUB-BR-35, HUB-BR-36, HUB-BR-37, HUB-BR-40]
design:
  - docs/design/agent-hub/ba-agent-hub.md HUB-FR-131…134, 137 · HUB-BR-35…37, 40 (ngoại lệ HUB-BR-12)
  - docs/design/agent-hub/ui-agent-studio.md (Cài đặt → KnowledgeHub, Tri thức — thiếu artboard)
  - docs/adr/0012-knowledgehub-external-rag.md (Accepted) · docs/specs/K1-knowledgehub/research-ai-sdlc.md
  - docs/CHANGE-REQUESTS.md#CR-062 · #CR-067 · #CR-068 · #CR-070
  - nền: H4b-1 Secrets (`kh_api_key` theo tenant, `useSecret`) · P-a/P-b2 (`required_sections`, `## Bàn giao`, gate) · H2a (`/mcp`, token job)
owner: backend-lead + frontend-lead + qc
---

# K1 · KnowledgeHub (RAG ngoài)

Tách từ BA (Intake 2026-10-13); [`readiness.md`](readiness.md). Sau H4b-1.

## 1. Phạm vi
**Làm:**
- Studio → Cài đặt → KnowledgeHub: **danh sách kết nối KH** (tên + URL allowlist; CR-071 nhiều KH); mỗi kết nối có bảng tenant ↔ namespace + credentials (`kh_api_key` JSON) và "Kiểm tra kết nối" riêng (HUB-FR-131).
- Client KH `/v1/{ns}`: đổi token client credentials, giữ trong bộ nhớ, làm mới 60–90 s, `401` ⇒ thử lại 1 lần (HUB-FR-137).
- **CR-071:** Studio mục "Tri thức" = kho tri thức (tên, kết nối KH, project KH, một công ty/dùng chung chỉ đọc, [Kiểm tra]); sửa agent → "Tri thức" chọn nhiều kho; `kh-query` chỉ hỏi kho gắn agent ∧ (tenant run ∨ dùng chung), gọi đúng KH của từng kho; bỏ gắn project theo quy trình/stage, `tenant_admin` giữ công tắc công ty (HUB-FR-132). §3–4 viết lại, Gate lại.
- Tool `kh_query` ở `/mcp` → `POST /v1/{ns}/context/step` (4000 ký tự/lần, ≤ 5 lần/stage).
- Ghi `## Tóm tắt` qua `POST /v1/{ns}/worklog`; ghi vào kho ghi được đầu tiên của agent stage; không có ⇒ không ghi, không thêm `## Tóm tắt` vào `required_sections` (HUB-FR-133).
- Hạ cấp khi KH lỗi (HUB-FR-134); mock KH cho dev/test.
- Seed quy trình mẫu `sdlc-delivery` + `bug-fix` (CR-070, chỉ seed; không sửa `sdlc`).

**Không làm:** nạp nguồn/tài liệu vào KH (K2); code-graph (hoãn, CR-069); tự gắn/xoay ns/client phía KH; tự chèn tri thức vào prompt; dùng `/vector/*` hay khoá chung; thêm KH vào docker-compose; thay đổi phía KH (embedder, parse); dựng canvas/chỉnh template quy trình (P-b2 đã xong).

## 2. Nghiệp vụ
Trỏ BA; chỉ ghi phần cụ thể hoá.

| Luật | Điều kiện chính xác | Nguồn |
|---|---|---|
| Phiên bản tối thiểu | `GET /version` ≥ v6.4; `GET /v1/capabilities`: `api_versions ∋ v1` + `retrieval` (K2 thêm `packs`) | ADR-0012 §6 |
| Kiểm tra kết nối — lỗi | ns bật `include_people_lanes` **và** tenant có project dùng chung (`read_only`) — lanes bật ở project riêng là OK (Q2); `GET /v1/me` `kind=local`; gọi không token vẫn được (trừ localhost dev); `http://` (trừ localhost dev) | HUB-FR-131, HUB-BR-40 |
| Cảnh báo tĩnh | Embedder đa ngữ (bge-m3) là điều kiện triển khai KH; Hub không đo được | ADR-0012 §8 |
| ns = tenant | Mỗi (kết nối KH, tenant) tối đa một cặp (ns, credentials); run chỉ dùng credentials của tenant mình; tenant khác ⇒ 404 | HUB-BR-35 |
| Project dùng chung | Đánh dấu chỉ đọc: `kh_query` được, không ghi `## Tóm tắt` | HUB-FR-132 |
| `kh_query` | `budget_chars` 4000; ≤ 5 lần/stage (lần 6 ⇒ lỗi tool, không lỗi run); kết quả là dữ liệu | HUB-FR-132, HUB-BR-31 |
| Ghi worklog | subject `<quy trình>/<stage>`; cắt 4000 ký tự; `Idempotency-Key` = run/stage/phiên bản output; `after: auto` ghi khi chốt output, có gate ghi khi Đạt | HUB-FR-133 |
| `## Tóm tắt` | ≤ 200 từ, quá thì cắt; chỉ bắt buộc ở stage có kho ghi được đầu tiên (agent gắn, tenant run, không chỉ đọc) | HUB-FR-133 |
| Hạ cấp | Mạng/timeout, `404 ns_not_active`, `423 ns_suspended`, `503 embedder_unavailable` ⇒ chạy tiếp + cảnh báo output + audit | HUB-FR-134 |
| Seed mẫu | `sdlc-delivery` (≤ 10 stage: Scope Sign-off gate → Setup&Plan → Spec gate → Design → Implementation → Code Review → Testing → UAT gate → Release); `bug-fix` (6 stage, danh sách ở [plan §6](plan.md)). Code Review/Testing trượt ⇒ gate người + `back_to_steps`; phỏng cấu trúc `seed.py`, không chép prompt | CR-070 |

## 3. Contract (backend-lead · viết lại theo CR-071)
File `packages/contracts/src/hub-admin/kh.ts` (export `@ai/contracts/hub-admin`), mọi object `strictObject`, lỗi = `ErrorResponse` M0. Quyết định, hàm thuần, luồng, mã kiểm: [`plan.md`](plan.md).

**3.1 Kiểu chung**
| Tên | Định nghĩa |
|---|---|
| `KhNsSchema` | `^[a-z][a-z0-9_]{2,31}$`, không bắt đầu `kh`, ∉ `admin, me, capabilities, token, redaction, openapi, health, version` |
| `KhProjectIdSchema` · `KhKeyspaceSchema` | `^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$` · `^[a-z][a-z0-9_.-]{0,63}$` (mặc định `step`) |
| `KhCredentials` (secret `kh_api_key`, không qua API) | JSON `{ client_id: 1..128, client_secret: 1..512, token_url?: URL }` |
| `KhCheckItemSchema` · `KH_CHECK_CODES` | `{ code, level: "error" \| "warning", params?: Record<string, string \| number> }` · 17 lỗi + 4 cảnh báo (plan §3.1) |
| `KhCheckResultSchema` | `{ status: "ok" \| "error", checked_at, kh_version: string \| null, keyspace_dims: string[] ≤ 8, items ≤ 30 }`; `error` ⇔ có mục lỗi |
| `KhConnectionSchema` | `{ id, name: trim 1..80, base_url, tenants_count, knowledge_count, version, updated_at, updated_by }` |
| `KhTenantSchema` (theo **(kết nối, tenant)**) | `{ connection: {id,name}, tenant: {id,key,name}, ns, secret: {id,name} \| null, keyspace, enabled` (chỉ đọc, cờ công ty), `status: "unchecked" \| "ok" \| "error", check: KhCheckResult \| null, version, updated_at, updated_by }` |
| `KhKnowledgeSchema` | `{ id, connection: {id,name}, name: trim 1..80, project_id, tenant: {id,key,name} \| null` (null = **dùng chung** ⇒ `read_only`), `read_only, agents_count, version, updated_at, updated_by }` |
| `KhKnowledgeCheckSchema` | `{ status: "ok" \| "warning" \| "error", checked_at, truncated, items: [{ tenant: {id,key,name}, ns: string \| null, result: "attached" \| "not_attached" \| "unverified" \| "not_configured" \| "failed", code: KH_WARNING_CODES \| null }] ≤ 100 }` |
| `StageKnowledgeSchema` (optional `StageViewSchema.knowledge`) | `{ write_to: { knowledge_id, name } \| null, queries: 0..5, query_limit: 5, warning: KH_WARNING_CODES \| null, summary: "none" \| "pending" \| "written" \| "failed" \| "skipped" }` |
| `KH_WARNING_CODES` | `unreachable · timeout · ns_not_active · ns_suspended · embedder_unavailable · unauthorized · forbidden · quota · invalid · server_error · disabled` |

**3.2 Studio** (chỉ `platform_admin`, 403 trước parse — `mountH4a`). `C` = `/kh/connections`. Lỗi luôn gồm 400 (body/query sai); list: `limit 1..100 = 50, cursor?` ⇒ `{ items, next_cursor }`.
| Method · path | Request | 2xx | Lỗi |
|---|---|---|---|
| `GET C` | — | 200 + `allowed_origins: string[], timeout_ms` (chỉ đọc, `AppDeps.kh` ?? env); sắp `(lower(name), id)` | — |
| `POST C` · `PUT C/:id` | `{ name, base_url: ≤ 512 }` (+ `version` khi PUT) | 201/200 `KhConnection`; đổi `base_url` ⇒ mọi cấu hình tenant của kết nối `unchecked`, `check = null` | 404 · 409 `KH_CONNECTION_EXISTS {id, field: "name" \| "base_url"}` · `VERSION_CONFLICT` · 422 `KH_URL_NOT_ALLOWED {reason: invalid \| not_https \| not_in_allowlist}` |
| `DELETE C/:id?version=N` | — | 204 | 404 · 409 `VERSION_CONFLICT` · `KH_CONNECTION_IN_USE {tenants, knowledge}` (đếm > 0) |
| `GET C/:cid/tenants` | `q? ≤ 64` | 200 `KhTenant[]` sắp `(lower(key), tenant_id)` | 404 |
| `PUT C/:cid/tenants/:tenant_id` | `{ ns, secret_id: uuid \| null, keyspace = "step", version?: int }` (vắng = tạo) | 201/200 `KhTenant`; đổi ns/secret/keyspace ⇒ `unchecked`, `check = null`; tạo ⇒ thêm `kh_tenant_prefs` nếu chưa có | 400 path `tenant_id` · 404 · 409 `KH_TENANT_EXISTS` · `KH_NS_TAKEN {tenant}` (trong kết nối) · `VERSION_CONFLICT {current, updated_at}` · 422 `KH_SECRET_INVALID {reason: not_found \| wrong_kind \| wrong_tenant}` |
| `DELETE C/:cid/tenants/:tenant_id?version=N` | — | 204 (kho giữ; cờ `enabled` giữ) | 404 · 409 `VERSION_CONFLICT` |
| `POST C/:cid/tenants/:tenant_id/check` | — | 200 `KhCheckResult` (KH lỗi vẫn 200); lưu vào hàng, không tăng `version` | 404 · 409 `KH_NOT_CONFIGURED` (thiếu secret) |
| `GET /kh/knowledge` | `q? ≤ 64, connection_id?, scope?: "shared" \| uuid tenant` | 200 `KhKnowledge[]` sắp `(lower(name), id)` | — |
| `POST /kh/knowledge` | `{ connection_id, name, project_id, tenant_id: uuid \| null, read_only = false }`; dùng chung ∧ `read_only false` ⇒ 400 path `read_only` | 201 `KhKnowledge` | 400 path `connection_id`/`tenant_id` · 409 `KH_KNOWLEDGE_EXISTS {id}` (trùng `(kết nối, phạm vi, project_id)`) |
| `PUT /kh/knowledge/:id` | `{ name, project_id, read_only, version }` (kết nối, phạm vi bất biến) | 200 | 404 · 409 `KH_KNOWLEDGE_EXISTS` · `VERSION_CONFLICT` · 400 `read_only` |
| `DELETE /kh/knowledge/:id?version=N` | — | 204 | 404 · 409 `VERSION_CONFLICT` · `KH_KNOWLEDGE_IN_USE {agents: [{id,key,name}] ≤ 20}` |
| `POST /kh/knowledge/:id/check` | — | 200 `KhKnowledgeCheck` (không lưu, audit `check`) | 404 |
| `PUT /agents/:id/knowledge` | `{ knowledge_ids: uuid[] ≤ 10 duy nhất (thứ tự = thứ tự gắn), version }` | 200 `AgentWriteResponse`; `AgentSchema.knowledge_ids`, `AgentListItemSchema.knowledge_count` | 404 · 409 `VERSION_CONFLICT` · 422 `KH_AGENT_RUNTIME` (≠ `agentic-cli` ∧ list ≠ []) · `KH_KNOWLEDGE_NOT_FOUND {ids}` |

**Kiểm tra (kết nối, tenant)**: 10 bước plan §3.1, kho xét = kho **cùng kết nối**. **Kiểm tra kho**: theo cấu hình (kết nối của kho, tenant); kho tenant ⇒ một mục, `not_attached`/`not_configured`/`failed` ⇒ `error`; kho dùng chung ⇒ một mục mỗi tenant có cấu hình ở kết nối đó (≤ 100 theo key), chưa gắn ⇒ `warning`. Không ảnh hưởng hiệu lực.

**3.3 Tenant — `/admin/kh*`** (`tenant_admin` = tenant phiên; `platform_admin` + `?tenant_id`; `member` ⇒ 403; vào `PROTECTED_PREFIXES`). `enabled`/`version` = cờ **chung công ty** (`kh_tenant_prefs`), không theo kết nối.
| Method · path | Request | 2xx | Lỗi |
|---|---|---|---|
| `GET /admin/kh` | `?tenant_id` | 200 `{ available, reason: null \| "not_configured" \| "unchecked" \| "check_failed", enabled, version: int \| null, connections: [{ name, status: "not_configured" \| "unchecked" \| "ok" \| "error" }] ≤ 50 }` (chỉ đọc, không URL) | 404 |
| `PUT /admin/kh/enabled` | `{ enabled, version }` | 200 như GET | 409 `KH_NOT_CONFIGURED` (không cấu hình ở kết nối nào) · `VERSION_CONFLICT` |

Bỏ (CR-071): `kh_settings`, `/kh/settings`, `/kh/tenants*`, `kh_bindings`, `/process-defs/:id/knowledge`, `KhProjectSchema`, `KhSettingsSchema`, `KH_PROJECT_*`, `knowledge_enabled`.

**3.4 Kho hiệu lực + tool `kh-query`** (Q1; chỉ job **stage quy trình**, Q10)
- **Kho hiệu lực** (`khEffectiveKnowledge`) = kho gắn agent của job, `tenant_id = tenant run ∨ null`, thứ tự gắn, ≤ 10; kho tenant khác bỏ lặng lẽ (RLS + WHERE).
- **Tạo job**: `agentic-cli` ∧ `enabled` ∧ ≥ 1 kho có kết nối hiệu lực ⇒ thêm `kh-query` vào `payload.mcp.tools` + chốt **cả** tập (kèm `connection_id`) vào `kh_job_knowledge` (cùng tx). Đổi gắn/kho sau đó không thu hồi; lúc gọi kiểm lại.
- Input `{ query: trim 1..4000 }`, `additionalProperties:false`; agent **không** truyền project/ns/kết nối. Hub gọi song song `context/step` (kết nối của kho, ns tenant tại kết nối) cho mỗi kho có kết nối hiệu lực, `budget_chars = max(200, ⌊4000/n⌋)` (n = số kho gọi thật); kho có kết nối không hiệu lực ⇒ phần đó hạ cấp `disabled` (tính `failed`). Ghép `### <tên kho>` + `pack_text` ≤ 4000; `structuredContent { serve_ids, used_chars, cut_at_budget, failed, calls_left }`. Một lần gọi = 1 lần đếm (≤ 5/stage, chung nhóm).
- Lỗi tool (`isError`, không lỗi run): `INVALID_ARGS` (không đếm) · `KH_LIMIT` (lần 6+) · `KH_UNAVAILABLE` (mọi phần lỗi; `enabled=false` hoặc không kết nối hiệu lực ⇒ `disabled`, không đếm) · `NOT_CONFIGURED`. Một phần lỗi ⇒ phần OK + `warning` + audit `degrade`. Câu EN: plan §3.4.

**3.5 Hiệu lực, URL, token, ghi worklog**
- **URL** (`khUrlPolicy`, mỗi `base_url`): `https:` (`http:` chỉ dev/test + loopback); origin ∈ `HUB_KH_ALLOWED_ORIGINS`; không userinfo/query/fragment; kiểm khi lưu **và** mỗi lời gọi, `redirect:"error"`.
- **`available`** (kết nối, tenant) = có cấu hình ∧ `secret_id` ∧ `status=ok`; **kết nối hiệu lực** = `enabled ∧ available`. `/admin/kh`: `available` = ∃ kết nối available; không thì `reason` = `unchecked` (∃ cấu hình có secret `unchecked`) > `check_failed` (∃ `error`) > `not_configured`.
- **Token** (HUB-FR-137): client credentials, cache bộ nhớ theo `(connection, tenant, secret_id, secret.version, token_url)`, làm mới khi còn 60–90 s, `401` ⇒ thử lại **1 lần**; không vào DB/log/audit/job/prompt.
- **Đích `## Tóm tắt`** (chốt lúc **start**, stage executor `agent` đơn): kho **ghi được đầu tiên** của agent stage (`read_only=false`, `tenant_id = tenant run`, kết nối hiệu lực — kết nối bất kỳ) ⇒ `snapshot.kh.stages[idx]` + `ensureSummary` (def gốc không đổi). Không có / stage nhóm ⇒ `null`.
- **Ghi**: stage `done` (auto / gate Đạt / người cho qua) ∧ đích ≠ null ∧ output có `## Tóm tắt` ⇒ `kh_writes` cùng tx; bộ gửi nền gọi **kết nối của kho đích** `POST /v1/{ns}/worklog {project, subject: "<process.key>/<stage.key>", text}` (200 từ, ≤ 4000), `Idempotency-Key: kw-<process_run_id>-<stage_run_id>-v<output.version>`; trước khi gửi kiểm lại kết nối hiệu lực + kho còn ∧ không chỉ đọc, sai ⇒ `skipped`.
- **Lỗi KH**: query ⇒ hạ cấp ngay; ghi ⇒ thử lại ≤ 5 (30 s × 2ⁿ), `403/422/413` không; hết ⇒ `failed` + audit. Không đổi trạng thái run/gate.

**3.6 Audit**: entity `kh_connection · kh_tenant · kh_knowledge · kh_query · kh_worklog` (+ `agent`); action thêm `check · degrade · write_fail`. Không secret/token. Studio ghi qua `withConfigWrite`; check/hạ cấp/ghi không bump. Bảng: plan §4.

## 4. Dữ liệu (backend-lead)
Migration `migrations-hub/0029_k1_kh.sql` (sau 0028, idempotent, chỉ THÊM, chưa áp ⇒ viết lại tự do); Drizzle `schema/hub-kh.ts`; RLS mẫu `v_t` (0028) `TO hub_rw`. Cột/CHECK/index: plan §5.
| Bảng | Vai trò | Khoá · FK (xoá) | RLS |
|---|---|---|---|
| `kh_connections` | `name`, `base_url`, `version` | PK `id` · UNIQUE `lower(name)`, `base_url` | không |
| `kh_tenant_prefs` | cờ `enabled` công ty, `version` | PK `tenant_id` | `v_t` |
| `kh_tenants` | (kết nối, tenant) ↔ `ns`, `secret_id`, `keyspace`, `check_*`, `version` | PK `(connection_id, tenant_id)` · UNIQUE `(connection_id, ns)` · `→ kh_connections`, `→ secrets` RESTRICT | `v_t` |
| `kh_knowledge` | `connection_id`, `name`, `project_id`, `tenant_id` (NULL = dùng chung), `read_only`, `version` | UNIQUE `(connection_id, COALESCE(tenant_id, uuid0), project_id)` · CHECK `tenant_id IS NOT NULL OR read_only` · `→ kh_connections` RESTRICT | đọc: system ∨ `tenant_id IS NULL` ∨ = tenant; ghi: system |
| `agent_knowledge` | kho ↔ agent, `position` 0..9 | PK `(agent_id, knowledge_id)` · UNIQUE `(agent_id, position)` · `→ agents` CASCADE · `→ kh_knowledge` RESTRICT | không (RLS `kh_knowledge` lọc) |
| `kh_job_knowledge` | `items [{id,name,project,connection_id}]` 1..10 | PK `job_id → jobs` CASCADE | `v_t` |
| `kh_stage_usage` | `queries` 0..5, `last_warning` | PK `(stage_run_id, attempt, round)` CASCADE | `v_t` |
| `kh_writes` | hàng chờ worklog (`connection_id`, `knowledge_id`, `project_id`, `status`, `attempts` ≤ 5) | UNIQUE `output_id` · `→ process_runs/stage_runs/process_outputs` CASCADE | `v_t` |

**Audit CHECK**: giữ mọi giá trị tới 0028 + action `check, degrade, write_fail` / entity `kh_connection, kh_tenant, kh_knowledge, kh_query, kh_worklog`.
**`snapshot.kh`** (chốt lúc start; vắng = không đích): `{ stages: ({ knowledge_id, name, project, connection_id } | null)[] }`.
**`used_by` (H4b-1)**: `knowledge_hub` = `kh_tenants ⋈ kh_connections WHERE secret_id = ANY($ids)` ⇒ `{type, id: tenant_id, key: "<connection.name>/<ns>"}`; secret đang dùng ⇒ 409 `SECRET_IN_USE`.

Không seed KH (dev dùng mock). Seed quy trình mẫu: plan §6.

## 5. UI (frontend-lead)
**Chưa artboard.** Mockup: https://claude.ai/artifact/MHUei1vhi2WHKqYWi21WFQ (FE chờ người dùng OK). Chi tiết (bố cục, trạng thái, VI/EN, validate, nhãn e2e): [`plan-frontend.md`](plan-frontend.md), đã đối chiếu §3.
| Màn | App | Contract |
|---|---|---|
| Cài đặt → KnowledgeHub: URL + bảng tenant ↔ ns, Sheet (secret, keyspace, project), Dialog kết quả kiểm | studio-web `/settings` (platform_admin) | §3.2 `/kh*` |
| Agent → "Tri thức" (Switch `knowledge_enabled`, chỉ `agentic-cli`; không có "Loại project") | studio-web | `PUT /agents/:id/knowledge` |
| Quy trình → thẻ "Tri thức" (project mặc định + theo stage, lưu riêng, hiện `effective`) + Dialog "Tri thức" bật theo công ty | admin-web (tenant_admin) | §3.3 |
| Output stage: cảnh báo hạ cấp + "n/5 lần · Tóm tắt" | admin-web OutputDialog, chat-web run-block/run-page | `StageView.knowledge` |

Quyết định: không thư viện/ADR mới; credentials chỉ chọn `secret_id` (tạo ở Secrets, không có "Toàn nền tảng"); một cờ `enabled` (tenant) + `status=ok`; Kiểm tra kết nối theo hàng đã lưu.

## 6. Hiệu năng
Mặc định `CONVENTIONS.md` §6 (không chặn mốc). Mỗi lời gọi KH ≤ `HUB_KH_TIMEOUT_MS` = 5000 ("Kiểm tra" ≤ 20 s). `kh-query`: Hub thêm ≤ 50 ms p95 ngoài KH (tra theo PK, upsert `kh_stage_usage`; gọi song song mỗi kho, mọi kết nối). `tools/list` 0 query DB. Bộ gửi worklog: 10 s, lô ≤ 20, `SKIP LOCKED` trên `kh_writes_due_idx`.

## 7. Phụ thuộc & giả lập
| Phụ thuộc | Giả lập |
|---|---|
| KH v6.4 `/v1` | Mock KH (`bun run mocks`, cổng `KH_MOCK_PORT` = 4030; int test dựng thêm `createKhMock()` thứ hai cho kết nối thứ hai), kịch bản plan §7 |
| H4b-1 `useSecret` | Secret thật trong DB test |

**Từ H4b-1** (Q12): (a) `usedByMany` thêm `knowledge_hub` (§4); (b) kiểm `work/<job_id>/` (AC-H4b1-07) bằng job giả dùng `useSecret`.
Env: `HUB_KH_ALLOWED_ORIGINS` (cách dấu phẩy; vắng ⇒ không lưu được kết nối; dev/test vắng ⇒ `http://localhost:4030,http://127.0.0.1:4030`) · `HUB_KH_TIMEOUT_MS` (1000..30000, 5000). Mock credentials `kh-ns-<ns>` / `mock-secret-<ns>`; không vào docker-compose.

## 8. Tiêu chí nghiệm thu (qc)
Bản nháp theo BA; qc hoàn thiện ở test-plan.

| AC | Given / When / Then | Test |
|---|---|---|
| K1-AC01 | KH hợp lệ ⇒ "Kiểm tra kết nối" OK; `include_people_lanes=true` + project dùng chung / `kind=local` / http ⇒ lỗi nêu nguyên nhân; lanes bật + chỉ project riêng ⇒ OK | R `kh-check-rules`, `kh-rules` · A `check` · E studio (R01–R06, R30–R43 · A30–A47 · E06–E07) |
| K1-AC02 | Tenant A chạy run ⇒ chỉ credentials ns A; kho tenant B bỏ qua/404; kho nhiều KH ⇒ gọi đúng KH | A `query`, `tenant` · R `kh-summary-rules` (A74–A75, A51, A56, A60 · R61, R64) |
| K1-AC03 | Token chỉ trong bộ nhớ; 401 ⇒ làm mới và thử lại đúng 1 lần; credentials không có trong job/prompt/log/audit | R `kh-rules` · A `query`, `noleak` (R14–R16 · A77–A79, A110–A111) |
| K1-AC04 | `kh_query` 5 lần OK, lần 6 lỗi tool; ≤ 4000 ký tự/lần | R `kh-summary-rules`, `contracts-k1` · A `query` (R65–R66, R75, R78 · A73–A75, A84) |
| K1-AC05 | Stage có gate: Đạt ⇒ ghi worklog đúng subject + khoá idempotent; trượt ⇒ không ghi; kho chỉ đọc ⇒ không ghi | R `kh-summary-rules` · A `worklog` (R50–R53, R63 · A93–A97) |
| K1-AC06 | KH sập / 404 / 423 / 503 ⇒ run tiếp tục, cảnh báo + audit | R `kh-rules` · A `query`, `worklog` · E chat (R16–R17 · A80–A83, A98–A101 · E30) |
| K1-AC07 | Stage có kho ghi được gắn agent ⇒ `## Tóm tắt` bắt buộc; không có ⇒ không đổi, không ghi | R `kh-summary-rules` · A `worklog` · E admin (R55–R62 · A90–A92 · E20, E22) |
| K1-AC08 | Seed `sdlc-delivery`, `bug-fix` hợp lệ (≤ 10 stage); 12 file test khoá của `sdlc` không đổi | A `seed` (A120–A122) |
| K1-AC09 (chuyển từ H4b-1) | (a) Xoá `kh_api_key` đang được KH trỏ tới ⇒ 409 `SECRET_IN_USE` có `used_by[type=knowledge_hub]`; (b) job giả dùng `useSecret` ⇒ giá trị không xuất hiện trong `work/<job_id>/` (AC-H4b1-07, Q12) | A `studio` A23 (a) · A `noleak` A112 (b) |

Lệnh xong: `done:k1` = test-plan §6.

## 9. Quyết định
### Trước Gate (đã chốt với người dùng)
- 2026-10-13 · Intake Đầy đủ chốt 14 mặc định: CR-067 (chỉ `/v1/{ns}`, ns = tenant, credentials JSON, token trong bộ nhớ, TLS qua proxy, license), CR-068 (`## Tóm tắt` qua worklog, embedder đa ngữ), CR-069 (K2 thu hẹp), CR-070 (seed mẫu). Khảo sát: [`research-ai-sdlc.md`](research-ai-sdlc.md).
### Câu hỏi trước Gate (backend-lead; mặc định đề xuất)
| # | Câu hỏi | Mặc định |
|---|---|---|
| Q1 | `kh_query` ∉ `CATALOG_KEY_RE` | Khoá **`kh-query`**; không đổi contract job/Runtime |
| Q2 | People lanes | **Người dùng chốt:** được với project riêng tenant (KH ≤ 40% budget); kho dùng chung ⇒ lỗi `kh_people_lanes_on_shared` |
| Q3 | Cảnh báo hạ cấp | `StageView.knowledge.warning` + audit; không sửa output |
| Q4 | Allowlist URL | Env `HUB_KH_ALLOWED_ORIGINS` (UI chỉ đọc), chung mọi kết nối |
| Q5 | Hiệu lực | Lần kiểm gần nhất `ok` theo (kết nối, tenant); đổi ns/secret/keyspace/`base_url` ⇒ `unchecked`; sửa kho không đổi |
| Q6 | Đếm ≤ 5 | `(stage_run, attempt, round)`, chung nhóm; lỗi KH tính; tham số sai / `disabled` không |
| Q7 | `kh_api_key` nền tảng | Không nhận (`wrong_tenant`) |
| Q8 | Stage nhóm | Không đích `## Tóm tắt`; `kh-query` theo kho agent từng job |
| Q9 | Agent seed mẫu | Dùng lại agent seed; seed schema nhận `after.review.back_to_steps` |
| Q10 | `kh-query` ngoài quy trình | Không ở K1 |
| Q11 | Chốt kho lúc nào | `kh-query`: tạo job; đích `## Tóm tắt`: start run; bộ gửi kiểm lại |
| Q12 | Nhiều kho | Gọi song song mỗi kho, chia đều budget (≥ 200), ghép ≤ 4000; một lần tool = một lần đếm |
| Q13 | Kho dùng chung chưa gắn ở KH | Không chặn; [Kiểm tra] kho cảnh báo; lúc chạy hạ cấp phần đó |
| Q14 | Xoá cấu hình tenant / kho đang gắn | Giữ kho / 409 `KH_KNOWLEDGE_IN_USE` |
| Q15 (nhiều KH) | Hai kết nối cùng `base_url`? | **Không** (UNIQUE): ns duy nhất theo kết nối chỉ có nghĩa khi một kết nối = một KH ⇒ 409 `KH_CONNECTION_EXISTS {field: base_url}` |
| Q16 | `enabled` lưu đâu | Bảng `kh_tenant_prefs` (một hàng/tenant), tạo khi có cấu hình đầu tiên; xoá cấu hình giữ cờ |
| Q17 | Kho thuộc kết nối tenant chưa hiệu lực lúc tạo job | Vẫn chốt; lúc gọi hạ cấp phần đó (`disabled`); tool chỉ thêm khi ≥ 1 kho có kết nối hiệu lực |
| Q18 | Đổi kết nối của kho / xoá kết nối còn dùng | Bất biến (xoá + tạo) / 409 `KH_CONNECTION_IN_USE` |
| Q19 | Tenant admin thấy gì về kết nối | Chỉ `name` + `status`, không URL/ns/secret |

- 2026-10-13 · Readiness lần 1: mặc định BE (#2–#21) đã áp (`R#` trong plan). CR-071: Gate lại; §3–4 + plan viết lại (Q10–Q14); bổ sung nhiều kết nối KH (Q15–Q19).
### Trong lúc làm
Xem [`spec-decisions.md`](spec-decisions.md).

## 10. Tranh chấp test
- (không)

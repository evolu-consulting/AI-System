---
id: K1-knowledgehub
title: K1 · KnowledgeHub làm RAG ngoài (Hub proxy) + quy trình mẫu AISDLC
milestone: K1
status: draft            # khung — chưa PLAN, chưa readiness, chưa Gate
requirements: [HUB-FR-131, HUB-FR-132, HUB-FR-133, HUB-FR-134, HUB-FR-137, HUB-BR-35, HUB-BR-36, HUB-BR-37, HUB-BR-40]
design:
  - docs/design/agent-hub/ba-agent-hub.md HUB-FR-131…134, 137 · HUB-BR-35…37, 40 (ngoại lệ HUB-BR-12)
  - docs/design/agent-hub/ui-agent-studio.md (Cài đặt → KnowledgeHub, Tri thức — thiếu artboard)
  - docs/adr/0012-knowledgehub-external-rag.md (Proposed) · docs/specs/K1-knowledgehub/research-ai-sdlc.md
  - docs/CHANGE-REQUESTS.md#CR-062 · #CR-067 · #CR-068 · #CR-070
  - nền: H4b-1 Secrets (`kh_api_key` theo tenant, `useSecret`) · P-a/P-b2 (`required_sections`, `## Bàn giao`, gate) · H2a (`/mcp`, token job)
owner: backend-lead + frontend-lead + qc
---

# K1 · KnowledgeHub (RAG ngoài)

Khung tách từ BA đã sửa theo Intake Đầy đủ 2026-10-13 (14 mặc định đã chốt). **Chỉ khung**: mục 3–5 do backend-lead/frontend-lead; chưa readiness/Gate. Chạy sau H4b-1.

## 1. Phạm vi
**Làm:**
- Studio → Cài đặt → KnowledgeHub: URL + bảng tenant ↔ namespace + credentials (`kh_api_key` JSON) + "Kiểm tra kết nối" (HUB-FR-131).
- Client KH `/v1/{ns}`: đổi token client credentials, giữ trong bộ nhớ, làm mới 60–90 s, `401` ⇒ thử lại 1 lần (HUB-FR-137).
- Mục "Tri thức" trong agent; `tenant_admin` bật theo công ty + chọn project KH cho quy trình/stage (HUB-FR-132).
- Tool `kh_query` ở `/mcp` → `POST /v1/{ns}/context/step` (4000 ký tự/lần, ≤ 5 lần/stage).
- Ghi `## Tóm tắt` qua `POST /v1/{ns}/worklog`; tự thêm `## Tóm tắt` vào `required_sections` cho quy trình đã chọn project KH (HUB-FR-133).
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
| ns = tenant | Mỗi tenant tối đa một cặp (ns, credentials); run chỉ dùng credentials của tenant mình; tenant khác ⇒ 404 | HUB-BR-35 |
| Project dùng chung | Đánh dấu chỉ đọc: `kh_query` được, không ghi `## Tóm tắt` | HUB-FR-132 |
| `kh_query` | `budget_chars` 4000; ≤ 5 lần/stage (lần 6 ⇒ lỗi tool, không lỗi run); kết quả là dữ liệu | HUB-FR-132, HUB-BR-31 |
| Ghi worklog | subject `<quy trình>/<stage>`; cắt 4000 ký tự; `Idempotency-Key` = run/stage/phiên bản output; `after: auto` ghi khi chốt output, có gate ghi khi Đạt | HUB-FR-133 |
| `## Tóm tắt` | ≤ 200 từ, quá thì cắt; chỉ bắt buộc với quy trình đã chọn project KH | HUB-FR-133 |
| Hạ cấp | Mạng/timeout, `404 ns_not_active`, `423 ns_suspended`, `503 embedder_unavailable` ⇒ chạy tiếp + cảnh báo output + audit | HUB-FR-134 |
| Seed mẫu | `sdlc-delivery` (≤ 10 stage: Scope Sign-off gate → Setup&Plan → Spec gate → Design → Implementation → Code Review → Testing → UAT gate → Release); `bug-fix` (Bug Intake gate → Code Reading → Bug Fix …). Code Review/Testing trượt ⇒ gate người + `back_to_steps`; phỏng cấu trúc `seed.py`, không chép prompt | CR-070 |

## 3. Contract (backend-lead)
<!-- backend-lead -->
File: `packages/contracts/src/hub-admin/kh.ts` (export qua `@ai/contracts/hub-admin`), mọi object `strictObject`. Quyết định, hàm thuần, luồng: [`plan.md`](plan.md). Body lỗi = `ErrorResponse` M0.

**3.1 Kiểu chung**
| Tên | Định nghĩa |
|---|---|
| `KhNsSchema` | `^[a-z][a-z0-9_]{2,31}$`, không bắt đầu `kh`, ∉ `admin, me, capabilities, token, redaction, openapi, health, version` (luật KH `auth-and-tenancy` §1) |
| `KhProjectIdSchema` | `^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$` |
| `KhKeyspaceSchema` | `^[a-z][a-z0-9_.-]{0,63}$`, mặc định `step` |
| `KhProjectSchema` | `{ project_id, label: string trim ≤ 80 = "", read_only: boolean = false }` |
| `KhCredentials` (giá trị secret `kh_api_key`, **không** có trong API — Hub parse khi dùng) | JSON `{ client_id: 1..128, client_secret: 1..512, token_url?: URL }`; sai ⇒ mục kiểm `kh_credentials_invalid` |
| `KhCheckItemSchema` | `{ code: KH_CHECK_CODES, level: "error" \| "warning", params?: Record<string, string \| number> }` |
| `KH_CHECK_CODES` | 17 mã lỗi + 4 mã cảnh báo (`kh_embedder_multilingual` luôn có) — danh sách + bước sinh: plan §3.1 |
| `KhCheckResultSchema` | `{ status: "ok" \| "error", checked_at: ISO, kh_version: string \| null, keyspace_dims: string[] ≤ 8, items: KhCheckItem[] ≤ 30 }`; `error` ⇔ có mục `level=error` |
| `KhStatusSchema` | `"unchecked" \| "ok" \| "error"` |
| `KhTenantSchema` | `{ tenant: {id,key,name}, ns, secret: {id, name} \| null, keyspace, enabled, status: KhStatus, check: KhCheckResult \| null, projects: KhProject[] ≤ 50, version, updated_at, updated_by }` |
| `KhSettingsSchema` | `{ base_url: string \| null, allowed_origins: string[]` (từ env, chỉ đọc), `timeout_ms, version, updated_at }` |
| `StageKnowledgeSchema` (thêm **optional** `knowledge` vào `StageViewSchema`, `chat/processes-entities.ts`) | `{ project_id, read_only, queries: 0..5, query_limit: 5, warning: KH_WARNING_CODES \| null, summary: "none" \| "pending" \| "written" \| "failed" \| "skipped" }`; vắng = stage không dùng KH |
| `KH_WARNING_CODES` (hạ cấp) | `unreachable` · `timeout` · `ns_not_active` · `ns_suspended` · `embedder_unavailable` · `unauthorized` · `forbidden` · `quota` · `invalid` · `server_error` · `disabled` (plan §3.3) |

**3.2 Studio — `/studio/api/kh*`** (chỉ `platform_admin`, 403 trước parse — sẵn ở `mountH4a`)
| Method · path | Request | 2xx | Lỗi |
|---|---|---|---|
| `GET /kh/settings` | — | 200 `KhSettings` | — |
| `PUT /kh/settings` | `{ base_url: string ≤ 512 \| null, version }` | 200 `KhSettings`; đổi URL ⇒ mọi tenant `status = unchecked` | 400 · 409 `VERSION_CONFLICT` · 422 `KH_URL_NOT_ALLOWED {reason: invalid \| not_https \| not_in_allowlist}` |
| `GET /kh/tenants` | `{ q? ≤ 64, limit 1..100 = 50, cursor? ≤ 512 }` | 200 `{ items: KhTenant[], next_cursor }` sắp `(lower(tenant.key), tenant_id)` | 400 |
| `PUT /kh/tenants/:tenant_id` | `{ ns, secret_id: uuid \| null, keyspace = "step", projects: KhProject[] ≤ 50 (project_id duy nhất), version?: int }` — vắng `version` = tạo | 201 tạo / 200 sửa `KhTenant`; đổi `ns`/`secret_id`/`keyspace`/`projects` ⇒ `status = unchecked`, `check = null` | 400 (tenant không tồn tại ⇒ path `tenant_id`) · 404 (sửa mà chưa có) · 409 `KH_TENANT_EXISTS` · 409 `KH_NS_TAKEN {tenant}` · 409 `VERSION_CONFLICT {current, updated_at}` · 422 `KH_SECRET_INVALID {reason: not_found \| wrong_kind \| wrong_tenant}` (secret phải `kh_api_key` **của chính tenant**) · 409 `KH_PROJECT_IN_USE {project_id, process_defs: [{id,key,name}]}` (bỏ project còn được gắn) |
| `DELETE /kh/tenants/:tenant_id?version=N` | — | 204; xoá luôn project + gắn quy trình của tenant (CASCADE, audit `summary.bindings_removed`) | 404 · 409 `VERSION_CONFLICT` |
| `POST /kh/tenants/:tenant_id/check` | — | 200 `KhCheckResult` (KH lỗi vẫn 200, `status=error`); lưu vào hàng (không tăng `version`) | 404 · 409 `KH_NOT_CONFIGURED` (thiếu `base_url` hoặc `secret_id`) |
| `PUT /agents/:id/knowledge` | `{ knowledge_enabled: boolean, version }` | 200 `AgentWriteResponse` (H4a); `AgentSchema` thêm `knowledge_enabled: boolean` | 404 · 409 `VERSION_CONFLICT` · 422 `KH_AGENT_RUNTIME` (chỉ `agentic-cli`) |

**"Kiểm tra kết nối"**: 10 bước `/health` → `/version` (≥ 6.4) → `/v1/me` không token (phải 401) → token → `/v1/capabilities` (`v1`, `retrieval`) → `/v1/me` (`kind=client`, đúng ns) → `/v1/{ns}/manifest` (có manifest, có keyspace; people lanes bật chỉ lỗi nếu tenant có project dùng chung) → project → cảnh báo embedder; mã từng bước: plan §3.1.

**3.3 Tenant — `/admin/kh*`, `/process-defs/:id/knowledge`** (`tenant_admin` = tenant phiên; `platform_admin` kèm `?tenant_id` — ngữ nghĩa `readTenant`/`writeTenant` của nguồn; `member` ⇒ 403; thêm `/admin/kh` vào `PROTECTED_PREFIXES`)
| Method · path | Request | 2xx | Lỗi |
|---|---|---|---|
| `GET /admin/kh` | `?tenant_id` | 200 `{ available: boolean, reason: null \| "not_configured" \| "unchecked" \| "check_failed", enabled, projects: KhProject[], version: int \| null }` | 404 |
| `PUT /admin/kh/enabled` | `{ enabled, version }` | 200 như GET | 409 `KH_NOT_CONFIGURED` (chưa có hàng) · 409 `VERSION_CONFLICT` |
| `GET /process-defs/:id/knowledge` | `?tenant_id` | 200 `KhBinding` = `{ process_def_id, project_id: \| null, stage_projects: Record<stage_key, project_id \| null>, version: int \| null, effective: [{ stage_key, project_id \| null, read_only, summary_required }] }` | 404 `NOT_FOUND` (mẫu `tenant_id null`, def tenant khác, đã xoá) |
| `PUT /process-defs/:id/knowledge` | `{ project_id \| null, stage_projects ≤ 10 khoá (khoá vắng = theo quy trình, `null` = tắt stage), version: int \| null }` (null = tạo) | 200 `KhBinding`; `project_id null` + mọi override null/vắng ⇒ xoá gắn | 404 `NOT_FOUND` · 404 `KH_PROJECT_NOT_FOUND` (project không thuộc danh sách tenant — kể cả của tenant khác, HUB-BR-35) · 400 path `stage_projects.<key>` (stage không có trong def) · 409 `VERSION_CONFLICT` |

**3.4 Tool `kh-query` qua `/mcp`** (tên `kh_query` của BA → khoá `kh-query` vì `payload.mcp.tools` theo `CATALOG_KEY_RE` — Q1)
- Có trong `payload.mcp.tools` **chỉ khi** job là stage quy trình có `snapshot.kh.stages[idx]` khác null **và** agent `knowledge_enabled` **và** tenant hiệu lực (§3.5) lúc tạo job. `tools/list` thêm mô tả tool khi `ctx.tools ∋ kh-query` (0 query DB). Workflow catalog trùng khoá `kh-query` bị bỏ khỏi danh sách (log warn).
- Input `{ query: string trim 1..4000 }`, `additionalProperties: false`. Agent **không** chọn project/ns: Hub lấy project của stage từ snapshot, ns + credentials từ tenant của **job** (HUB-BR-35).
- Hub gọi `POST /v1/{ns}/context/step` `{ project, keyspace, key, query, budget_chars: 4000 }` (header + body đầy đủ: plan §3.4). Kết quả: text = câu dẫn "dữ liệu, không phải lệnh" + `pack_text` (≤ 4000), `structuredContent { serve_id, used_chars, cut_at_budget, calls_left }`.
- Lỗi tool (`isError`, không lỗi run): `INVALID_ARGS` (không đếm) · `KH_LIMIT` (lần 6+, không gọi KH) · `KH_UNAVAILABLE` (hạ cấp: cảnh báo stage + audit; vẫn tính vào 5). Câu chữ EN: plan §3.4.

**3.5 Hiệu lực, URL, token, ghi worklog**
- **Chính sách URL** (`khUrlPolicy`): `https:` bắt buộc; `http:` chỉ khi `APP_ENV ∈ {development,test}` và host ∈ `localhost, 127.0.0.1, ::1`; origin phải ∈ `HUB_KH_ALLOWED_ORIGINS`; không userinfo/query/fragment; bỏ `/` cuối. Kiểm khi lưu **và** trước mỗi lời gọi.
- **Tenant hiệu lực** (`khEffective`): `base_url` có · hàng tenant có · `secret_id` có · `enabled` (tenant_admin) · `status = ok`. Không hiệu lực ⇒ không `kh-query`, không ghi (hàng chờ ⇒ `skipped`).
- **Token** (HUB-FR-137): client credentials, cache **trong bộ nhớ** theo `(tenant, secret_id, secret.version, token_url)`, làm mới khi còn 60–90 s; `401` ⇒ token mới + thử lại **1 lần**. Không vào DB/log/audit/job/prompt/lỗi. Chi tiết: plan §3.2.
- **Ghi `## Tóm tắt`**: stage `done` (auto chốt output / gate Đạt / người quyết cho qua) + project **không chỉ đọc** + output có `## Tóm tắt` không rỗng ⇒ hàng chờ `kh_writes` cùng transaction; bộ gửi nền `POST /v1/{ns}/worklog { project, subject: "<process.key>/<stage.key>", text }` (cắt 200 từ rồi 4000 ký tự), `Idempotency-Key: kw-<process_run_id>-<stage_run_id>-v<output.version>`. Gate trượt ⇒ không có hàng.
- **Lỗi KH**: query ⇒ hạ cấp ngay; ghi ⇒ thử lại ≤ 5 lần (lùi 30 s × 2ⁿ), `403/422/413` không thử lại; hết lần ⇒ `failed` + audit. Không đổi trạng thái run/gate. Bảng phân loại: plan §3.3.
- **`## Tóm tắt` bắt buộc**: lúc **start** run, stage có project **không chỉ đọc** và executor `agent` ⇒ snapshot thêm `Tóm tắt` vào `required_sections` + `## Tóm tắt` vào template (như `ensureHandoff`; def gốc không đổi). Quy trình không gắn / tenant không hiệu lực lúc start ⇒ snapshot như cũ.

**3.6 Audit**: entity `kh_settings` · `kh_tenant` · `kh_binding` · `kh_query` · `kh_worklog` (+ `agent`); action thêm `check` · `degrade` · `write_fail`. Before/after không bao giờ có giá trị secret/token. Ghi Studio qua `withConfigWrite` (bump + NOTIFY); `check`/hạ cấp/ghi worklog không bump. Bảng đầy đủ: plan §4.

## 4. Dữ liệu (backend-lead)
<!-- backend-lead -->
Migration `packages/db/migrations-hub/0029_k1_kh.sql` (sau `0028_h4b1_secrets`; idempotent như 0021: `IF NOT EXISTS`, `DO $$` kiểm `pg_constraint`/`pg_policies`; chỉ THÊM). Drizzle: file mới `packages/db/src/schema/hub-kh.ts`. RLS mẫu `v_t` của 0021 (`app.scope='system'` OR (`'user'` AND `tenant_id = app.tenant_id`)), policy `FOR ALL TO hub_rw`; `agent_runtime`/`hub_ro` không GRANT.

Cột/kiểu/CHECK đầy đủ: plan §5. Tóm tắt:
| Bảng | Vai trò | Khoá · FK (luật xoá) | RLS |
|---|---|---|---|
| `kh_settings` | một hàng `id=1`: `base_url`, `version` | PK `id` | không (nền tảng; hub_rw S/U) |
| `kh_tenants` | tenant ↔ `ns` ↔ `secret_id`, `keyspace`, `enabled`, `check_status/checked_at/check_result`, `version` | PK `tenant_id` · UNIQUE `ns` · `secret_id → secrets` RESTRICT | có |
| `kh_projects` | project của tenant + `label`, `read_only` | PK `(tenant_id, project_id)` · `→ kh_tenants` CASCADE | có |
| `kh_bindings` | gắn quy trình: `project_id` mặc định + `stage_projects` jsonb, `version` | PK `process_def_id` · `→ process_defs` CASCADE · `(tenant_id, project_id) → kh_projects` RESTRICT · `→ kh_tenants` CASCADE | có |
| `kh_stage_usage` | đếm `queries` 0..5 + `last_warning` | PK `(stage_run_id, attempt, round)` · `→ stage_runs` CASCADE | có |
| `kh_writes` | hàng chờ ghi worklog (`status` pending/done/failed/skipped, `attempts` ≤ 5, `next_at`) | PK `id` · UNIQUE `output_id` · `→ process_runs/stage_runs/process_outputs` CASCADE · index due `(next_at) WHERE pending` | có |
| `agents` (sửa) | `knowledge_enabled bool NOT NULL DEFAULT false` | — | như cũ |

**Audit CHECK**: DROP + ADD `hub_audit_log_action_check` thêm `check`, `degrade`, `write_fail`; `hub_audit_log_entity_check` thêm `kh_settings`, `kh_tenant`, `kh_binding`, `kh_query`, `kh_worklog` — giữ **toàn bộ** giá trị tới 0028 (gồm `rotate`, `secret`). Hằng `K1_AUDIT_ACTIONS`/`K1_AUDIT_ENTITIES` ở `hub-kh.ts`, trải vào `HUB_AUDIT_*_VALUES`.

**`snapshot.kh`** (trong `process_runs.snapshot`, chốt lúc start, vắng = run không dùng KH): `{ stages: ({ project: string, read_only: boolean, summary: boolean } | null)[] }` (độ dài = số stage). ns/credentials/`read_only` **đọc lại lúc gọi** (đổi giữa chừng có hiệu lực ngay; project bị gỡ khỏi tenant ⇒ `disabled`).

**`used_by` (H4b-1)**: `usedByMany` thêm `knowledge_hub` = `hub.kh_tenants WHERE secret_id = ANY($ids)` (index trên), `key = ns`. Xoá secret đang dùng ⇒ 409 `SECRET_IN_USE` (FK RESTRICT là chốt cuối).

Không xoá dữ liệu cũ; không seed KH (cấu hình qua Studio; dev dùng mock). Seed quy trình mẫu: plan §6.

## 5. UI (frontend-lead)
<!-- frontend-lead --> **Chưa có artboard — bố cục đề xuất, trình Gate người dùng.** Chi tiết (bố cục, trạng thái, VI/EN, validate, nhãn e2e): [`plan-frontend.md`](plan-frontend.md), đã đối chiếu §3.
| Màn | App | Contract |
|---|---|---|
| Cài đặt → KnowledgeHub: URL + bảng tenant ↔ ns, Sheet (secret, keyspace, project), Dialog kết quả kiểm | studio-web `/settings` (platform_admin) | §3.2 `/kh*` |
| Agent → "Tri thức" (Switch `knowledge_enabled`, chỉ `agentic-cli`; không có "Loại project") | studio-web | `PUT /agents/:id/knowledge` |
| Quy trình → thẻ "Tri thức" (project mặc định + theo stage, lưu riêng, hiện `effective`) + Dialog "Tri thức" bật theo công ty | admin-web (tenant_admin) | §3.3 |
| Output stage: cảnh báo hạ cấp + "n/5 lần · Tóm tắt" | admin-web OutputDialog, chat-web run-block/run-page | `StageView.knowledge` |

Quyết định: không thư viện/ADR mới; credentials chỉ chọn `secret_id` (tạo ở Secrets, không có "Toàn nền tảng"); một cờ `enabled` (tenant) + `status=ok`; Kiểm tra kết nối theo hàng đã lưu. Task F1–F4 (`tasks.md`).

## 6. Hiệu năng
Mặc định `CONVENTIONS.md` §6 (perf không chặn mốc). Mỗi lời gọi KH ≤ `HUB_KH_TIMEOUT_MS` = 5000 (tổng "Kiểm tra kết nối" ≤ 20 s). `kh-query`: Hub thêm ≤ 50 ms p95 ngoài thời gian KH (2 query: tra job→stage→run theo PK + `kh_stage_usage` upsert theo PK; cấu hình tenant theo PK). `tools/list` giữ 0 query DB. Bộ gửi worklog: mỗi 10 s, lô ≤ 20, `FOR UPDATE SKIP LOCKED` trên `kh_writes_due_idx`. List Studio ≤ 100 hàng/trang.

## 7. Phụ thuộc & giả lập
| Phụ thuộc | Cách giả lập khi dev/test |
|---|---|
| KH v6.4 `/v1` (health, version, capabilities, me, token, context/step, worklog) | Mock KH (`bun run mocks`), kịch bản: ok, 401 hết hạn, 404/423/503, timeout, `include_people_lanes=true` (có/không project dùng chung), `kind=local` |
| H4b-1 `useSecret` | Secret thật trong DB test |

**Việc chuyển từ H4b-1 sang K1** (H4b1 plan §2/Q12): (a) mở rộng `usedByMany` của `modules/secrets` thêm `type: knowledge_hub` (H4b-1 trả rỗng) để xoá `kh_api_key` đang dùng ⇒ 409 `SECRET_IN_USE`; (b) kiểm phần `work/<job_id>/` của AC-H4b1-07 (giá trị secret không xuất hiện trong thư mục job) bằng job giả dùng `useSecret`.

Env mới (`apps/hub-api/src/config/env.ts`): `HUB_KH_ALLOWED_ORIGINS` (danh sách origin cách dấu phẩy; vắng ⇒ không lưu được URL; `APP_ENV` development/test vắng ⇒ mặc định `http://localhost:4030`) · `HUB_KH_TIMEOUT_MS` (1000..30000, mặc định 5000). Mock KH: `tools/mocks/src/kh/` trong `bun run mocks`, cổng `KH_MOCK_PORT` = 4030, credentials `kh-ns-<ns>` / `mock-secret-<ns>`, điều khiển kịch bản `PUT /__mock/kh/ns/:ns` + `PUT /__mock/kh` (plan §7); không vào docker-compose. Lệnh xong: `bun run done:k1` (plan §8).

## 8. Tiêu chí nghiệm thu (qc)
Bản nháp theo BA; qc hoàn thiện ở test-plan.

| AC | Given / When / Then | Test |
|---|---|---|
| K1-AC01 | KH hợp lệ ⇒ "Kiểm tra kết nối" OK; `include_people_lanes=true` + project dùng chung / `kind=local` / http ⇒ lỗi nêu nguyên nhân; lanes bật + chỉ project riêng ⇒ OK | <!-- qc --> |
| K1-AC02 | Tenant A chạy run ⇒ chỉ credentials ns A; project tenant B ⇒ 404 | <!-- qc --> |
| K1-AC03 | Token chỉ trong bộ nhớ; 401 ⇒ làm mới và thử lại đúng 1 lần; credentials không có trong job/prompt/log/audit | <!-- qc --> |
| K1-AC04 | `kh_query` 5 lần OK, lần 6 lỗi tool; ≤ 4000 ký tự/lần | <!-- qc --> |
| K1-AC05 | Stage có gate: Đạt ⇒ ghi worklog đúng subject + khoá idempotent; trượt ⇒ không ghi; project chỉ đọc ⇒ không ghi | <!-- qc --> |
| K1-AC06 | KH sập / 404 / 423 / 503 ⇒ run tiếp tục, cảnh báo + audit | <!-- qc --> |
| K1-AC07 | Quy trình đã chọn project KH ⇒ `## Tóm tắt` bắt buộc; quy trình khác không đổi | <!-- qc --> |
| K1-AC08 | Seed `sdlc-delivery`, `bug-fix` hợp lệ (≤ 10 stage); 12 file test khoá của `sdlc` không đổi | <!-- qc --> |
| K1-AC09 (chuyển từ H4b-1) | (a) Xoá `kh_api_key` đang được KH trỏ tới ⇒ 409 `SECRET_IN_USE` có `used_by[type=knowledge_hub]`; (b) job giả dùng `useSecret` ⇒ giá trị không xuất hiện trong `work/<job_id>/` (AC-H4b1-07, Q12) | <!-- qc --> |

Lệnh xong: `done:k1` (backend-lead định nghĩa ở PLAN).

## 9. Quyết định
### Trước Gate (đã chốt với người dùng)
- 2026-10-13 · Intake Đầy đủ chốt 14 mặc định: CR-067 (chỉ `/v1/{ns}`, ns = tenant, credentials JSON, token trong bộ nhớ, TLS qua proxy, license), CR-068 (`## Tóm tắt` qua worklog, embedder đa ngữ), CR-069 (K2 thu hẹp), CR-070 (seed mẫu). Khảo sát: [`research-ai-sdlc.md`](research-ai-sdlc.md).
### Câu hỏi trước Gate (backend-lead PLAN 2026-10-13; mặc định đề xuất — chưa có trong CR-067…070)
| # | Câu hỏi | Mặc định đề xuất |
|---|---|---|
| Q1 | Tên tool `kh_query` không khớp `CATALOG_KEY_RE` (`^[a-z0-9-]{2,32}$`) của `payload.mcp.tools` (Runtime/pydantic kiểm cùng regex) | Khoá tool **`kh-query`** (agent thấy `mcp__hub__kh-query`); không đổi contract job/Runtime. "kh_query" giữ làm tên nghiệp vụ trong BA |
| Q2 | People lanes và `## Tóm tắt` quay lại qua `context/step` (KH chỉ phục vụ tầng `log` khi `include_people_lanes`≠false — `app/caps/retrieval.py`) | **Người dùng chốt 2026-10-13:** cho phép people lanes với project **riêng** của tenant (ns = tenant ⇒ vẫn cách ly) ⇒ agent đọc `## Tóm tắt` qua `kh-query` ngay K1; chấp nhận ghi chú người viết cùng project lẫn vào kết quả (KH giới hạn ≤ 40% budget). **Project dùng chung vẫn bắt buộc tắt lanes** (chỉ đọc, Hub không ghi Tóm tắt) ⇒ "Kiểm tra kết nối" lỗi `kh_people_lanes_on_shared`. Sửa CR-067/ADR-0012 |
| Q3 | "Cảnh báo vào output stage" khi hạ cấp | Hiện ở `StageView.knowledge.warning` (+ audit); **không** sửa nội dung file output của agent |
| Q4 | Allowlist URL KH ở đâu | Env `HUB_KH_ALLOWED_ORIGINS` (vận hành đặt, UI chỉ đọc); URL nằm trong DB qua Studio |
| Q5 | Khi nào tenant "hiệu lực" | Cần lần "Kiểm tra kết nối" gần nhất `ok`; mọi thay đổi ns/secret/keyspace/project/URL ⇒ `unchecked` ⇒ ngừng gọi KH tới khi kiểm lại |
| Q6 | Đếm ≤ 5 lần/stage | Theo lần chạy stage `(stage_run, attempt, round)`, nhóm agent dùng chung; lần gọi KH lỗi vẫn tính; tham số sai không tính |
| Q7 | `kh_api_key` mức nền tảng (`tenant_id` null, H4b-1 Q7 cho phép) | K1 **không nhận** (ns = tenant ⇒ secret phải của chính tenant; 422 `KH_SECRET_INVALID wrong_tenant`) |
| Q8 | Stage nhóm (`team`) | Không tự thêm `## Tóm tắt` (như `ensureHandoff`); có mục đó trong output thì vẫn ghi |
| Q9 | Seed `sdlc-delivery`/`bug-fix` dùng agent nào | Dùng lại agent seed sẵn (`intake-analyst`, `docs-architect`, `backend-lead`, `reviewer`, `qc`, `qc-uat`); mở rộng seed schema nhận `after: {review: {back_to_steps}}`; không thêm agent |

### Trong lúc làm (agent tự quyết theo Luật 2)
- (chưa có)

## 10. Tranh chấp test
- (không)

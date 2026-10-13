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

Tách từ BA (Intake 2026-10-13, 14 mặc định); readiness: [`readiness.md`](readiness.md). Chạy sau H4b-1.

## 1. Phạm vi
**Làm:**
- Studio → Cài đặt → KnowledgeHub: URL + bảng tenant ↔ namespace + credentials (`kh_api_key` JSON) + "Kiểm tra kết nối" (HUB-FR-131).
- Client KH `/v1/{ns}`: đổi token client credentials, giữ trong bộ nhớ, làm mới 60–90 s, `401` ⇒ thử lại 1 lần (HUB-FR-137).
- **CR-071:** Studio mục "Tri thức" = kho tri thức (tên, project KH, một công ty/dùng chung chỉ đọc, [Kiểm tra]); sửa agent → "Tri thức" chọn nhiều kho; `kh-query` chỉ hỏi kho gắn agent ∧ (tenant run ∨ dùng chung); bỏ gắn project theo quy trình/stage, `tenant_admin` giữ công tắc công ty (HUB-FR-132). §3–4 viết lại, Gate lại.
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
| ns = tenant | Mỗi tenant tối đa một cặp (ns, credentials); run chỉ dùng credentials của tenant mình; tenant khác ⇒ 404 | HUB-BR-35 |
| Project dùng chung | Đánh dấu chỉ đọc: `kh_query` được, không ghi `## Tóm tắt` | HUB-FR-132 |
| `kh_query` | `budget_chars` 4000; ≤ 5 lần/stage (lần 6 ⇒ lỗi tool, không lỗi run); kết quả là dữ liệu | HUB-FR-132, HUB-BR-31 |
| Ghi worklog | subject `<quy trình>/<stage>`; cắt 4000 ký tự; `Idempotency-Key` = run/stage/phiên bản output; `after: auto` ghi khi chốt output, có gate ghi khi Đạt | HUB-FR-133 |
| `## Tóm tắt` | ≤ 200 từ, quá thì cắt; chỉ bắt buộc với quy trình đã chọn project KH | HUB-FR-133 |
| Hạ cấp | Mạng/timeout, `404 ns_not_active`, `423 ns_suspended`, `503 embedder_unavailable` ⇒ chạy tiếp + cảnh báo output + audit | HUB-FR-134 |
| Seed mẫu | `sdlc-delivery` (≤ 10 stage: Scope Sign-off gate → Setup&Plan → Spec gate → Design → Implementation → Code Review → Testing → UAT gate → Release); `bug-fix` (6 stage, danh sách ở [plan §6](plan.md)). Code Review/Testing trượt ⇒ gate người + `back_to_steps`; phỏng cấu trúc `seed.py`, không chép prompt | CR-070 |

## 3. Contract (backend-lead · viết lại theo CR-071)
File `packages/contracts/src/hub-admin/kh.ts` (export `@ai/contracts/hub-admin`), mọi object `strictObject`, lỗi = `ErrorResponse` M0. Quyết định, hàm thuần, luồng, mã kiểm: [`plan.md`](plan.md).

**3.1 Kiểu chung**
| Tên | Định nghĩa |
|---|---|
| `KhNsSchema` | `^[a-z][a-z0-9_]{2,31}$`, không bắt đầu `kh`, ∉ `admin, me, capabilities, token, redaction, openapi, health, version` |
| `KhProjectIdSchema` · `KhKeyspaceSchema` | `^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$` · `^[a-z][a-z0-9_.-]{0,63}$` (mặc định `step`) |
| `KhCredentials` (giá trị secret `kh_api_key`, không có trong API) | JSON `{ client_id: 1..128, client_secret: 1..512, token_url?: URL }`; sai ⇒ `kh_credentials_invalid` |
| `KhCheckItemSchema` · `KH_CHECK_CODES` | `{ code, level: "error" \| "warning", params?: Record<string, string \| number> }` · 17 lỗi + 4 cảnh báo (plan §3.1) |
| `KhCheckResultSchema` | `{ status: "ok" \| "error", checked_at, kh_version: string \| null, keyspace_dims: string[] ≤ 8, items ≤ 30 }`; `error` ⇔ có mục `level=error` |
| `KhTenantSchema` | `{ tenant: {id,key,name}, ns, secret: {id,name} \| null, keyspace, enabled, status: "unchecked" \| "ok" \| "error", check: KhCheckResult \| null, version, updated_at, updated_by }` (**không** còn `projects`) |
| `KhSettingsSchema` | `{ base_url: string \| null, allowed_origins: string[], timeout_ms, version, updated_at }` (origins/timeout chỉ đọc, `AppDeps.kh` ?? env) |
| `KhKnowledgeSchema` (kho tri thức) | `{ id, name: trim 1..80, project_id, tenant: {id,key,name} \| null` (null = **dùng chung**), `read_only, agents_count: int, version, updated_at, updated_by }`; dùng chung ⇒ `read_only = true` |
| `KhKnowledgeCheckSchema` | `{ status: "ok" \| "warning" \| "error", checked_at, truncated: boolean, items: [{ tenant: {id,key,name}, ns: string \| null, result: "attached" \| "not_attached" \| "unverified" \| "not_configured" \| "failed", code: KH_WARNING_CODES \| null }] ≤ 100 }` |
| `StageKnowledgeSchema` (optional `knowledge` trong `StageViewSchema`) | `{ write_to: { knowledge_id, name } \| null, queries: 0..5, query_limit: 5, warning: KH_WARNING_CODES \| null, summary: "none" \| "pending" \| "written" \| "failed" \| "skipped" }`; vắng = stage không dùng KH |
| `KH_WARNING_CODES` | `unreachable · timeout · ns_not_active · ns_suspended · embedder_unavailable · unauthorized · forbidden · quota · invalid · server_error · disabled` |

**3.2 Studio** (chỉ `platform_admin`, 403 trước parse — `mountH4a`). Cột "Lỗi" luôn gồm 400 (body/query sai).
| Method · path | Request | 2xx | Lỗi |
|---|---|---|---|
| `GET /kh/settings` · `PUT /kh/settings` | PUT `{ base_url: ≤ 512 \| null, version }` | 200 `KhSettings`; đổi URL ⇒ mọi tenant `unchecked` | 409 `VERSION_CONFLICT` · 422 `KH_URL_NOT_ALLOWED {reason: invalid \| not_https \| not_in_allowlist}` |
| `GET /kh/tenants` | `q? ≤ 64, limit 1..100 = 50, cursor?` | 200 `{ items: KhTenant[], next_cursor }` theo `(lower(key), tenant_id)` | — |
| `PUT /kh/tenants/:tenant_id` | `{ ns, secret_id: uuid \| null, keyspace = "step", version?: int }` (vắng = tạo) | 201/200 `KhTenant`; đổi ns/secret/keyspace ⇒ `unchecked`, `check = null` | 400 path `tenant_id` (không tồn tại) · 404 · 409 `KH_TENANT_EXISTS` · `KH_NS_TAKEN {tenant}` · `VERSION_CONFLICT {current, updated_at}` · 422 `KH_SECRET_INVALID {reason: not_found \| wrong_kind \| wrong_tenant}` |
| `DELETE /kh/tenants/:tenant_id?version=N` | — | 204 (kho của tenant **giữ**, tenant không hiệu lực) | 404 · 409 `VERSION_CONFLICT` |
| `POST /kh/tenants/:tenant_id/check` | — | 200 `KhCheckResult` (KH lỗi vẫn 200); lưu vào hàng, không tăng `version` | 404 · 409 `KH_NOT_CONFIGURED` |
| `GET /kh/knowledge` | `q? ≤ 64, scope?: "shared" \| uuid tenant, limit 1..100 = 50, cursor?` | 200 `{ items: KhKnowledge[], next_cursor }` theo `(lower(name), id)` | — |
| `POST /kh/knowledge` | `{ name, project_id, tenant_id: uuid \| null, read_only = false }`; `tenant_id null` ∧ `read_only false` ⇒ 400 path `read_only` | 201 `KhKnowledge` | 400 path `tenant_id` · 409 `KH_KNOWLEDGE_EXISTS {id}` (trùng `(phạm vi, project_id)`) |
| `PUT /kh/knowledge/:id` | `{ name, project_id, read_only, version }` (phạm vi **không** đổi được) | 200 | 404 · 409 `KH_KNOWLEDGE_EXISTS` · `VERSION_CONFLICT` · 400 (dùng chung mà `read_only false`) |
| `DELETE /kh/knowledge/:id?version=N` | — | 204 | 404 · 409 `VERSION_CONFLICT` · 409 `KH_KNOWLEDGE_IN_USE {agents: [{id,key,name}] ≤ 20}` |
| `POST /kh/knowledge/:id/check` | — | 200 `KhKnowledgeCheck` (không lưu, audit `check`) | 404 · 409 `KH_NOT_CONFIGURED` (thiếu `base_url`) |
| `PUT /agents/:id/knowledge` | `{ knowledge_ids: uuid[] ≤ 10 duy nhất (thứ tự = thứ tự gắn), version }` (thay `knowledge_enabled`) | 200 `AgentWriteResponse`; `AgentSchema.knowledge_ids: uuid[]`, `AgentListItemSchema.knowledge_count` | 404 · 409 `VERSION_CONFLICT` · 422 `KH_AGENT_RUNTIME` (≠ `agentic-cli` mà list ≠ []) · 422 `KH_KNOWLEDGE_NOT_FOUND {ids}` |

**Kiểm tra kết nối (tenant)**: 10 bước plan §3.1 giữ; bước 8 lỗi `kh_people_lanes_on_shared` khi lanes bật ∧ có kho dùng chung có project gắn vào ns (`me.projects` rỗng ⇒ mọi kho dùng chung); bước 9 so `me.projects` với kho **của tenant**. **Kiểm tra kho**: kho tenant ⇒ một mục, `not_attached`/`not_configured`/`failed` ⇒ `error`; kho dùng chung ⇒ mỗi tenant đã có hàng KH (≤ 100 theo key) một mục, chưa gắn ⇒ chỉ `warning`. Không ảnh hưởng hiệu lực.

**3.3 Tenant — `/admin/kh*`** (`tenant_admin` = tenant phiên; `platform_admin` + `?tenant_id`; `member` ⇒ 403; `/admin/kh` vào `PROTECTED_PREFIXES`)
| Method · path | Request | 2xx | Lỗi |
|---|---|---|---|
| `GET /admin/kh` | `?tenant_id` | 200 `{ available, reason: null \| "not_configured" \| "unchecked" \| "check_failed", enabled, version: int \| null }` | 404 |
| `PUT /admin/kh/enabled` | `{ enabled, version }` | 200 như GET | 409 `KH_NOT_CONFIGURED` · `VERSION_CONFLICT` |

Bỏ (CR-071): `kh_bindings`, `GET/PUT /process-defs/:id/knowledge`, `KhProjectSchema`, `KH_PROJECT_IN_USE`, `KH_PROJECT_NOT_FOUND`, `knowledge_enabled`.

**3.4 Kho hiệu lực + tool `kh-query`** (khoá `kh-query` — Q1; chỉ job **stage quy trình**, Q10)
- **Kho hiệu lực** (`khEffectiveKnowledge`) = kho gắn agent của job, `tenant_id = tenant run ∨ null`, theo thứ tự gắn, ≤ 10 — **và** tenant hiệu lực (§3.5). Kho tenant khác bỏ qua lặng lẽ (RLS + WHERE).
- **Lúc tạo job**: agent `agentic-cli` ∧ tập ≠ ∅ ⇒ thêm `kh-query` vào `payload.mcp.tools` + chốt tập vào `kh_job_knowledge` (cùng tx). Rỗng ⇒ không tool. Đổi gắn/kho sau đó không thu hồi; lúc gọi vẫn kiểm tenant hiệu lực.
- Input `{ query: trim 1..4000 }`, `additionalProperties:false`; agent **không** truyền project/ns. Hub gọi song song `POST /v1/{ns}/context/step` cho **mỗi** project đã chốt, `budget_chars = max(200, ⌊4000/n⌋)`; ghép `### <tên kho>` + `pack_text`, tổng ≤ 4000; `structuredContent { serve_ids, used_chars, cut_at_budget, failed: int, calls_left }`. Một lần gọi tool = 1 lần đếm (≤ 5/stage, đếm chung nhóm).
- Lỗi tool (`isError`, không lỗi run): `INVALID_ARGS` (không đếm) · `KH_LIMIT` (lần 6+, không gọi KH) · `KH_UNAVAILABLE` (mọi project lỗi, hoặc `disabled` — `disabled` không đếm) · `NOT_CONFIGURED`. Một phần lỗi ⇒ trả phần OK + `warning` + audit `degrade`. Câu EN: plan §3.4.

**3.5 Hiệu lực, URL, token, ghi worklog**
- **URL** (`khUrlPolicy`): `https:`; `http:` chỉ `APP_ENV ∈ {development,test}` + host loopback; origin ∈ `HUB_KH_ALLOWED_ORIGINS`; không userinfo/query/fragment. Kiểm khi lưu **và** mỗi lời gọi (kể cả token), `redirect:"error"`.
- **`available`** = `base_url` ∧ hàng tenant ∧ `secret_id` ∧ `status=ok`; `reason` ưu tiên `not_configured` > `unchecked` > `check_failed`. **Tenant hiệu lực** = `available ∧ enabled`.
- **Token** (HUB-FR-137): client credentials, cache bộ nhớ theo `(tenant, secret_id, secret.version, token_url)`, làm mới khi còn 60–90 s, `401` ⇒ token mới + thử lại **1 lần**; không vào DB/log/audit/job/prompt.
- **Đích `## Tóm tắt`** (chốt lúc **start** run, stage executor `agent` đơn): kho **ghi được đầu tiên** trong kho hiệu lực của agent stage (`read_only=false`, `tenant_id = tenant run`) ⇒ `snapshot.kh.stages[idx]` + `ensureSummary` (thêm `Tóm tắt` vào `required_sections` + template, def gốc không đổi). Không có / tenant không hiệu lực / stage nhóm ⇒ `null`, snapshot như cũ.
- **Ghi**: stage `done` (auto chốt / gate Đạt / người cho qua) ∧ đích ≠ null ∧ output có `## Tóm tắt` ⇒ hàng chờ `kh_writes` cùng tx; bộ gửi nền `POST /v1/{ns}/worklog {project, subject: "<process.key>/<stage.key>", text}` (200 từ rồi 4000 ký tự), `Idempotency-Key: kw-<process_run_id>-<stage_run_id>-v<output.version>`; trước khi gửi kiểm lại tenant hiệu lực + kho còn ∧ không chỉ đọc, sai ⇒ `skipped`. Gate trượt ⇒ không có hàng.
- **Lỗi KH**: query ⇒ hạ cấp ngay; ghi ⇒ thử lại ≤ 5 (30 s × 2ⁿ), `403/422/413` không thử lại; hết ⇒ `failed` + audit. Không đổi trạng thái run/gate (plan §3.3).

**3.6 Audit**: entity `kh_settings · kh_tenant · kh_knowledge · kh_query · kh_worklog` (+ `agent`); action thêm `check · degrade · write_fail`. Không giá trị secret/token. Studio ghi qua `withConfigWrite`; check/hạ cấp/ghi không bump. Bảng: plan §4.

## 4. Dữ liệu (backend-lead)
Migration `migrations-hub/0029_k1_kh.sql` (sau 0028, idempotent, chỉ THÊM; chưa áp lên DB nào ⇒ viết lại tự do). Drizzle `schema/hub-kh.ts`. RLS mẫu `v_t` (0028), `FOR ALL TO hub_rw`; `agent_runtime`/`hub_ro` không GRANT. Cột/CHECK đủ: plan §5.
| Bảng | Vai trò | Khoá · FK (xoá) | RLS |
|---|---|---|---|
| `kh_settings` | một hàng `id=1`: `base_url`, `version` | PK | không |
| `kh_tenants` | tenant ↔ `ns` ↔ `secret_id`, `keyspace`, `enabled`, `check_*`, `version` | PK `tenant_id` · UNIQUE `ns` · `secret_id → secrets` RESTRICT | `v_t` |
| `kh_knowledge` | kho: `name`, `project_id`, `tenant_id` NULL = dùng chung, `read_only`, `version` | PK `id` · UNIQUE `(COALESCE(tenant_id, uuid0), project_id)` · CHECK `tenant_id IS NOT NULL OR read_only` | đọc: system ∨ (user ∧ (`tenant_id IS NULL` ∨ = tenant)); ghi: system |
| `agent_knowledge` | gắn kho ↔ agent + `position` 0..9 | PK `(agent_id, knowledge_id)` · UNIQUE `(agent_id, position)` · `→ agents` CASCADE · `→ kh_knowledge` RESTRICT | không (như `agents`; lọc tenant nhờ RLS `kh_knowledge`) |
| `kh_job_knowledge` | tập kho chốt lúc tạo job `items [{id,name,project}]` 1..10 | PK `job_id → jobs` CASCADE | `v_t` |
| `kh_stage_usage` | đếm `queries` 0..5 + `last_warning` | PK `(stage_run_id, attempt, round)` · `→ stage_runs` CASCADE | `v_t` |
| `kh_writes` | hàng chờ worklog (`knowledge_id`, `project_id`, `status`, `attempts` ≤ 5, `next_at`) | PK `id` · UNIQUE `output_id` · `→ process_runs/stage_runs/process_outputs` CASCADE · index due | `v_t` |

**Audit CHECK**: DROP + ADD giữ mọi giá trị tới 0028 + action `check, degrade, write_fail` / entity `kh_settings, kh_tenant, kh_knowledge, kh_query, kh_worklog` (`K1_AUDIT_*` trải vào `HUB_AUDIT_*_VALUES`).

**`snapshot.kh`** (`process_runs.snapshot`, chốt lúc start, vắng = không stage nào có đích ghi): `{ stages: ({ knowledge_id, name, project } | null)[] }` = đích `## Tóm tắt`. ns/credentials đọc lại lúc gọi.

**`used_by` (H4b-1)**: `knowledge_hub` = `kh_tenants WHERE secret_id = ANY($ids)` ⇒ `{type, id: tenant_id, key: ns}`; xoá secret đang dùng ⇒ 409 `SECRET_IN_USE`.

Không seed KH (dev dùng mock). Seed quy trình mẫu: plan §6.

## 5. UI (frontend-lead)
**Chưa artboard.** Mockup: https://claude.ai/artifact/MHUei1vhi2WHKqYWi21WFQ (FE chờ người dùng OK). Chi tiết (bố cục, trạng thái, VI/EN, validate, nhãn e2e): [`plan-frontend.md`](plan-frontend.md), đã đối chiếu §3.
| Màn | App | Contract |
|---|---|---|
| Cài đặt → KnowledgeHub: URL + bảng tenant ↔ ns, Sheet (secret, keyspace, project), Dialog kết quả kiểm | studio-web `/settings` (platform_admin) | §3.2 `/kh*` |
| Agent → "Tri thức" (Switch `knowledge_enabled`, chỉ `agentic-cli`; không có "Loại project") | studio-web | `PUT /agents/:id/knowledge` |
| Quy trình → thẻ "Tri thức" (project mặc định + theo stage, lưu riêng, hiện `effective`) + Dialog "Tri thức" bật theo công ty | admin-web (tenant_admin) | §3.3 |
| Output stage: cảnh báo hạ cấp + "n/5 lần · Tóm tắt" | admin-web OutputDialog, chat-web run-block/run-page | `StageView.knowledge` |

Quyết định: không thư viện/ADR mới; credentials chỉ chọn `secret_id` (tạo ở Secrets, không có "Toàn nền tảng"); một cờ `enabled` (tenant) + `status=ok`; Kiểm tra kết nối theo hàng đã lưu. Task F1–F4 (`tasks.md`).

## 6. Hiệu năng
Mặc định `CONVENTIONS.md` §6 (perf không chặn mốc). Mỗi lời gọi KH ≤ `HUB_KH_TIMEOUT_MS` = 5000 (tổng "Kiểm tra kết nối" ≤ 20 s). `kh-query`: Hub thêm ≤ 50 ms p95 ngoài thời gian KH (tra `kh_job_knowledge` + job→stage + cấu hình tenant theo PK, upsert `kh_stage_usage`; gọi KH song song theo project). `tools/list` giữ 0 query DB. Bộ gửi worklog: mỗi 10 s, lô ≤ 20, `FOR UPDATE SKIP LOCKED` trên `kh_writes_due_idx`. List Studio ≤ 100 hàng/trang.

## 7. Phụ thuộc & giả lập
| Phụ thuộc | Cách giả lập khi dev/test |
|---|---|
| KH v6.4 `/v1` (health, version, capabilities, me, token, context/step, worklog) | Mock KH (`bun run mocks`), kịch bản: ok, 401 hết hạn, 404/423/503, timeout, `include_people_lanes=true` (có/không project dùng chung), `kind=local` |
| H4b-1 `useSecret` | Secret thật trong DB test |

**Chuyển từ H4b-1** (Q12): (a) `usedByMany` thêm `knowledge_hub` (§4) ⇒ xoá `kh_api_key` đang dùng ⇒ 409 `SECRET_IN_USE`; (b) kiểm `work/<job_id>/` của AC-H4b1-07 bằng job giả dùng `useSecret`.

Env (`config/env.ts`, `.env.example`): `HUB_KH_ALLOWED_ORIGINS` (origin cách dấu phẩy; vắng ⇒ không lưu được URL; `APP_ENV` development/test vắng ⇒ `http://localhost:4030`) · `HUB_KH_TIMEOUT_MS` (1000..30000, mặc định 5000). Mock KH: `tools/mocks/src/kh/` trong `bun run mocks`, cổng `KH_MOCK_PORT` = 4030, credentials `kh-ns-<ns>` / `mock-secret-<ns>`, kịch bản: plan §7; không vào docker-compose. Lệnh xong `done:k1`: test-plan §6.

## 8. Tiêu chí nghiệm thu (qc)
Bản nháp theo BA; qc hoàn thiện ở test-plan.

| AC | Given / When / Then | Test |
|---|---|---|
| K1-AC01 | KH hợp lệ ⇒ "Kiểm tra kết nối" OK; `include_people_lanes=true` + project dùng chung / `kind=local` / http ⇒ lỗi nêu nguyên nhân; lanes bật + chỉ project riêng ⇒ OK | R `kh-check-rules`, `kh-rules` · A `check` · E studio (R01–R06, R30–R43 · A30–A47 · E06–E07) |
| K1-AC02 | Tenant A chạy run ⇒ chỉ credentials ns A; project tenant B ⇒ 404 | A `query`, `tenant` · R `kh-summary-rules` (A74–A75, A51, A56, A60 · R61, R64) |
| K1-AC03 | Token chỉ trong bộ nhớ; 401 ⇒ làm mới và thử lại đúng 1 lần; credentials không có trong job/prompt/log/audit | R `kh-rules` · A `query`, `noleak` (R14–R16 · A77–A79, A110–A111) |
| K1-AC04 | `kh_query` 5 lần OK, lần 6 lỗi tool; ≤ 4000 ký tự/lần | R `kh-summary-rules`, `contracts-k1` · A `query` (R65–R66, R75, R78 · A73–A75, A84) |
| K1-AC05 | Stage có gate: Đạt ⇒ ghi worklog đúng subject + khoá idempotent; trượt ⇒ không ghi; project chỉ đọc ⇒ không ghi | R `kh-summary-rules` · A `worklog` (R50–R53, R63 · A93–A97) |
| K1-AC06 | KH sập / 404 / 423 / 503 ⇒ run tiếp tục, cảnh báo + audit | R `kh-rules` · A `query`, `worklog` · E chat (R16–R17 · A80–A83, A98–A101 · E30) |
| K1-AC07 | Quy trình đã chọn project KH ⇒ `## Tóm tắt` bắt buộc; quy trình khác không đổi | R `kh-summary-rules` · A `worklog` · E admin (R55–R62 · A90–A92 · E20, E22) |
| K1-AC08 | Seed `sdlc-delivery`, `bug-fix` hợp lệ (≤ 10 stage); 12 file test khoá của `sdlc` không đổi | A `seed` (A120–A122) |
| K1-AC09 (chuyển từ H4b-1) | (a) Xoá `kh_api_key` đang được KH trỏ tới ⇒ 409 `SECRET_IN_USE` có `used_by[type=knowledge_hub]`; (b) job giả dùng `useSecret` ⇒ giá trị không xuất hiện trong `work/<job_id>/` (AC-H4b1-07, Q12) | A `studio` A23 (a) · A `noleak` A112 (b) |

Lệnh xong: `done:k1` = test-plan §6.

## 9. Quyết định
### Trước Gate (đã chốt với người dùng)
- 2026-10-13 · Intake Đầy đủ chốt 14 mặc định: CR-067 (chỉ `/v1/{ns}`, ns = tenant, credentials JSON, token trong bộ nhớ, TLS qua proxy, license), CR-068 (`## Tóm tắt` qua worklog, embedder đa ngữ), CR-069 (K2 thu hẹp), CR-070 (seed mẫu). Khảo sát: [`research-ai-sdlc.md`](research-ai-sdlc.md).
### Câu hỏi trước Gate (backend-lead; mặc định đề xuất)
| # | Câu hỏi | Mặc định |
|---|---|---|
| Q1 | `kh_query` không khớp `CATALOG_KEY_RE` của `payload.mcp.tools` | Khoá tool **`kh-query`** (`mcp__hub__kh-query`); không đổi contract job/Runtime |
| Q2 | People lanes | **Người dùng chốt 2026-10-13:** cho phép với project riêng của tenant (KH ≤ 40% budget); kho **dùng chung** bắt buộc tắt lanes ⇒ lỗi `kh_people_lanes_on_shared` |
| Q3 | Cảnh báo hạ cấp ở đâu | `StageView.knowledge.warning` + audit; không sửa file output |
| Q4 | Allowlist URL | Env `HUB_KH_ALLOWED_ORIGINS` (UI chỉ đọc) |
| Q5 | Tenant "hiệu lực" | Lần kiểm gần nhất `ok`; đổi ns/secret/keyspace/URL ⇒ `unchecked`. Sửa kho **không** đổi trạng thái tenant (CR-071) |
| Q6 | Đếm ≤ 5 | Theo `(stage_run, attempt, round)`, nhóm dùng chung; lỗi KH vẫn tính; tham số sai / `disabled` không tính |
| Q7 | `kh_api_key` nền tảng | Không nhận (422 `KH_SECRET_INVALID wrong_tenant`) |
| Q8 | Stage nhóm | Không có đích `## Tóm tắt` (không thêm, không ghi); `kh-query` theo kho của agent từng job |
| Q9 | Agent của seed mẫu | Dùng lại agent seed sẵn; seed schema nhận `after: {review: {back_to_steps}}` |
| Q10 (CR-071) | `kh-query` cho job không thuộc quy trình (chat trực tiếp)? | **Không** ở K1 (giới hạn "≤ 5/stage" cần stage); mở ở mốc sau |
| Q11 (CR-071) | Chốt kho lúc nào | `kh-query`: lúc **tạo job** (`kh_job_knowledge`); đích `## Tóm tắt`: lúc **start** run (vì `required_sections` chốt lúc start); bộ gửi kiểm lại trước khi ghi |
| Q12 (CR-071) | `context/step` nhận một project; agent có nhiều kho | Hub gọi song song mỗi project, chia đều budget (≥ 200), ghép ≤ 4000; một lần tool = một lần đếm |
| Q13 (CR-071) | Kho dùng chung ↔ tenant chưa gắn project phía KH | Không chặn; [Kiểm tra] kho báo cảnh báo; lúc chạy KH trả lỗi ⇒ hạ cấp phần đó |
| Q14 (CR-071) | Xoá cấu hình KH của tenant / xoá kho đang gắn agent | Xoá tenant giữ kho; xoá kho đang gắn ⇒ 409 `KH_KNOWLEDGE_IN_USE` |

- 2026-10-13 · Readiness lần 1: mặc định BE (#2–#21) đã áp (`R#` trong plan).
- 2026-10-13 · CR-071: Gate lại; §3–4 + plan viết lại (Q10–Q14).
### Trong lúc làm
Xem [`spec-decisions.md`](spec-decisions.md).

## 10. Tranh chấp test
- (không)

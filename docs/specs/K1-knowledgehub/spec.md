---
id: K1-knowledgehub
title: K1 · KnowledgeHub làm RAG ngoài (Hub proxy) + quy trình mẫu AISDLC
milestone: K1
status: plan
requirements: [HUB-FR-131, HUB-FR-132, HUB-FR-133, HUB-FR-134, HUB-FR-137, HUB-BR-35, HUB-BR-36, HUB-BR-37, HUB-BR-40]
design:
  - docs/design/agent-hub/ba-agent-hub.md HUB-FR-131…134, 137 · HUB-BR-35…37, 40 (ngoại lệ HUB-BR-12)
  - docs/design/agent-hub/ui-agent-studio.md (Cài đặt → Kết nối KnowledgeHub, Sửa agent → Tri thức — thiếu artboard)
  - docs/adr/0012-knowledgehub-external-rag.md (Accepted) · docs/specs/K1-knowledgehub/research-ai-sdlc.md
  - docs/CHANGE-REQUESTS.md#CR-062 · #CR-067 · #CR-068 · #CR-070 · #CR-072 (thay CR-071) · #CR-073 (bỏ cách ly tenant)
  - nền: H4b-1 Secrets (`kh_api_key` theo tenant, `useSecret`) · P-a/P-b2 (`required_sections`, `## Bàn giao`, gate) · H2a (`/mcp`, token job)
owner: backend-lead + frontend-lead + qc
---

# K1 · KnowledgeHub (RAG ngoài)

Tách từ BA (Intake 2026-10-13); [`readiness.md`](readiness.md). Sau H4b-1.

## 1. Phạm vi
**Làm:**
- Studio → Cài đặt → **Kết nối KnowledgeHub** (**CR-073**): **danh sách**; mỗi kết nối = tên + địa chỉ (allowlist, https) + khoá (secret `kh_api_key` mức nền tảng) + **Project ghi Tóm tắt** (tuỳ chọn, trống = không ghi) + "Kiểm tra". Không bảng công ty, không ns theo tenant, không công tắc `tenant_admin` (HUB-FR-131).
- Client KH `/v1/{ns}`: đổi token client credentials, giữ trong bộ nhớ, làm mới 60–90 s, `401` ⇒ thử lại 1 lần (HUB-FR-137).
- **CR-072/073 (tối giản):** sửa agent = tick KH được dùng (một/nhiều); `kh-query(câu hỏi, project)` dùng khoá của kết nối, khoá thấy project nào hỏi được (HUB-FR-132). Không trang/kho/gắn theo stage. **Hub không cách ly theo tenant — KH/khoá tự phân quyền; người dùng chấp nhận rủi ro đọc chéo công ty (CR-073, PRODUCTION-NOTES).**
- Tool `kh_query` ở `/mcp` → `POST /v1/{ns}/context/step` (4000 ký tự/lần, ≤ 5 lần/stage).
- Ghi `## Tóm tắt` (worklog) vào Project ghi Tóm tắt của KH đầu tiên (thứ tự tick) có project ghi; không có ⇒ không ghi, không thêm `## Tóm tắt` (HUB-FR-133).
- Hạ cấp khi KH lỗi (HUB-FR-134); mock KH.
- Seed quy trình mẫu `sdlc-delivery` + `bug-fix` (CR-070, chỉ seed; không sửa `sdlc`).

**Không làm:** nạp nguồn/tài liệu vào KH (K2); code-graph (hoãn, CR-069); tự gắn/xoay ns/client phía KH; tự chèn tri thức vào prompt; dùng `/vector/*` hay khoá chung; thêm KH vào docker-compose; đổi phía KH; canvas/template quy trình (P-b2 đã xong).

## 2. Nghiệp vụ
Trỏ BA; chỉ ghi phần cụ thể hoá.
| Luật | Điều kiện chính xác | Nguồn |
|---|---|---|
| Phiên bản tối thiểu | `GET /version` ≥ v6.4; `GET /v1/capabilities`: `api_versions ∋ v1` + `retrieval` (K2 thêm `packs`) | ADR-0012 §6 |
| Kiểm tra kết nối — lỗi | `GET /v1/me` `kind=local`; gọi không token vẫn được (trừ localhost dev); `http://` (trừ localhost dev) | HUB-FR-131, HUB-BR-40 |
| Kiểm tra kết nối — cảnh báo | ns bật `include_people_lanes` ⇒ chỉ **cảnh báo** `kh_people_lanes_on`, không chặn (Q2, CR-072) | HUB-FR-131 |
| Cảnh báo tĩnh | Embedder đa ngữ (bge-m3) là điều kiện KH; Hub không đo | ADR-0012 §8 |
| Không cách ly tenant (CR-073) | Một khoá/kết nối; Hub không lọc project theo công ty; khoá không thấy project ⇒ KH từ chối. Đảo HUB-BR-35 (người dùng chấp nhận) | HUB-BR-35, CR-073 |
| Project ghi Tóm tắt | Khai báo theo kết nối, tuỳ chọn; trống ⇒ không ghi | HUB-FR-133 |
| `kh-query` | Agent chỉ hỏi KH đã tick; `budget_chars` 4000; ≤ 5 lần/stage (lần 6 ⇒ lỗi tool, không lỗi run)| HUB-FR-132, HUB-BR-31 |
| Ghi worklog | subject `<quy trình>/<stage>`; cắt 4000 ký tự; `Idempotency-Key` = run/stage/phiên bản output; `after: auto` ghi khi chốt output, có gate ghi khi Đạt | HUB-FR-133 |
| `## Tóm tắt` | ≤ 200 từ, quá thì cắt; chỉ bắt buộc ở stage mà KH đầu tiên (thứ tự tick) của agent có Project ghi Tóm tắt | HUB-FR-133 |
| Hạ cấp | Mạng/timeout, `404 ns_not_active`, `423 ns_suspended`, `503 embedder_unavailable` ⇒ chạy tiếp + cảnh báo output + audit | HUB-FR-134 |
| Seed mẫu | `sdlc-delivery` (≤ 10 stage: Scope Sign-off gate → Setup&Plan → Spec gate → Design → Implementation → Code Review → Testing → UAT gate → Release); `bug-fix` (6 stage, danh sách ở [plan §6](plan.md)). Code Review/Testing trượt ⇒ gate người + `back_to_steps`; phỏng cấu trúc `seed.py`, không chép prompt | CR-070 |

## 3. Contract (backend-lead · CR-072)
File `packages/contracts/src/hub-admin/kh.ts` (export `@ai/contracts/hub-admin`), mọi object `strictObject`, lỗi = `ErrorResponse` M0. Hàm thuần, luồng, mã kiểm: [`plan.md`](plan.md).

**3.1 Kiểu chung**
| Tên | Định nghĩa |
|---|---|
| `KhNsSchema` | `^[a-z][a-z0-9_]{2,31}$`, không bắt đầu `kh`, ∉ `admin, me, capabilities, token, redaction, openapi, health, version` |
| `KhProjectIdSchema` · `KhKeyspaceSchema` | `^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$` · `^[a-z][a-z0-9_.-]{0,63}$` (mặc định `step`) |
| `KhCredentials` (secret `kh_api_key`, không qua API) | JSON `{ client_id: 1..128, client_secret: 1..512, token_url?: URL }` |
| `KhCheckItemSchema` · `KH_CHECK_CODES` | `{ code, level: "error" \| "warning", params?: Record<string, string \| number> }` · 15 lỗi + 6 cảnh báo (plan §3.1) |
| `KhCheckResultSchema` | `{ status: "ok" \| "error", checked_at, kh_version: string \| null, keyspace_dims: string[] ≤ 8, projects: KhProjectId[] ≤ 50` (ns thấy, từ `/v1/me`), `items ≤ 30 }`; `error` ⇔ có mục lỗi |
| `KhConnectionSchema` | `{ id, name: trim 1..80, base_url, tenants_count, agents_count, version, updated_at, updated_by }` |
| `KhTenantSchema` (theo **(kết nối, tenant)**) | `{ connection: {id,name}, tenant: {id,key,name}, ns, secret: {id,name} \| null, keyspace, summary_project: KhProjectId \| null, enabled` (chỉ đọc, cờ công ty), `status: "unchecked" \| "ok" \| "error", check: KhCheckResult \| null, version, updated_at, updated_by }` |
| `StageKnowledgeSchema` (optional `StageViewSchema.knowledge`) | `{ write_to: { connection: string` (tên), `project } \| null, queries: 0..5, query_limit: 5, warning: KH_WARNING_CODES \| null, summary: "none" \| "pending" \| "written" \| "failed" \| "skipped" }` |
| `KH_WARNING_CODES` | `unreachable · timeout · ns_not_active · ns_suspended · embedder_unavailable · unauthorized · forbidden · quota · invalid · server_error · disabled` |
| Agent | `AgentSchema.knowledge_connection_ids: uuid[]` (thứ tự tick) · `AgentListItemSchema.knowledge_count` |

**3.2 Studio** (tiền tố `/studio/api`, chỉ `platform_admin`, 403 trước parse — `mountH4a`). `C` = `/kh/connections`. Lỗi luôn gồm 400 (body/query sai); list: `limit 1..100 = 50, cursor?` ⇒ `{ items, next_cursor }`.
| Method · path | Request | 2xx | Lỗi |
|---|---|---|---|
| `GET C` | — | 200 + `allowed_origins: string[], timeout_ms` (chỉ đọc); sắp `(lower(name), id)` | — |
| `POST C` · `PUT C/:id` | `{ name, base_url: ≤ 512 }` (+ `version` khi PUT) | 201/200 `KhConnection`; đổi `base_url` ⇒ mọi cấu hình tenant của kết nối `unchecked`, `check = null` | 404 · 409 `KH_CONNECTION_EXISTS {id, field: "name" \| "base_url"}` · `VERSION_CONFLICT` · 422 `KH_URL_NOT_ALLOWED {reason: invalid \| not_https \| not_in_allowlist}` |
| `DELETE C/:id?version=N` | — | 204 | 404 · 409 `VERSION_CONFLICT` · `KH_CONNECTION_IN_USE {tenants, agents}` (đếm > 0) |
| `GET C/:cid/tenants` | `q? ≤ 64` | 200 `KhTenant[]` sắp `(lower(key), tenant_id)` | 404 |
| `PUT C/:cid/tenants/:tenant_id` | `{ ns, secret_id: uuid \| null, keyspace = "step", summary_project: KhProjectId \| null = null, version?: int }` (vắng `version` = tạo) | 201/200 `KhTenant`; đổi ns/secret/keyspace ⇒ `unchecked`, `check = null`; đổi `summary_project` không; tạo ⇒ thêm `kh_tenant_prefs` nếu chưa có | 400 path `tenant_id` · 404 · 409 `KH_TENANT_EXISTS` · `KH_NS_TAKEN {tenant}` (trong kết nối) · `VERSION_CONFLICT {current, updated_at}` · 422 `KH_SECRET_INVALID {reason: not_found \| wrong_kind \| wrong_tenant}` |
| `DELETE C/:cid/tenants/:tenant_id?version=N` | — | 204 (cờ `enabled`, gắn agent giữ) | 404 · 409 `VERSION_CONFLICT` |
| `POST C/:cid/tenants/:tenant_id/check` | — | 200 `KhCheckResult` (KH lỗi vẫn 200); lưu vào hàng, không tăng `version` | 404 · 409 `KH_NOT_CONFIGURED` (thiếu secret) |
| `PUT /agents/:id/knowledge` | `{ connection_ids: uuid[] ≤ 5 duy nhất` (thứ tự = thứ tự tick), `version }` | 200 `AgentWriteResponse` | 400 path `connection_ids` (trùng/quá) · 404 · 409 `VERSION_CONFLICT` · 422 `KH_AGENT_RUNTIME` (≠ `agentic-cli` ∧ list ≠ []) · `KH_CONNECTION_NOT_FOUND {ids}` |

**Kiểm tra (kết nối, tenant)**: 10 bước plan §3.1 (version, auth, `/v1`, capability, `me`, ns, manifest, keyspace; people lanes và `summary_project` ∉ `projects` chỉ **cảnh báo**). Không kiểm project/kho.

**3.3 Tenant — `/admin/kh*`** (`tenant_admin` = tenant phiên; `platform_admin` + `?tenant_id`; `member` ⇒ 403; vào `PROTECTED_PREFIXES`). `enabled`/`version` = cờ **chung công ty** (`kh_tenant_prefs`).
| Method · path | Request | 2xx | Lỗi |
|---|---|---|---|
| `GET /admin/kh` | `?tenant_id` | 200 `{ available, reason: null \| "not_configured" \| "unchecked" \| "check_failed", enabled, version: int \| null, connections: [{ name, status: "not_configured" \| "unchecked" \| "ok" \| "error" }] ≤ 50 }` (không URL/ns/secret) | 404 |
| `PUT /admin/kh/enabled` | `{ enabled, version }` | 200 như GET | 409 `KH_NOT_CONFIGURED` (không cấu hình ở kết nối nào) · `VERSION_CONFLICT` |

Bỏ (CR-072): `KhKnowledge*`, `/kh/knowledge*`, `KH_KNOWLEDGE_*`, `knowledge_ids`; từ trước: `kh_settings`, `kh_bindings`, `/process-defs/:id/knowledge`, `KhProject*`, `knowledge_enabled`.

**3.4 KH của job + tool `kh-query`** (chỉ job **stage quy trình**, agent `agentic-cli`, Q10)
- **Kết nối hiệu lực** (của tenant) = cấu hình (kết nối, tenant) `available` ∧ `enabled`. **KH của job** = kết nối agent tick (thứ tự) ∩ kết nối hiệu lực của tenant run, ≤ 5. ns + secret luôn theo (kết nối, tenant run).
- **Tạo job**: mỗi KH của job: `projects` = `GET /v1/me` (cache 300 s; lỗi ⇒ `check.projects`) + `summary_project`, ≤ 50; KH rỗng bị bỏ. Còn ≥ 1 KH ⇒ thêm `kh-query` vào `payload.mcp.tools` + chốt `kh_jobs.items` cùng tx tạo job. Đổi gắn/cấu hình sau đó không thu hồi; lúc gọi kiểm lại hiệu lực.
- **Nhãn project**: 1 KH ⇒ `<project>`; ≥ 2 KH ⇒ `<tên kết nối>/<project>`. Mô tả tool liệt kê nhãn + mặc định; `inputSchema {query: string 1..4000, project?: enum nhãn}`, `additionalProperties:false`. Agent không truyền ns/kết nối.
- **Chọn project**: khớp **chính xác** nhãn ⇒ (kết nối, project) đó; vắng ⇒ project của đích `## Tóm tắt` (§3.5); không có, hoặc ngoài nhãn ⇒ `KH_PROJECT` liệt kê nhãn (không đếm).
- **Gọi**: kết nối không còn hiệu lực ⇒ `KH_UNAVAILABLE` (`disabled`, không đếm); ≤ 5/stage, lần 6 `KH_LIMIT`; `POST /v1/{ns}/context/step {project, keyspace, key, query, budget_chars: 4000, limit: 10}` ⇒ câu dẫn + `pack_text` ≤ 4000, `structuredContent {project, serve_id, used_chars, cut_at_budget, calls_left}`. KH lỗi ⇒ `KH_UNAVAILABLE` + `warning` + audit `degrade` (đã đếm).
- Lỗi tool (`isError`, không lỗi run): `INVALID_ARGS` · `KH_PROJECT` · `KH_LIMIT` · `KH_UNAVAILABLE` · `NOT_CONFIGURED`. Câu EN: plan §3.5.

**3.5 URL, hiệu lực, token, ghi worklog**
- **URL** (`khUrlPolicy`, mỗi `base_url`): `https:` (`http:` chỉ dev/test + loopback); origin ∈ `HUB_KH_ALLOWED_ORIGINS`; không userinfo/query/fragment; kiểm khi lưu **và** mỗi lời gọi, `redirect:"error"`.
- **`available`** (kết nối, tenant) = có cấu hình ∧ `secret_id` ∧ `status=ok`. `/admin/kh`: `available` = ∃ kết nối available; không thì `reason` = `unchecked` > `check_failed` > `not_configured`.
- **Token** (HUB-FR-137): client credentials, cache bộ nhớ theo `(connection, tenant, secret_id, secret.version, token_url)`, làm mới khi còn 60–90 s, `401` ⇒ thử lại **1 lần**; không vào DB/log/audit/job/prompt.
- **Đích `## Tóm tắt`** (chốt lúc **start**, stage executor `agent` đơn, agent `agentic-cli`): KH **đầu tiên** (thứ tự tick) trong kết nối hiệu lực của tenant run **có** `summary_project` ⇒ `snapshot.kh.stages[idx]` + `ensureSummary` (def gốc không đổi). Không có / stage nhóm ⇒ `null`.
- **Ghi**: stage `done` (auto / gate Đạt / người cho qua) ∧ đích ≠ null ∧ output có `## Tóm tắt` ⇒ `kh_writes` cùng tx; bộ gửi nền gọi kết nối đích `POST /v1/{ns}/worklog {project, subject: "<process.key>/<stage.key>", text}` (200 từ, ≤ 4000), `Idempotency-Key: kw-<process_run_id>-<stage_run_id>-v<output.version>`; trước khi gửi kiểm lại kết nối hiệu lực, sai ⇒ `skipped`. Project theo snapshot (đổi `summary_project` sau start không ảnh hưởng run đang chạy).
- **Lỗi KH**: query ⇒ hạ cấp ngay; ghi ⇒ thử lại ≤ 5 (30 s × 2ⁿ), `403/422/413` không; hết ⇒ `failed` + audit. Không đổi trạng thái run/gate.

**3.6 Audit**: entity `kh_connection · kh_tenant · kh_query · kh_worklog` (+ `agent`); action thêm `check · degrade · write_fail`. Không secret/token. Studio ghi qua `withConfigWrite`; check/hạ cấp/ghi không bump. Bảng: plan §4.

## 4. Dữ liệu (backend-lead)
Migration `migrations-hub/0029_k1_kh.sql` (sau 0028, idempotent, chỉ THÊM, chưa áp ⇒ viết lại tự do); Drizzle `schema/hub-kh.ts`; RLS mẫu `v_t` (0028) `TO hub_rw`. Cột/CHECK/index: plan §5.
| Bảng | Vai trò | Khoá · FK (xoá) | RLS |
|---|---|---|---|
| `kh_connections` | `name`, `base_url`, `version` | PK `id` · UNIQUE `lower(name)`, `base_url` | không |
| `kh_tenant_prefs` | cờ `enabled` công ty, `version` | PK `tenant_id` | `v_t` |
| `kh_tenants` | (kết nối, tenant) ↔ `ns`, `secret_id`, `keyspace`, `summary_project?`, `check_*`, `version` | PK `(connection_id, tenant_id)` · UNIQUE `(connection_id, ns)` · `→ kh_connections`, `→ secrets` RESTRICT | `v_t` |
| `agent_kh` | agent ↔ kết nối, `position` 0..4 | PK `(agent_id, connection_id)` · UNIQUE `(agent_id, position)` · `→ agents` CASCADE · `→ kh_connections` RESTRICT | không (dữ liệu nền tảng) |
| `kh_jobs` | `items [{connection_id, name, summary_project, projects[]}]` 1..5 | PK `job_id → jobs` CASCADE | `v_t` |
| `kh_stage_usage` | `queries` 0..5, `last_warning` | PK `(stage_run_id, attempt, round)` CASCADE | `v_t` |
| `kh_writes` | hàng chờ worklog (`connection_id`, `project_id`, `status`, `attempts` ≤ 5) | UNIQUE `output_id` · `→ process_runs/stage_runs/process_outputs` CASCADE | `v_t` |

**Audit CHECK**: giữ mọi giá trị tới 0028 + action `check, degrade, write_fail` / entity `kh_connection, kh_tenant, kh_query, kh_worklog`.
**`snapshot.kh`** (chốt lúc start; vắng = không đích): `{ stages: ({ connection_id, name, project } | null)[] }`.
**`used_by` (H4b-1)**: `knowledge_hub` = `kh_tenants ⋈ kh_connections WHERE secret_id = ANY($ids)` ⇒ `{type, id: tenant_id, key: "<connection.name>/<ns>"}`; secret đang dùng ⇒ 409 `SECRET_IN_USE`.

Không seed KH (dev dùng mock). Seed quy trình mẫu: plan §6.

## 5. UI (frontend-lead)
**Mockup = bố cục chuẩn** (5 màn): https://claude.ai/artifact/MHUei1vhi2WHKqYWi21WFQ. Chi tiết (trạng thái, VI/EN, validate): [`plan-frontend.md`](plan-frontend.md), đã đối chiếu §3. Không trang "Tri thức", không thẻ binding quy trình, không "Loại project".
| Màn | App | Contract |
|---|---|---|
| Cài đặt: bảng "Kết nối KnowledgeHub" + bảng "Công ty của kết nối" + Sheet công ty + Dialog kết quả kiểm | studio-web `/settings` (platform_admin) | §3.2 `/kh/connections*` |
| Sửa agent → section "KnowledgeHub": checkbox kết nối + [Lưu] (chỉ `agentic-cli`) | studio-web | `PUT /agents/:id/knowledge` |
| Dialog "Tri thức" (một cờ, hiện `connections[name,status]`) | admin-web (tenant_admin) | §3.3 |
| `KnowledgeNotice` trong output ("Tri thức: n/5 lần hỏi · Tóm tắt: …") | admin OutputDialog, chat run-block/run-page | `StageView.knowledge` |

**Nhãn e2e (role "tên")**: `table "Kết nối KnowledgeHub"` · `button "Thêm kết nối"` · `button "Công ty|Sửa|Xoá {kết nối}"` · `dialog "Thêm kết nối"` (`textbox "Tên"`, `textbox "Địa chỉ"`, `button "Lưu"`) · `table "Công ty của kết nối"` · `button "Thêm công ty"` · `button "Kiểm tra|Kết quả|Sửa|Xoá {tenant}"` · `dialog "Thêm công ty"` (`combobox "Tenant"`, `textbox "Namespace"`, `combobox "Secret KnowledgeHub"`, `link "Tạo secret"`, `textbox "Project ghi Tóm tắt"`, `textbox "Keyspace"`) · `dialog "Kết quả kiểm tra"` · `region "KnowledgeHub"` (agent; `checkbox "{kết nối}"`, `button "Lưu"`) · `button "Tri thức"` → `dialog "Tri thức"` (`switch "Dùng tri thức cho công ty"`, `list "Kết nối"`) · output `status` "Không truy cập được KnowledgeHub", "Tri thức: 2/5 lần hỏi", "Tóm tắt: đang chờ". Đầy đủ: plan-frontend §5.

Quyết định: không thư viện/ADR mới; chỉ chọn `secret_id` (tạo ở Secrets); một cờ `enabled` (tenant) + `status=ok`; Kiểm tra theo hàng đã lưu.

## 6. Hiệu năng
Mặc định `CONVENTIONS.md` §6 (không chặn mốc). Mỗi lời gọi KH ≤ `HUB_KH_TIMEOUT_MS` = 5000 ("Kiểm tra" ≤ 20 s). Tạo job: `/v1/me` song song mỗi KH, cache 300 s, lỗi/timeout ⇒ fallback `check.projects`. `kh-query`: một lời gọi KH, Hub thêm ≤ 50 ms p95 (tra theo PK, upsert `kh_stage_usage`). `tools/list` không thêm query (JOIN `kh_jobs` trong tra token). Bộ gửi worklog: 10 s, lô ≤ 20, `SKIP LOCKED` trên `kh_writes_due_idx`.

## 7. Phụ thuộc & giả lập
| Phụ thuộc | Giả lập |
|---|---|
| KH v6.4 `/v1` | Mock KH (`bun run mocks`, cổng `KH_MOCK_PORT` = 4030; int test dựng `createKhMock()` thứ hai cho kết nối thứ hai; `/v1/me` trả `projects` theo ns), kịch bản plan §7 |
| H4b-1 `useSecret` | Secret thật trong DB test |

**Từ H4b-1** (Q12 của H4b-1): (a) `usedByMany` thêm `knowledge_hub` (§4); (b) kiểm `work/<job_id>/` (AC-H4b1-07) bằng job giả dùng `useSecret`.
Env: `HUB_KH_ALLOWED_ORIGINS` (cách dấu phẩy; vắng ⇒ không lưu được kết nối; dev/test vắng ⇒ `http://localhost:4030,http://127.0.0.1:4030`) · `HUB_KH_TIMEOUT_MS` (1000..30000, 5000). Mock credentials `kh-ns-<ns>` / `mock-secret-<ns>`; không vào docker-compose.

## 8. Tiêu chí nghiệm thu (qc)
Bản nháp theo BA; qc hoàn thiện ở test-plan.
| AC | Given / When / Then | Test |
|---|---|---|
| K1-AC01 | KH hợp lệ ⇒ "Kiểm tra kết nối" OK; `kind=local` / http ⇒ lỗi nêu nguyên nhân; `include_people_lanes=true` ⇒ vẫn OK kèm cảnh báo `kh_people_lanes_on` | R `kh-check-rules`, `kh-rules` · A `check` · E studio (R01–R06, R30–R43 · A30–A47 · E06–E07) |
| K1-AC02 | (CR-073) `kh-query` dùng khoá của kết nối; project khoá không thấy ⇒ KH từ chối; chỉ KH đã tick; nhiều KH ⇒ đúng KH; không có cách ly theo công ty (rủi ro chấp nhận) | R `kh-check-rules`, `kh-summary-rules` · A `query`, `tenant` (A74–A75, A51, A56, A60 · R61, R64) |
| K1-AC03 | Token chỉ trong bộ nhớ; 401 ⇒ làm mới và thử lại đúng 1 lần; credentials không có trong job/prompt/log/audit | R `kh-rules` · A `query`, `noleak` (R14–R16 · A77–A79, A110–A111) |
| K1-AC04 | `kh_query` 5 lần OK, lần 6 lỗi tool; ≤ 4000 ký tự/lần | R `kh-summary-rules`, `contracts-k1` · A `query` (R65–R66, R75, R78 · A73–A75, A84) |
| K1-AC05 | Stage có gate: Đạt ⇒ ghi worklog đúng subject + khoá idempotent; trượt ⇒ không ghi; Project ghi trống ⇒ không ghi | R `kh-summary-rules` · A `worklog` (R50–R53, R63 · A93–A97) |
| K1-AC06 | KH sập / 404 / 423 / 503 ⇒ run tiếp tục, cảnh báo + audit | R `kh-rules` · A `query`, `worklog` · E chat (R16–R17 · A80–A83, A98–A101 · E30) |
| K1-AC07 | KH đầu tiên (thứ tự tick) của agent stage có Project ghi Tóm tắt ⇒ `## Tóm tắt` bắt buộc; không có ⇒ không ghi | R `kh-summary-rules` · A `worklog` · E admin (R55–R62 · A90–A92 · E20, E22) |
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
| Q2 | People lanes | **CR-072:** chỉ cảnh báo `kh_people_lanes_on` (Hub không còn project dùng chung) |
| Q3 | Cảnh báo hạ cấp | `StageView.knowledge.warning` + audit; không sửa output |
| Q4 | Allowlist URL | Env `HUB_KH_ALLOWED_ORIGINS` (UI chỉ đọc), chung mọi kết nối |
| Q5 | Hiệu lực | Lần kiểm gần nhất `ok` theo (kết nối, tenant); đổi ns/secret/keyspace/`base_url` ⇒ `unchecked` |
| Q6 | Đếm ≤ 5 | `(stage_run, attempt, round)`, chung nhóm; lỗi KH tính; tham số sai / `KH_PROJECT` / `disabled` không |
| Q7 | `kh_api_key` nền tảng | Không nhận (`wrong_tenant`) |
| Q8 | Stage nhóm | Không đích `## Tóm tắt`; `kh-query` theo KH agent từng job |
| Q9 | Agent seed mẫu | Dùng lại agent seed; seed schema nhận `after.review.back_to_steps` |
| Q10 | `kh-query` ngoài quy trình | Không ở K1 |
| Q11 | Chốt lúc nào | KH + project: tạo job; đích `## Tóm tắt`: start run; bộ gửi kiểm lại hiệu lực |
| Q15 | Hai kết nối cùng `base_url`? | **Không** (UNIQUE) ⇒ 409 `KH_CONNECTION_EXISTS {field: base_url}`; xoá kết nối còn dùng ⇒ 409 `KH_CONNECTION_IN_USE` |
| Q16 | `enabled` lưu đâu | `kh_tenant_prefs` (một hàng/tenant), tạo khi có cấu hình đầu tiên; xoá cấu hình giữ cờ |
| Q19 | Tenant admin thấy gì | Chỉ `name` + `status`, không URL/ns/secret |
| Q20 (CR-072) | Danh sách project agent thấy lấy từ đâu | `GET /v1/me` lúc tạo job (cache 300 s); lỗi ⇒ `projects` lần kiểm gần nhất; luôn gồm `summary_project`; KH không project nào ⇒ không dùng ở job đó |
| Q21 | `summary_project` không nằm trong project ns thấy | Cảnh báo `kh_summary_project_not_attached`, không lỗi (KH là nơi quyết) |
| Q22 | Giới hạn | ≤ 5 KH/agent; ≤ 50 project/KH trong mô tả tool |
| Q23 | Đổi `summary_project` | Không đặt lại trạng thái kiểm; run đã start giữ đích cũ |
| Q24 | Agent không truyền `project` | Dùng project đích `## Tóm tắt`; không có ⇒ lỗi tool liệt kê project, không đếm |
| Q25 | Định danh project khi agent dùng ≥ 2 KH | `<tên kết nối>/<project>`, khớp chính xác (project id không chứa `/`); 1 KH ⇒ `<project>` |

Bỏ (CR-072, mô hình kho): Q12–Q14, Q17, Q18 (phần kho).
- 2026-10-13 · Readiness lần 1: mặc định BE (#2–#21) đã áp (`R#` trong plan). CR-071: Gate lại (Q10–Q19). **CR-072** (thay CR-071): §3–4, §6–7, plan viết lại tối giản (Q20–Q25); Gate lại.
### Trong lúc làm
Xem [`spec-decisions.md`](spec-decisions.md).

## 10. Tranh chấp test
- (không)

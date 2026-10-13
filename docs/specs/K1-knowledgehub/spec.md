---
id: K1-knowledgehub
title: K1 · KnowledgeHub làm RAG ngoài (Hub proxy) + quy trình mẫu AISDLC
milestone: K1
status: plan
requirements: [HUB-FR-131, HUB-FR-132, HUB-FR-133, HUB-FR-134, HUB-BR-37, HUB-BR-40]
design:
  - docs/design/agent-hub/ba-agent-hub.md HUB-FR-131…134 · HUB-BR-37, 40 (ngoại lệ HUB-BR-12)
  - docs/design/agent-hub/ui-agent-studio.md (Cài đặt → Kết nối KnowledgeHub, Sửa agent → Tri thức — thiếu artboard)
  - docs/adr/0012-knowledgehub-external-rag.md (Accepted) · docs/specs/K1-knowledgehub/research-ai-sdlc.md
  - docs/CHANGE-REQUESTS.md#CR-062 · #CR-067 · #CR-068 · #CR-070 · #CR-072 (thay CR-071) · #CR-073 (bỏ cách ly tenant; thay HUB-FR-137, HUB-BR-35/36)
  - nền: H4b-1 Secrets (`kh_api_key` mức nền tảng, `useSecret`) · P-a/P-b2 (`required_sections`, `## Bàn giao`, gate) · H2a (`/mcp`, token job)
owner: backend-lead + frontend-lead + qc
---

# K1 · KnowledgeHub (RAG ngoài)

Tách từ BA (Intake 2026-10-13); [`readiness.md`](readiness.md). Sau H4b-1.

## 1. Phạm vi
**Làm:**
- Studio → Cài đặt → **Kết nối KnowledgeHub** (**CR-073**): **danh sách**; mỗi kết nối = tên + địa chỉ (allowlist, https) + khoá (secret `kh_api_key` mức nền tảng) + **Project ghi Tóm tắt** (tuỳ chọn, trống = không ghi) + "Kiểm tra". Không cấu hình theo công ty, không công tắc `tenant_admin` (HUB-FR-131).
- Client KH: API gốc + header `X-KH-Key` (§3.0), không token/ns (Q26).
- **CR-072/073 (tối giản):** sửa agent = tick KH được dùng (một/nhiều); `kh-query(câu hỏi, project)` dùng khoá của kết nối, khoá thấy project nào hỏi được (HUB-FR-132). Không trang/kho/gắn theo stage. **Hub không cách ly theo tenant — KH/khoá tự phân quyền; người dùng chấp nhận rủi ro đọc chéo (CR-073, PRODUCTION-NOTES).**
- Tool `kh_query` ở `/mcp` → `POST /vector/query` (§3.0; 4000 ký tự/lần, ≤ 5 lần/stage).
- Ghi `## Tóm tắt` (worklog) vào Project ghi Tóm tắt của KH đầu tiên (thứ tự tick) có project ghi; không có ⇒ không ghi, không thêm `## Tóm tắt` (HUB-FR-133).
- Hạ cấp khi KH lỗi (HUB-FR-134); mock KH.
- Seed quy trình mẫu `sdlc-delivery` + `bug-fix` (CR-070, chỉ seed; không sửa `sdlc`).

**Không làm:** nạp nguồn/tài liệu vào KH (K2); code-graph (hoãn, CR-069); đổi phía KH (gắn/xoay khoá); tự chèn tri thức vào prompt; dùng `/v1/{ns}`; thêm KH vào docker-compose; canvas/template quy trình (P-b2 đã xong).

## 2. Nghiệp vụ
Trỏ BA; chỉ ghi phần cụ thể hoá.
| Luật | Điều kiện chính xác | Nguồn |
|---|---|---|
| Phiên bản tối thiểu | `GET /version` ≥ v6.4 (§3.0) | ADR-0012 §6 |
| Kiểm tra kết nối — lỗi | `GET /version` không khoá vẫn được (`kh_auth_disabled`, Q28); `http://` (trừ localhost dev) | HUB-FR-131, HUB-BR-40 |
| Cảnh báo tĩnh | Embedder đa ngữ (bge-m3) là điều kiện KH; Hub không đo | ADR-0012 §8 |
| Không cách ly tenant (CR-073) | Một khoá/kết nối; Hub không lọc project theo công ty; khoá không thấy project ⇒ KH từ chối. Đảo HUB-BR-35 (người dùng chấp nhận) | HUB-BR-35, CR-073 |
| Project ghi Tóm tắt | Khai báo theo kết nối, tuỳ chọn; trống ⇒ không ghi | HUB-FR-133 |
| `kh-query` | Agent chỉ hỏi KH đã tick; `budget_chars` 4000; ≤ 5 lần/stage (lần 6 ⇒ lỗi tool, không lỗi run)| HUB-FR-132, HUB-BR-31 |
| Ghi worklog | subject `<quy trình>/<stage>`; cắt 4000 ký tự; `id` cố định = run/stage/phiên bản output (Q32); `after: auto` ghi khi chốt output, có gate ghi khi Đạt | HUB-FR-133 |
| `## Tóm tắt` | ≤ 200 từ, quá thì cắt; chỉ bắt buộc ở stage mà KH đầu tiên (thứ tự tick) của agent có Project ghi Tóm tắt | HUB-FR-133 |
| Hạ cấp | Mạng/timeout, 401/403/404/429/5xx từ KH ⇒ chạy tiếp + cảnh báo output + audit | HUB-FR-134 |
| Seed mẫu | Seed vào tenant `evolu`; UAT K1 chạy trên evolu (2026-10-13). `sdlc-delivery` (≤ 10 stage: Scope Sign-off gate → Setup&Plan → Spec gate → Design → Implementation → Code Review → Testing → UAT gate → Release); `bug-fix` (6 stage, danh sách ở [plan §6](plan.md)). Code Review/Testing trượt ⇒ gate người + `back_to_steps`; phỏng cấu trúc `seed.py`, không chép prompt | CR-070 |

## 3. Contract (backend-lead · CR-073)
File `packages/contracts/src/hub-admin/kh.ts` (export `@ai/contracts/hub-admin`), mọi object `strictObject`, lỗi = `ErrorResponse` M0. Hàm thuần, luồng, mã kiểm: [`plan.md`](plan.md).

**3.0 Giao thức KH** (CR-073; thay `/v1/{ns}` của CR-067). API gốc của KH v6.4 ở chế độ **khoá chung** (`KH_API_KEY` của KH), mỗi lời gọi (trừ `/health`) gửi header `X-KH-Key: <khoá>`; không ns, không token, không Keycloak. Giống `ai-sdlc-rowan/POC/AISDLC/kh.py`. KH ở chế độ đăng nhập (SSO) không nhận khoá tĩnh ⇒ "Kiểm tra" báo `kh_key_rejected` (Q27).
| Route KH | Dùng ở | Hub gửi ⇒ đọc |
|---|---|---|
| `GET /health` | Kiểm tra | không khoá ⇒ `200 {model}` |
| `GET /version` | Kiểm tra | không khoá ⇒ phải `401`; có khoá ⇒ `{version}` ≥ v6.4 |
| `GET /projects` | Kiểm tra, tạo job | có khoá ⇒ khoá của object `projects` = project khoá thấy |
| `POST /vector/query` | `kh-query` | `{text, project, k: 8, max_chars: 1500}` ⇒ `hits[] {score, source_text}` |
| `POST /vector/add` | ghi `## Tóm tắt` | `{id, text, scope: "log", metadata: {scope: "log", project, subject, topic: subject, ts, source: "ai-hub"}}`; `id` cố định ⇒ ghi lại = ghi đè (idempotent) |

**3.1 Kiểu chung**
| Tên | Định nghĩa |
|---|---|
| `KhProjectIdSchema` | `^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$` (không `/`) |
| `KhConnectionNameSchema` | trim 1..80, không chứa `/` |
| `KhCheckItemSchema` · `KH_CHECK_CODES` | `{ code, level: "error" \| "warning", params?: Record<string, string \| number> }` · 7 lỗi + 5 cảnh báo (plan §3.1) |
| `KhCheckResultSchema` | `{ status: "ok" \| "error", checked_at, kh_version: string \| null, embedder: string \| null, projects: KhProjectId[] ≤ 50, items ≤ 20 }`; `error` ⇔ có mục lỗi |
| `KhConnectionSchema` | `{ id, name, base_url, secret: {id, name}, summary_project: KhProjectId \| null, status: "unchecked" \| "ok" \| "error", check: KhCheckResult \| null, agents_count, version, updated_at, updated_by }` |
| `KhConnectionWriteSchema` | `{ name, base_url: string ≤ 512, secret_id: uuid, summary_project: KhProjectId \| null = null }` (+ `version: int ≥ 1` khi PUT) |
| `StageKnowledgeSchema` (optional `StageViewSchema.knowledge`) | `{ write_to: { connection: string, project } \| null, queries: 0..5, query_limit: 5, warning: KH_WARNING_CODES \| null, summary: "none" \| "pending" \| "written" \| "failed" \| "skipped" }` |
| `KH_WARNING_CODES` | `unreachable · timeout · unauthorized · forbidden · not_found · invalid · rate_limited · server_error · disabled` |
| Agent | `AgentSchema.knowledge_connection_ids: uuid[]` (thứ tự tick) · `AgentListItemSchema.knowledge_count` |

**3.2 Studio** (tiền tố `/studio/api`, chỉ `platform_admin`, 403 trước parse — `mountH4a`). `C` = `/kh/connections`. Lỗi luôn gồm 400 (body/query sai).
| Method · path | Request | 2xx | Lỗi |
|---|---|---|---|
| `GET C` | `limit 1..100 = 50`, `cursor?` | 200 `{ items: KhConnection[], next_cursor, allowed_origins: string[], timeout_ms }`; sắp `(lower(name), id)` | — |
| `POST C` | `KhConnectionWrite` | 201 `KhConnection` (`status: "unchecked"`) | 409 `KH_CONNECTION_EXISTS {id, field: "name" \| "base_url"}` · 422 `KH_URL_NOT_ALLOWED {reason: invalid \| not_https \| not_in_allowlist}` · `KH_SECRET_INVALID {reason: not_found \| wrong_kind \| not_platform}` |
| `PUT C/:id` | `KhConnectionWrite` + `version` | 200 `KhConnection`; đổi `base_url` hoặc `secret_id` ⇒ `unchecked`, `check = null`; đổi `summary_project`/`name` không | 404 · như POST · 409 `VERSION_CONFLICT {current, updated_at}` |
| `DELETE C/:id?version=N` | — | 204 | 404 · 409 `VERSION_CONFLICT` · `KH_CONNECTION_IN_USE {agents}` (đếm `agent_kh` > 0) |
| `POST C/:id/check` | — | 200 `KhCheckResult` (KH lỗi vẫn 200); lưu vào hàng, không tăng `version` | 404 |
| `PUT /agents/:id/knowledge` | `{ connection_ids: uuid[] ≤ 5 duy nhất` (thứ tự = thứ tự tick), `version }` | 200 `AgentWriteResponse` | 400 path `connection_ids` (trùng/quá) · 404 · 409 `VERSION_CONFLICT` · 422 `KH_AGENT_RUNTIME` (≠ `agentic-cli` ∧ list ≠ []) · `KH_CONNECTION_NOT_FOUND {ids}` |

Không có route tenant (`/admin/kh*`), không cấu hình theo công ty (CR-073).

**3.3 KH của job + tool `kh-query`** (chỉ job **stage quy trình**, agent `agentic-cli`, Q10)
- **Kết nối dùng được** = `status = ok` ∧ `base_url` qua `khUrlPolicy` lúc gọi. **KH của job** = kết nối agent tick (thứ tự) ∩ dùng được, ≤ 5. Mọi tenant chạy agent đó dùng cùng kết nối + khoá (CR-073, không cách ly phía Hub).
- **Tạo job**: mỗi KH của job: `projects` = `GET /projects` (cache bộ nhớ 300 s theo `(connection, version)`; lỗi ⇒ `check.projects`) + `summary_project` đầu, ≤ 50; KH rỗng bị bỏ. Còn ≥ 1 ⇒ thêm `kh-query` vào `payload.mcp.tools` + `kh_jobs.items` cùng tx tạo job. Đổi gắn/kết nối sau đó không thu hồi; lúc gọi kiểm lại "dùng được".
- **Nhãn**: 1 KH ⇒ `<project>`; ≥ 2 ⇒ `<tên kết nối>/<project>`. `inputSchema {query: string 1..4000, project?: enum nhãn}`, `additionalProperties: false`; mô tả liệt kê nhãn + mặc định.
- **Chọn project**: khớp **chính xác** nhãn; vắng ⇒ `summary_project` của KH đầu tiên trong job có nó; không có hoặc ngoài nhãn ⇒ `KH_PROJECT` liệt kê nhãn (không đếm).
- **Gọi**: kết nối không còn dùng được ⇒ `KH_UNAVAILABLE` (`disabled`, không đếm); ≤ 5/stage, lần 6 `KH_LIMIT`; `POST /vector/query` (§3.0) ⇒ Hub ghép hit theo `score` giảm tới **4000 ký tự** ⇒ câu dẫn + văn bản, `structuredContent {project: nhãn, hits, used_chars, cut_at_budget, calls_left}`. KH lỗi ⇒ `KH_UNAVAILABLE` + `warning` + audit `degrade` (đã đếm).
- Lỗi tool (`isError`, không lỗi run): `INVALID_ARGS` · `KH_PROJECT` · `KH_LIMIT` · `KH_UNAVAILABLE`. Câu EN: plan §3.4. Khoá KH không vào job/payload/prompt/log/audit.

**3.4 URL, đích `## Tóm tắt`, ghi**
- **URL** (`khUrlPolicy`): `https:` (`http:` chỉ dev/test + loopback); origin ∈ `HUB_KH_ALLOWED_ORIGINS`; không userinfo/query/fragment; kiểm khi lưu **và** mỗi lời gọi; `redirect: "error"`.
- **Đích** (chốt lúc **start**, stage executor `agent` đơn, agent `agentic-cli`): KH **đầu tiên** (thứ tự tick, dùng được) **có** `summary_project` ⇒ `snapshot.kh.stages[idx]` + `ensureSummary`. Không có / stage nhóm ⇒ `null`, không thêm `## Tóm tắt`.
- **Ghi**: stage `done` (auto / gate Đạt / người cho qua) ∧ đích ≠ null ∧ output có `## Tóm tắt` ⇒ `kh_writes` cùng tx; bộ gửi nền kiểm lại kết nối dùng được (sai ⇒ `skipped`) rồi `POST /vector/add` với `subject = "<process.key>/<stage.key>"`, `text` ≤ 200 từ ∧ ≤ 4000 ký tự, `id = kw-<process_run_id>-<stage_run_id>-v<output.version>`. Lỗi: thử lại ≤ 5 (30 s × 2ⁿ) cho mạng/timeout/429/5xx; 4xx khác ⇒ `failed` ngay + audit. Không đổi trạng thái run/gate.

**3.5 Audit**: entity `kh_connection · kh_query · kh_worklog` (+ `agent`); action thêm `check · degrade · write_fail`. Không khoá. Studio ghi qua `withConfigWrite`; check/hạ cấp/ghi không bump. Bảng: plan §4.

## 4. Dữ liệu (backend-lead)
Migration `migrations-hub/0029_k1_kh.sql` (sau 0028, idempotent, chỉ THÊM, chưa áp ⇒ viết lại tự do); Drizzle `schema/hub-kh.ts`; RLS mẫu `v_t` (0028) `TO hub_rw`. Cột/CHECK/index: plan §5.
| Bảng | Vai trò | Khoá · FK (xoá) | RLS |
|---|---|---|---|
| `kh_connections` | `name`, `base_url`, `secret_id`, `summary_project?`, `check_*`, `version` | PK `id` · UNIQUE `lower(name)`, `base_url` · `secret_id → secrets` RESTRICT | không (nền tảng) |
| `agent_kh` | agent ↔ kết nối, `position` 0..4 | PK `(agent_id, connection_id)` · UNIQUE `(agent_id, position)` · `→ agents` CASCADE · `→ kh_connections` RESTRICT | không |
| `kh_jobs` | `items [{connection_id, name, summary_project, projects[]}]` 1..5 | PK `job_id → jobs` CASCADE | `v_t` |
| `kh_stage_usage` | `queries` 0..5, `last_warning` | PK `(stage_run_id, attempt, round)` CASCADE | `v_t` |
| `kh_writes` | hàng chờ ghi Tóm tắt (`connection_id`, `project_id`, `vector_id`, `status`, `attempts` ≤ 5) | UNIQUE `output_id` · `→ process_runs/stage_runs/process_outputs` CASCADE | `v_t` |

**Audit CHECK**: giữ mọi giá trị tới 0028 + action `check, degrade, write_fail` / entity `kh_connection, kh_query, kh_worklog`.
**`snapshot.kh`** (chốt lúc start; vắng = không đích): `{ stages: ({ connection_id, name, project } | null)[] }`.
**`used_by` (H4b-1)**: `knowledge_hub` = `kh_connections WHERE secret_id = ANY($ids)` ⇒ `{type, id: connection.id, key: connection.name}`; secret đang dùng ⇒ 409 `SECRET_IN_USE`. Secret phải `kind = kh_api_key` ∧ `tenant_id IS NULL`.

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
Mặc định `CONVENTIONS.md` §6 (không chặn mốc). Mỗi lời gọi KH ≤ `HUB_KH_TIMEOUT_MS` = 5000 ("Kiểm tra" ≤ 20 s). Tạo job: `GET /projects` song song mỗi KH, cache 300 s, lỗi ⇒ `check.projects`. `kh-query`: một lời gọi KH, Hub thêm ≤ 50 ms p95 (PK `kh_connections`, upsert `kh_stage_usage`). `tools/list` không thêm query (JOIN `kh_jobs` khi tra token). Bộ gửi: 10 s, lô ≤ 20, `SKIP LOCKED` trên `kh_writes_due_idx`.

## 7. Phụ thuộc & giả lập
| Phụ thuộc | Giả lập |
|---|---|
| KH v6.4 chế độ `KH_API_KEY` (§3.0) | Mock KH (`bun run mocks`, cổng `KH_MOCK_PORT` = 4030; int test dựng `createKhMock()` thứ hai cho kết nối thứ hai), kịch bản plan §7 |
| H4b-1 `useSecret` (`kh_api_key`, `tenant_id` null) | Secret thật trong DB test |

**Từ H4b-1** (Q12 của H4b-1): (a) `usedByMany` thêm `knowledge_hub` (§4); (b) kiểm `work/<job_id>/` (AC-H4b1-07) bằng job giả dùng `useSecret`.
Env: `HUB_KH_ALLOWED_ORIGINS` (cách dấu phẩy; vắng ⇒ không lưu được kết nối; dev/test vắng ⇒ `http://localhost:4030,http://127.0.0.1:4030`) · `HUB_KH_TIMEOUT_MS` (1000..30000, 5000). Mock: khoá `KH_MOCK_API_KEY` (mặc định `mock-kh-key`); không vào docker-compose.

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
- 2026-10-13 · Intake Đầy đủ chốt 14 mặc định (CR-067…070); khảo sát: [`research-ai-sdlc.md`](research-ai-sdlc.md). **CR-073** (siêu tối giản): kết nối KH mức nền tảng + khoá chung; người dùng chấp nhận bỏ cách ly tenant phía Hub ("KH tự lo") — thay CR-067 ns = tenant, CR-072 cấu hình theo công ty.
### Câu hỏi trước Gate (backend-lead; mặc định đề xuất)
| # | Câu hỏi | Mặc định |
|---|---|---|
| Q1 | `kh_query` ∉ `CATALOG_KEY_RE` | Khoá **`kh-query`** |
| Q3 | Cảnh báo hạ cấp | `StageView.knowledge.warning` + audit; không sửa output |
| Q4 | Allowlist URL | Env `HUB_KH_ALLOWED_ORIGINS` (UI chỉ đọc), chung mọi kết nối |
| Q6 | Đếm ≤ 5 | `(stage_run, attempt, round)`; lỗi KH tính; tham số sai / `KH_PROJECT` / `disabled` không |
| Q8 | Stage nhóm | Không đích `## Tóm tắt`; `kh-query` theo KH agent từng job |
| Q9 | Agent seed mẫu | Dùng lại agent seed; seed schema nhận `after.review.back_to_steps` |
| Q10 | `kh-query` ngoài quy trình | Không ở K1 |
| Q11 | Chốt lúc nào | KH + project: tạo job; đích `## Tóm tắt`: start run; bộ gửi kiểm lại "dùng được" |
| Q15 | Hai kết nối cùng `base_url` | Không (UNIQUE) ⇒ 409 `KH_CONNECTION_EXISTS {field: base_url}` |
| Q22 | Giới hạn | ≤ 5 KH/agent; ≤ 50 project/KH |
| Q24 | Agent không truyền `project` | `summary_project` của KH đầu tiên trong job có nó; không có ⇒ `KH_PROJECT` liệt kê nhãn, không đếm |
| Q25 | Nhãn khi ≥ 2 KH | `<tên kết nối>/<project>`, khớp chính xác; tên kết nối và project không chứa `/` |
| Q26 (mới) | Giao thức | API gốc + `X-KH-Key` (§3.0), không `/v1`: `/v1` cần ns + client credentials + Keycloak + cache token — đúng thứ CR-073 bỏ; API gốc là thứ `kh.py` đang dùng |
| Q27 (mới) | KH chạy chế độ đăng nhập (SSO) | Không hỗ trợ ở K1 (khoá tĩnh bị từ chối ⇒ lỗi `kh_key_rejected`); cần thì CR sau dùng `/v1` |
| Q28 (mới) | KH tắt xác thực (`GET /version` không khoá trả 2xx) | **Lỗi** `kh_auth_disabled` (chặn dùng: Tóm tắt của mọi công ty sẽ nằm ở kho mở); `http` loopback dev/test ⇒ chỉ cảnh báo `kh_auth_disabled_dev` |
| Q29 (mới) | Khoá bắt buộc? | Có: `secret_id` NOT NULL, `kh_api_key` mức nền tảng (`tenant_id` null); secret theo tenant ⇒ 422 `not_platform` |
| Q30 (mới) | Truy vấn | Không gửi `scope` (mọi loại dữ liệu của project, gồm Tóm tắt stage trước); `k = 8`, `max_chars = 1500`, Hub ghép tới 4000 ký tự |
| Q31 (mới) | Danh sách project | `GET /projects` lúc tạo job (cache 300 s), lỗi ⇒ `check.projects`; > 50 ⇒ giữ `summary_project` + 49 đầu theo tên, kiểm báo cảnh báo `kh_projects_many {count}` |
| Q32 (mới) | Idempotency ghi | `/vector/add` không có header idempotency ⇒ dùng `id` cố định theo run/stage/phiên bản (KH upsert theo `id`) |
| Q33 (mới) | Embedder | Đọc `model` của `/health`; tên chỉ tiếng Anh (`-en`) ⇒ cảnh báo `kh_embedder_english {model}`, không chặn |
| Q34 (mới) | Khi nào "dùng được" | Lần kiểm gần nhất `ok`; đổi `base_url`/`secret_id` ⇒ `unchecked` (phải kiểm lại); đổi `summary_project`/`name` không |

Bỏ (CR-073): Q2, Q5, Q7, Q16, Q19, Q20, Q21, Q23 (ns, people lanes, cấu hình/công tắc theo tenant, `/v1/me`). Bỏ trước đó: Q12–Q14, Q17, Q18.
- 2026-10-13 · Readiness lần 1 (`R#` trong plan cũ); CR-071, CR-072 Gate lại; **CR-073**: §3–4, §6–7, §9, plan viết lại siêu tối giản (Q26–Q34); Gate lại.
### Trong lúc làm
Xem [`spec-decisions.md`](spec-decisions.md).

## 10. Tranh chấp test
- (không)

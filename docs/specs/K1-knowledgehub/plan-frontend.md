---
spec: K1-knowledgehub
part: frontend
owner: frontend-lead
status: plan
requirements: [HUB-FR-131, HUB-FR-132, HUB-FR-133, HUB-FR-134, HUB-BR-35, HUB-BR-36, HUB-BR-40]
---

# Plan frontend · K1 · KnowledgeHub (CR-072 tối giản)

Nguồn: spec §1–3 · `plan.md` §3 · H4b-1 `plan-frontend.md` (D3–D9: ConflictDialog, "Đã lưu · v{n}") · mẫu: studio-web `features/{agents,secrets}`, admin-web `features/processes`.
**Bố cục chuẩn = mockup** https://claude.ai/artifact/MHUei1vhi2WHKqYWi21WFQ (5 màn). Plan này chỉ lấp trạng thái, câu chữ, validate, nhãn e2e; không vẽ lại. Không có trang "Tri thức", không thẻ binding quy trình, không "Loại project", không project do platform khai báo; Hub không quản kho.

## 0. Quyết định
| # | Quyết định | Lý do |
|---|---|---|
| D1 | Không thư viện/ADR mới. Route `/settings` nạp lười. Nav Studio không thêm mục (Cài đặt đã có) | CONVENTIONS §6 |
| D2 | Không nhập credentials ở K1: Sheet công ty chọn secret `kh_api_key` **của chính tenant** (`GET /studio/api/secrets?kind=kh_api_key&tenant_id=`); tạo ở màn Secrets qua link "Tạo secret". Không có "Toàn nền tảng" | spec §3.2 |
| D3 | Hai bảng trên một trang: **Kết nối** (platform) và **Công ty của kết nối** đang chọn (click dòng hoặc nút "Công ty" của dòng; `validateSearch {conn?: uuid, edit?: tenantId\|"new"}`) | mockup 1 |
| D4 | Studio chỉ **hiện** cờ công ty `enabled` (chỉ đọc). Bật/tắt = `tenant_admin` ở admin-web (`PUT /admin/kh/enabled`, một cờ) | spec §3.3 |
| D5 | Agent: `PUT /agents/:id/knowledge {connection_ids, version}` — nút [Lưu] **riêng** của section, version riêng (không nằm trong Lưu form agent); chỉ `agentic-cli`; thứ tự tick = thứ tự ưu tiên; ≤ 5 | spec §3.2 |
| D6 | "Project ghi Tóm tắt" là ô văn bản tự do (tuỳ chọn, `KhProjectId`) — Hub không liệt kê project của KH. Cảnh báo `kh_summary_project_not_attached` hiện trong kết quả kiểm | spec §3.1 |
| D7 | Cảnh báo hạ cấp là dữ liệu `StageView.knowledge.warning`, không toast: `Alert` vàng `aria-live="polite"` trong `KnowledgeNotice`. Không chặn, không đổi trạng thái run | HUB-FR-134 |
| D8 | Kiểm tra theo hàng đã lưu (không nhận giá trị gõ dở). Đổi ns/secret/keyspace ⇒ `unchecked` (đổi `summary_project` không); đổi `base_url` kết nối ⇒ mọi công ty của nó `unchecked` — UI báo trước khi lưu | spec §3.2 |
| D9 | Ghi chú embedder hiện tĩnh dưới bảng Công ty **và** là mục `kh_embedder_multilingual` trong kết quả kiểm | CR-068 |
| D10 | `KnowledgeNotice` ở `packages/ui` (thuần trình bày, props = `StageKnowledge`); dùng cho admin OutputDialog và chat run-block/run-page | spec §3.1 |

## 1. Cấu trúc
- studio-web: `routes/_authed/settings.tsx` (lazy) · `features/settings/knowledgehub/{api.ts, hooks/, lib/{schema,check-labels}.ts, components/{KhConnectionsTable,KhConnectionDialog,KhTenantsTable,KhTenantSheet,KhCheckDialog}, pages/KnowledgeHubSettingsPage.tsx, README.md}` · `features/agents/components/AgentKnowledgeSection.tsx` (+ hook trong `agents/api.ts`; chỉ hiện khi `runtime=agentic-cli`).
- admin-web: `features/processes/api.ts` (+ `khState`, `setKhEnabled`) · `components/knowledge/TenantKnowledgeDialog.tsx` · hook `use-kh-state`; `OutputDialog.tsx` gắn `KnowledgeNotice`.
- `packages/ui/src/knowledge-notice/KnowledgeNotice.tsx`; chat-web `features/processes/**` (run-block, run-page).

## 2. Màn và trạng thái (bố cục: mockup)
| Màn (mockup) | Nội dung | Đang tải | Rỗng | Lỗi | Quyền / 409 |
|---|---|---|---|---|---|
| 1a Studio → Cài đặt → bảng "Kết nối KnowledgeHub" | Cột Tên · Địa chỉ · Công ty đã cấu hình (`tenants_count`); mỗi dòng [Công ty] [Sửa] [Xoá]; [+ Thêm kết nối]; chip "Origin được phép" từ `allowed_origins` (chỉ đọc); "Tải thêm" theo `next_cursor` | Skeleton 4 dòng `aria-busy` | EmptyState "Chưa có kết nối KnowledgeHub" + [Thêm kết nối]. `allowed_origins` rỗng ⇒ Alert "Vận hành chưa khai báo HUB_KH_ALLOWED_ORIGINS — không lưu được địa chỉ" | Alert + [Thử lại] | Không `platform_admin` ⇒ `/forbidden`; `VERSION_CONFLICT` ⇒ ConflictDialog |
| 1b Dialog Thêm/Sửa kết nối | `Tên`, `Địa chỉ` (https), [Huỷ] [Lưu]. Sửa địa chỉ khi `tenants_count>0` ⇒ Alert "Đổi địa chỉ sẽ đặt mọi công ty của kết nối về Chưa kiểm tra." | — | — | `KH_CONNECTION_EXISTS` (field name/base_url) dưới ô; `KH_URL_NOT_ALLOWED` dưới ô địa chỉ | 409 ConflictDialog |
| 1c Xoá kết nối | `alertdialog`; `KH_CONNECTION_IN_USE {tenants, agents}` ⇒ Alert trong dialog, không đóng | — | — | — | — |
| 1d Bảng "Công ty của kết nối" | Tiêu đề kèm tên kết nối. Cột Công ty · Namespace · Secret · Project ghi Tóm tắt · Trạng thái · Kiểm tra lúc · (badge "Công ty bật/tắt"); mỗi dòng [Kiểm tra] [Kết quả] [Sửa] [Xoá]; [Thêm công ty]; note embedder (D9) | Skeleton | Chưa chọn kết nối: "Chọn một kết nối để xem công ty". Rỗng: "Chưa công ty nào được cấu hình" + [Thêm công ty] | Alert + [Thử lại] | `VERSION_CONFLICT` ⇒ ConflictDialog |
| 3 Sheet Thêm/Sửa công ty | `Tenant` (Select; sửa: chỉ đọc), `Namespace`, `Secret KnowledgeHub` (Select secret của tenant + link "Tạo secret" → `/secrets`), `Project ghi Tóm tắt` (tuỳ chọn), `Keyspace` (mặc định `step`); sửa ⇒ Alert "Lưu sẽ đặt trạng thái về Chưa kiểm tra; công ty ngừng dùng tri thức tới khi kiểm tra lại." (không hiện khi chỉ đổi project). [Huỷ] [Lưu]; sau lưu ở lại "Đã lưu · v{n}" | Select "Đang tải…" | Tenant không có secret: "Tenant này chưa có secret KnowledgeHub" + link | lỗi theo trường (`KH_TENANT_EXISTS`, `KH_NS_TAKEN`, `KH_SECRET_INVALID`) | 409 ConflictDialog |
| 4 Dialog kết quả kiểm | Tổng `role="status"`; danh sách mục (lỗi trước, cảnh báo sau; icon + chữ); "Phiên bản KnowledgeHub: {v}", "Kiểm lúc {thời gian}" | "Đang kiểm tra…" (nút disabled; hạn UI 25 s) | `check=null`: "Chưa kiểm tra" | `KH_NOT_CONFIGURED` ⇒ "Thiếu địa chỉ hoặc secret — hãy lưu cấu hình trước" | — |
| 2 Sửa agent → section "KnowledgeHub" | Danh sách checkbox mọi kết nối (tên + địa chỉ), thứ tự tick hiện số 1..n; [Lưu]. Tick thứ 6 ⇒ các ô còn lại disabled + "Tối đa 5 kết nối" | Skeleton | Chưa có kết nối: "Chưa có kết nối KnowledgeHub — vào Cài đặt để thêm" + link `/settings` | `KH_AGENT_RUNTIME`/`KH_CONNECTION_NOT_FOUND` ⇒ Alert trong section; lỗi khác toast | Runtime ≠ `agentic-cli`: section disabled + "Chỉ agent chạy bằng CLI mới dùng được tri thức". `VERSION_CONFLICT` ⇒ ConflictDialog |
| 5a admin-web Dialog "Tri thức" (trang Quy trình, `tenant_admin`) | Switch "Dùng tri thức cho công ty" + mô tả + danh sách `connections[{name,status}]` (badge Chưa cấu hình/Chưa kiểm tra/Đạt/Lỗi) + [Đóng] | Skeleton | `connections` rỗng ⇒ "Chưa có kết nối nào cho công ty" | toast | `reason=not_configured` ⇒ Switch disabled + câu §4; `unchecked`/`check_failed` ⇒ bật được + Alert cảnh báo; `member` ⇒ không hiện nút; `VERSION_CONFLICT` ⇒ làm mới |
| 5b `KnowledgeNotice` (admin OutputDialog; chat run-block/run-page) | Trên output, chỉ khi `knowledge` có: Alert vàng khi `warning≠null`; dòng phụ "Tri thức: {queries}/{query_limit} lần hỏi · Tóm tắt: {trạng thái}" + (khi `write_to`) " (ghi vào {project} · {connection})" | — | `knowledge` vắng ⇒ không render | — | — |

**Hành vi**
| Tương tác | Hành vi |
|---|---|
| Lưu kết nối | `POST/PUT /kh/connections[/:id]`; toast "Đã lưu kết nối {name}" |
| Kiểm tra / Kết quả | `POST /kh/connections/:cid/tenants/:tid/check` → mở Dialog + làm mới hàng. [Kết quả] hiện `check` đã lưu; disabled khi `check=null` |
| Lưu công ty | `PUT .../tenants/:tid` (không `version` = tạo); `summary_project` rỗng ⇒ `null` |
| Xoá công ty | `alertdialog`: "Xoá cấu hình KnowledgeHub của {tenant} trên {connection}? Secret không bị xoá. Cờ bật của công ty và agent đã gắn được giữ." |
| Lưu section agent | gửi `connection_ids` theo thứ tự tick + `version` agent hiện tại; cập nhật `version` form từ `AgentWriteResponse` |

## 3. Validate client (zod; khớp contract §3.1)
| Trường | Luật | VI | EN |
|---|---|---|---|
| Tên kết nối | trim 1..80 | "Nhập tên (tối đa 80 ký tự)" | "Enter a name (at most 80 characters)" |
| Địa chỉ | bắt buộc, URL `https://` (cho `http://localhost`/`127.0.0.1`/`[::1]` khi dev), ≤ 512, không userinfo/query/fragment | "Địa chỉ không hợp lệ" · "Chỉ chấp nhận https:// (trừ localhost khi phát triển)" · "Địa chỉ không được chứa tài khoản, query hay fragment" | "Invalid address" · "Only https:// is allowed (except localhost in development)" · "Address must not contain credentials, query or fragment" |
| Tenant | bắt buộc (tạo) | "Chọn tenant" | "Select a tenant" |
| Namespace | `^[a-z][a-z0-9_]{2,31}$`, không bắt đầu `kh`, ∉ `admin, me, capabilities, token, redaction, openapi, health, version` | "Nhập namespace" · "Namespace gồm 3–32 ký tự: chữ thường, số, _; bắt đầu bằng chữ" · "Namespace không được bắt đầu bằng kh hoặc trùng tên dành riêng" | "Enter a namespace" · "Namespace: 3–32 characters, lowercase letters, digits, _; must start with a letter" · "Namespace must not start with kh or use a reserved name" |
| Secret | bắt buộc | "Chọn secret KnowledgeHub" | "Select a KnowledgeHub secret" |
| Keyspace | `^[a-z][a-z0-9_.-]{0,63}$` | "Keyspace không hợp lệ" | "Invalid keyspace" |
| Project ghi Tóm tắt | rỗng được; `^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$` | "Mã project không hợp lệ" | "Invalid project ID" |
| Agent | ≤ 5, không trùng | "Tối đa 5 kết nối" | "At most 5 connections" |

Lỗi server qua `api-error.ts` (KNOWN += `KH_URL_NOT_ALLOWED`, `KH_CONNECTION_EXISTS`, `KH_CONNECTION_IN_USE`, `KH_CONNECTION_NOT_FOUND`, `KH_TENANT_EXISTS`, `KH_NS_TAKEN`, `KH_SECRET_INVALID`, `KH_NOT_CONFIGURED`, `KH_AGENT_RUNTIME`).

## 4. Câu chữ (VI / EN; key `knowledgehub.*`, `agents.knowledge.*`, `processes.knowledge.*`, `ui.knowledgeNotice.*`)
| Chỗ | VI | EN |
|---|---|---|
| Tiêu đề | "Cài đặt" · "Kết nối KnowledgeHub" · "Công ty của kết nối" | "Settings" · "KnowledgeHub connections" · "Companies of the connection" |
| Bảng kết nối | "Tên" · "Địa chỉ" · "Công ty đã cấu hình" · "Công ty" · "Sửa" · "Xoá" · "Thêm kết nối" · "Origin được phép" · "Chưa có kết nối KnowledgeHub" · "Tải thêm" | "Name" · "Address" · "Configured companies" · "Companies" · "Edit" · "Delete" · "Add connection" · "Allowed origins" · "No KnowledgeHub connection yet" · "Load more" |
| Dialog kết nối | "Thêm kết nối" · "Sửa kết nối" · "Tên" · "Địa chỉ" · "Lưu" · "Huỷ" · "Đổi địa chỉ sẽ đặt mọi công ty của kết nối về Chưa kiểm tra." | "Add connection" · "Edit connection" · "Name" · "Address" · "Save" · "Cancel" · "Changing the address resets every company of the connection to Not tested." |
| Bảng công ty | "Công ty" · "Namespace" · "Secret" · "Project ghi Tóm tắt" · "Trạng thái" · "Kiểm tra lúc" · "Kiểm tra" · "Kết quả" · "Thêm công ty" · "Chọn một kết nối để xem công ty" · "Chưa công ty nào được cấu hình" | "Company" · "Namespace" · "Secret" · "Summary project" · "Status" · "Checked at" · "Test" · "Result" · "Add company" · "Select a connection to see its companies" · "No company configured yet" |
| Badge | "Chưa kiểm tra / Đạt / Lỗi" · "Công ty bật / tắt" | "Not tested / OK / Error" · "Company on / off" |
| Embedder | "Cần embedder đa ngữ (ví dụ bge-m3) để tìm tiếng Việt chính xác. Hub không kiểm tra được điều này." | "A multilingual embedder (e.g. bge-m3) is required for accurate Vietnamese retrieval. The Hub cannot verify this." |
| Sheet | "Thêm công ty" · "Sửa công ty" · "Tenant" · "Namespace" · "Secret KnowledgeHub" · "Tạo secret" · "Tenant này chưa có secret KnowledgeHub" · "Project ghi Tóm tắt (tuỳ chọn)" · "Keyspace" · "Lưu sẽ đặt trạng thái về Chưa kiểm tra; công ty ngừng dùng tri thức tới khi kiểm tra lại." | "Add company" · "Edit company" · "Tenant" · "Namespace" · "KnowledgeHub secret" · "Create secret" · "This tenant has no KnowledgeHub secret" · "Summary project (optional)" · "Keyspace" · "Saving resets the status to Not tested; the company stops using knowledge until re-tested." |
| Lỗi server | `KH_CONNECTION_EXISTS` "Tên hoặc địa chỉ đã được kết nối khác dùng" · `KH_CONNECTION_IN_USE` "Kết nối còn {tenants} công ty và {agents} agent đang dùng" · `KH_CONNECTION_NOT_FOUND` "Kết nối không còn tồn tại" · `KH_TENANT_EXISTS` "Công ty này đã có cấu hình trên kết nối" · `KH_NS_TAKEN` "Namespace đã được công ty {tenant} dùng" · `KH_SECRET_INVALID` "Secret phải là khoá KnowledgeHub của chính công ty này" · `KH_NOT_CONFIGURED` "Thiếu địa chỉ hoặc secret — hãy lưu cấu hình trước" · `KH_AGENT_RUNTIME` "Chỉ agent chạy bằng CLI mới dùng được tri thức" | "Name or address is used by another connection" · "The connection is still used by {tenants} companies and {agents} agents" · "The connection no longer exists" · "This company is already configured on the connection" · "Namespace is used by company {tenant}" · "The secret must be this company's own KnowledgeHub key" · "Address or secret is missing — save the configuration first" · "Only CLI agents can use knowledge" |
| Kết quả kiểm | "Kết quả kiểm tra" · "Kết nối đạt" · "Kết nối chưa đạt: {n} lỗi" · "Đang kiểm tra…" · "Phiên bản KnowledgeHub: {v}" · "Kiểm lúc {thời gian}" · "Chưa kiểm tra" | "Check result" · "Connection OK" · "Connection failed: {n} errors" · "Testing…" · "KnowledgeHub version: {v}" · "Checked at {time}" · "Not tested" |
| Toast | "Đã lưu kết nối {name}" · "Đã xoá kết nối {name}" · "Đã lưu cấu hình {tenant}" · "Đã xoá cấu hình {tenant}" · "Đã lưu kết nối của agent" | "Connection {name} saved" · "Connection {name} deleted" · "{tenant} configuration saved" · "{tenant} configuration removed" · "Agent connections saved" |
| Agent | "KnowledgeHub" · "Chọn kết nối KnowledgeHub mà agent được hỏi khi chạy quy trình. Thứ tự tick = thứ tự ưu tiên (tối đa 5)." · "Tối đa 5 kết nối" · "Chưa có kết nối KnowledgeHub — vào Cài đặt để thêm" · "Chỉ agent chạy bằng CLI mới dùng được tri thức" · "Lưu" | "KnowledgeHub" · "Pick the KnowledgeHub connections the agent may query while running a process. Tick order = priority (at most 5)." · "At most 5 connections" · "No KnowledgeHub connection yet — go to Settings to add one" · "Only CLI agents can use knowledge" · "Save" |
| Dialog admin | "Tri thức" · "Dùng tri thức cho công ty" · "Agent được phép sẽ hỏi KnowledgeHub trong lúc chạy." · "Kết nối" · "Chưa kết nối nào cho công ty" · "Đóng" · badge "Chưa cấu hình / Chưa kiểm tra / Đạt / Lỗi" | "Knowledge" · "Use knowledge for company" · "Allowed agents can query KnowledgeHub while running." · "Connections" · "No connection for your company yet" · "Close" · "Not configured / Not tested / OK / Error" |
| Lý do `available=false` | `not_configured` "Quản trị nền tảng chưa cấu hình KnowledgeHub cho công ty" · `unchecked` "Cấu hình chưa được kiểm tra — chưa dùng được" · `check_failed` "Lần kiểm tra gần nhất lỗi — chưa dùng được" | "The platform admin has not configured KnowledgeHub for your company" · "The configuration has not been tested — not usable yet" · "The last test failed — not usable yet" |
| Output | "Tri thức: {queries}/{limit} lần hỏi" · "Tóm tắt: đang chờ / đã ghi / lỗi / bỏ qua / không ghi" (`pending/written/failed/skipped/none`) · "(ghi vào {project} · {connection})" | "Knowledge: {queries}/{limit} queries" · "Summary: pending / written / failed / skipped / none" · "(writing to {project} · {connection})" |
| Hạ cấp (`warning`) | Đầu: "Không truy cập được KnowledgeHub — stage đã chạy không có tri thức." Lý do: `unreachable` "Không kết nối được" · `timeout` "Hết thời gian chờ" · `ns_not_active` "Namespace chưa kích hoạt" · `ns_suspended` "Namespace đang bị tạm ngưng" · `embedder_unavailable` "Dịch vụ nhúng (embedder) không khả dụng" · `unauthorized`/`forbidden` "Không có quyền truy cập" · `quota` "Vượt giới hạn tần suất" · `invalid` "Yêu cầu bị từ chối" · `server_error` "KnowledgeHub gặp lỗi" · `disabled` "Tri thức đã bị tắt" | "KnowledgeHub was unreachable — this stage ran without knowledge." · "Cannot connect" · "Timed out" · "Namespace not active" · "Namespace suspended" · "Embedder unavailable" · "Access denied" · "Rate limit exceeded" · "Request rejected" · "KnowledgeHub error" · "Knowledge was turned off" |

**Mục kiểm (`items[].code` → nhãn; `params` thay `{…}`)** — 15 lỗi:
| Mã | VI | EN |
|---|---|---|
| `kh_url_not_allowed` | "Địa chỉ không được phép ({reason})" | "Address not allowed ({reason})" |
| `kh_unreachable` / `kh_timeout` | "Không kết nối được KnowledgeHub" / "KnowledgeHub không trả lời kịp" | "Cannot reach KnowledgeHub" / "KnowledgeHub did not respond in time" |
| `kh_version_too_old` | "Phiên bản KnowledgeHub phải ≥ v6.4 (hiện {found})" | "KnowledgeHub must be ≥ v6.4 (found {found})" |
| `kh_auth_disabled` | "KnowledgeHub trả lời khi không có token hoặc khoá là loại local — hãy bật xác thực và dùng client credentials" | "KnowledgeHub answers without a token or the key is local — enable authentication and use client credentials" |
| `kh_credentials_invalid` / `kh_credentials_rejected` / `kh_token_failed` | "Secret không đúng định dạng credentials" / "KnowledgeHub từ chối credentials" / "Không lấy được token ({status})" | "Secret is not valid credentials" / "KnowledgeHub rejected the credentials" / "Could not obtain a token ({status})" |
| `kh_api_v1_missing` / `kh_capability_missing` | "KnowledgeHub không hỗ trợ API v1" / "Thiếu khả năng {name}" | "KnowledgeHub does not support API v1" / "Missing capability {name}" |
| `kh_identity_unexpected` / `kh_ns_mismatch` / `kh_ns_not_active` | "Khoá không phải client credentials ({kind})" / "Khoá thuộc namespace khác ({found})" / "Namespace chưa kích hoạt" | "Key is not client credentials ({kind})" / "Key belongs to another namespace ({found})" / "Namespace is not active" |
| `kh_manifest_missing` / `kh_keyspace_missing` | "Namespace chưa có manifest" / "Namespace thiếu keyspace {keyspace}" | "Namespace has no manifest" / "Namespace is missing keyspace {keyspace}" |

6 cảnh báo: `kh_auth_disabled_dev` "Xác thực đang tắt (chỉ chấp nhận khi phát triển)" / "Authentication is off (acceptable in development only)" · `kh_people_lanes_on` "Namespace bật include_people_lanes" / "Namespace has include_people_lanes on" · `kh_ns_suspended` "Namespace đang bị tạm ngưng" / "Namespace is suspended" · `kh_summary_project_not_attached` "Project ghi Tóm tắt {project_id} chưa gắn với khoá này" / "Summary project {project_id} is not attached to this key" · `kh_projects_empty` "Khoá chưa gắn project nào" / "The key has no attached project" · `kh_embedder_multilingual` = ghi chú embedder. Mã lạ ⇒ "Mục kiểm {code}".

## 5. Role + nhãn cho e2e (giữ đúng khi code; spec §5 trích lại)
| Màn | Phần tử |
|---|---|
| Cài đặt | `heading "Cài đặt"` · `heading "Kết nối KnowledgeHub"` · `table "Kết nối KnowledgeHub"` · `button "Thêm kết nối"` · `list "Origin được phép"` · `button "Tải thêm"` |
| Dòng kết nối | `button "Công ty {name}"` · `button "Sửa {name}"` · `button "Xoá {name}"` |
| Dialog kết nối | `dialog "Thêm kết nối"` / `"Sửa kết nối"` · `textbox "Tên"` · `textbox "Địa chỉ"` · `button "Lưu"` · `button "Huỷ"` |
| Bảng công ty | `table "Công ty của kết nối"` · `button "Thêm công ty"` · `note` chứa "embedder đa ngữ" · mỗi dòng: `button "Kiểm tra {tenant}"` · `button "Kết quả {tenant}"` · `button "Sửa {tenant}"` · `button "Xoá {tenant}"` |
| Sheet công ty | `dialog "Thêm công ty"` / `"Sửa công ty"` · `combobox "Tenant"` · `textbox "Namespace"` · `combobox "Secret KnowledgeHub"` · `link "Tạo secret"` · `textbox "Project ghi Tóm tắt"` · `textbox "Keyspace"` · `button "Lưu"` · `button "Huỷ"` · `status` "Đã lưu · v{n}" |
| Dialog kết quả | `dialog "Kết quả kiểm tra"` · `status` (tổng) · `list` mục kiểm |
| ConfirmDialog | `alertdialog` (Radix); xoá kết nối/công ty: nút xác nhận **"Xoá" / "Delete"**, nút **"Huỷ" / "Cancel"**; xoá công ty chứa "Xoá cấu hình KnowledgeHub của {tenant}" + "Secret không bị xoá."; toast: `region "Notifications"` |
| Agent | `region "KnowledgeHub"` có `checkbox "{tên kết nối}"` (mỗi kết nối) · `button "Lưu"` (trong region) · "Tối đa 5 kết nối" |
| Admin | nút `button "Tri thức"` → `dialog "Tri thức"` có `switch "Dùng tri thức cho công ty"`, `list "Kết nối"` (mỗi mục chứa tên + badge), `button "Đóng"` · nav `link "Quy trình"` (`navigation "Điều hướng chính"`) |
| Output (admin + chat) | `status` chứa "Không truy cập được KnowledgeHub" · text "Tri thức: 2/5 lần hỏi" · "Tóm tắt: đang chờ" · "(ghi vào {project} · {connection})" |

Test khoá T2 cũ (`e2e/studio/k1-knowledgehub.studio.ts`, `e2e/K1/**`) viết theo thiết kế trước CR-072: qc viết lại theo bảng này (không còn thẻ "Tri thức" quy trình, `switch` agent, bảng Tenant ↔ namespace, `textbox "Địa chỉ KnowledgeHub"`).

## 6. Hiệu năng và a11y
Trang Cài đặt KH < 25 KB gzip (lazy route); bảng phân trang cursor ≤ 100/lần, không virtualize. Kết quả kiểm có icon **và** chữ; Alert `aria-live="polite"`; tương phản ≥ 4.5:1; checkbox agent có `label`, điều hướng bàn phím.

## 7. Đối chiếu contract BE (spec §3) · Cần backend-lead
Khớp: `KhConnection`/`KhTenant` (`summary_project`, `enabled` chỉ đọc), `KhCheckResult` (15+6 mã), `PUT /agents/:id/knowledge`, `AgentSchema.knowledge_connection_ids`, `/admin/kh {connections[]}`, `StageView.knowledge.write_to`. Không đề nghị đổi contract. Artboard: mockup đã đủ 5 màn, không đề xuất thêm.

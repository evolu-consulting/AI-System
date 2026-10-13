---
spec: K1-knowledgehub
part: frontend
owner: frontend-lead
status: draft
requirements: [HUB-FR-131, HUB-FR-132, HUB-FR-133, HUB-FR-134, HUB-BR-35, HUB-BR-36, HUB-BR-40]
---

# Plan frontend · K1 · KnowledgeHub

Nguồn: spec §1–3, §9 · `plan.md` §3 · `ui-agent-studio` · H4b-1 `plan-frontend.md` · mẫu: studio-web `features/{agents,secrets}`, admin-web `features/processes`. Đã đối chiếu contract BE (spec §3). Chưa có artboard: bố cục "đề xuất", trình Gate.

## 0. Quyết định
| # | Quyết định | Lý do |
|---|---|---|
| D1 | Không thêm thư viện, không ADR. Route `/settings` nạp lười | H4a D1 |
| D2 | **Không nhập credentials ở màn KH.** Sheet tenant chọn một secret `kh_api_key` **của chính tenant** (`GET /studio/api/secrets?kind=kh_api_key&tenant_id=`); tạo/xoay secret ở màn Secrets (H4b-1) qua link. Không có `kh_api_key` mức nền tảng (Q7) ⇒ **không có lựa chọn "Toàn nền tảng"** | spec §3.2, Q7 |
| D3 | Nav `settings` (nhóm "Hệ thống") → `/settings`, một tab "KnowledgeHub" | ui-agent-studio |
| D4 | **Một cờ bật**, không có "Cấp": platform cấu hình = có hàng tenant + `status=ok`; `enabled` do `tenant_admin` bật (`PUT /admin/kh/enabled`). Studio chỉ **hiện** `enabled` (badge, chỉ đọc). Hiệu lực = có URL, hàng, secret, `enabled`, `status=ok` (§3.5) | spec §3.3/3.5, Q5 |
| D5 | **Bỏ "Loại project" của agent** (contract không có kinds). Agent chỉ có `knowledge_enabled`, lưu bằng `PUT /agents/:id/knowledge` (version riêng, **không** nằm trong nút Lưu của form); chỉ `agentic-cli` (`KH_AGENT_RUNTIME`) | spec §3.2 |
| D6 | Project KH là danh sách **do platform_admin khai báo** trong Sheet tenant (`project_id`, `label`, `read_only`); `read_only` = project dùng chung ⇒ badge "Chỉ đọc". People lanes bật được cho project **riêng**; dùng chung phải tắt (`kh_people_lanes_on_shared`) | spec §9 Q2 |
| D7 | Gắn project ở admin-web là **thao tác riêng** (`GET/PUT /process-defs/:id/knowledge`, version riêng, nút [Lưu tri thức]) — không đi chung `ProcessSaveBar`. Hiện `effective[]` (project, chỉ đọc, "cần Tóm tắt") theo từng stage. Mẫu hệ thống (`tenant_id null`) ⇒ không render thẻ (BE 404) | spec §3.3 |
| D8 | Cảnh báo hạ cấp là dữ liệu của `StageView.knowledge.warning`, không toast: `Alert` vàng `aria-live="polite"` trong OutputDialog (admin) và run-block/run-page (chat). Không chặn, không đổi trạng thái run | Q3, HUB-FR-134 |
| D9 | Cảnh báo embedder là mục `kh_embedder_multilingual` (luôn có trong kết quả kiểm) **và** ghi tĩnh dưới khối URL | CR-068, ADR-0012 §8 |
| D10 | Kiểm tra kết nối chạy theo **hàng tenant đã lưu** (không nhận URL/secret gõ dở): nút disabled khi URL đang sửa chưa lưu. Mọi thay đổi URL/ns/secret/keyspace/project ⇒ `unchecked` — UI nói rõ trước khi lưu | spec §3.2, Q5 |

## 1. Cấu trúc
studio-web: `routes/_authed/settings.tsx` (lazy; `validateSearch {tab?, edit?: tenantId|"new"}`) · `features/settings/knowledgehub/{api.ts, hooks/, lib/{schema,check-labels,project-rows}.ts, components/{KhUrlCard,KhTenantTable,KhTenantSheet,KhProjectRows,KhCheckDialog}, pages/KnowledgeHubSettingsPage.tsx, README.md}` · `features/agents/components/AgentKnowledgeSection.tsx` (+ hook trong `agents/api.ts`) · `shell/lib/nav.ts` + settings.
admin-web: `features/processes/api.ts` (+ khState, setKhEnabled, get/putKhBinding) · `components/knowledge/{KnowledgeBindingCard,TenantKnowledgeDialog}` · hooks `use-kh-state`, `use-kh-binding`.
`packages/ui`: `KnowledgeNotice` (OutputDialog admin, chat-web run-block/run-page).

## 2. Màn, bố cục, trạng thái
| Màn | Bố cục (chưa có artboard — đề xuất) | Đang tải | Rỗng | Lỗi | Không quyền / 409 |
|---|---|---|---|---|---|
| Studio → Cài đặt → KnowledgeHub | `PageHeader` "Cài đặt" + tablist 1 tab. **Khối 1** Card "Kết nối": Input URL, [Lưu]; dưới: "Origin được phép" (chip chỉ đọc từ `allowed_origins`; rỗng ⇒ Alert "Vận hành chưa khai báo HUB_KH_ALLOWED_ORIGINS — không lưu được địa chỉ"); `note` embedder. **Khối 2** Card "Tenant ↔ namespace": ô tìm + bảng Tenant · Namespace · Secret · Project (số) · Công ty bật (badge) · Trạng thái (badge) · Kiểm tra lúc · [Kiểm tra] [Kết quả] [Sửa] [Xoá]; "Tải thêm" theo `next_cursor` | Skeleton Card + 4 dòng (`aria-busy`) | Chưa có URL: Khối 2 mờ + "Khai báo địa chỉ trước". Bảng rỗng: EmptyState + [Thêm tenant] | Alert + [Thử lại]; `KH_URL_NOT_ALLOWED` dưới ô URL (reason: invalid → "Địa chỉ không hợp lệ", not_https → "Chỉ chấp nhận https://", not_in_allowlist → "Origin này không nằm trong danh sách được phép"; EN: "Invalid address" / "Only https:// is allowed" / "This origin is not in the allowed list") | Không `platform_admin` → `/forbidden`; `VERSION_CONFLICT` → `ConflictDialog` (H4b-1 D8) |
| Sheet Thêm/Sửa tenant | Sheet phải: `Tenant` (Select; sửa: readonly), `Namespace`, `Secret KnowledgeHub` (Select secret `kh_api_key` của tenant + link "Tạo secret" → `/secrets`), `Keyspace` (mặc định `step`), nhóm `Project` (hàng: `project_id`, `label`, checkbox "Chỉ đọc (dùng chung)", [Xoá hàng]; [Thêm project]; ≤ 50). Khi sửa: Alert "Lưu sẽ đặt trạng thái về Chưa kiểm tra; công ty ngừng dùng tri thức tới khi kiểm tra lại." Footer [Huỷ] [Lưu]. Sau lưu Sheet ở lại "Đã lưu · v{n}" (H4b-1 D9) | Select "Đang tải…" | Tenant chưa có secret: "Tenant này chưa có secret KnowledgeHub" + link | lỗi theo trường; `KH_TENANT_EXISTS`, `KH_NS_TAKEN`, `KH_SECRET_INVALID`, `KH_PROJECT_IN_USE` | 409 → ConflictDialog |
| Dialog kết quả kiểm | Tổng `role="status"`; danh sách mục: icon + nhãn + chi tiết (lỗi trước, cảnh báo sau); "Phiên bản KnowledgeHub: {v}", "Kiểm lúc {thời gian}" | "Đang kiểm tra…" (nút disabled; hạn UI 25 s, hạn BE 20 s) | Chưa kiểm: "Chưa kiểm tra" | `KH_NOT_CONFIGURED` ⇒ "Thiếu địa chỉ hoặc secret — hãy lưu cấu hình trước" | — |
| Agent → "Tri thức" | Section trong `AgentForm`: Switch "Được dùng tri thức (KnowledgeHub)" + mô tả; đổi là gọi API ngay, cập nhật `version` của form từ `AgentWriteResponse` | Switch disabled khi đang gửi | Studio chưa có URL: Switch disabled + chú thích + link `/settings`. Runtime ≠ `agentic-cli`: disabled + "Chỉ agent chạy bằng CLI mới dùng được tri thức" | `KH_AGENT_RUNTIME` ⇒ cùng câu; lỗi khác ⇒ hoàn Switch + toast | ConflictDialog (form agent) |
| admin-web → Quy trình → thẻ "Tri thức" | `KnowledgeBindingCard` dưới `DefInfoCard`: Select "Project tri thức" (Không dùng / project, badge "Chỉ đọc") + bảng stage: Stage · Select "Project tri thức của stage" (Theo quy trình / Không dùng / project) · cột hiệu lực (project, "Chỉ đọc", "Cần Tóm tắt"). [Lưu tri thức]. Stage cần Tóm tắt ⇒ Alert info "Stage sẽ bắt buộc có mục ## Tóm tắt (≤ 200 từ)." | Skeleton, Select disabled | `available=false`: Select disabled + lý do (bảng §4) (+ [Bật tri thức] cho `tenant_admin` nếu `reason≠not_configured`). 403 (member) ⇒ không render thẻ. Không project: "Chưa có project — nhờ quản trị nền tảng khai báo" | Alert + [Thử lại]; `KH_PROJECT_NOT_FOUND` ⇒ toast + làm mới danh sách | Không phải `tenant_admin` ⇒ chỉ đọc; `VERSION_CONFLICT` ⇒ ConflictDialog (tải lại binding); mẫu hệ thống ⇒ không render |
| Dialog "Tri thức" (trang Quy trình, `tenant_admin`) | Dialog nhỏ: Switch "Dùng tri thức cho công ty" + mô tả + dòng trạng thái theo `reason` + [Đóng] | Skeleton | — | toast lỗi | `reason=not_configured` ⇒ Switch disabled + "Quản trị nền tảng chưa cấu hình KnowledgeHub cho công ty"; `unchecked`/`check_failed` ⇒ bật được nhưng Alert cảnh báo nguyên văn §4 (`unchecked`/`check_failed`); `VERSION_CONFLICT` ⇒ làm mới |
| Output stage (OutputDialog admin; run-block/run-page chat) | `KnowledgeNotice` phía trên output, chỉ khi `knowledge` có: Alert vàng khi `warning ≠ null` (một dòng, lý do §4); dòng phụ "Tri thức: {queries}/{query_limit} lần hỏi · Tóm tắt: {trạng thái}" | — | `knowledge` vắng ⇒ không render | — | — |

**Hành vi**
| Tương tác | Hành vi |
|---|---|
| [Lưu] URL | `PUT /kh/settings {base_url, version}`; có tenant ⇒ `ConfirmDialog` trước khi lưu: "Đổi địa chỉ sẽ đặt mọi tenant về Chưa kiểm tra." Rỗng ⇒ `null` (tắt cả KH) |
| [Kiểm tra] / [Kết quả] | `POST /kh/tenants/:id/check` → mở Dialog; kết quả cũng làm mới hàng (status, thời gian). [Kết quả] hiện `check` đã lưu, disabled khi `check=null` |
| Switch agent | Optimistic; `PUT /agents/:id/knowledge`; lỗi hoàn lại |
| Xoá tenant | `ConfirmDialog` destructive: "Xoá cấu hình KnowledgeHub của {tenant}? Project và gắn quy trình của công ty sẽ bị gỡ. Secret không bị xoá." |
| Bỏ project ở Sheet đang được gắn | Server `409 KH_PROJECT_IN_USE`: Alert liệt kê tên quy trình ngay trong Sheet |
| Lưu binding | Gửi `stage_projects` chỉ chứa stage **khác mặc định** ("Theo quy trình" = bỏ khoá; "Không dùng" = `null`); mặc định `null` + không override ⇒ BE xoá gắn |

## 3. Validate client (zod; khớp contract §3.1)
| Trường | Luật | VI | EN |
|---|---|---|---|
| URL | rỗng được (= tắt); nếu có: URL hợp lệ, `https://` (cho `http://localhost`/`127.0.0.1`/`[::1]` khi dev), ≤ 512, không userinfo/query/fragment | "Địa chỉ không hợp lệ" · "Chỉ chấp nhận https:// (trừ localhost khi phát triển)" · "Địa chỉ không được chứa tài khoản, query hay fragment" | "Invalid address" · "Only https:// is allowed (except localhost in development)" · "Address must not contain credentials, query or fragment" |
| Tenant | bắt buộc (tạo) | "Chọn tenant" | "Select a tenant" |
| Namespace | `^[a-z][a-z0-9_]{2,31}$`, không bắt đầu `kh`, ∉ `admin, me, capabilities, token, redaction, openapi, health, version` | "Nhập namespace" · "Namespace gồm 3–32 ký tự: chữ thường, số, _; bắt đầu bằng chữ" · "Namespace không được bắt đầu bằng kh hoặc trùng tên dành riêng" | "Enter a namespace" · "Namespace: 3–32 characters, lowercase letters, digits, _; must start with a letter" · "Namespace must not start with kh or use a reserved name" |
| Secret | bắt buộc | "Chọn secret KnowledgeHub" | "Select a KnowledgeHub secret" |
| Keyspace | `^[a-z][a-z0-9_.-]{0,63}$` | "Keyspace không hợp lệ" | "Invalid keyspace" |
| Project id | `^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$`; duy nhất trong danh sách; ≤ 50 hàng | "Mã project không hợp lệ" · "Mã project bị trùng" | "Invalid project ID" · "Duplicate project ID" |
| Label | ≤ 80 | "Tối đa 80 ký tự" | "At most 80 characters" |

Lỗi server qua `api-error.ts` (KNOWN += `KH_URL_NOT_ALLOWED`, `KH_TENANT_EXISTS`, `KH_NS_TAKEN`, `KH_SECRET_INVALID`, `KH_PROJECT_IN_USE`, `KH_PROJECT_NOT_FOUND`, `KH_NOT_CONFIGURED`, `KH_AGENT_RUNTIME`); câu chữ ở §4.

## 4. Câu chữ (VI / EN; key `knowledgehub.*`, `agents.knowledge.*`, `processes.knowledge.*`)
| Chỗ | VI | EN |
|---|---|---|
| Tiêu đề | "Cài đặt" · "KnowledgeHub" | "Settings" · "KnowledgeHub" |
| Khối 1 | "Kết nối" · "Địa chỉ KnowledgeHub" · "Lưu" · "Origin được phép" · "Vận hành chưa khai báo HUB_KH_ALLOWED_ORIGINS — không lưu được địa chỉ" · "Đổi địa chỉ sẽ đặt mọi tenant về Chưa kiểm tra." | "Connection" · "KnowledgeHub address" · "Save" · "Allowed origins" · "Operations has not set HUB_KH_ALLOWED_ORIGINS — the address cannot be saved" · "Changing the address resets every tenant to Not tested." |
| Cảnh báo embedder | "Cần embedder đa ngữ (ví dụ bge-m3) để tìm tiếng Việt chính xác. Hub không kiểm tra được điều này." | "A multilingual embedder (e.g. bge-m3) is required for accurate Vietnamese retrieval. The Hub cannot verify this." |
| Bảng | "Tenant ↔ namespace" · "Tenant" · "Namespace" · "Secret" · "Project" · "Công ty bật" · "Trạng thái" · "Kiểm tra lúc" · "Kiểm tra" · "Kết quả" · "Sửa" · "Xoá" · "Tải thêm" | same · "Tenant" · "Namespace" · "Secret" · "Projects" · "Enabled by company" · "Status" · "Checked at" · "Test" · "Result" · "Edit" · "Delete" · "Load more" |
| Badge | "Chưa kiểm tra / Đạt / Lỗi" · "Bật / Tắt" | "Not tested / OK / Error" · "On / Off" |
| Rỗng | "Chưa tenant nào được cấu hình" · "Thêm tenant" · "Khai báo địa chỉ trước" | "No tenant configured yet" · "Add tenant" · "Enter the address first" |
| Sheet | "Thêm tenant" · "Sửa tenant" · "Secret KnowledgeHub" · "Tạo secret" · "Tenant này chưa có secret KnowledgeHub" · "Keyspace" · "Project" · "Thêm project" · "Chỉ đọc (dùng chung)" · "Lưu sẽ đặt trạng thái về Chưa kiểm tra; công ty ngừng dùng tri thức tới khi kiểm tra lại." | "Add tenant" · "Edit tenant" · "KnowledgeHub secret" · "Create secret" · "This tenant has no KnowledgeHub secret" · "Keyspace" · "Projects" · "Add project" · "Read-only (shared)" · "Saving resets the status to Not tested; the company stops using knowledge until re-tested." |
| Lỗi server | `KH_TENANT_EXISTS` "Tenant này đã có cấu hình" · `KH_NS_TAKEN` "Namespace đã được tenant {tenant} dùng" · `KH_SECRET_INVALID` "Secret phải là khoá KnowledgeHub của chính tenant này" · `KH_PROJECT_IN_USE` "Project còn được gắn cho quy trình: {danh sách}" · `KH_NOT_CONFIGURED` "Thiếu địa chỉ hoặc secret — hãy lưu cấu hình trước" · `KH_PROJECT_NOT_FOUND` "Project không còn trong danh sách của công ty" · `KH_AGENT_RUNTIME` "Chỉ agent chạy bằng CLI mới dùng được tri thức" | "This tenant is already configured" · "Namespace is used by tenant {tenant}" · "The secret must be this tenant's own KnowledgeHub key" · "Project is still attached to processes: {list}" · "Address or secret is missing — save the configuration first" · "The project is no longer in your company's list" · "Only CLI agents can use knowledge" |
| Kết quả kiểm | "Kết nối đạt" · "Kết nối chưa đạt: {n} lỗi" · "Đang kiểm tra…" · "Phiên bản KnowledgeHub: {v}" · "Kiểm lúc {thời gian}" · "Chưa kiểm tra" | "Connection OK" · "Connection failed: {n} errors" · "Testing…" · "KnowledgeHub version: {v}" · "Checked at {time}" · "Not tested" |
| Toast | "Đã lưu địa chỉ KnowledgeHub" · "Đã thêm {tenant}" · "Đã lưu cấu hình {tenant}" · "Đã xoá cấu hình {tenant}" | "KnowledgeHub address saved" · "{tenant} added" · "{tenant} configuration saved" · "{tenant} configuration removed" |
| Agent | "Tri thức" · "Được dùng tri thức (KnowledgeHub)" · "Agent được phép hỏi KnowledgeHub trong lúc chạy quy trình." · "Chưa kết nối KnowledgeHub — vào Cài đặt để kết nối" · "Chỉ agent chạy bằng CLI mới dùng được tri thức" | "Knowledge" · "Can use knowledge (KnowledgeHub)" · "The agent may query KnowledgeHub while running a process." · "KnowledgeHub is not connected — go to Settings" · "Only CLI agents can use knowledge" |
| Admin quy trình | "Tri thức" · "Project tri thức" · "Project tri thức của stage" · "Không dùng" · "Theo quy trình" · "Chỉ đọc" · "Cần Tóm tắt" · "Lưu tri thức" · "Chưa có project — nhờ quản trị nền tảng khai báo" · "Stage sẽ bắt buộc có mục ## Tóm tắt (≤ 200 từ)." · "Project dùng chung chỉ đọc: không ghi Tóm tắt vào đây." | "Knowledge" · "Knowledge project" · "Stage knowledge project" · "None" · "Same as process" · "Read-only" · "Summary required" · "Save knowledge" · "No projects yet — ask the platform admin to add some" · "This stage will require a ## Tóm tắt section (≤ 200 words)." · "Shared project is read-only: no summary is written to it." |
| Lý do `available=false` | `not_configured` "Quản trị nền tảng chưa cấu hình KnowledgeHub cho công ty" · `unchecked` "Cấu hình chưa được kiểm tra — chưa dùng được" · `check_failed` "Lần kiểm tra gần nhất lỗi — chưa dùng được" | "The platform admin has not configured KnowledgeHub for your company" · "The configuration has not been tested — not usable yet" · "The last test failed — not usable yet" |
| Dialog | "Tri thức" · "Dùng tri thức cho công ty" · "Agent được phép sẽ hỏi KnowledgeHub trong lúc chạy." | "Knowledge" · "Use knowledge for company" · "Allowed agents can query KnowledgeHub while running." |
| Output | "Tri thức: {queries}/{limit} lần hỏi" · "Tóm tắt: đang chờ / đã ghi / lỗi / bỏ qua / không ghi" (`pending/written/failed/skipped/none`) | "Knowledge: {queries}/{limit} queries" · "Summary: pending / written / failed / skipped / none" |
| Hạ cấp (`warning`) | Đầu: "Không truy cập được KnowledgeHub — stage đã chạy không có tri thức." Lý do: `unreachable` "Không kết nối được" · `timeout` "Hết thời gian chờ" · `ns_not_active` "Namespace chưa kích hoạt" · `ns_suspended` "Namespace đang bị tạm ngưng" · `embedder_unavailable` "Dịch vụ nhúng (embedder) không khả dụng" · `unauthorized`/`forbidden` "Không có quyền truy cập" · `quota` "Vượt giới hạn tần suất" · `invalid` "Yêu cầu bị từ chối" · `server_error` "KnowledgeHub gặp lỗi" · `disabled` "Tri thức đã bị tắt hoặc project đã gỡ" | "KnowledgeHub was unreachable — this stage ran without knowledge." · "Cannot connect" · "Timed out" · "Namespace not active" · "Namespace suspended" · "Embedder unavailable" · "Access denied" · "Rate limit exceeded" · "Request rejected" · "KnowledgeHub error" · "Knowledge was turned off or the project was removed" |

**Mục kiểm (`items[].code` → nhãn; `params` thay `{…}`)** — lỗi:
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
| `kh_people_lanes_on_shared` | "Namespace bật include_people_lanes nhưng project dùng chung {project_id} phải tắt — hãy tắt phía KnowledgeHub hoặc bỏ đánh dấu dùng chung" | "Namespace has include_people_lanes on but shared project {project_id} requires it off — turn it off in KnowledgeHub or unmark it as shared" |
| `kh_project_not_attached` | "Project {project_id} chưa gắn với khoá này" | "Project {project_id} is not attached to this key" |

Cảnh báo: `kh_auth_disabled_dev` "Xác thực đang tắt (chỉ chấp nhận khi phát triển)" / "Authentication is off (acceptable in development only)" · `kh_ns_suspended` "Namespace đang bị tạm ngưng" / "Namespace is suspended" · `kh_projects_unverified` "Chưa xác minh được project (khoá không liệt kê project)" / "Projects could not be verified (the key lists no projects)" · `kh_embedder_multilingual` = cảnh báo embedder ở trên. Mã lạ ⇒ "Mục kiểm {code}".

## 5. Role + nhãn cho e2e (giữ đúng khi code)
| Màn | Phần tử |
|---|---|
| Settings | `heading "Cài đặt"` · `tab "KnowledgeHub"` · `textbox "Địa chỉ KnowledgeHub"` · `button "Lưu"` · `list "Origin được phép"` · `note` chứa "embedder đa ngữ" |
| Bảng tenant | `table "Tenant ↔ namespace"` · `button "Thêm tenant"` · mỗi dòng: `button "Kiểm tra {tenant}"` · `button "Kết quả {tenant}"` · `button "Sửa {tenant}"` · `button "Xoá {tenant}"` · `button "Tải thêm"` |
| Sheet | `dialog "Thêm tenant"` / `"Sửa tenant"` · `combobox "Tenant"` · `textbox "Namespace"` · `combobox "Secret KnowledgeHub"` · `textbox "Keyspace"` · `group "Project"` (hàng: `textbox "Mã project"`, `textbox "Nhãn"`, `checkbox "Chỉ đọc (dùng chung)"`, `button "Xoá project {n}"`) · `button "Thêm project"` · `link "Tạo secret"` · `button "Lưu"` · `button "Huỷ"` · `status` "Đã lưu · v{n}" |
| Dialog kết quả | `dialog "Kết quả kiểm tra"` · `status` (tổng) · `list` mục kiểm |
| ConfirmDialog | `alertdialog` (Radix) — đổi URL: chứa câu "Đổi địa chỉ sẽ đặt mọi tenant về Chưa kiểm tra.", nút xác nhận **"Lưu" / "Save"**; xoá tenant: chứa "Xoá cấu hình KnowledgeHub của {tenant}?" + "Secret không bị xoá.", nút xác nhận **"Xoá" / "Delete"** (nút Huỷ / Cancel) · toast: `region "Notifications"` |
| Agent | `switch "Được dùng tri thức (KnowledgeHub)"` |
| Admin | `button "Tri thức"` → `dialog "Tri thức"` có `switch "Dùng tri thức cho công ty"` · `region "Tri thức"` có `combobox "Project tri thức"` · mỗi stage `combobox "Project tri thức của stage {stage}"` · `button "Lưu tri thức"` · nav `link "Quy trình"` (`navigation "Điều hướng chính"`) · output (admin + chat): `status` chứa "Không truy cập được KnowledgeHub", text "Tri thức: 2/5 lần hỏi", "Tóm tắt: đang chờ" |

**Khớp test khoá T2** (`e2e/studio/k1-knowledgehub.studio.ts`, `e2e/K1/{admin,chat}`): đã rà nhãn/role, chỉ bổ sung ConfirmDialog, link "Tạo secret", toast, nav; không lệch khác.

## 6. Hiệu năng và a11y
Trang KH < 25 KB gzip; bảng phân trang cursor (≤ 100/lần), không virtualize. Kết quả kiểm có icon **và** chữ; Alert `aria-live="polite"`; tương phản ≥ 4.5:1.

## 7. Đối chiếu contract BE (khớp spec §3)
Credentials qua `secret_id` (D2); kiểm tra theo hàng đã lưu (D10); không `provisioned`/`kinds` (D4, D5); gắn project endpoint riêng (D7); `StageView.knowledge` optional, 11 mã `warning` (D8).

## 8. Trả lời câu hỏi FE trước đây · Cần backend-lead · Gate
Cờ bật ⇒ D4; "Loại project" bỏ ⇒ D5. **Artboard mới** (theo §2, trình Gate): Cài đặt → KnowledgeHub (+ Sheet tenant, Dialog kết quả), thẻ "Tri thức" quy trình + Dialog, `KnowledgeNotice`.

**Cần backend-lead** (không chặn plan; FE có mặc định):
| # | Đề nghị | Mặc định FE nếu không đổi |
|---|---|---|
| B2 | ĐÓNG: dùng `AgentSchema.runtime` (`studio/agents.ts:155`) | — |
| B3 | Studio chọn tenant ở Sheet: xác nhận dùng nguồn tenant của SecretSheet (H4b-1) | Dùng lại hook đó |
| B4 | DELETE tenant không báo số quy trình bị gỡ; `platform_admin` truyền `?tenant_id` như module processes | Câu chung |

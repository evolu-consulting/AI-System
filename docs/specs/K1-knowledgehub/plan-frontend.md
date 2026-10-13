---
spec: K1-knowledgehub
part: frontend
owner: frontend-lead
status: draft
requirements: [HUB-FR-131, HUB-FR-132, HUB-FR-133, HUB-FR-134, HUB-BR-35, HUB-BR-36, HUB-BR-40]
---

# Plan frontend · K1 · KnowledgeHub

Nguồn: spec §1/§2/§5 · `ui-agent-studio` (Cài đặt → KnowledgeHub, Tri thức) · H4b-1 `plan-frontend.md` (D3–D9: chỉ ghi, Sheet, ConflictDialog) · code mẫu: studio-web `features/orchestrator`, `features/agents`; admin-web `features/processes/components/editor` (`DefInfoCard`, `StageSourcesField`).
**Chờ contract BE:** spec §3 do backend-lead viết song song. Endpoint/field dưới đây là **giả định** (mục 7), đối chiếu lại khi §3 chốt. Không có artboard: mọi bố cục là **"chưa có artboard — đề xuất"**, trình Gate.

## 0. Quyết định
| # | Quyết định | Lý do |
|---|---|---|
| D1 | Không thêm thư viện, không ADR. Route `/settings` nạp lười | H4a D1 |
| D2 | Credentials KH **dùng lại** secret `kh_api_key` theo tenant (H4b-1 D3/D4): dán JSON, chỉ ghi, không hiện lại `client_secret`; chỉ hiện `client_id` (không bí mật) nếu BE trả | HUB-BR-36, CR-067 |
| D3 | Thêm nav `settings` (nhóm "Hệ thống") → `/settings`, một tab "KnowledgeHub" (chừa chỗ cho cài đặt khác) | ui-agent-studio dòng 39 |
| D4 | Mục "Tri thức" trong editor agent: khi KH chưa kết nối vẫn hiện nhưng Switch disabled + chú thích + link tới Cài đặt (để biết lý do) | ui-agent-studio |
| D5 | admin-web chọn project ở **hai cấp**: mặc định cho quy trình (`DefInfoCard`) + ghi đè theo stage (`StageForm`, mặc định "Theo quy trình"). `tenant_admin` bật theo công ty ở Dialog "Tri thức" trên trang Quy trình | CR-067, HUB-FR-132 |
| D6 | Project `read_only` (dùng chung) có badge "Chỉ đọc", chọn được, kèm gợi ý không ghi Tóm tắt | HUB-FR-132 |
| D7 | Cảnh báo hạ cấp là **dữ liệu của output** (stage `warnings[]`), không toast: `Alert` vàng `aria-live="polite"` trong OutputDialog (admin) và run-block/run-page (chat). Không chặn, không đổi trạng thái run | HUB-FR-134 |
| D8 | Cảnh báo embedder là **tĩnh**, luôn hiện dưới ô URL và sau "Kiểm tra kết nối" | CR-068, ADR-0012 §8 |

## 1. Cấu trúc
```
studio-web
  routes/_authed/settings.tsx           lazy; validateSearch {tab?: "knowledgehub", drawer?: <tenantId>|"new"}
  features/settings/knowledgehub/
    api.ts          GET/PUT /studio/api/knowledgehub/config · POST .../check · GET .../tenants · PUT/DELETE .../tenants/:tenantId
    hooks/          use-kh-config · use-kh-check (mutation) · use-kh-tenants · use-kh-tenant-mutations
    lib/            schema.ts · credentials-json.ts · check-labels.ts
    components/     KhUrlCard · KhCheckResult · KhTenantTable · KhTenantSheet
    pages/KnowledgeHubSettingsPage.tsx · README.md
  features/agents/components/AgentKnowledgeSection.tsx   (đưa vào AgentForm)
  features/shell/lib/nav.ts             + settings
admin-web
  features/processes/components/editor/KnowledgeProjectField.tsx · TenantKnowledgeDialog.tsx
  features/processes/hooks/use-knowledge-projects.ts     (hàm gọi API thêm vào processes/api.ts)
  OutputDialog.tsx và chat-web run-block/run-page        + DegradedAlert (đặt ở packages/ui nếu cả hai dùng)
```
Component ≤ 200 dòng; gọi API chỉ ở `api.ts`.

## 2. Màn, bố cục, trạng thái
| Màn | Bố cục (chưa có artboard — đề xuất) | Đang tải | Rỗng | Lỗi | Không quyền / 409 |
|---|---|---|---|---|---|
| Studio → Cài đặt → KnowledgeHub | `PageHeader` "Cài đặt" + tablist 1 tab. **Khối 1** Card "Kết nối": Input URL, nút [Lưu] [Kiểm tra kết nối], dưới là `KhCheckResult` (mỗi điều kiện một dòng icon + nhãn + chi tiết) và Alert embedder. **Khối 2** Card "Tenant ↔ namespace": bảng Tenant · Namespace · Credentials (`client_id` + `•••• Đã lưu`) · Trạng thái (badge) · Cấp (Switch) · [Thay] [Xoá] | Skeleton Card + 4 dòng (`aria-busy`) | Chưa có URL: Khối 2 mờ + "Khai báo địa chỉ trước". Bảng rỗng: EmptyState "Chưa tenant nào được cấu hình" + [Thêm tenant] | Alert lỗi + [Thử lại]; URL sai/`http://` lỗi dưới ô | Không `platform_admin` → `/forbidden`; `409 VERSION_CONFLICT` → `ConflictDialog` `rows=[]` (H4b-1 D8) |
| Sheet Thêm/Thay tenant | Sheet phải (mẫu SecretSheet): `Tenant` (Select; thay: readonly), `Namespace`, `Credentials (JSON)` (textarea mono; gợi ý "Giá trị không xem lại được sau khi lưu"), footer [Huỷ] [Lưu]. Sau lưu Sheet ở lại "Đã lưu · v{n}" (H4b-1 D9) | nút "Đang lưu…" | — | lỗi theo trường; tenant trùng: "Tenant này đã có cấu hình" | 409 → ConflictDialog |
| Agent → "Tri thức" | Section trong `AgentForm`: Switch "Được dùng tri thức (KnowledgeHub)"; khi bật: nhóm checkbox "Loại project" | theo form | KH chưa kết nối: chú thích + link | — | ConflictDialog của form agent |
| admin-web → Quy trình → editor | `DefInfoCard`: Select "Project tri thức" (Không dùng / project, badge "Chỉ đọc"). `StageForm`: Select "Project tri thức của stage" (Theo quy trình / Không dùng / project). Chọn project ⇒ Alert info "Stage sẽ bắt buộc có mục ## Tóm tắt (≤ 200 từ)." | Select disabled "Đang tải…" | Công ty chưa bật: Select disabled + "Công ty chưa bật tri thức" (+ [Bật tri thức] cho `tenant_admin`). Không project: "Chưa có project trong namespace" | Select disabled + [Thử lại] nhỏ | Không phải `tenant_admin` ⇒ chỉ đọc; 409 theo `ProcessSaveBar` hiện có; project 404 khi lưu ⇒ toast `errors.NOT_FOUND` + làm mới |
| Dialog "Tri thức" (trang Quy trình, `tenant_admin`) | Dialog nhỏ: Switch "Dùng tri thức cho công ty" + mô tả + [Đóng] | Skeleton | — | toast lỗi | Platform chưa cấp ⇒ Switch disabled + "Quản trị nền tảng chưa cấu hình KnowledgeHub cho công ty" |
| Output stage (OutputDialog admin; run-block/run-page chat) | `Alert` vàng phía trên nội dung output, mỗi cảnh báo một dòng | — | không có cảnh báo ⇒ không render | — | — |

**Hành vi**
| Tương tác | Hành vi |
|---|---|
| [Kiểm tra kết nối] | `POST check` với URL **đang gõ** (chưa cần lưu) + tenant chọn ở combobox cạnh nút (mặc định tenant đầu); "Đang kiểm tra…" disabled; timeout UI 15 s; kết quả thay `KhCheckResult` |
| `KhCheckResult` | Dòng theo `checks[]`: ok ✓ / fail ✗ (đỏ + nguyên nhân) / warn !; tổng kết đầu danh sách `role="status"` |
| Switch Cấp (platform) | Gửi ngay (optimistic, lỗi thì hoàn). Tắt hỏi `ConfirmDialog` "Tắt tri thức cho {tenant}? Run đang chạy tiếp tục không có tri thức." |
| Xoá cấu hình tenant | `ConfirmDialog` destructive; xoá cả secret `kh_api_key`; nếu có quy trình đang dùng ⇒ nêu số lượng trong dialog |
| Chọn project | Lưu cùng định nghĩa quy trình (nút Lưu hiện có), không gọi riêng |

## 3. Validate client (zod; khớp contract giả định)
| Trường | Luật | VI | EN |
|---|---|---|---|
| URL | bắt buộc; `https://` (cho `http://localhost`/`127.0.0.1` khi dev); ≤ 2048 | "Nhập địa chỉ KnowledgeHub" · "Chỉ chấp nhận https:// (trừ localhost khi phát triển)" | "Enter the KnowledgeHub address" · "Only https:// is allowed (except localhost in development)" |
| Namespace | bắt buộc; `^[a-z0-9][a-z0-9_-]{0,62}$` | "Nhập namespace" · "Namespace chỉ gồm chữ thường, số, - và _" | "Enter a namespace" · "Namespace may contain lowercase letters, digits, - and _ only" |
| Tenant | bắt buộc | "Chọn tenant" | "Select a tenant" |
| Credentials | bắt buộc; JSON hợp lệ; có `client_id`, `client_secret` (chuỗi không rỗng); `token_url?` https | "Dán credentials dạng JSON" · "JSON không hợp lệ" · "Thiếu client_id hoặc client_secret" · "token_url phải là https://" | "Paste credentials as JSON" · "Invalid JSON" · "client_id or client_secret is missing" · "token_url must be https://" |

Lỗi JSON không lặp lại nội dung đã dán. Lỗi server qua `api-error.ts` (KNOWN += `KH_URL_REJECTED`, `KH_NS_TAKEN`, `KH_PROJECT_NOT_FOUND`; tên chờ BE).

## 4. Câu chữ (VI / EN; key `knowledgehub.*`, `agents.knowledge.*`, `processes.knowledge.*`)
| Chỗ | VI | EN |
|---|---|---|
| Tiêu đề | "Cài đặt" · "KnowledgeHub" | "Settings" · "KnowledgeHub" |
| Subtitle | "Nguồn tri thức ngoài (RAG) cho agent. Tắt mặc định, bật theo từng công ty." | "External knowledge source (RAG) for agents. Off by default, enabled per company." |
| Khối 1 | "Kết nối" · "Địa chỉ KnowledgeHub" · "Lưu" · "Kiểm tra kết nối" · "Đang kiểm tra…" · "Kiểm tra với tenant" | "Connection" · "KnowledgeHub address" · "Save" · "Test connection" · "Testing…" · "Test with tenant" |
| Điều kiện | "Phiên bản ≥ v6.4" · "Hỗ trợ API v1 và truy hồi (retrieval)" · "Namespace không bật include_people_lanes" · "Khoá là client credentials (không phải local)" · "Yêu cầu xác thực" · "Dùng HTTPS" | "Version ≥ v6.4" · "Supports API v1 and retrieval" · "Namespace has include_people_lanes off" · "Credential is client credentials (not local)" · "Authentication required" · "Uses HTTPS" |
| Nguyên nhân lỗi | "Namespace đang bật include_people_lanes — hãy tắt phía KnowledgeHub" · "Khoá là loại local — dùng client credentials" · "KnowledgeHub trả lời được khi không có token — hãy bật xác thực" · "Địa chỉ dùng http:// — đặt sau proxy HTTPS" | "Namespace has include_people_lanes on — turn it off in KnowledgeHub" · "Credential is local — use client credentials" · "KnowledgeHub answers without a token — enable authentication" · "Address uses http:// — put it behind an HTTPS proxy" |
| Cảnh báo embedder | "Cần embedder đa ngữ (ví dụ bge-m3) để tìm tiếng Việt chính xác. Hub không kiểm tra được điều này." | "A multilingual embedder (e.g. bge-m3) is required for accurate Vietnamese retrieval. The Hub cannot verify this." |
| Kết quả | "Kết nối đạt" · "Kết nối chưa đạt: {n} điều kiện lỗi" | "Connection OK" · "Connection failed: {n} checks failed" |
| Bảng | "Tenant ↔ namespace" · "Tenant" · "Namespace" · "Credentials" · "Trạng thái" · "Cấp" · "Đã lưu" · "Hoạt động / Lỗi / Tắt / Chưa kiểm tra" | same · "Tenant" · "Namespace" · "Credentials" · "Status" · "Provisioned" · "Saved" · "Active / Error / Off / Not tested" |
| Rỗng | "Chưa tenant nào được cấu hình" · "Thêm tenant" · "Khai báo địa chỉ trước" | "No tenant configured yet" · "Add tenant" · "Enter the address first" |
| Sheet | "Thêm tenant" · "Thay credentials" · "Credentials (JSON)" · "Giá trị không xem lại được sau khi lưu" | "Add tenant" · "Replace credentials" · "Credentials (JSON)" · "The value cannot be viewed after saving" |
| Toast | "Đã lưu địa chỉ KnowledgeHub" · "Đã thêm {tenant}" · "Đã thay credentials {tenant}" · "Đã xoá cấu hình {tenant}" | "KnowledgeHub address saved" · "{tenant} added" · "{tenant} credentials replaced" · "{tenant} configuration removed" |
| Agent | "Tri thức" · "Được dùng tri thức (KnowledgeHub)" · "Loại project" · "Chưa kết nối KnowledgeHub — vào Cài đặt để kết nối" | "Knowledge" · "Can use knowledge (KnowledgeHub)" · "Project types" · "KnowledgeHub is not connected — go to Settings" |
| Admin quy trình | "Project tri thức" · "Project tri thức của stage" · "Không dùng" · "Theo quy trình" · "Chỉ đọc" · "Công ty chưa bật tri thức" · "Chưa có project trong namespace" · "Stage sẽ bắt buộc có mục ## Tóm tắt (≤ 200 từ)." · "Project dùng chung chỉ đọc: không ghi Tóm tắt vào đây." | "Knowledge project" · "Stage knowledge project" · "None" · "Same as process" · "Read-only" · "Knowledge is not enabled for your company" · "No projects in this namespace" · "This stage will require a ## Tóm tắt section (≤ 200 words)." · "Shared project is read-only: no summary is written to it." |
| Dialog | "Tri thức" · "Dùng tri thức cho công ty" · "Agent được phép sẽ hỏi KnowledgeHub trong lúc chạy." · "Quản trị nền tảng chưa cấu hình KnowledgeHub cho công ty" | "Knowledge" · "Use knowledge for company" · "Allowed agents can query KnowledgeHub while running." · "The platform admin has not configured KnowledgeHub for your company" |
| Hạ cấp | "Không truy cập được KnowledgeHub — stage đã chạy không có tri thức." · lý do: "Hết thời gian chờ" / "Namespace chưa kích hoạt" / "Namespace đang bị tạm ngưng" / "Dịch vụ nhúng (embedder) không khả dụng" | "KnowledgeHub was unreachable — this stage ran without knowledge." · "Timed out" / "Namespace not active" / "Namespace suspended" / "Embedder unavailable" |

## 5. Role + nhãn cho e2e (giữ đúng khi code)
| Màn | Phần tử |
|---|---|
| Settings | `heading "Cài đặt"` · `tab "KnowledgeHub"` · `textbox "Địa chỉ KnowledgeHub"` · `button "Lưu"` · `button "Kiểm tra kết nối"` · `combobox "Kiểm tra với tenant"` · `region "Kết quả kiểm tra"` (có `status` tổng + `list` điều kiện) · `note` chứa "embedder đa ngữ" |
| Bảng tenant | `table "Tenant ↔ namespace"` · `button "Thêm tenant"` · mỗi dòng: `switch "Cấp {tenant}"` · `button "Thay credentials {tenant}"` · `button "Xoá {tenant}"` |
| Sheet | `dialog "Thêm tenant"` / `"Thay credentials"` · `combobox "Tenant"` · `textbox "Namespace"` · `textbox "Credentials (JSON)"` · `button "Lưu"` · `button "Huỷ"` · `status` "Đã lưu · v{n}" |
| Agent | `switch "Được dùng tri thức (KnowledgeHub)"` · `group "Loại project"` |
| Admin | `combobox "Project tri thức"` · `combobox "Project tri thức của stage"` · `button "Tri thức"` → `dialog "Tri thức"` có `switch "Dùng tri thức cho công ty"` · output: `status` chứa "Không truy cập được KnowledgeHub" |

Textarea credentials: `autoComplete=off`, `spellCheck=false`; sau lưu form reset, giá trị không vào URL/cache/toast/log/DOM attr (H4b-1 D4).

## 6. Hiệu năng và a11y
Chunk `/settings` nạp lười, trang KH < 25 KB gzip; bảng tenant nhỏ, không virtualize; `KhCheckResult` memo. Kết quả có icon **và** chữ (không chỉ màu); Switch có nhãn; Alert `aria-live="polite"`; tương phản ≥ 4.5:1.

## 7. Giả định contract — chờ contract BE (spec §3)
| # | Giả định | Dùng ở |
|---|---|---|
| C1 | `GET/PUT /studio/api/knowledgehub/config` → `{url, version}` (khoá lạc quan) | Khối 1 |
| C2 | `POST .../check` body `{url, tenant_id}` → `{ok, checks:[{id, status:"ok"\|"fail"\|"warn", detail?}]}`, `id` ∈ version, capabilities, people_lanes, kind_local, auth_required, https; embedder là cảnh báo tĩnh phía FE | KhCheckResult |
| C3 | `GET .../tenants` → `[{tenant_id, tenant_name, namespace, client_id\|null, status, provisioned, version}]`; `PUT/DELETE .../tenants/:tenantId`; credentials đi vào secret `kh_api_key` (H4b-1) cùng request hoặc qua `POST /secrets`; DELETE trả/nhận `affected_processes` | Khối 2 |
| C4 | Agent có `use_knowledge: boolean`, `knowledge_kinds: string[]`; kinds là enum trong contract hoặc `GET .../project-kinds` | Agent |
| C5 | admin-api: `GET /admin/api/knowledge/projects` → `{enabled, provisioned, projects:[{id, name, read_only}]}`; `GET/PUT /admin/api/knowledge/settings` → `{enabled, version}`; quy trình thêm `knowledge_project_id\|null`, stage thêm `knowledge_project_id\|"inherit"\|null` | Admin |
| C6 | Output stage có `warnings:[{code:"kh_degraded", reason:"timeout"\|"ns_not_active"\|"ns_suspended"\|"embedder_unavailable"}]` (admin run và chat run) | DegradedAlert |
| C7 | Mã lỗi: `KH_URL_REJECTED`, `KH_NS_TAKEN`, `KH_PROJECT_NOT_FOUND` | api-error |

## 8. Câu hỏi cho Gate (mặc định đề xuất)
1. Hai cờ: platform `provisioned` (Switch "Cấp" ở Studio), tenant `enabled` (Dialog "Tri thức") — hay một cờ? **Mặc định: hai cờ.**
2. "Loại project" của agent lấy từ đâu (C4)? **Mặc định: enum trong contract do BE chốt.**
3. Artboard mới Cài đặt → KnowledgeHub (+ Dialog admin, + Alert hạ cấp) — **chưa có artboard — đề xuất** vẽ theo bố cục §2 để duyệt cùng Gate.

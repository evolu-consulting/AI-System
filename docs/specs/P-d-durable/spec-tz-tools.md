# P-d · Múi giờ theo tenant + công tắc tool theo tenant (Admin)

Phần mở rộng của [`spec.md`](spec.md) theo trả lời readiness lần 1 câu 2–3 (2026-10-17, [`spec-decisions.md`](spec-decisions.md) "Trả lời readiness lần 1", B1–B7). §1 thuộc lát **P-d1** (CR-084 bổ sung), §2 thuộc lát **P-d2** (CR-087 bổ sung). BA: [ADM-FR-72, ADM-FR-73, AC-A14, AC-A15](../../design/admin/ba-admin.md) · [HUB-FR-144, HUB-FR-146, AC-H47](../../design/agent-hub/ba-agent-hub.md).

## 1. Múi giờ theo tenant (P-d1 · ADM-FR-72 · CR-084)
| Luật | Điều kiện chính xác | Nguồn |
|---|---|---|
| TZ-R01 | Cột `admin.tenants.timezone text NOT NULL DEFAULT 'Asia/Ho_Chi_Minh'`; CHECK `char_length(timezone) BETWEEN 1 AND 64`. Hàng cũ = mặc định (DEFAULT của migration) | câu 2 |
| TZ-R02 | Hợp lệ ⇔ giá trị nằm trong `Intl.supportedValuesOf('timeZone')` (tên IANA chuẩn; alias như `Asia/Saigon` không có trong danh sách ⇒ từ chối). Kiểm ở zod contract (dùng chung admin-api + admin-web). Sai ⇒ 400 `VALIDATION_ERROR` path `timezone` (mã contract khoá) | câu 2 |
| TZ-R03 | `platform_admin` đặt khi tạo tenant (vắng ⇒ mặc định) và sửa ở `PATCH /admin/tenants/:id` (gửi `version`, lệch ⇒ 409 như ADM-FR-55). Audit trước/sau (ADM-FR-51) + `config_changed` (ADM-FR-53). `tenant_admin` không vào màn tenant (B3) | ADM-FR-60/72 |
| TZ-R04 | Hub đọc `admin.tenants.timezone` (quyền `hub_ro` sẵn có) **trong tx lưu hẹn giờ** `wait_until` (PD-R13); đổi giờ địa phương → `due_at` UTC có tính DST. Đổi `timezone` sau đó **không** tính lại hẹn giờ đã lưu (B7). Hẹn giờ `retry` không dùng múi giờ | câu 2, D7 |
| TZ-R05 | Export/import yaml tenant (ADM-FR-54) thêm `timezone`; import vắng ⇒ giữ giá trị hiện có (tenant mới ⇒ mặc định) | B6 |

**Contract** (backend-lead chốt chi tiết ở plan): `TenantSchema`/`TenantDetail` + `timezone: string`; create/update tenant body + `timezone?`; hằng `TENANT_TZ_DEFAULT = 'Asia/Ho_Chi_Minh'`. Editor quy trình (Hub) cần biết múi giờ tenant để hiện chỉ-đọc — backend-lead chọn nguồn (thêm vào view def hoặc endpoint Hub sẵn có), **không** mở màn tenant cho `tenant_admin`.

**Dữ liệu:** migration admin viết tay, số kế tiếp lúc làm (hiện cao nhất `migrations/0010_cr052_user_locale_en.sql` ⇒ dự kiến `0011_pd1_tenant_timezone.sql`); Drizzle `packages/db/src/schema/admin.ts` (`tenants`). Không đổi RLS.

**UI** (mockup trong T2): chi tiết tenant → tab "Thông tin" (`TenantInfoForm`) thêm ô chọn có tìm kiếm "Múi giờ" (danh sách IANA, hiện mặc định); panel "Chờ tới ngày" (editor quy trình) hiện dòng chỉ-đọc "Theo múi giờ công ty: {tz}".

## 2. Công tắc tool theo tenant (P-d2 · ADM-FR-73 · CR-087)
Thay mặc định readiness #6 (tool khả dụng qua agent grant). Tool của gói (ADR-0018) vẫn để sau.

| Luật | Điều kiện chính xác | Nguồn |
|---|---|---|
| TT-R01 | Bảng **`admin.tenant_workflow_tools`** (B1, mẫu `feature_entitlements`): `workflow_id` FK `admin.workflows` ON DELETE CASCADE · `tenant_id` FK `admin.tenants` ON DELETE CASCADE · `granted_by` FK `admin.users` ON DELETE SET NULL · `granted_at timestamptz NN` · `revoked_at timestamptz NULL`; PK `(workflow_id, tenant_id)`; index một phần `(tenant_id, workflow_id) WHERE revoked_at IS NULL`. **Bật** ⇔ có hàng `revoked_at IS NULL` | câu 3 |
| TT-R02 | RLS ENABLE (như 0004): policy `tenant_workflow_tools_admin_rw` cho `admin_rw` theo tenant như `feature_entitlements_admin_rw`; `tenant_workflow_tools_hub_ro` SELECT cho `hub_ro`. Không quyền ghi cho Hub | câu 3 |
| TT-R03 | API Admin, **chỉ `platform_admin`** (tenant_admin ⇒ 403): `GET /admin/tenants/:id/workflow-tools` (mọi workflow catalog: key, tên, `side_effect`, `enabled`, `on`) · `PUT /admin/tenants/:id/workflow-tools/:workflow_id` (bật; đã bật ⇒ 200 không đổi) · `DELETE …` (tắt = đặt `revoked_at`; bật lại = xoá `revoked_at`, cập nhật `granted_by/at`). Mỗi lần đổi: audit `entity:"workflow"`, `action:"grant"` (bật) / `"revoke"` (tắt), `tenant_id`, `entity_id` = workflow, before/after `{on}` (dùng enum audit sẵn có) + `config_changed` | câu 3, ADM-FR-51/53 |
| TT-R04 | **Tool khả dụng cho tenant T** = workflow `enabled=true` ∧ công tắc bật cho T. Không cần agent grant. Endpoint catalog tool cho editor (Hub, [spec-d2 §4](spec-d2.md)) chỉ trả tool khả dụng của tenant người gọi | câu 3 |
| TT-R05 | **Lưu def:** `tool_key` phải là tool khả dụng của tenant def; không tồn tại / không bật / khác tenant ⇒ 422 `PROCESS_REF_INVALID` (không lộ tồn tại, readiness #13) | câu 3, PD2-R01 |
| TT-R06 | **Chạy:** ngay trước khi gọi, Hub đọc DB (B5, lọc `tenant_id` của run tường minh): công tắc còn bật ∧ workflow `enabled` — sai ⇒ `needs_decision` **`tool_failed`** (B4). Người bắt đầu phải active + thuộc Group được chạy quy trình (HUB-BR-27) — sai ⇒ `permission_lost`/`user_inactive` như cũ | câu 3, PD2-R03 |
| TT-R07 | Tắt công tắc khi run đang chờ (stage `tool` chưa gọi, đang backoff, hoặc bước trước chưa xong) ⇒ khi tới lượt gọi ⇒ `tool_failed`. Lời gọi đã gửi không bị huỷ | câu 3 |
| TT-R08 | Cách ly: công tắc của tenant B không ảnh hưởng tenant A; truy vấn công tắc luôn theo `(workflow_id, tenant_id = run.tenant_id)`. **Hard stop bảo mật** — gộp vào security review tool (T20) | câu 3, S5 |

**Đặt code** (ADR-0023, CR-090, [spec-ca §6](spec-ca.md)): §1 chỉ thêm trường vào luồng `tenants` sẵn có ⇒ không bắt buộc tách lớp; Hub tính `due_at` ở `processes/domain/timers/due-at.rules.ts`, đọc múi giờ qua port `TenantTzReader`. §2 là logic mới ⇒ admin-api viết bốn lớp (`domain/`, `application/`, `adapters/`; module mới `workflow-tools/` hoặc lớp trong `tenants/`, plan chốt); Hub đọc công tắc qua port `ToolSwitchReader`.

**Dữ liệu:** cùng migration admin với §1 nếu làm chung, hoặc migration admin kế tiếp lúc làm P-d2 (dự kiến `0012_pd2_tenant_workflow_tools.sql`); Drizzle `schema/admin.ts`.

**UI** (mockup trong T14): chi tiết tenant (`TenantDetailPage`) thêm **tab "Tool quy trình"** (B2) sau tab Agents: bảng workflow catalog (tên, `key`, nhãn "Tác dụng phụ" khi `side_effect`, nhãn "Workflow đang tắt" khi `enabled=false`), một công tắc mỗi dòng; tắt ⇒ hộp xác nhận "Run đang chờ gọi tool này sẽ dừng ở Cần người quyết". Panel "Gọi tool" (editor quy trình) chỉ liệt kê tool khả dụng; rỗng ⇒ "Chưa có tool nào được bật cho công ty — liên hệ quản trị nền tảng".

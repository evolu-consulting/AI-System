# P4 · Backend RBAC — Làn đầy đủ (Opus)

FR: **ADM-FR-82** (bảng + hàm biên dịch), **ADM-FR-83** (endpoint CRUD vai + gán + gating), **ADM-FR-84** (luật 409, `groups.managed_by_role_id`). Nguồn: ADR-0033 §1–§2, §5–§6; BA §4, R1–R4. backend-lead điền; docs-architect chỉ giữ khung.

## Ràng buộc đã chốt (không bàn lại)
R1–R4; bảng RLS theo `tenant_id`; biên dịch idempotent 1 transaction + đúng 1 NOTIFY; Hub không đọc bảng vai; slug `^[a-z0-9-]{2,32}$`, cấm trùng owner/editor/viewer/Group đã có ⇒ 409; xoá còn user ⇒ 409 (FK RESTRICT); cấm vai tuỳ biến cho external; gating platform_admin (catalog/entitlement) vs tenant_admin (vai/gán).

## 3. Contract / schema
[backend-lead điền] — tên bảng/cột/khoá/index `admin.app_roles` (mặc định đề xuất), `admin.groups.managed_by_role_id`, zod request/response.

## 4. API và quyền
[backend-lead điền] — endpoint + role gating từng thao tác, mã lỗi.

## Biên dịch
[backend-lead điền] — hàm thuần vai → cặp grant theo R1; tái dùng cơ chế `enablePack`.

## AC
| AC | Nội dung |
|---|---|
| P4-AC01 | Mức Quản trị ⇒ đúng 3 grant read/write/admin; Đọc+Ghi ⇒ 2; Đọc ⇒ 1 (R1) |
| P4-AC02 | Mỗi lần lưu biên dịch phát đúng 1 NOTIFY (R3) |
| P4-AC03 | Không có grant user lẻ được tạo (R2) |
| P4-AC04 | Tenant A không đọc/ghi được `app_roles` của tenant B (RLS) |
| P4-AC05 | Vai cho chat/studio/admin bị từ chối; vai tuỳ biến cho external bị từ chối |
| P4-AC06 | Slug trùng ⇒ 409; xoá vai còn user ⇒ 409 |
| P4-AC07 | Chạy biên dịch hai lần cho cùng vai ⇒ kết quả không đổi (idempotent) |

---
id: cr125-ux-s6-wording
lát: cr125-ux-s6-wording
cr: CR-125
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
UX-S6 (H8, L3, chữ của M5): chỉ đổi nhãn i18n sang ngôn ngữ nghiệp vụ.

## Làm
- vi.json: Users/Groups/Số run/Token -> Người dùng / Nhóm / phòng ban / Lượt chạy / Lượng AI dùng; "Trần công ty" -> "Mức cao nhất công ty cho phép"; nhật ký "quyền feature" -> "quyền dùng tính năng"; chân khung hiện vai (nav.roleName) thay vì tenant_admin.
- contracts: "Upload hợp đồng"/"Tải lên chứng từ" -> "Tải hợp đồng lên".
- glossary.vi.json: thêm 2 dòng cấm lộ lại.
- e2e app-roles + deployed/02 cập nhật chữ cũ.

## Không làm / Chạm
Canvas, Cài đặt, wizard, contracts-list code, DLC. Chưa làm: ẩn app thử (pkdemo), nút "Thêm" duy nhất, tiếng Anh màn nền tảng (en.json).

## Test tối thiểu
i18n:check, check:i18n-terms, check:i18n-unused --strict, openspec:check, e2e app-roles (evotest -Dirty).

## Quyết định trong lúc làm
Chân khung dùng t("nav.roleName.<role>") với defaultValue = role.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: chỉ đổi nhãn hiển thị i18n và một dòng hiển thị vai ở chân khung admin-web).

## Việc còn lại
Chạy e2e app-roles một lần trên evotest.
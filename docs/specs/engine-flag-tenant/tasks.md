# engine-flag-tenant (Luật 0b, làn nhanh)

Bật/tắt duyệt HĐ bằng engine theo công ty, không UI mới.

## Quyết định
- Feature `contracts-approval-engine` (admin.features) cấp theo công ty bằng feature_entitlements; admin bật/thu hồi ở trang Features sẵn có.
- Luật (`engineAllowedForTenant`): env `CONTRACTS_APPROVAL_ENGINE` ≠ `on` ⇒ tắt hết (công tắc khẩn); `on` ⇒ chỉ tenant có entitlement còn hiệu lực và feature không `off`. Thiếu feature ⇒ máy cũ (fail-closed).
- Cổng chỉ ở `start` (mở lượt MỚI, gồm heal của sweep) trong `approval.mount.ts`; đọc từ cache cấu hình `PackAccessView.catalog()` (`tenantFeatureOn`), 0 SQL. Lượt đã `mode='engine'` chạy nốt (tool/reopen/myApprovals không cổng). Đường máy cũ không đổi.
- Seam test `contractsAi.approvalEngine` vẫn ghi đè env và KHÔNG cổng (test CF cũ không đổi); `approvalEngineTenantGate: true` bật cổng.
- Migration 0026 (idx 26): tạo feature (chỉ khi đã có tenant), cấp cho tenant `demo` + mọi tenant đã có lượt `mode='engine'` (nếu bảng contracts.approvals tồn tại lúc chạy). Admin-api không cần sửa.

## Test
- unit: approval-engine.rules.test.ts (env x entitlement). int: tests/acceptance/CF/engine-tenant-gate.int.test.ts.

## Còn lại
- Kiểm prod đang bật env hay không; nếu tenant khác demo đang dùng engine mà chưa có lượt engine thì cấp tay ở Features trước khi deploy.
- defSync/settingsSync vẫn chạy cho mọi tenant khi env on (vô hại, chỉ đồng bộ def).

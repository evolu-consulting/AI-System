# grants

FR: ADM-FR-32 (grant feature cho group/user trong phạm vi entitlement), ADM-FR-35 (ma trận, batch), ADM-BR-12. Spec: `docs/specs/M3-permissions/spec.md` §3 "Grants", plan §5.5, §6.

- Điểm vào: `grants.routes.ts` (`/admin/grants`, `/matrix`, `/batch`; platform_admin + tenant_admin).
- `grants.service.ts`: list, POST (201 tạo / 200 đã có), DELETE theo query (luôn 204); `grants.batch.ts`: batch một transaction; `grants.matrix.ts`: ma trận (đọc); `grants.read.ts`: SQL đọc + map `Grant`; `grants.repo.ts`: khoá + ghi; `grants.rules.ts`: hàm thuần (`comparePairs`, `checkGrantFeatures`, `planBatch`, `matrixRowState`).
- Thứ tự khoá (plan §6): groups `SHARE` → features `SHARE` → entitlements `SHARE` → lock pass hàng grant sắp `(feature_id, group_id)` (thêm ∪ bớt) → xoá/chèn → `config_meta` (configWrite). Khoá đủ trước, báo lỗi sau theo thứ tự spec.
- Batch xoá theo toàn bộ `remove` (không theo snapshot), đếm bằng `returning`.
- Phụ thuộc: `groups.service` (`writeTenant`, `mustTenant`, `groupRefsOf`), `users.rules` (`resolveTenantScope`).

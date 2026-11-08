---
id: feature-ui
lát: feature-ui
cr: CR-111
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Admin-web (ai-admin) hiện liệt kê feature bằng tên kỹ thuật (`community-admin`, `contracts-approval-engine`…). Làm lại 2 chỗ theo lựa chọn người dùng:
- **Danh mục `/features` (phương án A):** nhóm theo app (Cơ bản, Chat AI, Community, Sổ Hợp Tác, Tri thức, Khác); mỗi dòng tên dễ hiểu + mô tả một dòng, key kỹ thuật mono mờ bên phải; badge "Mặc định" / "Tính năng thêm".
- **Chi tiết công ty › tab Feature (phương án C, trước đây "Chưa khả dụng"):** mỗi app một thẻ; app có mức chọn Tắt · Xem · Sửa · Quản trị (cộng dồn read/write/admin) + công tắc tính năng thêm (khoá khi app Tắt); Chat AI một công tắc; Cơ bản luôn bật, khoá. Tóm tắt "Đang: Sửa · 1 tính năng thêm". Lưu một lượt bằng diff.
Metadata ở một registry: `features/features/lib/feature-meta.ts` + i18n `featmeta.*` (vi/en); key lạ suy app theo tiền tố, không khớp ⇒ nhóm "Khác" với tên gốc.

## Làm
- [x] `feature-meta.ts` (registry, `metaOf`, `groupByApp`), `feature-label.ts`.
- [x] Danh mục: `FeatureTable` (nhóm) + `FeatureGroupSection`.
- [x] Tab Feature công ty: `feature-assign.ts` (luật thuần), `use-tenant-features`, `AppCard`/`LevelControl`/`AddonList`/`TenantFeaturesTab` (nạp lười), `useTenantFeatureStates` (ma trận quyền), `useApplyTenantEntitlements`.
- [x] i18n vi + en; unit; e2e `e2e/feature-ui.spec.ts`.

## Không làm / Chạm
- Không đổi backend, contract, quyền (vẫn chỉ platform_admin). Không có endpoint bulk ⇒ lưu = các `PUT/DELETE /admin/features/:id/entitlements/:tenant` gọi song song một lượt (một toast thành công/lỗi; lỗi ⇒ nạp lại trạng thái thật, diff còn lại giữ nguyên để lưu tiếp). Có thu hồi ⇒ hộp xác nhận.
- Cột "Cập nhật" của danh mục bỏ (nhường chỗ cho mô tả + key); editor feature không đổi.

## Test tối thiểu
- unit `feature-meta.test.ts` (nhóm/suy app), `feature-assign.test.ts` (level↔keys hai chiều gồm bộ không chuẩn, diff lưu).
- e2e `feature-ui.spec.ts` (danh mục + tab Feature, DB thật) + `features.spec.ts` cũ vẫn xanh.

## Quyết định trong lúc làm
- Key lạ có tiền tố app đã biết (`contracts-xyz`) ⇒ app đó, coi là tính năng thêm; mức suy từ hậu tố read/write/admin.
- Mức chọn được khi catalog có đủ feature các mức thấp hơn; app Tắt xoá luôn tính năng thêm của app đó khỏi bản nháp.
- Bộ không chuẩn (vd Sửa mà thiếu Xem, hoặc app Tắt còn tính năng thêm): hiện mức cao nhất + nhãn "Không chuẩn"; bấm lại mức đang chọn rồi Lưu ⇒ chuẩn hoá.
- Trạng thái công ty đọc từ `GET /admin/grants/matrix?tenant_id=&limit=1` (đã dùng cho quota), không thêm API.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

### MODIFIED admin/ghi-chu.md
#### Yêu cầu: Danh mục feature nhóm theo app với tên dễ hiểu
`/features` nhóm feature theo app (suy từ registry/tiền tố key); mỗi dòng hiện tên dễ hiểu + mô tả, key kỹ thuật mono mờ, badge "Mặc định"/"Tính năng thêm"; key lạ vào nhóm "Khác".
- Kịch bản: khi key thuộc registry hoặc có tiền tố app thì vào đúng nhóm theo thứ tự app, trong nhóm Xem → Sửa → Quản trị → tính năng thêm [test: apps/admin-web/src/features/features/lib/feature-meta.test.ts » groupByApp]
- Kịch bản: khi platform_admin mở /features thì thấy nhóm "Sổ Hợp Tác", dòng han-muc-duyet có tên dễ hiểu + badge "Tính năng thêm" + key mono [test: e2e/feature-ui.spec.ts » CR-111 · /features nhóm theo app]

#### Yêu cầu: Gán tính năng cho công ty theo mức của từng app
Tab Feature của chi tiết công ty (platform_admin) hiện mỗi app một thẻ: mức Tắt/Xem/Sửa/Quản trị (cộng dồn) và công tắc tính năng thêm; Lưu một lượt cấp/thu hồi entitlement theo diff; bộ không chuẩn hiện mức cao nhất kèm "Không chuẩn" và được chuẩn hoá khi lưu.
- Kịch bản: khi chọn mức thì tập key = các mức thấp hơn + chính nó; bộ thiếu mức thấp bị nhận là không chuẩn [test: apps/admin-web/src/features/tenants/lib/feature-assign.test.ts » level ↔ keys]
- Kịch bản: khi đổi mức/công tắc thì diff chỉ gồm cấp/thu hồi cần thiết, không đụng core [test: apps/admin-web/src/features/tenants/lib/feature-assign.test.ts » diffEntitlements]
- Kịch bản: khi acme có bộ Sửa không chuẩn, chọn Quản trị + bật tính năng thêm rồi Lưu thì DB có đủ 4 entitlement; chuyển Tắt có xác nhận và thu hồi hết [test: e2e/feature-ui.spec.ts]

## Việc còn lại
- Chưa merge (chờ điều phối). Ảnh chụp: `.data/cr111/catalog.png`, `tenant.png`.

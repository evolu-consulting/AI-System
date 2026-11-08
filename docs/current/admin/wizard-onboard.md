# Admin · Wizard thêm công ty

Cập nhật: 2026-11-09 · Gộp từ: cr112-wizard (đợt cr125-wave).

## Yêu cầu: Wizard thêm công ty 4 bước và Onboard lại (ADM-FR-79) (nguồn: cr112-wizard)
Wizard `/tenants/new` có 4 bước Thông tin → Ứng dụng & Gói → Phân quyền & Người dùng → Xem lại; bước 1 tạo công ty ngay, các bước sau dùng endpoint có sẵn, trạng thái nằm trên URL nên bỏ ngang vẫn tiếp được; bước 3 và 4 bỏ qua được; "Onboard lại" ở header workspace mở wizard từ bước 2.
- Kịch bản: khi tạo công ty ở bước 1 rồi bấm Thoát thì công ty còn trong DB và workspace mở được, "Onboard lại" mở bước 2, bỏ qua bước 3, Xem lại, Hoàn tất ⇒ tab Tổng quan [test: e2e/cr112-wizard.spec.ts » ADM-FR-79 · AC1,AC2,AC4 · sidebar '+' → bước 1 tạo công ty ngay, Thoát ⇒ công ty còn, 'Onboard lại' mở bước 2, lưu app, bỏ qua bước 3, Xem lại, Hoàn tất ⇒ tab Tổng quan]
- Kịch bản: khi mã công ty trùng thì báo lỗi tại bước 1 và chưa có công ty mới [test: e2e/cr112-wizard.spec.ts » ADM-FR-79 · AC3 · mã trùng 'acme' ⇒ lỗi ngay ở bước 1, chưa có công ty mới, vẫn bước 1]
- Kịch bản: khi URL có công ty thì bước hiện tại là bước đã lưu trên URL (tối thiểu bước 2), chưa có công ty thì luôn bước 1 [test: apps/admin-web/src/features/tenants/lib/wizard.test.ts » chưa có công ty ⇒ bước 1 dù ?step= là gì, có công ty ⇒ resume đúng bước, tối thiểu bước 2]
- Kịch bản: khi bấm Onboard lại thì wizard mở bước 2 trên công ty có sẵn [test: apps/admin-web/src/features/tenants/lib/wizard.test.ts » Onboard lại mở bước 2 trên công ty có sẵn (AC4)]
- Kịch bản: bước 3 và 4 bỏ qua được, bước 1 và 2 thì không [test: apps/admin-web/src/features/tenants/lib/wizard.test.ts » bước 3 và 4 bỏ qua được, bước 1 và 2 thì không (AC2)]

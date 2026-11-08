---
id: cr123-u9-plain-words
lát: cr123-u9-plain-words
cr: CR-123
làn: nhanh
migration: không
phụ thuộc: cr123-u7-save-apply
---
## Plan (ngắn)
Soát UX CEO (docs/specs/CR-123/ux-review-ceo.md hàng 4–10, 17, 20, 6) + ảnh sau u7: trình sửa quy trình của công ty không được lộ khái niệm kỹ thuật.

## Làm
- Hub: `apply` ghi audit `company_flow.apply` (action `update`, entity `process_def`, summary có tenant/flow/bản gốc bị thay) qua `withConfigWrite` — cùng tx, tăng phiên cấu hình (Hub nạp lại ngay). Comment ở route để `POST /:id` tương lai không nuốt `/apply`.
- admin-web (người dùng công ty, `isBusinessView`): ẩn "Nguồn của quy trình / Thêm nguồn / Khai báo nguồn", "Thông tin đầu vào", "Nâng cao" của thông tin chung và của từng bước (Tự sửa mã, người thực hiện…). Quản trị nền tảng vẫn thấy đủ. Sơ đồ các bước lên đầu trang. Thanh lưu = MỘT dòng trạng thái (lỗi › đang áp dụng › chưa lưu › đã áp dụng › chưa áp dụng › ghi chú).
- Bước Thông báo (trình sửa sơ đồ): thêm "Gửi cho" — người tạo hợp đồng + chọn phòng ban theo tên.
- workspace-web: nút "Xác nhận và lưu" → "Gửi duyệt" (nhãn + gợi ý bản nháp); danh sách hợp đồng rỗng cho vai không có quyền tải lên nói đúng phạm vi ("Bạn chỉ thấy hợp đồng đến lượt bạn duyệt…"), không gợi ý Upload.

## Không làm / Chạm
- Không đụng canvas/* (u8), esign (m4), partner UI (q4).
- CHƯA làm (cần ngoài phạm vi): nhãn kỹ thuật trên node ("contracts-esign-send", "Hành động thật", "Chạy tính năng", "Tác động thật") nằm ở `components/canvas/StageBody.tsx` (canvas/*, u8 đang sửa) ⇒ giao u8; cột "Bước" của danh sách hợp đồng lấy bước thật cần đổi API danh sách + `ContractListRow` (khoá 22 khoá, engine run) ⇒ lát riêng.

## Test tối thiểu
unit `company-copy.test.ts` (isBusinessView); int `company-flows-apply.int.test.ts` (thêm kiểm audit); journey e2e G2 chạy một lần + ảnh.

## Quyết định trong lúc làm
- Audit không thêm giá trị `action` mới (cần migration CHECK) — dùng `update` + `entity_name = company_flow.apply`.
- perf: apply thêm ≤ 4 câu cố định (khoá cấu hình, tăng phiên, audit, NOTIFY); không phụ thuộc số flow.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr122-cr123)

### MODIFIED engine/thu-vien-quy-trinh.md
#### Yêu cầu: Nhân bản rồi gán
Nhân bản mọi quy trình (kể cả đang dùng) thành nháp mới cùng khe, chưa gán; sửa bản nhân bản không ảnh hưởng tenant nào. Với flow của công ty: "Lưu và áp dụng" ghi nhật ký (ai, quy trình nào, thay bản gốc nào); người dùng công ty chỉ thấy phần nghiệp vụ của trình sửa (không Nguồn, Thông tin đầu vào, Nâng cao), sơ đồ các bước ở đầu trang, thanh lưu một dòng trạng thái; bước Thông báo chọn được người nhận.
- Kịch bản: khi quản trị công ty bấm Lưu và áp dụng thì có đúng một dòng nhật ký company_flow.apply ghi người làm và bản gốc bị thay [test: apps/hub-api/src/modules/processes/library/company-flows-apply.int.test.ts » một lần áp dụng ⇒ bản công ty Bật, gốc Thư viện Tắt (replaced_by) trong cùng phản hồi, áp dụng lại không đổi]
- Kịch bản: khi người dùng công ty mở bản công ty thì không thấy Nguồn của quy trình, Thông tin đầu vào, Khai báo nguồn; quản trị nền tảng vẫn thấy [test: apps/admin-web/src/features/processes/lib/company-copy.test.ts » bản công ty: người công ty chỉ thấy nghiệp vụ, quản trị nền tảng thấy đủ]
- Kịch bản: khi tenant_admin mở bản công ty rồi Lưu và áp dụng thì trang không có phần kỹ thuật và hiện một dòng xác nhận [test: e2e/journey-approval/cr122-flows.spec.ts » G2 · tenant_admin: Sao chép → 3 lỗi 409 → sửa người duyệt → Xuất bản (gốc tự Tắt) → HĐ B theo bản công ty, HĐ A giữ bản cũ → Quay về bản gốc]

## Việc còn lại
Nhãn kỹ thuật trên node (canvas/StageBody) ⇒ u8; cột "Bước" thật của danh sách hợp đồng ⇒ lát riêng (API danh sách).

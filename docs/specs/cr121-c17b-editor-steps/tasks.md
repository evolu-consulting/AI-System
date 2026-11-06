---
id: cr121-c17b-editor-steps
lát: cr121-c17b-editor-steps
cr: CR-121
làn: nhanh
migration: không
phụ thuộc: cr121-c, c15, c17
---
## Plan (ngắn)
Phần còn lại của artboard `Tpl-Editor` (+ `Tpl-Run` cho tab Lượt chạy). Phát hiện khi đọc: trình sửa thư viện của platform đã có chế độ "Danh sách" (Form: bước dọc, "Chỉ chạy khi", bộ đếm, "Thêm bước", thanh trạng thái) — lát này nối nó vào mô hình chung thay vì dựng thứ hai (Luật gốc 1–2).

## Làm
1. Danh sách bước dọc = chế độ "Danh sách" của `view-mode.ts` (Form ↔ list, Canvas ↔ canvas): `LibraryEditorBody` đọc/ghi `processView` qua `lib/step-limit.ts` (`editorModeOf/viewModeOf`); canvas vẫn mặc định. Cùng model: Form lưu `slot_body`, canvas lưu `stages` (Hub dựng lại) — không có kho riêng. Bộ đếm `stepCounter` (n/20), chặn bước 21 `canAddStep`, lý do "Tối đa 20 bước — xoá bớt một bước để thêm bước mới." (vi+en). "Chỉ chạy khi" = `describeWhen` (có sẵn).
2. Thư viện (platform): nút "Xuất bản v{N+1}" (`nextVersion`), dòng "X công ty đang dùng vN" từ `tenant_count` có sẵn của API danh sách/chi tiết (không SQL mới); nhãn "tenant" ⇒ "công ty".
3. Bản riêng công ty: không Xuất bản (vốn không có); thanh lưu ghi "Lưu là áp dụng ngay cho lượt chạy mới; lượt đang chạy giữ bản cũ." (`ProcessSaveBar companyCopy`).
4. Trang chỉ-xem: tab "Các bước" | "Lượt chạy" — lượt từ `process-library/:id` (đã lọc theo công ty + `def_id`, c9), bảng dùng chung `runColumns` với tab Lượt chạy của trình sửa.
5. "Xem trước bằng HĐ mẫu": đổi nhãn nút "Xem trước đường đi" (đường xem trước có sẵn của thư viện, `PreviewDialog`: loại HĐ + giá trị ⇒ bước chạy/bỏ qua). Không nối sang tab "Mẫu · chạy thử" (đó là chạy thử mẫu, không phải xem trước đường đi).

## Không làm / Chạm
Hub/contract không đổi. Perf: không chạm đường nóng.

## Test tối thiểu
- unit: `lib/step-limit.test.ts` (n/20, chặn 21, vN+1, ánh xạ chế độ, nhãn điều kiện). Không có int (không đổi Hub).
- e2e viết, không chạy: `e2e/P-a/pf4/editor-steps.pa.ts`; chỉnh nhãn ở `process-library.pa.ts`, `journey-approval/cr121-d6b-notify.spec.ts` ("Xuất bản vN", "công ty đang dùng").

## Khác biệt còn lại so với artboard / bẫy
1. Bản riêng của công ty vẫn mở trình sửa chung (Cấu hình/Lượt chạy, canvas giai đoạn); chưa có danh sách bước dọc + "Chỉ chạy khi" + "Thêm bước" cho bản riêng (Form hiện chỉ cho def thư viện của platform; Hub chấp nhận lưu bản riêng theo khe nhưng web chưa dựng Form cho nó).
2. "Xem trước bằng HĐ mẫu" chỉ có ở thư viện platform (API xem trước là của platform); bản riêng chưa có.
3. Cột `record_label` (c11b) chưa có trong contract `ProcessRunSummary` ở nhánh này ⇒ bảng Lượt chạy chưa có nhãn hồ sơ.
4. Tab Danh sách ở trang chỉ-xem nhiều lượt >20: API chỉ trả 20 lượt gần nhất.
5. "Dùng bởi" đếm = số công ty được gán (tập gán), không phân biệt "đang dùng thật" theo luật.

## Quyết định trong lúc làm
- Tái dùng Form có sẵn làm "Danh sách" thay vì dựng component mới.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED admin/trinh-sua-danh-sach-buoc.md
#### Yêu cầu: Trình sửa quy trình có chế độ Sơ đồ và Danh sách bước dùng chung một lựa chọn (CR-121 R8)
Trình sửa quy trình thư viện mở ở Sơ đồ (canvas) mặc định; "Danh sách" là bước dọc có "Chỉ chạy khi", bộ đếm n/20 và chặn bước thứ 21 kèm lý do; lựa chọn được nhớ theo người dùng. Thư viện hiện "Xuất bản vN+1" và "X công ty đang dùng vN"; bản riêng của công ty ghi rõ lưu là áp dụng ngay cho lượt chạy mới (không có Xuất bản); trang chỉ-xem có tab Lượt chạy của công ty.
- Kịch bản: bộ đếm n/20 và bước thứ 21 bị chặn [test: apps/admin-web/src/features/processes/lib/step-limit.test.ts » CR-121 c17b · n/20 và chặn bước thứ 21]
- Kịch bản: xuất bản vN+1 và Danh sách ứng với Form [test: apps/admin-web/src/features/processes/lib/step-limit.test.ts » CR-121 c17b · xuất bản vN+1, chế độ xem]
- Kịch bản: platform chuyển Danh sách, tải lại vẫn Danh sách; tenant_admin thấy tab Lượt chạy và ghi chú lưu áp dụng ngay [test: thủ công — e2e/P-a/pf4/editor-steps.pa.ts viết, chạy một lần cuối đợt]

## Việc còn lại
- Điều phối: chạy e2e `editor-steps.pa.ts` + 2 file đổi nhãn; quyết định lát cho khác biệt 1–2 (Form/xem trước cho bản riêng).
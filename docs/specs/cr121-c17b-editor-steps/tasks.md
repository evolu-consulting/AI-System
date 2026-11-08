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

## Bổ sung (vòng 2, điều phối)
- Bản riêng công ty dùng CÙNG `FlowFormEditor` (một component) qua `CompanyCopyBody`: công tắc Sơ đồ/Danh sách (`view-mode.ts`), "Chỉ chạy khi", n/20, "Thêm bước", Xem trước bằng HĐ mẫu = `PreviewDialog` (đúng đường xem trước của thiết kế); lưu theo đường khe (c17). Hub: `GET /process-defs/:id` của bản riêng trả thêm `slot_body`; `POST /process-defs/:id/preview` cho tenant_admin xem trước CHÍNH bản riêng của công ty mình (khe lấy từ def nguồn; def thư viện/công ty khác = 404; member 403). Form bị chặn ở dạng tuần tự: bước song song/If ⇒ Form báo lý do và chỉ sửa ở Sơ đồ; lưu sai dạng ⇒ 422 `SLOT_SHAPE_UNSUPPORTED` (c17).
- `record_label`: `ProcessLibraryView.runs` chuyển sang `ProcessRunListItemSchema` (cùng schema danh sách `GET /process-runs`, một nguồn); Hub gắn nhãn theo TẬP bằng `runRecordLabels`; cột "Hồ sơ" ở bảng Lượt chạy dùng chung (trình sửa + trang chỉ-xem).
- Test: unit `lib/company-copy.test.ts`; int (evotest xanh 13/13): `clone-for-company.int » CR-121 c17b …`, `library-preview.int` (tenant_admin trên def thư viện ⇒ 404 thay 403).
- Bẫy: Form của bản riêng không có thông tin khe (`GET /process-slots` chỉ platform) ⇒ dùng trường điều kiện mặc định của hợp đồng, không có gợi ý mã phòng ban; platform sửa bản riêng của công ty khác chưa hỗ trợ (PUT cần ngữ cảnh công ty).

## Khác biệt còn lại so với artboard / bẫy
1. (đã làm ở vòng 2) Form bước dọc + Xem trước cho bản riêng.
2. "Xem trước bằng HĐ mẫu" = `PreviewDialog` (xác nhận điều phối); không nối sang tab "Mẫu · chạy thử".
3. (đã làm ở vòng 2) `record_label`.
4. Tab Lượt chạy ở trang chỉ-xem nhiều lượt >20: API chỉ trả 20 lượt gần nhất.
5. "Dùng bởi" đếm = số công ty được gán (tập gán), không phân biệt "đang dùng thật" theo luật.

## Quyết định trong lúc làm
- Tái dùng Form có sẵn làm "Danh sách" thay vì dựng component mới.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

### ADDED admin/trinh-sua-danh-sach-buoc.md
#### Yêu cầu: Trình sửa quy trình có chế độ Sơ đồ và Danh sách bước dùng chung một lựa chọn (CR-121 R8)
Trình sửa quy trình thư viện mở ở Sơ đồ (canvas) mặc định; "Danh sách" là bước dọc có "Chỉ chạy khi", bộ đếm n/20 và chặn bước thứ 21 kèm lý do; lựa chọn được nhớ theo người dùng. Thư viện hiện "Xuất bản vN+1" và "X công ty đang dùng vN"; bản riêng của công ty ghi rõ lưu là áp dụng ngay cho lượt chạy mới (không có Xuất bản); trang chỉ-xem có tab Lượt chạy của công ty.
- Kịch bản: bộ đếm n/20 và bước thứ 21 bị chặn [test: apps/admin-web/src/features/processes/lib/step-limit.test.ts » CR-121 c17b · n/20 và chặn bước thứ 21]
- Kịch bản: xuất bản vN+1 và Danh sách ứng với Form [test: apps/admin-web/src/features/processes/lib/step-limit.test.ts » CR-121 c17b · xuất bản vN+1, chế độ xem]
- Kịch bản: bản riêng của công ty dùng cùng Form bước dọc khi Hub trả slot_body, lượt chạy hiện nhãn hồ sơ [test: apps/admin-web/src/features/processes/lib/company-copy.test.ts » CR-121 c17b · bản riêng dùng Form bước dọc chung]
- Kịch bản: tenant_admin xem trước bằng HĐ mẫu CHÍNH bản riêng của công ty mình, bản riêng công ty khác 404 [test: apps/hub-api/src/modules/processes/library/clone-for-company.int.test.ts » CR-121 c17b · bản riêng: Form bước dọc + xem trước bằng HĐ mẫu]
- Kịch bản: platform chuyển Danh sách, tải lại vẫn Danh sách; tenant_admin thấy tab Lượt chạy và ghi chú lưu áp dụng ngay [test: thủ công — e2e/P-a/pf4/editor-steps.pa.ts viết, chạy một lần cuối đợt]

## Việc còn lại
- Điều phối: chạy e2e `editor-steps.pa.ts` + 2 file đổi nhãn; quyết định lát cho khác biệt 1–2 (Form/xem trước cho bản riêng).
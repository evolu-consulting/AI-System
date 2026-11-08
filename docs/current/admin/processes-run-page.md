# Admin · Chi tiết lượt chạy

Cập nhật: 2026-11-09 · Gộp từ: cr121-r3-run-ui (đợt cr125-wave).

## Yêu cầu: Chi tiết lượt chạy (admin) (nguồn: cr121-r3-run-ui)
Trang lượt chạy hiện đầu trang (mã lượt có sao chép, quy trình + phiên bản, công ty, kích hoạt bởi, mốc thời gian, trạng thái + lý do), sơ đồ ngang các bước, dòng thời gian thu gọn được; bấm bước mở nhật ký bước (Cơ bản; Gỡ lỗi chỉ khi server trả debug).
- Kịch bản: khi quản trị mở lượt chạy và bấm một bước thì thấy ngăn "Nhật ký bước n" có tab Cơ bản [test: e2e/K1/admin/cr121-run.k1.ts » mở lượt chạy]
- Kịch bản: khi chọn mức theo vai thì tab Gỡ lỗi chỉ hiện khi dữ liệu có mức debug [test: apps/admin-web/src/features/processes/lib/run-detail-view.test.ts » tab Gỡ lỗi chỉ khi level=debug]

## Yêu cầu: Thao tác lượt chạy có lý do (nguồn: cr121-r3-run-ui)
Dừng / Chạy lại bước / Chạy lại cả lượt qua thẻ xác nhận nói hậu quả, bắt buộc chọn lý do (Gửi nhầm, Cần sửa nội dung, Dữ liệu sai, Khác); nút hiện theo trạng thái và vai; lượt gắn gói trả 409 `pack_bound` thì ẩn nút và giải thích.
- Kịch bản: khi lượt đang chạy thì quản trị thấy Dừng, không thấy Chạy lại [test: apps/admin-web/src/features/processes/lib/run-detail-view.test.ts » runControls]
- Kịch bản: khi dừng lượt phải chọn lý do rồi mới xác nhận được [test: e2e/K1/admin/cr121-run.k1.ts » dừng lượt]
- Kịch bản: khi bước lỗi/xong thì chỉ platform_admin thấy Chạy lại bước [test: apps/admin-web/src/features/processes/lib/run-detail-view.test.ts » canRerunStepUi]

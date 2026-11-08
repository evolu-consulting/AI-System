# quy trinh con

Cập nhật: 2026-11-08 · Nguồn: CR-125.

## CR-125 · Delta gộp 2026-11-08 (đợt cr125-docs-sync)

#### Yêu cầu: Bước "Quy trình con" (nguồn: cr125-subprocess-ui)
Trình sửa quy trình có bước "Quy trình con": chạy một quy trình khác của công ty rồi quay lại; chọn quy trình đã xuất bản hoặc đang bật, thấy nó cần và trả gì, nối đầu vào từ các bước trước; trên sơ đồ hiện tên quy trình con, huy hiệu, ba cổng Xong / Từ chối / Huỷ và liên kết mở nó.
- Kịch bản: khi chọn quy trình con thì panel hiện nhãn trạng thái và đầu vào/kết quả của nó [test: apps/admin-web/src/features/processes/lib/subprocess-form.test.ts » cần gì / trả gì]
- Kịch bản: khi lưu stage subprocess thì executor mang def_key + input_map đi về nguyên vẹn [test: apps/admin-web/src/features/processes/lib/subprocess-form.test.ts » executor ⇄ bản nháp]
- Kịch bản: khi một bước là quy trình con thì ô canvas có ba đầu ra Xong / Từ chối / Huỷ [test: apps/admin-web/src/features/processes/lib/subprocess-form.test.ts » panel + canvas + lỗi]
- Kịch bản: quản trị công ty thêm Quy trình con, chọn "Mua hàng · Phần 2", lưu, canvas hiện ô và liên kết mở [test: thủ công — e2e `cr125-subprocess-ui.spec.ts` chờ lát engine gộp rồi chạy trên evotest]


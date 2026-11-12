# duyet cung luc giao dien

> **CR-127 (2026-11-11) — phần Thư viện/khe/sao chép/mẫu/máy duyệt cũ trong file này ĐÃ THAY THẾ:** xem [engine/quy-trinh-cr127.md](../engine/quy-trinh-cr127.md). Giữ làm lịch sử; chỗ mâu thuẫn thì file CR-127 thắng.

Cập nhật: 2026-11-08 · Nguồn: CR-125.

## CR-125 · Delta gộp 2026-11-08 (đợt cr125-docs-sync)

#### Yêu cầu: Cấu hình «Duyệt cùng lúc nhiều nhóm» ở trình sửa quy trình (nguồn: cr125-parallel-approval-ui)
Bước Duyệt có công tắc «Duyệt cùng lúc nhiều nhóm»: chọn 2–5 nhóm (mỗi nhóm một tên hiện trên thẻ) và luật Tất cả / Một trong số / Ít nhất N; sơ đồ nói «Cùng duyệt: A + B · luật»; lưu sai (ít hơn 2 nhóm, N vượt số nhóm, trùng nhóm) báo câu có cách sửa ngay cạnh ô.
- Kịch bản: khi bật Cùng duyệt thì nháp đi về `after.parallel` nguyên vẹn (nhóm, nhãn, luật) [test: apps/admin-web/src/features/processes/lib/parallel-form.test.ts » nháp ⇄ after.parallel]
- Kịch bản: khi một nhóm, N vượt số nhóm hoặc trùng nhóm thì báo mã lỗi ngay tại ô [test: apps/admin-web/src/features/processes/lib/parallel-form.test.ts » lỗi hiện ngay]
- Kịch bản: khi bật Cùng duyệt thì sơ đồ hiện «Cùng duyệt: A + B · Tất cả» [test: apps/admin-web/src/features/processes/lib/parallel-form.test.ts » tóm tắt trên canvas]


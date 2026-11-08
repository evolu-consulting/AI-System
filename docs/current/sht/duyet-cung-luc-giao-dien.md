# duyet cung luc giao dien

Cập nhật: 2026-11-08 · Nguồn: CR-125.

## CR-125 · Delta gộp 2026-11-08 (đợt cr125-docs-sync)

#### Yêu cầu: Cấu hình «Duyệt cùng lúc nhiều nhóm» ở trình sửa quy trình (nguồn: cr125-parallel-approval-ui)
Bước Duyệt có công tắc «Duyệt cùng lúc nhiều nhóm»: chọn 2–5 nhóm (mỗi nhóm một tên hiện trên thẻ) và luật Tất cả / Một trong số / Ít nhất N; sơ đồ nói «Cùng duyệt: A + B · luật»; lưu sai (ít hơn 2 nhóm, N vượt số nhóm, trùng nhóm) báo câu có cách sửa ngay cạnh ô.
- Kịch bản: khi bật Cùng duyệt thì nháp đi về `after.parallel` nguyên vẹn (nhóm, nhãn, luật) [test: apps/admin-web/src/features/processes/lib/parallel-form.test.ts » nháp ⇄ after.parallel]
- Kịch bản: khi một nhóm, N vượt số nhóm hoặc trùng nhóm thì báo mã lỗi ngay tại ô [test: apps/admin-web/src/features/processes/lib/parallel-form.test.ts » lỗi hiện ngay]
- Kịch bản: khi bật Cùng duyệt thì sơ đồ hiện «Cùng duyệt: A + B · Tất cả» [test: apps/admin-web/src/features/processes/lib/parallel-form.test.ts » tóm tắt trên canvas]
- Kịch bản: quản trị công ty đặt Tất cả cho 2 nhóm, cả hai lần lượt duyệt thì bước qua [test: e2e/journey-approval/cr125-parallel-approval-ui.spec.ts » quản trị công ty bật Cùng duyệt]
- Kịch bản: khi một nhóm Từ chối thì thẻ nhóm kia đóng và nói lý do [test: e2e/journey-approval/cr125-parallel-approval-ui.spec.ts » một nhóm Từ chối]


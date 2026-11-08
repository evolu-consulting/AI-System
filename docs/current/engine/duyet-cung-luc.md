# duyet cung luc

Cập nhật: 2026-11-08 · Nguồn: CR-125.

## CR-125 · Delta gộp 2026-11-08 (đợt cr125-docs-sync)

#### Yêu cầu: Duyệt cùng lúc nhiều nhóm («A + B cùng duyệt») (nguồn: cr125-parallel-approval-engine)
Bước Duyệt có `after.parallel` mở thẻ duyệt cho mọi nhóm cùng lúc; bước Đạt khi đủ luật (`all` / `any` / `{min:n}`); Từ chối hoặc Trả lại của bất kỳ nhóm nào thắng ngay và đóng thẻ còn lại kèm lý do; hai người quyết cùng lúc chỉ chuyển bước một lần.
- Kịch bản: khi lượt tới bước cùng duyệt thì mỗi nhóm thấy đúng thẻ của mình ở thẻ HĐ và «Chờ tôi duyệt» [test: apps/hub-api/src/modules/processes/gates/parallel-approve.int.test.ts » mở thẻ cho mọi nhóm cùng lúc — mỗi nhóm thấy và quyết được thẻ CỦA MÌNH (thẻ HĐ + Chờ tôi duyệt)]
- Kịch bản: khi luật `all` và A Đạt thì bước còn chờ B; B Đạt thì bước Đạt [test: apps/hub-api/src/modules/processes/gates/parallel-approve.int.test.ts » all: A Đạt ⇒ bước còn chờ B (A không còn quyết) — B Đạt ⇒ bước Đạt, lượt xong]
- Kịch bản: khi A Đạt rồi B Từ chối thì bước Từ chối [test: apps/hub-api/src/modules/processes/gates/parallel-approve.int.test.ts » all: A Đạt, B Từ chối ⇒ bước Từ chối (lượt huỷ), không chạy Kết thúc · Đã duyệt]
- Kịch bản: khi luật `any` và một nhóm Đạt thì bước Đạt, thẻ nhóm kia đóng [test: apps/hub-api/src/modules/processes/gates/parallel-approve.int.test.ts » any: một nhóm Đạt ⇒ bước Đạt ngay — thẻ nhóm kia đóng với lý do]
- Kịch bản: khi luật `{min:2}` của 3 nhóm thì cần 2 phiếu Đạt [test: apps/hub-api/src/modules/processes/gates/parallel-approve.int.test.ts » min 2/3: A Đạt ⇒ chờ — B Đạt ⇒ Đạt — thẻ C đóng]
- Kịch bản: khi một nhóm Từ chối thì thẻ còn mở đóng «Đã có người từ chối/trả lại» [test: apps/hub-api/src/modules/processes/gates/parallel-approve.int.test.ts » min 2/3: A Đạt, B Từ chối ⇒ Từ chối ngay — thẻ C đóng «Đã có người từ chối/trả lại»]
- Kịch bản: khi một nhóm Trả lại thì lượt tới bước Trả lại [test: apps/hub-api/src/modules/processes/gates/parallel-approve.int.test.ts » Trả lại (một nhóm) ⇒ tới bước Trả lại — thẻ nhóm kia đóng với lý do]
- Kịch bản: khi hai người quyết cùng lúc thì bước chuyển một lần [test: apps/hub-api/src/modules/processes/gates/parallel-approve.int.test.ts » hai người quyết CÙNG LÚC (any) ⇒ một người thắng, bước chuyển MỘT lần]
- Kịch bản: khi lưu quy trình có cùng duyệt sai (< 2 nhóm, `min` vượt số nhóm, trùng nhóm) thì báo mã lỗi có đường dẫn [test: apps/hub-api/src/modules/processes/gates/parallel-approve.test.ts » parallelStageIssues: < 2 nhóm ⇒ MIN2 — min > số nhóm / trùng nhóm / không phải Duyệt ⇒ RULE_INVALID]
- Kịch bản: khi mẫu Thư viện có cùng duyệt thì mỗi mã nhóm là nhóm cần có và được gắn id khi gán/sao chép [test: apps/hub-api/src/modules/processes/gates/parallel-approve.test.ts » mã nhóm của `parallel`: cần có (mẫu) và gắn id khi mở lượt / sao chép]


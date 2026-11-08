# flow templates

Cập nhật: 2026-11-08 · Nguồn: cr122-b-clean-templates. Mục "Việc còn lại" nằm ở `docs/specs/<lát>/tasks.md`.

#### Yêu cầu: Thư viện có sẵn 3 flow mẫu duyệt hợp đồng
Thư viện có ba flow mẫu theo sự kiện gửi duyệt hợp đồng, đã xuất bản, duyệt theo mã Group, từ chối thì kết thúc là Từ chối.
- Kịch bản: khi chạy seed thì có đủ ba flow mẫu đã xuất bản bản 1 và đọc lại vẫn hợp lệ [test: apps/hub-api/src/modules/processes/library/flow-templates.seed.int.test.ts » tạo 3 flow mẫu đã xuất bản (bản 1), có trigger + app, không khe, đọc lại vẫn hợp lệ]
- Kịch bản: khi chạy seed lần hai thì không nhân bản và không đè bản đã sửa [test: apps/hub-api/src/modules/processes/library/flow-templates.seed.int.test.ts » chạy lại không nhân bản (3 def, mỗi def 1 release) và không đè bản đã đổi]
- Kịch bản: khi kiểm từng mẫu thì qua luật FlowDef với sự kiện của hợp đồng [test: apps/hub-api/src/modules/processes/library/flow-templates.def.test.ts » flowDefIssues với sự kiện của manifest contracts = 0 (outcome, điều kiện đúng dữ kiện + kiểu)]

## CR-125 · Delta gộp 2026-11-08 (đợt cr125-docs-sync)

#### Yêu cầu: Thư viện có sẵn 3 mẫu «Quy trình mua hàng» (Phần 1 Đề xuất → Đặt hàng, Phần 2 Hợp đồng, Phần 3 Nhận hàng → Thanh toán) (nguồn: cr125-purchase-templates)
Seed ghi 3 mẫu đã xuất bản v1 (sự kiện «Gửi duyệt hợp đồng», app Sổ Hợp Tác), đủ 11 dòng của quy trình mua hàng, mỗi mẫu dưới trần bước; người duyệt/người làm theo MÃ nhóm; Phần 1 có «Trả lại» từ bước Giám đốc duyệt ngân sách về bước lập bảng so sánh giá.
- Kịch bản: khi nạp 3 mẫu mua hàng thì mỗi mẫu là FlowDef hợp lệ, đủ dòng 1–11, Phần 1 Trả lại về bước so sánh giá [test: apps/hub-api/src/modules/processes/library/purchase-templates.test.ts » 3 mẫu, mỗi mẫu là FlowDef hợp lệ (parse + sự kiện của app)]
- Kịch bản: khi seed chạy trên công ty fixture (evolu, demo) thì 3 mẫu có trong Thư viện và `templateReadiness` ready, mọi nhóm của mẫu có thành viên [test: tools/scripts/src/seed-cr125-config.int.test.ts » 3 mẫu «Quy trình mua hàng» có trong Thư viện và templateReadiness ready cho công ty demo + evolu (đủ nhóm, có thành viên)]
- Kịch bản: khi công ty sao chép 3 mẫu rồi mỗi vai đăng nhập tải phiếu / duyệt / trả lại / ký thì cả 3 Phần chạy tới «done» [test: thủ công — `UAT_PORT_BASE=3800 bun --env-file=.env.local tools/demo/purchase-templates.ts run`, ảnh docs/specs/cr125-purchase-templates/shots/ (bước form gửi bằng API, xem Việc còn lại 1)]


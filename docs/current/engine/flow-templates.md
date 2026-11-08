# flow templates

Cập nhật: 2026-11-08 · Nguồn: cr122-b-clean-templates. Mục "Việc còn lại" nằm ở `docs/specs/<lát>/tasks.md`.

#### Yêu cầu: Thư viện có sẵn 3 flow mẫu duyệt hợp đồng
Thư viện có ba flow mẫu theo sự kiện gửi duyệt hợp đồng, đã xuất bản, duyệt theo mã Group, từ chối thì kết thúc là Từ chối.
- Kịch bản: khi chạy seed thì có đủ ba flow mẫu đã xuất bản bản 1 và đọc lại vẫn hợp lệ [test: apps/hub-api/src/modules/processes/library/flow-templates.seed.int.test.ts » tạo 3 flow mẫu đã xuất bản (bản 1), có trigger + app, không khe, đọc lại vẫn hợp lệ]
- Kịch bản: khi chạy seed lần hai thì không nhân bản và không đè bản đã sửa [test: apps/hub-api/src/modules/processes/library/flow-templates.seed.int.test.ts » chạy lại không nhân bản (3 def, mỗi def 1 release) và không đè bản đã đổi]
- Kịch bản: khi kiểm từng mẫu thì qua luật FlowDef với sự kiện của hợp đồng [test: apps/hub-api/src/modules/processes/library/flow-templates.def.test.ts » flowDefIssues với sự kiện của manifest contracts = 0 (outcome, điều kiện đúng dữ kiện + kiểu)]

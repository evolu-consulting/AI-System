# flow def save

Cập nhật: 2026-11-08 · Nguồn: cr122-e1-trigger. Mục "Việc còn lại" nằm ở `docs/specs/<lát>/tasks.md`.

#### Yêu cầu: Lưu và đọc def có Bắt đầu khi (FLOW2-FR-01/02/15)
`POST/PUT /process-defs` nhận `trigger` + `app` ở gốc body (như admin-web gửi), lưu `process_defs.trigger`/`app`; GET trả lại (chỉ khi có). Stage giữ `outcome` + `next_step`. Có `trigger` ⇒ kiểm `parseFlowDef` + `flowDefIssues` theo sự kiện của app; sai ⇒ 422 `PROCESS_DEF_INVALID` + `paths`. PUT không gửi `trigger`/`app` ⇒ giữ nguyên; `null` ⇒ xoá.
- Kịch bản: khi tạo def có trigger thì đọc lại đủ trigger, app, outcome, next_step [test: apps/hub-api/src/modules/processes/defs/defs-flow.int.test.ts » POST + GET: trigger/app/outcome/next_step lưu và đọc lại, trigger_event sinh]
- Kịch bản: khi kết quả không thuộc sự kiện thì 422, sửa không gửi trigger thì giữ [test: apps/hub-api/src/modules/processes/defs/defs-flow.int.test.ts » PUT sai luật FlowDef ⇒ 422 + paths, không ghi, PUT không gửi trigger ⇒ giữ nguyên]

## CR-125 · Delta gộp 2026-11-08 (đợt cr125-docs-sync)

#### Yêu cầu: Quản trị nền tảng sửa mẫu Thư viện chọn nhóm duyệt theo mã và lưu được node Ký số (nguồn: cr125-purchase-templates)
Ở trình sửa của mẫu Thư viện (không có công ty), ô «Ai duyệt» / «Phòng ban duyệt» liệt kê nhóm theo mã (một mã một dòng, bỏ nhóm kỹ thuật) và lưu `after.group_key` (`group_id` rỗng); mở lại thấy đúng mã. Máy khách không kiểm «tool bật cho công ty» với mẫu Thư viện.
- Kịch bản: khi nháp có `groupKey` thì lưu ra `after.group_key` + `group_id: null` và nạp lại giữ mã; flow công ty vẫn lưu `group_id` [test: apps/admin-web/src/features/processes/lib/stage-convert.group-key.test.ts » đặt groupKey ⇒ after.group_key và group_id null, nạp lại giữ mã]
- Kịch bản: khi quản trị nền tảng dựng Phần 2 bằng canvas có node Ký số thì Lưu được (không 422/«tính năng chưa bật cho công ty») [test: thủ công — `purchase-templates.ts build` (REBUILD=1)]


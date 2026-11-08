# flow def save

Cập nhật: 2026-11-08 · Nguồn: cr122-e1-trigger. Mục "Việc còn lại" nằm ở `docs/specs/<lát>/tasks.md`.

#### Yêu cầu: Lưu và đọc def có Bắt đầu khi (FLOW2-FR-01/02/15)
`POST/PUT /process-defs` nhận `trigger` + `app` ở gốc body (như admin-web gửi), lưu `process_defs.trigger`/`app`; GET trả lại (chỉ khi có). Stage giữ `outcome` + `next_step`. Có `trigger` ⇒ kiểm `parseFlowDef` + `flowDefIssues` theo sự kiện của app; sai ⇒ 422 `PROCESS_DEF_INVALID` + `paths`. PUT không gửi `trigger`/`app` ⇒ giữ nguyên; `null` ⇒ xoá.
- Kịch bản: khi tạo def có trigger thì đọc lại đủ trigger, app, outcome, next_step [test: apps/hub-api/src/modules/processes/defs/defs-flow.int.test.ts » POST + GET: trigger/app/outcome/next_step lưu và đọc lại, trigger_event sinh]
- Kịch bản: khi kết quả không thuộc sự kiện thì 422, sửa không gửi trigger thì giữ [test: apps/hub-api/src/modules/processes/defs/defs-flow.int.test.ts » PUT sai luật FlowDef ⇒ 422 + paths, không ghi, PUT không gửi trigger ⇒ giữ nguyên]

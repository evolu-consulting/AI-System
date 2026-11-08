# flow triggers

Cập nhật: 2026-11-08 · Nguồn: cr122-e1-trigger. Mục "Việc còn lại" nằm ở `docs/specs/<lát>/tasks.md`.

#### Yêu cầu: Sự kiện app mở lượt cho flow đang bật khớp (FLOW2-FR-03/19/20)
App ghi sự kiện vào `hub.flow_events` (trùng `(tenant, event_id)` bỏ qua). Bộ điều phối nhận lô `FOR UPDATE SKIP LOCKED`, chọn flow đang bật của công ty có `trigger_event` = sự kiện và điều kiện khớp dữ kiện; sự kiện `decides` chỉ flow đầu theo `position`, flow khác ghi lý do; cờ `FLOW_TRIGGERS` tắt ⇒ chỉ ghi "lẽ ra chạy". Lỗi tạm thử lại có lùi tối đa 5 lần.
- Kịch bản: khi ghi cùng sự kiện hai lần thì chỉ một dòng [test: apps/hub-api/src/modules/processes/triggers/dispatcher.int.test.ts » ghi sự kiện hai lần cùng (tenant, event_id) ⇒ một dòng]
- Kịch bản: khi sự kiện decides khớp nhiều flow thì chỉ flow đầu chạy [test: apps/hub-api/src/modules/processes/triggers/dispatcher.int.test.ts » decides: chỉ flow khớp đầu theo position chạy, flow tắt không xét, điều kiện không khớp ghi lý do]
- Kịch bản: khi hai Hub chạy cùng lúc thì mỗi sự kiện × flow một lần [test: apps/hub-api/src/modules/processes/triggers/dispatcher.int.test.ts » hai Hub chạy đồng thời ⇒ mỗi sự kiện × flow đúng một lần]
- Kịch bản: khi cờ tắt thì không mở lượt, ghi would_run [test: apps/hub-api/src/modules/processes/triggers/dispatcher.int.test.ts » cờ FLOW_TRIGGERS tắt (Y) ⇒ bóng: không mở lượt, ghi would_run]
- Kịch bản: khi công ty khác đọc thì không thấy dữ liệu 3 bảng mới [test: apps/hub-api/src/modules/processes/triggers/dispatcher.int.test.ts » scope user công ty Y không thấy flow_events / company_flows / tenant_flow_settings của X]
- Kịch bản: khi điều kiện lồng AND/OR trên dữ kiện thì khớp đúng [test: apps/hub-api/src/modules/processes/triggers/match.rules.test.ts » OR ngoài, AND lồng một cấp, kiểu lệch (chuỗi so số) ⇒ không khớp]

## CR-125 · Delta gộp 2026-11-08 (đợt cr125-docs-sync)

#### Yêu cầu: Bắt đầu quy trình bằng phiếu yêu cầu (nguồn: cr125-manual-start-engine)
Flow công ty có stage đầu `core.start-form` bắt đầu được bằng tay qua `POST /processes/start` (khoá flow + giá trị phiếu + `request_id`),
mở lượt qua cùng đường với sự kiện (gating `company_flows` + cờ `FLOW_TRIGGERS`); giá trị phiếu là input của lượt. `GET /processes/startable`
liệt kê flow người xem được bắt đầu kèm phiếu. Chỉ công ty của người gọi.
- Kịch bản: khi người thuộc nhóm được phép gửi phiếu hợp lệ thì mở đúng một lượt, input của lượt là giá trị phiếu + tên yêu cầu; gửi lại cùng request_id thì trả cùng lượt [test: apps/hub-api/src/modules/processes/triggers/manual-start.int.test.ts » người trong nhóm thấy flow + phiếu, bắt đầu ⇒ một lượt với input là giá trị phiếu, gửi trùng ⇒ cùng lượt]
- Kịch bản: khi người không thuộc nhóm được phép bắt đầu thì 403 START_NOT_ALLOWED và flow không có trong danh sách [test: apps/hub-api/src/modules/processes/triggers/manual-start.int.test.ts » người không trong nhóm ⇒ 403 START_NOT_ALLOWED, không thấy trong danh sách]
- Kịch bản: khi phiếu sai (thiếu ô bắt buộc, sai kiểu, ô lạ) thì 422 START_FORM_INVALID kèm lỗi theo ô và không ghi gì [test: apps/hub-api/src/modules/processes/triggers/manual-start.int.test.ts » phiếu sai ⇒ 422 START_FORM_INVALID kèm lỗi theo ô, không mở lượt]
- Kịch bản: khi người của công ty khác gọi thì không thấy và không bắt đầu được flow [test: apps/hub-api/src/modules/processes/triggers/manual-start.int.test.ts » công ty khác không thấy, không bắt đầu được flow của X]
- Kịch bản: khi hai người, hoặc một người trên hai flow, gửi cùng request_id thì mỗi yêu cầu có lượt riêng, chỉ cùng người cùng flow gửi lại mới trả lượt cũ [test: apps/hub-api/src/modules/processes/triggers/manual-start.int.test.ts » cùng request_id — người khác ⇒ lượt riêng, cùng người flow khác ⇒ lượt riêng, cùng người cùng flow ⇒ cùng lượt]
- Kịch bản: khi mã ô phiếu trùng dữ liệu hệ thống (request_title, record, ref, event, contract_id — supplier_id vẫn được) thì cấu hình bị từ chối với START_FIELD_RESERVED [test: packages/contracts/src/modules/core/start-form/config.test.ts » mã ô trùng dữ liệu hệ thống ⇒ START_FIELD_RESERVED]
- Kịch bản: khi cờ quy trình của công ty tắt thì 409 START_FLOW_OFF và danh sách rỗng [test: apps/hub-api/src/modules/processes/triggers/manual-start.int.test.ts » cờ quy trình của công ty tắt ⇒ 409 START_FLOW_OFF, danh sách rỗng]


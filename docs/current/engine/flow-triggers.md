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

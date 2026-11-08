# flow events emit

Cập nhật: 2026-11-08 · Nguồn: cr122-e1b-company-flows. Mục "Việc còn lại" nằm ở `docs/specs/<lát>/tasks.md`.

#### Yêu cầu: App ghi sự kiện cùng tx, flow Thư viện chạy thẳng (FLOW2-FR-19/20)
Role gói ghi sự kiện qua `hub.emit_flow_event` chỉ cho tenant hiện tại. Flow Thư viện được gán mở lượt từ bản xuất bản mới nhất; một sự kiện × flow chỉ một lượt kể cả khi gửi lại hoặc xử lý lại. Sự kiện hết lượt thử bị kẹt được chốt `lease_exhausted`.
- Kịch bản: khi role gói ghi cho tenant khác thì bị chặn [test: apps/hub-api/src/modules/processes/triggers/emit-flow-event.int.test.ts » ghi cho tenant khác / chưa đặt tenant ⇒ 42501, không đọc thẳng được bảng]
- Kịch bản: khi một sự kiện tới thì engine thật mở đúng một lượt [test: apps/hub-api/src/modules/processes/triggers/launch-real.int.test.ts » flow Thư viện được gán: một sự kiện ⇒ một lượt (snapshot bản xuất bản), gửi lại / mở lại ⇒ vẫn một]
- Kịch bản: khi sự kiện hết lượt thử mà kẹt thì chốt lỗi [test: apps/hub-api/src/modules/processes/triggers/launch-real.int.test.ts » soát E1 #1: attempts = 5, lease đã qua, chưa xong ⇒ chốt lease_exhausted]

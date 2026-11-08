# su kien flow

Cập nhật: 2026-11-08 · Nguồn: cr122-a2-community. Mục "Việc còn lại" nằm ở `docs/specs/<lát>/tasks.md`.

#### Yêu cầu: Community bắn sự kiện flow cùng giao dịch khi cờ FLOW_TRIGGERS bật
Khi công ty bật FLOW_TRIGGERS, đăng bài, gửi đơn xin tham gia và tạo báo cáo ghi sự kiện `post.created`, `partner.join_requested`,
`report.created` (khoá `<sự kiện>:<id bản ghi>`) trong cùng giao dịch ghi bản ghi; cờ tắt thì giữ đường khe cũ và không ghi sự kiện.
- Kịch bản: cờ tắt, đăng bài ⇒ không có sự kiện, agent sàng lọc vẫn chạy [test: apps/hub-api/src/modules/packs/community/adapters/community.flow-events.int.test.ts » cờ tắt ⇒ giữ đường khe cũ: không ghi sự kiện, agent screen vẫn chạy]
- Kịch bản: cờ bật, đăng bài ⇒ một sự kiện `post.created` đúng dữ kiện [test: apps/hub-api/src/modules/packs/community/adapters/community.flow-events.int.test.ts » cờ bật: bài ⇒ post.created cùng tx, Hiện/Ẩn idempotent]

#### Yêu cầu: Kết quả Kết thúc của flow đổi trạng thái bài, đơn xin tham gia, báo cáo (idempotent)
Hiện/Ẩn bài, Nhận/Từ chối đơn, Ẩn/Giữ/Cảnh báo báo cáo áp trong giao dịch của engine; gọi lại không đổi gì và không ghi đè quyết định đã có.
- Kịch bản: Nhận đơn ⇒ tạo liên kết công ty đối tác, gọi lại ⇒ không đổi [test: apps/hub-api/src/modules/packs/community/adapters/community.flow-events.int.test.ts » cờ bật: đơn xin tham gia ⇒ partner.join_requested, Nhận idempotent]
- Kịch bản: Ẩn báo cáo ⇒ báo cáo đã xử lý và bài bị ẩn [test: apps/hub-api/src/modules/packs/community/adapters/community.flow-events.int.test.ts » cờ bật: báo cáo ⇒ report.created, Ẩn idempotent]
- Kịch bản: tenant khác không đọc dữ kiện hay đổi trạng thái [test: apps/hub-api/src/modules/packs/community/adapters/community.flow-events.int.test.ts » chặn chéo tenant: tenant khác không đọc dữ kiện, không đổi trạng thái bản ghi của tenant A]

# audit-trail2 — «Ai làm gì trên bước duyệt HĐ đều có record» (tiếp audit-trail)

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED sht/duyet-ky-so.md
#### Yêu cầu: Duyệt thay và uỷ quyền ghi rõ trên mọi đường quyết
Toàn quyền quyết qua «Việc của tôi»/chuông (đường chung) ⇒ engine báo cờ duyệt thay, gói ghi cùng bản ghi `approval_override` như thẻ ⇒ Hồ sơ duyệt hiện «duyệt thay người được giao». Quyết bằng uỷ quyền ⇒ dòng quyết định lưu người uỷ quyền ⇒ Hồ sơ (JSON, PDF, web) hiện «thay <người uỷ quyền>» cả khi không kèm bằng chứng.
- Kịch bản: khi người chỉ có quyền nhờ Group «cũng quyết» quyết qua đường chung thì sự kiện mang cờ duyệt thay [test: apps/hub-api/src/modules/processes/gates/claim-events.int.test.ts » X chỉ có quyền nhờ Group «cũng quyết»]
- Kịch bản: khi gói nhận quyết duyệt thay hoặc uỷ quyền thì hồ sơ có cờ duyệt thay và người uỷ quyền [test: apps/hub-api/src/modules/packs/contracts/adapters/task-events.int.test.ts » đường chung: Toàn quyền ⇒ override]

#### Yêu cầu: Nhận việc, trả việc, giao lại, tự trả, chuyển cấp có dòng lịch sử HĐ
Mỗi việc trên bước duyệt của HĐ (nhận việc, trả về nhóm, giao cho người khác, tự trả khi quá giờ giữ việc, tự chuyển cấp khi quá hạn) ⇒ một dòng «Lịch sử» HĐ (`task_handled`: ai — hoặc hệ thống, lúc nào, bước, người/nhóm nhận, lý do). Ghi sau khi việc đã lưu, theo lô (một câu mỗi công ty), không trùng khi gửi lại (khoá task × loại × lúc). Không vào Hồ sơ duyệt PDF (chỉ quyết định).
- Kịch bản: khi người được giao nhận việc rồi trả về nhóm thì engine báo hai việc đúng bước [test: apps/hub-api/src/modules/processes/gates/claim-events.int.test.ts » A nhận việc rồi trả về nhóm]
- Kịch bản: khi task của công ty khác được gửi kèm thì không báo [test: apps/hub-api/src/modules/processes/gates/claim-events.int.test.ts » chéo tenant]
- Kịch bản: khi gói nhận đủ năm loại việc hai lần thì HĐ có đúng năm dòng [test: apps/hub-api/src/modules/packs/contracts/adapters/task-events.int.test.ts » nhận / trả / giao lại / tự trả / chuyển cấp]
- Kịch bản: khi run của công ty khác được báo thì HĐ không có dòng nào [test: apps/hub-api/src/modules/packs/contracts/adapters/task-events.int.test.ts » chéo tenant]

## Quyết định trong lúc làm
- Không migration: loại sự kiện mới `task_handled` hợp `contract_events_type_ck`; idempotent bằng `data.key` + `not exists` (lọc theo HĐ).
- Hub báo gói qua cầu `packRuns.onTaskEvents[packKey]` (cùng khuôn `onDecided`); tra run + khoá bước một câu cho cả lô (`runs/pack-task-events.ts`).
- Cờ duyệt thay tính ở hub (`decidesByOverride`, cùng ý `overrideOnly` của thẻ); người uỷ quyền đọc một câu `delegatorOf` (cùng luật `recordTaskEvidence`).

## Việc còn lại
- Việc trên task ghi SAU COMMIT, lỗi chỉ cảnh báo — chưa có đường bù (hub không lưu lịch sử nhận/trả; chuyển cấp có `hub.audit_log`). Cần bảng/sự kiện bền ở hub nếu bắt buộc không thiếu.
- Ghi bù quyết định (`DECIDED_TASKS`) chưa mang cờ duyệt thay / người uỷ quyền khi không có bằng chứng.
- Dòng «Lịch sử» HĐ chưa hiện tên người/nhóm nhận (`to`) — chỉ nhãn loại việc.
- Index 0088 «Cần: tất cả» (một dòng/ task) — để sau.
- Chưa chạy e2e hành trình.

# Admin · Dòng việc phản ánh quy trình đang dùng theo luật của công ty

Cập nhật: 2026-11-09 · Gộp từ: cr121-f1-flows-state (đợt cr125-wave).

## Yêu cầu: Dòng việc phản ánh quy trình đang dùng theo luật của công ty (nguồn: cr121-f1-flows-state)
Dòng việc và tóm tắt đọc từ luật định tuyến của công ty; công ty chưa có luật thì hiện rõ "Đang dùng mặc định hệ thống" và không tính là đã có quy trình; gán xong thì dòng việc và tóm tắt đổi ngay; công tắc Sơ đồ/Danh sách luôn có trong ngăn việc.
- Kịch bản: công ty chưa có luật mặc định ⇒ nguồn là mặc định hệ thống, không tính vào tóm tắt [test: apps/admin-web/src/features/tenants/flows/lib/flow-rows.test.ts » CR-121 f1 · nguồn quy trình đang dùng (luật công ty thắng mặc định hệ thống)]
- Kịch bản: sau khi gán, dòng việc đổi sang bản vừa gán và tóm tắt tăng [test: apps/admin-web/src/features/tenants/flows/lib/flow-rows.test.ts » CR-121 f1 · nguồn quy trình đang dùng (luật công ty thắng mặc định hệ thống)]

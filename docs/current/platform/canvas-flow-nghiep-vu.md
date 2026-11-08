# canvas flow nghiep vu

Cập nhật: 2026-11-08 · Nguồn: cr122-u2d-ui-polish. Mục "Việc còn lại" nằm ở `docs/specs/<lát>/tasks.md`.

#### Yêu cầu: Node flow nói ngôn ngữ nghiệp vụ, gợi ý cầu nối ngay trên canvas (FLOW2-FR-26)
Node trên canvas hiện tên bước, loại node và một dòng tóm tắt (không tên kỹ thuật); cạnh thiếu dữ liệu có ô gợi ý cầu nối ngay tại cạnh với xem trước và Nhận/Bỏ.
- Kịch bản: khi Ghi giá trị có nguồn dữ kiện thì node hiện `trường ← nhãn dữ kiện` [test: apps/admin-web/src/features/processes/lib/node-summary.test.ts » Ghi giá trị: một dòng `trường ← nguồn` kèm số dòng còn lại]
- Kịch bản: khi node là Nếu thì node hiện điều kiện đầu theo dữ kiện [test: apps/admin-web/src/features/processes/lib/node-summary.test.ts » Nếu: điều kiện đầu theo dữ kiện]

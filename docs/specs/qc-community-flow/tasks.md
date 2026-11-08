---
id: qc-community-flow
lát: qc-community-flow
lane: nhanh (qc)
migration: không
---
## Plan
Soát luồng community trên stack local (web 3900, admin 3905, DB ai_system_comm_test) với vai quản trị community (demo-owner, tenant_admin), kèm chạy e2e server.

## Kết quả e2e (server evotest, 2026-11-08)
- `-Filter community-web`: XANH 43 pass (community-web 68s + stack 315s).
- `-Filter community-web-stack`: XANH 7 pass.
- Hành trình đăng bài, chờ duyệt, duyệt, hiện bài đã có ở `e2e/community-web/flows.cs.ts` (xanh) nên (b)(c)(d) không dựng lại.
- MỚI `e2e/community-web/flow-edit.cs.ts` (sửa flow trên canvas + Lưu và áp dụng): ĐỎ có chủ đích vì lỗi B1.

## Lỗi sản phẩm (shots trong `shots/`)
- **B1 (Chặn)** Quản trị community sao chép "Duyệt bài Community", mở, Lưu và áp dụng ⇒ "Chưa lưu được — bước «Agent sàng lọc»: Tính năng này chưa bật cho công ty hoặc không còn." Không có đường nào cho quản trị community tự bật; flow sao chép không áp dụng được ⇒ luồng "sửa flow community trên canvas" chưa chạy. Nghi: CR-125 modules (m6b/m8: bật tính năng theo công ty) + D7 (seed community không bật tính năng cần). `15-save.png`.
- **B2 (Cao)** Bản sao báo "Có bước duyệt chưa chọn nhóm (nhóm theo mã chưa có ở công ty)": công ty community không có nhóm duyệt bài mà flow mẫu cần; ô "Ai duyệt" mặc định "Phòng Kế toán" (từ ngữ hợp đồng). `09-copied.png`, `14-node-panel.png`.
- **B3 (Trung bình)** Menu "Thêm bước" của flow community: Duyệt / Nếu / Thông báo chuông / Gửi email / Kết thúc, chung, không có nút nghiệp vụ community (Hiện bài/Ẩn bài); đầu ra "Kết thúc · Từ chối" thay vì Hiện/Ẩn bài. `11-add-menu.png`.
- **B4 (Trung bình)** Chữ hợp đồng trong màn community: hộp bật "Hợp đồng của công ty này sẽ chạy theo quy trình mới" (`08-switch-on.png`); chân trang editor "Chưa áp dụng ... để hợp đồng gửi từ giờ...", "Hợp đồng chờ quá 7 ngày..." (`10-editor.png`). Panel bước ghi "Chỉnh chi tiết ở 'Nâng cao'" (kỹ thuật).
- **B5 (Thấp)** Platform admin gán xong, công ty vẫn "Đang dùng cách cũ" tới khi quản trị công ty tự bật công tắc (bước ẩn); sau gán, hộp công tắc của platform không cập nhật (chữ "Chưa có quy trình" cũ) và bị khoá. `05-assigned.png`.
- Canvas OK: Ngang/Dọc không chồng node, cạnh không xuyên node (expectAllNodesInPane/expectEdgesClear xanh); kéo "Duyệt" vào canvas thêm 1 node + gợi ý nối. Chưa thử nối mũi tên bằng chuột (kéo cổng chưa ổn định theo ghi chú cr123-palette-drop).

## Delta (so với docs/current)
Không thay đổi hành vi (lý do: lát QC chỉ thêm e2e + ghi lỗi).

## Việc còn lại
- Sửa B1/B2 (vùng community + modules/seed tenant), chạy lại `flow-edit.cs.ts`; mở rộng: nối mũi tên Duyệt, đăng bài, kiểm bài được duyệt theo flow mới.

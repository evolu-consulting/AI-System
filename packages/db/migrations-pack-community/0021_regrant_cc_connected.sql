-- Cấp lại cho `community_rw` hàm hub.cc_connected (CR-161: xem bài Bảng tin của công ty đã kết nối).
-- Vì sao: migration hub chỉ cấp trong khối DO «nếu role đã có»; trên DB dựng sạch (prod 2026-11-16) migration hub chạy TRƯỚC khi
-- bộ khung gói tạo role ⇒ quyền bị bỏ qua. Migration gói chạy sau role ⇒ cấp ở đây, không điều kiện. Chạy lại vô hại.
GRANT USAGE ON SCHEMA hub TO community_rw;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION hub.cc_connected(uuid, uuid) TO community_rw;

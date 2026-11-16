-- CR-178 · «Tin nhắn» API đọc mới: (1) cấp `contracts_rw` chạy hàm hub mới (0153) — migration hub chạy TRƯỚC khi role gói có trên DB dựng sạch ⇒ cấp lại ở đây, không điều kiện
-- (khuôn 0118); (2) chỉ mục tìm tin (thêm ở lát M3). CHỈ THÊM, không đổi dữ liệu. Chạy lại vô hại.
GRANT USAGE ON SCHEMA hub TO contracts_rw;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION
  hub.pmsg_inbox_unread(uuid, timestamptz, uuid, integer)
  TO contracts_rw;

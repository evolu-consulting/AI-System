-- Cấp lại cho `contracts_rw` hai hàm hub mà migration hub chỉ cấp trong khối DO «nếu role đã có»:
--   hub 0143 contract_received_params (Nhận HĐ: ngưỡng/người phụ trách; dùng khi Gửi duyệt + hộp đối tác gửi)
--   hub 0120 partner_email_history   (nhật ký gửi đối tác)
-- Vì sao: trên DB dựng sạch (prod 2026-11-16) migration hub chạy TRƯỚC khi bộ khung gói tạo role ⇒ khối DO bị bỏ qua
-- ⇒ «permission denied for function contract_received_params» khi Gửi duyệt. Khuôn 0116/0118: cấp ở migration gói, không điều kiện. Chạy lại vô hại.
GRANT USAGE ON SCHEMA hub TO contracts_rw;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION
  hub.contract_received_params(uuid),
  hub.partner_email_history(uuid)
  TO contracts_rw;

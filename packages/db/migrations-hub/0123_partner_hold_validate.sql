-- CR-124 · q4 · tách từ 0122: kiểm hàng cũ của partner_mailbox_status_ck (NOT VALID ở 0122) riêng một migration — VALIDATE chỉ giữ SHARE UPDATE EXCLUSIVE,
-- không chặn ghi trong lúc quét (mẫu hub 0115/0116). Chạy lại vô hại.
ALTER TABLE hub.partner_mailbox VALIDATE CONSTRAINT partner_mailbox_status_ck;

-- CR-190 · lát `cr190-msg-directory-api` · hàm hub mới (hub 0167) cho danh bạ nhóm trang Tin nhắn: migration hub chạy TRƯỚC khi role gói có trên DB dựng sạch ⇒ cấp lại ở đây, không điều kiện (khuôn 0126). Chạy lại vô hại.
GRANT USAGE ON SCHEMA hub TO contracts_rw;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION hub.pmsg_dir_heads(uuid, text, uuid[]), hub.pmsg_dir_rows(uuid, text, uuid[], uuid[], integer, numeric, text, uuid, integer) TO contracts_rw;

-- CR-169 · lát 2b · cấp lại quyền cho `contracts_rw` trên hàm «Tin nhắn» 1–1 (hub 0149/0150) + cc_links (hub 0149 DROP+CREATE).
-- Vì sao: hub 0149/0151 cấp cho `contracts_rw` trong khối DO «nếu role đã có». Trên DB dựng sạch migration hub chạy TRƯỚC khi role gói được tạo ⇒ khối DO bị bỏ qua
-- ⇒ route lỗi 42501. Migration gói chạy sau role ⇒ cấp ở đây, không điều kiện (khuôn 0116). Chạy lại vô hại.
-- Hàm nội bộ (pmsg_ctx, pmsg_eligible_raw, pmsg_view, pmsg_msg_json, pmsg_connected) và `pmsg_files_sweep` (việc nền) KHÔNG cấp.
GRANT USAGE ON SCHEMA hub TO contracts_rw;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION
  hub.cc_links(text, timestamptz, uuid, integer),
  hub.pmsg_open(uuid, uuid), hub.pmsg_inbox(uuid, timestamptz, uuid, integer), hub.pmsg_detail(uuid), hub.pmsg_page(uuid, bigint, integer),
  hub.pmsg_send(uuid, uuid, text, uuid[]), hub.pmsg_delete(uuid, bigint), hub.pmsg_mark_read(uuid, bigint), hub.pmsg_unread(),
  hub.pmsg_file_add(uuid, uuid, text, text, text, bigint, text), hub.pmsg_file_get(uuid, uuid),
  hub.pmsg_people(uuid[], text, text, uuid, integer), hub.pmsg_companies(text, uuid, integer)
  TO contracts_rw;

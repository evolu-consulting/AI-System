-- (CR-161 sửa lỗi: chữ ký cc_file_add theo hub 0148 — migration hub luôn chạy trước migration gói; 0117 cấp lại.)
-- CR-161 · lát 5 · cấp lại quyền cho `contracts_rw` trên hàm kết nối/trò chuyện hai công ty (hub 0145/0146 + community 0020).
-- Vì sao: hub 0145/0147 và community 0020 cấp cho `contracts_rw` trong khối DO «nếu role đã có». Trên DB dựng sạch (prod), migration hub chạy TRƯỚC
-- khi role gói được tạo ⇒ khối DO bị bỏ qua ⇒ route kết nối lỗi 42501 «permission denied for function». Migration gói chạy sau role ⇒ cấp ở đây,
-- không điều kiện (khuôn 0085_partner_send.sql). Chạy lại vô hại (GRANT lặp). Hàm nội bộ (cc_ctx, cc_bell, cc_owners_raw…) KHÔNG cấp.
GRANT USAGE ON SCHEMA hub TO contracts_rw;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION
  hub.cc_owner_users(uuid[]), hub.cc_connected(uuid, uuid), hub.cc_search(text),
  hub.cc_invite(uuid, text, uuid, text), hub.cc_disconnect(uuid), hub.cc_links(text, timestamptz, uuid, integer),
  hub.cc_notify(jsonb), hub.partner_link_accept(uuid), hub.partner_link_block(uuid),
  hub.cc_thread_page(uuid, bigint, integer), hub.cc_send(uuid, uuid, text, text, uuid[]),
  hub.cc_mark_read(uuid, bigint), hub.cc_file_add(uuid, uuid, text, text, text, bigint, text),
  hub.cc_file_get(uuid), hub.cc_unread(uuid[])
  TO contracts_rw;
--> statement-breakpoint
-- community 0020 (`community.cc_posts`): chỉ cấp khi schema/hàm đã có (thứ tự áp dụng gói community ↔ contracts không cố định);
-- nếu community chạy SAU thì khối DO của chính 0020 đã cấp (role đã có lúc đó).
DO $$
BEGIN
  IF to_regprocedure('community.cc_posts(uuid, timestamptz, uuid, integer)') IS NOT NULL THEN
    GRANT USAGE ON SCHEMA community TO contracts_rw;
    GRANT EXECUTE ON FUNCTION community.cc_posts(uuid, timestamptz, uuid, integer) TO contracts_rw;
  END IF;
END $$;

-- CR-161 · lát 3 · spec §4 (0147) · GRANT cho hàm trò chuyện công ty (0146) + bảng cho việc nền.
-- Hàm công khai: hub_rw (hub-api, scope user) và, khi có, `contracts_rw` (tạo SAU hub ⇒ khối DO như 0118/0145).
-- Hàm nội bộ (cc_ctx, cc_thread_ensure, cc_msg_json) KHÔNG cấp cho ai: chỉ hàm DEFINER gọi.
-- Bảng: chỉ SELECT cho hub_rw, vẫn bị policy `app.scope='system'` chặn ở scope người dùng (đọc 0 dòng; không INSERT/UPDATE/DELETE). `contracts_rw` không đụng bảng.
-- Dọn tệp chưa gắn tin đi qua hàm DEFINER `hub.cc_files_sweep` (chỉ scope system), không cấp UPDATE trực tiếp.
-- Kind chuông `cc.msg` đã hợp CHECK `notifications_ck` (regex `^[a-z][a-z0-9_.]{1,40}$`) ⇒ không đổi CHECK.

GRANT SELECT ON hub.cc_threads, hub.cc_messages, hub.cc_reads, hub.cc_files TO hub_rw;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION hub.cc_thread_page(uuid, bigint, integer), hub.cc_send(uuid, uuid, text, text, uuid[]),
  hub.cc_mark_read(uuid, bigint), hub.cc_file_add(uuid, uuid, text, text, bigint, text),
  hub.cc_file_get(uuid), hub.cc_unread(uuid[]), hub.cc_files_sweep(interval) TO hub_rw;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'contracts_rw') THEN
    GRANT USAGE ON SCHEMA hub TO contracts_rw;
    GRANT EXECUTE ON FUNCTION hub.cc_thread_page(uuid, bigint, integer), hub.cc_send(uuid, uuid, text, text, uuid[]),
      hub.cc_mark_read(uuid, bigint), hub.cc_file_add(uuid, uuid, text, text, bigint, text),
      hub.cc_file_get(uuid), hub.cc_unread(uuid[]) TO contracts_rw;
  END IF;
END $$;

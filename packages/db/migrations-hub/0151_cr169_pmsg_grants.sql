-- CR-169 · lát 2b · spec §5 (hub 0151) · GRANT cho hàm «Tin nhắn» 1–1 (0149 + 0150) — cấp lại/đối chiếu, chạy lại vô hại.
-- Công khai: hub_rw (hub-api, scope user) và, khi role đã có, `contracts_rw` (tạo SAU hub ⇒ khối DO; DB dựng sạch cấp lại ở pack-contracts 0118). Chỉ hai role (P12):
-- không agent/MCP/role gói khác. `pmsg_files_sweep` (việc nền, scope system) CHỈ cho hub_rw. Hàm nội bộ (pmsg_ctx, pmsg_eligible_raw, pmsg_view, pmsg_msg_json,
-- pmsg_connected) KHÔNG cấp cho ai: chỉ hàm DEFINER khác gọi. Bảng: SELECT cho hub_rw đã cấp ở 0149 (vẫn bị policy `app.scope='system'` chặn ở scope người dùng).
GRANT EXECUTE ON FUNCTION
  hub.pmsg_open(uuid, uuid), hub.pmsg_inbox(uuid, timestamptz, uuid, integer), hub.pmsg_detail(uuid), hub.pmsg_page(uuid, bigint, integer),
  hub.pmsg_send(uuid, uuid, text, uuid[]), hub.pmsg_delete(uuid, bigint), hub.pmsg_mark_read(uuid, bigint), hub.pmsg_unread(),
  hub.pmsg_file_add(uuid, uuid, text, text, text, bigint, text), hub.pmsg_file_get(uuid, uuid), hub.pmsg_files_sweep(interval),
  hub.pmsg_people(uuid[], text, text, uuid, integer), hub.pmsg_companies(text, uuid, integer)
  TO hub_rw;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'contracts_rw') THEN
    GRANT USAGE ON SCHEMA hub TO contracts_rw;
    GRANT EXECUTE ON FUNCTION
      hub.pmsg_open(uuid, uuid), hub.pmsg_inbox(uuid, timestamptz, uuid, integer), hub.pmsg_detail(uuid), hub.pmsg_page(uuid, bigint, integer),
      hub.pmsg_send(uuid, uuid, text, uuid[]), hub.pmsg_delete(uuid, bigint), hub.pmsg_mark_read(uuid, bigint), hub.pmsg_unread(),
      hub.pmsg_file_add(uuid, uuid, text, text, text, bigint, text), hub.pmsg_file_get(uuid, uuid),
      hub.pmsg_people(uuid[], text, text, uuid, integer), hub.pmsg_companies(text, uuid, integer)
      TO contracts_rw;
  END IF;
END $$;

-- CR-178 · GRANT cho hàm đọc «Tin nhắn» mới (0153): hub_rw (hub-api, scope user) và, khi role đã có, `contracts_rw` (DB dựng sạch: cấp lại ở pack-contracts 0120). Chỉ hai role (P12).
-- Chạy lại vô hại. Hàm nội bộ không cấp.
GRANT EXECUTE ON FUNCTION
  hub.pmsg_inbox_unread(uuid, timestamptz, uuid, integer)
  TO hub_rw;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'contracts_rw') THEN
    GRANT USAGE ON SCHEMA hub TO contracts_rw;
    GRANT EXECUTE ON FUNCTION
      hub.pmsg_inbox_unread(uuid, timestamptz, uuid, integer)
      TO contracts_rw;
  END IF;
END $$;

-- CR-178 · «Tin nhắn» API đọc mới: (1) cấp `contracts_rw` chạy hàm hub mới (0153) — migration hub chạy TRƯỚC khi role gói có trên DB dựng sạch ⇒ cấp lại ở đây, không điều kiện
-- (khuôn 0118); (2) chỉ mục tìm tin (thêm ở lát M3). CHỈ THÊM, không đổi dữ liệu. Chạy lại vô hại.
GRANT USAGE ON SCHEMA hub TO contracts_rw;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION
  hub.pmsg_inbox_unread(uuid, timestamptz, uuid, integer), hub.pmsg_files_list(uuid, text, bigint, uuid, integer),
  hub.pmsg_search(text, uuid, timestamptz, uuid, bigint, integer)
  TO contracts_rw;

--> statement-breakpoint
-- `contracts_rw` chạy `hub.fold` khi chèn/sửa tin (chỉ mục bên dưới là biểu thức trên hàm này) — cấp tường minh (hub 0050 chỉ cấp hub_rw).
GRANT EXECUTE ON FUNCTION hub.fold(text) TO contracts_rw;
--> statement-breakpoint
-- M3 · chỉ mục trigram cho tìm tin nội bộ: cùng biểu thức/điều kiện với câu của `searchRepo` (hub.fold(body), tin chưa thu hồi). pg_trgm thiếu ⇒ bỏ qua (chậm hơn, vẫn đúng).
-- Migration gói chạy trong MỘT tx ⇒ không CONCURRENTLY; `lock_timeout` như 0070/0084. Cái giá: ghi `msg_messages` chờ trong lúc dựng (bảng còn nhỏ).
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    BEGIN
      EXECUTE format('CREATE INDEX IF NOT EXISTS msg_messages_fold_trgm_ix ON contracts.msg_messages USING gin (hub.fold(body) %I.gin_trgm_ops) WHERE deleted_at IS NULL',
                     (SELECT n.nspname FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace WHERE e.extname = 'pg_trgm'));
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'không tạo được index trigram tin nhắn nội bộ (%): bỏ qua', SQLERRM;
    END;
  END IF;
END $$;

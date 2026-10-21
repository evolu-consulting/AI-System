-- niti-import2 · lịch sử của tài khoản mgmt-app cũ (sohoptac) nhập vào hub: hội thoại trợ lý cũ = hội thoại LƯU TRỮ chỉ đọc
-- (`import_source` = nhãn lô, `archived_at` ≠ null ⇒ không tạo run mới — guard ở `runs.repo.touchConversation`); thông báo cũ =
-- lịch sử ĐÃ ĐỌC, không bao giờ phát (fanout_at đặt sẵn ⇒ vòng fanout email/push không chọn). Chỉ thêm cột/hàm; chạy lại vô hại.
ALTER TABLE hub.conversations ADD COLUMN IF NOT EXISTS import_source text;
--> statement-breakpoint
ALTER TABLE hub.conversations ADD COLUMN IF NOT EXISTS archived_at timestamptz;
--> statement-breakpoint
ALTER TABLE hub.conversations DROP CONSTRAINT IF EXISTS conversations_import_source_ck;
--> statement-breakpoint
ALTER TABLE hub.conversations ADD CONSTRAINT conversations_import_source_ck
  CHECK (import_source IS NULL OR (import_source ~ '^[a-z0-9][a-z0-9._-]{0,63}$' AND archived_at IS NOT NULL));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS conversations_import_idx ON hub.conversations (tenant_id, import_source)
  WHERE import_source IS NOT NULL;
--> statement-breakpoint
-- Thông báo lịch sử: tenant = app.tenant_id của tx; người nhận phải thuộc tenant; nguồn `mgmt_import`, khoá `<nhãn>:<id cũ>`
-- (chạy lại không nhân đôi), giữ created_at cũ, read_at = lúc đọc cũ (vắng ⇒ created_at), fanout_at = now() ⇒ KHÔNG email/push.
CREATE OR REPLACE FUNCTION notify.import_read(p_tag text, p_batch jsonb) RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_tid uuid := NULLIF(current_setting('app.tenant_id', true), '')::uuid;
  n integer;
BEGIN
  IF v_tid IS NULL THEN
    RAISE EXCEPTION 'notify.import_read: thiếu app.tenant_id' USING ERRCODE = '22023';
  END IF;
  IF p_tag IS NULL OR p_tag !~ '^[a-z0-9][a-z0-9._-]{0,63}$' THEN
    RAISE EXCEPTION 'notify.import_read: nhãn lô không hợp lệ' USING ERRCODE = '22023';
  END IF;
  IF p_batch IS NULL OR jsonb_typeof(p_batch) <> 'array' OR jsonb_array_length(p_batch) > 500 THEN
    RAISE EXCEPTION 'notify.import_read: lô phải là mảng ≤ 500' USING ERRCODE = '22023';
  END IF;
  WITH x AS (
    SELECT * FROM jsonb_to_recordset(p_batch)
      AS (user_id uuid, mgmt_id text, title text, body text, created_at timestamptz, read_at timestamptz)
  ), ins AS (
    INSERT INTO hub.notifications (tenant_id, user_id, source, kind, title, body, link, dedup_key, created_at, read_at,
      fanout_at)
    SELECT v_tid, x.user_id, 'mgmt_import', 'mgmt_import.history', x.title, COALESCE(x.body, ''), NULL,
      p_tag || ':' || x.mgmt_id, COALESCE(x.created_at, now()), COALESCE(x.read_at, x.created_at, now()), now()
    FROM x
    WHERE EXISTS (SELECT 1 FROM admin.users u WHERE u.id = x.user_id AND u.tenant_id = v_tid)
    ON CONFLICT (tenant_id, user_id, source, dedup_key) DO NOTHING
    RETURNING 1)
  SELECT count(*)::integer INTO n FROM ins;
  RETURN n;
END $$;
--> statement-breakpoint
-- Hoàn tác: CHỈ thông báo nguồn `mgmt_import` có khoá `<nhãn>:` trong tenant của tx (giao nhận đi theo FK CASCADE).
CREATE OR REPLACE FUNCTION notify.import_rollback(p_tag text) RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_tid uuid := NULLIF(current_setting('app.tenant_id', true), '')::uuid;
  n integer;
BEGIN
  IF v_tid IS NULL OR p_tag IS NULL OR p_tag !~ '^[a-z0-9][a-z0-9._-]{0,63}$' THEN
    RAISE EXCEPTION 'notify.import_rollback: tham số không hợp lệ' USING ERRCODE = '22023';
  END IF;
  WITH d AS (DELETE FROM hub.notifications n WHERE n.tenant_id = v_tid AND n.source = 'mgmt_import'
      AND left(n.dedup_key, char_length(p_tag) + 1) = p_tag || ':' RETURNING 1)
  SELECT count(*)::integer INTO n FROM d;
  RETURN n;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION notify.import_read(text, jsonb) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION notify.import_rollback(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION notify.import_read(text, jsonb) TO hub_rw;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION notify.import_rollback(text) TO hub_rw;

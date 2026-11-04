-- dlc-bell · chuông "cần người" cho run quy trình chạy trong HỘI THOẠI Chat (không gắn gói: `pack_key` null, có `conversation_id`;
-- vd lượt DLC). Cùng khuôn `notify.enqueue_pack_runs` (0059) / `notify.resolve_pack_tasks` (0061): cổng DEFINER riêng vì notifier
-- ghi theo lô nhiều tenant ở scope system. Tenant + link (`/c/<hội thoại gốc>`: `origin_conversation_id` — nơi người mở lượt và thẻ duyệt nằm trên khung nhập —, vắng ⇒ `conversation_id`) lấy TỪ HÀNG
-- RUN, không từ người gọi; nguồn cố định 'process'; người nhận ngoài tenant của run ⇒ bỏ; `dedup_key` = id notice ⇒ chạy lại
-- không nhân đôi. Bước xong ⇒ chuông của task đánh dấu đã đọc cho mọi người nhận. Chỉ thêm hàm; chạy lại vô hại.
CREATE OR REPLACE FUNCTION notify.enqueue_conv_runs(p_batch jsonb) RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_sys boolean := current_setting('app.scope', true) = 'system';
  v_tid uuid := NULLIF(current_setting('app.tenant_id', true), '')::uuid;
  n integer;
BEGIN
  IF p_batch IS NULL OR jsonb_typeof(p_batch) <> 'array' OR jsonb_array_length(p_batch) > 2000 THEN
    RAISE EXCEPTION 'notify.enqueue_conv_runs: lô phải là mảng ≤ 2000' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_batch) = 0 THEN
    RETURN 0;
  END IF;
  IF NOT v_sys AND v_tid IS NULL THEN
    RAISE EXCEPTION 'notify.enqueue_conv_runs: thiếu app.tenant_id' USING ERRCODE = '22023';
  END IF;
  WITH x AS (
    SELECT * FROM ROWS FROM (jsonb_to_recordset(p_batch)
      AS (run_id uuid, user_id uuid, kind text, title text, dedup_key text)) WITH ORDINALITY
  ), ins AS (
    INSERT INTO hub.notifications (tenant_id, user_id, source, kind, title, body, link, dedup_key)
    SELECT pr.tenant_id, x.user_id, 'process', x.kind,
           COALESCE(NULLIF(left(x.title, 200), ''), 'Quy trình cần bạn'), '',
           '/c/' || COALESCE(pr.origin_conversation_id, pr.conversation_id)::text, x.dedup_key
    FROM x
    JOIN hub.process_runs pr ON pr.id = x.run_id
    WHERE pr.pack_key IS NULL
      AND COALESCE(pr.origin_conversation_id, pr.conversation_id) IS NOT NULL
      AND (v_sys OR pr.tenant_id = v_tid)
      AND x.kind ~ '^[a-z][a-z0-9_.]{1,40}$'
      AND char_length(x.dedup_key) BETWEEN 1 AND 128
      AND EXISTS (SELECT 1 FROM admin.users u WHERE u.id = x.user_id AND u.tenant_id = pr.tenant_id)
    ORDER BY x.ordinality
    ON CONFLICT (tenant_id, user_id, source, dedup_key) DO NOTHING
    RETURNING 1)
  SELECT count(*)::integer INTO n FROM ins;
  RETURN n;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION notify.enqueue_conv_runs(jsonb) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION notify.enqueue_conv_runs(jsonb) TO hub_rw;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION notify.resolve_conv_tasks(p_task_ids uuid[]) RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_sys boolean := current_setting('app.scope', true) = 'system';
  v_tid uuid := NULLIF(current_setting('app.tenant_id', true), '')::uuid;
  n integer;
BEGIN
  IF p_task_ids IS NULL OR cardinality(p_task_ids) = 0 THEN
    RETURN 0;
  END IF;
  IF NOT v_sys AND v_tid IS NULL THEN
    RAISE EXCEPTION 'notify.resolve_conv_tasks: thiếu app.tenant_id' USING ERRCODE = '22023';
  END IF;
  WITH upd AS (
    UPDATE hub.notifications b SET read_at = now()
    FROM hub.process_notices pn
    JOIN hub.process_runs pr ON pr.id = pn.process_run_id AND pr.tenant_id = pn.tenant_id
    WHERE pn.task_id = ANY (p_task_ids)
      AND pn.kind IN ('review_requested', 'ask_requested', 'decision_requested', 'reminder', 'escalated')
      AND pr.pack_key IS NULL
      AND (v_sys OR pr.tenant_id = v_tid)
      AND b.tenant_id = pn.tenant_id
      AND b.user_id = pn.user_id
      AND b.source = 'process'
      AND b.dedup_key = pn.id::text
      AND b.read_at IS NULL
    RETURNING 1)
  SELECT count(*)::integer INTO n FROM upd;
  RETURN n;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION notify.resolve_conv_tasks(uuid[]) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION notify.resolve_conv_tasks(uuid[]) TO hub_rw;

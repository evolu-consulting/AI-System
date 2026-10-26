-- contract-flow S1b · chuông của gói cho run quy trình gắn bản ghi gói (`process_runs.pack_key/pack_record_id`, 0058).
-- Notifier của engine ghi notice `hub.process_notices` theo lô (có thể nhiều tenant, scope system) ⇒ không dùng được
-- `notify.enqueue` (tenant = app.tenant_id của tx). Cổng DEFINER riêng: tenant, nguồn (`pack_key`, '-' ⇒ '_') và link
-- (`/<pack_key>/<pack_record_id>`) lấy TỪ HÀNG RUN, không từ người gọi; run không gắn gói ⇒ bỏ qua; người nhận ngoài tenant của
-- run ⇒ bỏ qua; scope khác `system` ⇒ chỉ run của `app.tenant_id`. Một câu cho cả lô (Luật 4c), thứ tự seq theo mảng đầu vào,
-- `dedup_key` = id notice ⇒ chạy lại không nhân đôi. Chỉ thêm hàm (không đổi bảng); chạy lại vô hại.
CREATE OR REPLACE FUNCTION notify.enqueue_pack_runs(p_batch jsonb) RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_sys boolean := current_setting('app.scope', true) = 'system';
  v_tid uuid := NULLIF(current_setting('app.tenant_id', true), '')::uuid;
  n integer;
BEGIN
  IF p_batch IS NULL OR jsonb_typeof(p_batch) <> 'array' OR jsonb_array_length(p_batch) > 2000 THEN
    RAISE EXCEPTION 'notify.enqueue_pack_runs: lô phải là mảng ≤ 2000' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_batch) = 0 THEN
    RETURN 0;
  END IF;
  IF NOT v_sys AND v_tid IS NULL THEN
    RAISE EXCEPTION 'notify.enqueue_pack_runs: thiếu app.tenant_id' USING ERRCODE = '22023';
  END IF;
  WITH x AS (
    SELECT * FROM ROWS FROM (jsonb_to_recordset(p_batch)
      AS (run_id uuid, user_id uuid, kind text, title text, dedup_key text)) WITH ORDINALITY
  ), ins AS (
    INSERT INTO hub.notifications (tenant_id, user_id, source, kind, title, body, link, dedup_key)
    SELECT pr.tenant_id, x.user_id, replace(pr.pack_key, '-', '_'), x.kind,
           COALESCE(NULLIF(left(x.title, 200), ''), 'Quy trình duyệt'), '',
           '/' || pr.pack_key || '/' || pr.pack_record_id::text, x.dedup_key
    FROM x
    JOIN hub.process_runs pr ON pr.id = x.run_id
    WHERE pr.pack_key IS NOT NULL
      AND (v_sys OR pr.tenant_id = v_tid)
      AND replace(pr.pack_key, '-', '_') ~ '^[a-z][a-z0-9_]{1,20}$'
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
REVOKE ALL ON FUNCTION notify.enqueue_pack_runs(jsonb) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION notify.enqueue_pack_runs(jsonb) TO hub_rw;

-- CR-121 D-6 · node `notify` của engine: ghi thông báo (chuông; mail do vòng chia kênh) cho người nhận đã chọn, CÙNG tx với bước.
-- Vì sao cần hàm mới: `notify.enqueue` lấy tenant từ `app.tenant_id` (vòng hẹn giờ/kick lô chạy scope system ⇒ không có), còn
-- `notify.enqueue_pack_runs` ép `body = ''` + chỉ run gắn gói. Hàm này như `enqueue_pack_runs` (tenant/nguồn/link lấy TỪ HÀNG RUN,
-- người nhận ngoài công ty của run ⇒ bỏ, scope khác `system` ⇒ chỉ run của `app.tenant_id`) nhưng nhận `body` và run không gắn gói
-- (nguồn `processes`, link null). `dedup_key` = (run, stage run, lần thử) ⇒ retry/sweep chạy lại không gửi lần 2. Chỉ thêm hàm.
CREATE OR REPLACE FUNCTION notify.enqueue_run_notices(p_batch jsonb) RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_sys boolean := current_setting('app.scope', true) = 'system';
  v_tid uuid := NULLIF(current_setting('app.tenant_id', true), '')::uuid;
  n integer;
BEGIN
  IF p_batch IS NULL OR jsonb_typeof(p_batch) <> 'array' OR jsonb_array_length(p_batch) > 2000 THEN
    RAISE EXCEPTION 'notify.enqueue_run_notices: lô phải là mảng ≤ 2000' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_batch) = 0 THEN
    RETURN 0;
  END IF;
  IF NOT v_sys AND v_tid IS NULL THEN
    RAISE EXCEPTION 'notify.enqueue_run_notices: thiếu app.tenant_id' USING ERRCODE = '22023';
  END IF;
  WITH x AS (
    SELECT * FROM ROWS FROM (jsonb_to_recordset(p_batch)
      AS (run_id uuid, user_id uuid, kind text, title text, body text, dedup_key text)) WITH ORDINALITY
  ), ins AS (
    INSERT INTO hub.notifications (tenant_id, user_id, source, kind, title, body, link, dedup_key)
    SELECT pr.tenant_id, x.user_id,
           CASE WHEN pr.pack_key IS NULL THEN 'processes' ELSE replace(pr.pack_key, '-', '_') END, x.kind,
           COALESCE(NULLIF(left(x.title, 200), ''), 'Thông báo quy trình'), left(COALESCE(x.body, ''), 2000),
           CASE WHEN pr.pack_key IS NULL OR pr.pack_record_id IS NULL THEN NULL
                ELSE '/' || pr.pack_key || '/' || pr.pack_record_id::text END,
           x.dedup_key
    FROM x
    JOIN hub.process_runs pr ON pr.id = x.run_id
    WHERE (v_sys OR pr.tenant_id = v_tid)
      AND (pr.pack_key IS NULL OR replace(pr.pack_key, '-', '_') ~ '^[a-z][a-z0-9_]{1,20}$')
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
REVOKE ALL ON FUNCTION notify.enqueue_run_notices(jsonb) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION notify.enqueue_run_notices(jsonb) TO hub_rw;

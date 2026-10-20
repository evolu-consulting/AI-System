-- final-green · notify.enqueue: thứ tự seq trong một lô PHẢI theo thứ tự mảng đầu vào (chuông «mới nhất trước», phân trang theo seq).
-- Trước đây kế hoạch semi-join với admin.users có thể đảo thứ tự hàng ⇒ seq không theo lô (N3-FR-09 chập chờn). Giữ nguyên
-- ngữ nghĩa/GRANT; chỉ thêm WITH ORDINALITY + ORDER BY trước khi chèn.
CREATE OR REPLACE FUNCTION notify.enqueue(p_source text, p_batch jsonb) RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_tid uuid := NULLIF(current_setting('app.tenant_id', true), '')::uuid;
  n integer;
BEGIN
  IF v_tid IS NULL THEN
    RAISE EXCEPTION 'notify.enqueue: thiếu app.tenant_id' USING ERRCODE = '22023';
  END IF;
  IF p_source IS NULL OR p_source !~ '^[a-z][a-z0-9_]{1,20}$' THEN
    RAISE EXCEPTION 'notify.enqueue: khoá nguồn không hợp lệ' USING ERRCODE = '22023';
  END IF;
  IF p_batch IS NULL OR jsonb_typeof(p_batch) <> 'array' OR jsonb_array_length(p_batch) > 500 THEN
    RAISE EXCEPTION 'notify.enqueue: lô phải là mảng ≤ 500' USING ERRCODE = '22023';
  END IF;
  WITH ins AS (
    INSERT INTO hub.notifications (tenant_id, user_id, source, kind, title, body, link, dedup_key)
    SELECT v_tid, x.user_id, p_source, x.kind, x.title, COALESCE(x.body, ''), x.link,
           COALESCE(x.dedup_key, gen_random_uuid()::text)
    FROM ROWS FROM (jsonb_to_recordset(p_batch)
           AS (user_id uuid, kind text, title text, body text, link text, dedup_key text)) WITH ORDINALITY AS x
    WHERE EXISTS (SELECT 1 FROM admin.users u WHERE u.id = x.user_id AND u.tenant_id = v_tid)
    ORDER BY x.ordinality
    ON CONFLICT (tenant_id, user_id, source, dedup_key) DO NOTHING
    RETURNING 1)
  SELECT count(*)::integer INTO n FROM ins;
  RETURN n;
END $$;
-- CR-125 · x12 · email "Mời ký số" có thẻ tóm tắt HĐ + ảnh trang đầu. `hub.notifications.data` = dữ liệu có cấu trúc đi kèm thông báo (jsonb, ≤ 256 KB) để bộ gửi email
-- dựng thư giàu (thẻ + ảnh) từ CHÍNH dòng thông báo — một nguồn, đi chung hàng đợi/tùy chọn email/thử lại với chuông. Không chứa token/bí mật; không phải điều khoản HĐ.
-- `notify.enqueue` (bản 0053) thêm trường `data` vào lô; mọi thứ khác giữ nguyên.
ALTER TABLE hub.notifications ADD COLUMN IF NOT EXISTS data jsonb;
--> statement-breakpoint
ALTER TABLE hub.notifications DROP CONSTRAINT IF EXISTS notifications_data_ck;
--> statement-breakpoint
ALTER TABLE hub.notifications ADD CONSTRAINT notifications_data_ck
  CHECK (data IS NULL OR (jsonb_typeof(data) = 'object' AND pg_column_size(data) <= 262144)) NOT VALID;
--> statement-breakpoint
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
  WITH x AS (
    SELECT * FROM ROWS FROM (jsonb_to_recordset(p_batch)
      AS (user_id uuid, kind text, title text, body text, link text, dedup_key text, lead integer, managed boolean, data jsonb))
      WITH ORDINALITY
  ), d AS (
    SELECT notify.tenant_remind_days() AS days
  ), own AS (
    SELECT x.ordinality, 0 AS sub, x.user_id, x.kind, x.title, x.body, x.link, x.dedup_key, x.data
    FROM x CROSS JOIN d
    LEFT JOIN hub.notify_prefs p ON p.tenant_id = v_tid AND p.user_id = x.user_id
    WHERE (x.lead IS NULL OR x.lead = ANY (COALESCE(p.remind_days, d.days)))
      AND (x.kind NOT LIKE 'contract.price%' OR COALESCE(p.price_alerts, true))
  ), mg AS (
    SELECT x.ordinality, 1 AS sub, m.manager_id AS user_id, x.kind, x.title, x.body, x.link, x.dedup_key, NULL::jsonb AS data
    FROM x CROSS JOIN d
    CROSS JOIN LATERAL (
      SELECT r.manager_id FROM admin.user_reports r WHERE r.tenant_id = v_tid AND r.user_id = x.user_id
      UNION
      SELECT dp.head_user_id FROM admin.departments dp
        JOIN admin.group_members gm ON gm.group_id = dp.group_id AND gm.tenant_id = dp.tenant_id
        WHERE dp.tenant_id = v_tid AND gm.user_id = x.user_id AND dp.head_user_id IS NOT NULL) m
    JOIN hub.notify_prefs mp ON mp.tenant_id = v_tid AND mp.user_id = m.manager_id
    WHERE x.managed IS TRUE AND x.lead IS NOT NULL AND m.manager_id <> x.user_id AND mp.include_managed
      AND x.lead = ANY (COALESCE(mp.remind_days, d.days))
  ), ins AS (
    INSERT INTO hub.notifications (tenant_id, user_id, source, kind, title, body, link, dedup_key, data)
    SELECT v_tid, a.user_id, p_source, a.kind, a.title, COALESCE(a.body, ''), a.link,
           COALESCE(a.dedup_key, gen_random_uuid()::text), a.data
    FROM (SELECT * FROM own UNION ALL SELECT * FROM mg) a
    WHERE EXISTS (SELECT 1 FROM admin.users u WHERE u.id = a.user_id AND u.tenant_id = v_tid)
    ORDER BY a.ordinality, a.sub
    ON CONFLICT (tenant_id, user_id, source, dedup_key) DO NOTHING
    RETURNING 1)
  SELECT count(*)::integer INTO n FROM ins;
  RETURN n;
END $$;

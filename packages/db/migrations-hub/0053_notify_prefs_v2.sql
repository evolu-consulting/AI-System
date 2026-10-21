-- gap-c #11 · tùy chọn thông báo theo người dùng: mốc nhắc hạn (remind_days; NULL = mặc định của tenant), cảnh báo giá, nhận thêm
-- HĐ của người mình quản lý. Mặc định tenant = `admin.tenants.settings.remind_days` (mảng số; vắng ⇒ 60,30,7,1,0 như HD4).
-- Cột chỉ thêm (writer cũ không đổi). `notify.enqueue` giữ ngữ nghĩa cũ và nhận thêm hai khoá tùy chọn mỗi mục:
--   `lead` (mốc ngày của lời nhắc hạn) ⇒ chỉ ghi cho người nhận có mốc đó trong tập hiệu lực;
--   `managed` (true) ⇒ thêm bản cho các quản lý (admin.user_reports, trưởng phòng) đã bật `include_managed` và có mốc đó.
-- Kind `contract.price*` bị bỏ qua khi người nhận tắt `price_alerts`. Một câu cho cả lô (Luật 4c), thứ tự seq theo mảng đầu vào.
ALTER TABLE hub.notify_prefs ADD COLUMN IF NOT EXISTS remind_days integer[];
--> statement-breakpoint
ALTER TABLE hub.notify_prefs ADD COLUMN IF NOT EXISTS price_alerts boolean NOT NULL DEFAULT true;
--> statement-breakpoint
ALTER TABLE hub.notify_prefs ADD COLUMN IF NOT EXISTS include_managed boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE hub.notify_prefs DROP CONSTRAINT IF EXISTS notify_prefs_remind_days_ck;
--> statement-breakpoint
ALTER TABLE hub.notify_prefs ADD CONSTRAINT notify_prefs_remind_days_ck
  CHECK (remind_days IS NULL OR (remind_days <@ ARRAY[60, 30, 7, 1, 0] AND cardinality(remind_days) <= 5));
--> statement-breakpoint
-- Mốc mặc định của tenant trong tx (app.tenant_id). DEFINER: hub_rw không đọc admin.tenants; không tham số ⇒ chỉ hỏi tenant của tx.
CREATE OR REPLACE FUNCTION notify.tenant_remind_days() RETURNS integer[]
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce((SELECT CASE WHEN jsonb_typeof(t.settings -> 'remind_days') = 'array'
      THEN ARRAY(SELECT e::integer FROM jsonb_array_elements_text(t.settings -> 'remind_days') e
                 WHERE e ~ '^(60|30|7|1|0)$')
      END
    FROM admin.tenants t WHERE t.id = NULLIF(current_setting('app.tenant_id', true), '')::uuid),
    ARRAY[60, 30, 7, 1, 0])
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION notify.tenant_remind_days() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION notify.tenant_remind_days() TO hub_rw;
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
      AS (user_id uuid, kind text, title text, body text, link text, dedup_key text, lead integer, managed boolean))
      WITH ORDINALITY
  ), d AS (
    SELECT notify.tenant_remind_days() AS days
  ), own AS (
    SELECT x.ordinality, 0 AS sub, x.user_id, x.kind, x.title, x.body, x.link, x.dedup_key
    FROM x CROSS JOIN d
    LEFT JOIN hub.notify_prefs p ON p.tenant_id = v_tid AND p.user_id = x.user_id
    WHERE (x.lead IS NULL OR x.lead = ANY (COALESCE(p.remind_days, d.days)))
      AND (x.kind NOT LIKE 'contract.price%' OR COALESCE(p.price_alerts, true))
  ), mg AS (
    SELECT x.ordinality, 1 AS sub, m.manager_id AS user_id, x.kind, x.title, x.body, x.link, x.dedup_key
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
    INSERT INTO hub.notifications (tenant_id, user_id, source, kind, title, body, link, dedup_key)
    SELECT v_tid, a.user_id, p_source, a.kind, a.title, COALESCE(a.body, ''), a.link,
           COALESCE(a.dedup_key, gen_random_uuid()::text)
    FROM (SELECT * FROM own UNION ALL SELECT * FROM mg) a
    WHERE EXISTS (SELECT 1 FROM admin.users u WHERE u.id = a.user_id AND u.tenant_id = v_tid)
    ORDER BY a.ordinality, a.sub
    ON CONFLICT (tenant_id, user_id, source, dedup_key) DO NOTHING
    RETURNING 1)
  SELECT count(*)::integer INTO n FROM ins;
  RETURN n;
END $$;

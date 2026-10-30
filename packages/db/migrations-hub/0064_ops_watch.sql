-- CR-104 · ops-core (O1) · theo dõi vận hành `ops-watch` (docs/specs/ops-watch/proposal.md, Quyết định 1–6). Viết tay, idempotent
-- (IF NOT EXISTS / CREATE OR REPLACE). Chỉ THÊM 3 bảng + 1 hàm — không đụng bảng/grant cũ, không mất dữ liệu.
-- Bảng cấp NỀN TẢNG (không tenant_id, không RLS — như kh_connections 0029): chỉ hub_rw đọc/ghi, route chỉ platform_admin.
-- (1) ops_settings: MỘT dòng (id = 1) jsonb cấu hình (zod `OpsSettingsSchema` kiểm ở API) + mốc lượt kiểm cuối (`last_round_at`,
--     cũng là khoá "giành lượt" giữa nhiều instance: UPDATE có điều kiện) + mốc "Kiểm tra ngay" cuối (giới hạn 1/phút).
-- (2) ops_checks: trạng thái mới nhất mỗi check. (3) ops_events: chỉ ghi khi đổi trạng thái hoặc đổi cấu hình (giữ 500 dòng mới nhất).
-- (4) notify.enqueue_ops: cổng DEFINER gửi chuông tới MỌI platform_admin đang hoạt động (mỗi người theo tenant của chính họ) —
--     hub_rw không cần quyền đọc admin.users. Một câu cho cả lô (Luật 4c).

CREATE TABLE IF NOT EXISTS hub.ops_settings (
  id smallint NOT NULL DEFAULT 1,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_round_at timestamptz,
  last_manual_at timestamptz,
  CONSTRAINT ops_settings_pkey PRIMARY KEY (id),
  CONSTRAINT ops_settings_single_ck CHECK (id = 1),
  CONSTRAINT ops_settings_obj_ck CHECK (jsonb_typeof(settings) = 'object')
);
--> statement-breakpoint
INSERT INTO hub.ops_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS hub.ops_checks (
  check_key text NOT NULL,
  status text NOT NULL,
  value jsonb,
  message text NOT NULL DEFAULT '',
  hint text,
  checked_at timestamptz NOT NULL,
  changed_at timestamptz NOT NULL,
  CONSTRAINT ops_checks_pkey PRIMARY KEY (check_key),
  CONSTRAINT ops_checks_ck CHECK (check_key ~ '^[a-z][a-z0-9_]{1,40}$'
    AND status IN ('ok', 'warn', 'crit', 'unknown')
    AND char_length(message) <= 500 AND (hint IS NULL OR char_length(hint) <= 1000))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS hub.ops_events (
  id bigint GENERATED ALWAYS AS IDENTITY,
  check_key text,
  from_status text,
  to_status text,
  kind text NOT NULL,
  actor_user_id uuid,
  detail jsonb,
  at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ops_events_pkey PRIMARY KEY (id),
  CONSTRAINT ops_events_ck CHECK (kind IN ('status', 'settings_changed')
    AND (from_status IS NULL OR from_status IN ('ok', 'warn', 'crit', 'unknown'))
    AND (to_status IS NULL OR to_status IN ('ok', 'warn', 'crit', 'unknown'))
    AND (kind <> 'status' OR (check_key IS NOT NULL AND to_status IS NOT NULL))
    AND (detail IS NULL OR jsonb_typeof(detail) = 'object'))
);
--> statement-breakpoint

-- ── GRANT: chỉ hub_rw (hub_api); không quyền cho hub_ro / agent_runtime / admin_rw ─────────────────────────────────────────
REVOKE ALL ON hub.ops_settings, hub.ops_checks, hub.ops_events FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON hub.ops_settings, hub.ops_checks, hub.ops_events FROM hub_ro, agent_runtime, admin_rw;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON hub.ops_settings TO hub_rw;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON hub.ops_checks TO hub_rw;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON hub.ops_events TO hub_rw;
--> statement-breakpoint

-- ── Cổng chuông ops: người nhận = platform_admin đang hoạt động (tenant của chính họ), nguồn `ops`, link `/system`.
-- Chỉ scope `system` (vòng nền/route ops đặt). Mục: {kind, title, body, dedup_key}; mục sai định dạng bị bỏ qua.
CREATE OR REPLACE FUNCTION notify.enqueue_ops(p_batch jsonb) RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  n integer;
BEGIN
  IF current_setting('app.scope', true) IS DISTINCT FROM 'system' THEN
    RAISE EXCEPTION 'notify.enqueue_ops: chỉ scope system' USING ERRCODE = '42501';
  END IF;
  IF p_batch IS NULL OR jsonb_typeof(p_batch) <> 'array' OR jsonb_array_length(p_batch) > 100 THEN
    RAISE EXCEPTION 'notify.enqueue_ops: lô phải là mảng ≤ 100' USING ERRCODE = '22023';
  END IF;
  WITH x AS (
    SELECT * FROM ROWS FROM (jsonb_to_recordset(p_batch) AS (kind text, title text, body text, dedup_key text))
      WITH ORDINALITY
  ), ins AS (
    INSERT INTO hub.notifications (tenant_id, user_id, source, kind, title, body, link, dedup_key)
    SELECT u.tenant_id, u.id, 'ops', x.kind, left(x.title, 200), left(COALESCE(x.body, ''), 2000), '/system', x.dedup_key
    FROM x CROSS JOIN admin.users u
    WHERE u.role = 'platform_admin' AND u.active AND NOT u.locked_by_tenant
      AND x.kind ~ '^ops\.[a-z_]{2,20}$'
      AND char_length(COALESCE(x.title, '')) >= 1
      AND char_length(COALESCE(x.dedup_key, '')) BETWEEN 1 AND 128
    ORDER BY x.ordinality, u.id
    ON CONFLICT (tenant_id, user_id, source, dedup_key) DO NOTHING
    RETURNING 1)
  SELECT count(*)::integer INTO n FROM ins;
  RETURN n;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION notify.enqueue_ops(jsonb) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION notify.enqueue_ops(jsonb) TO hub_rw;

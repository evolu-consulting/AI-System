-- N3-FR-01…08 · N3-NFR-02 · thông báo dùng chung (spec N3-notify, plan "Dữ liệu"). Viết tay, idempotent như 0028/0036 (IF NOT EXISTS /
-- DO $$ kiểm pg_constraint·pg_policies). Chỉ THÊM bảng/hàm + nới CHECK kind của hub.secrets — không mất dữ liệu.
-- Số 0040 (không 0038): chừa chỗ cho lát N2/N5 chạy song song; `when` trong _journal lớn hơn để thứ tự áp không đảo.

-- ── (1) hub.notifications: nguồn duy nhất của chuông in-app VÀ hàng đợi (fanout_at NULL = chưa chia kênh) ────────────────────
CREATE TABLE IF NOT EXISTS hub.notifications (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  seq bigint GENERATED ALWAYS AS IDENTITY,
  tenant_id uuid NOT NULL,
  user_id uuid NOT NULL,
  source text NOT NULL,
  kind text NOT NULL,
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  link text,
  dedup_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  fanout_at timestamptz,
  CONSTRAINT notifications_pkey PRIMARY KEY (id),
  CONSTRAINT notifications_id_tenant_uq UNIQUE (id, tenant_id),
  CONSTRAINT notifications_dedup_uq UNIQUE (tenant_id, user_id, source, dedup_key),
  CONSTRAINT notifications_ck CHECK (source ~ '^[a-z][a-z0-9_]{1,20}$' AND kind ~ '^[a-z][a-z0-9_.]{1,40}$'
    AND char_length(title) BETWEEN 1 AND 200 AND char_length(body) <= 2000 AND char_length(dedup_key) BETWEEN 1 AND 128
    AND (link IS NULL OR (char_length(link) <= 500 AND link ~ '^/[^/\\]'))) -- đường dẫn trong app, không phải URL ngoài
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS notifications_feed_idx ON hub.notifications (tenant_id, user_id, seq DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS notifications_unread_idx ON hub.notifications (tenant_id, user_id) WHERE read_at IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS notifications_fanout_idx ON hub.notifications (seq) WHERE fanout_at IS NULL;
--> statement-breakpoint

-- ── (2) hub.notification_deliveries: bản gửi theo kênh; `sending` giữ next_attempt_at = hết hạn thuê ────────────────────────
CREATE TABLE IF NOT EXISTS hub.notification_deliveries (
  id bigint GENERATED ALWAYS AS IDENTITY,
  notification_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  user_id uuid NOT NULL,
  channel text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempts smallint NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notification_deliveries_pkey PRIMARY KEY (id),
  CONSTRAINT notification_deliveries_uq UNIQUE (notification_id, channel),
  CONSTRAINT notification_deliveries_ck CHECK (channel IN ('email', 'push')
    AND status IN ('pending', 'sending', 'sent', 'dead') AND attempts BETWEEN 0 AND 20
    AND (last_error IS NULL OR char_length(last_error) <= 64)),
  CONSTRAINT notification_deliveries_fk FOREIGN KEY (notification_id, tenant_id)
    REFERENCES hub.notifications (id, tenant_id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS notification_deliveries_due_idx ON hub.notification_deliveries (next_attempt_at, id)
  WHERE status IN ('pending', 'sending');
--> statement-breakpoint

-- ── (3) tùy chọn kênh + đăng ký push ────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hub.notify_prefs (
  tenant_id uuid NOT NULL,
  user_id uuid NOT NULL,
  email boolean NOT NULL DEFAULT true,
  push boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notify_prefs_pkey PRIMARY KEY (tenant_id, user_id)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS hub.push_subscriptions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  user_id uuid NOT NULL,
  endpoint text NOT NULL,
  p256dh text NOT NULL,
  auth text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT push_subscriptions_pkey PRIMARY KEY (id),
  CONSTRAINT push_subscriptions_endpoint_uq UNIQUE (endpoint),
  CONSTRAINT push_subscriptions_ck CHECK (endpoint ~ '^https://' AND char_length(endpoint) <= 2048
    AND char_length(p256dh) BETWEEN 1 AND 256 AND char_length(auth) BETWEEN 1 AND 64)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS push_subscriptions_user_idx ON hub.push_subscriptions (tenant_id, user_id);
--> statement-breakpoint

-- ── (4) RLS: system thấy hết; user chỉ hàng của MÌNH (cùng tenant VÀ cùng user). Bản gửi: chỉ system ──────────────────────
ALTER TABLE hub.notifications ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE hub.notification_deliveries ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE hub.notify_prefs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE hub.push_subscriptions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$
DECLARE
  v_sys constant text := '(current_setting(''app.scope'', true) = ''system'')';
  v_own constant text := '(current_setting(''app.scope'', true) = ''user'' AND tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid'
    || ' AND user_id = NULLIF(current_setting(''app.user_id'', true), '''')::uuid)';
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['notifications', 'notify_prefs', 'push_subscriptions'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'hub' AND tablename = t AND policyname = t || '_hub_rw') THEN
      EXECUTE format('CREATE POLICY %I ON hub.%I FOR ALL TO hub_rw USING (%s OR %s) WITH CHECK (%s OR %s)',
        t || '_hub_rw', t, v_sys, v_own, v_sys, v_own);
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'hub' AND tablename = 'notification_deliveries'
                 AND policyname = 'notification_deliveries_hub_rw') THEN
    EXECUTE format('CREATE POLICY notification_deliveries_hub_rw ON hub.notification_deliveries FOR ALL TO hub_rw USING (%s) WITH CHECK (%s)',
      v_sys, v_sys);
  END IF;
END
$$;
--> statement-breakpoint

-- ── (5) GRANT: không INSERT thẳng vào notifications (chỉ qua notify.enqueue); user chỉ sửa được read_at ──────────────────────
REVOKE ALL ON hub.notifications, hub.notification_deliveries, hub.notify_prefs, hub.push_subscriptions FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON hub.notifications, hub.notification_deliveries, hub.notify_prefs, hub.push_subscriptions FROM hub_ro, agent_runtime, admin_rw;
--> statement-breakpoint
REVOKE ALL ON hub.notifications, hub.notification_deliveries, hub.notify_prefs, hub.push_subscriptions FROM hub_rw;
--> statement-breakpoint
GRANT SELECT ON hub.notifications TO hub_rw;
--> statement-breakpoint
GRANT UPDATE (read_at, fanout_at) ON hub.notifications TO hub_rw;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON hub.notification_deliveries TO hub_rw;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON hub.notify_prefs TO hub_rw;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON hub.push_subscriptions TO hub_rw;
--> statement-breakpoint

-- ── (6) cổng ghi: notify.enqueue (DEFINER). Tenant = app.tenant_id của tx; người nhận ngoài tenant bị bỏ qua ─────────────────
CREATE SCHEMA IF NOT EXISTS notify;
--> statement-breakpoint
REVOKE ALL ON SCHEMA notify FROM PUBLIC;
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
  WITH ins AS (
    INSERT INTO hub.notifications (tenant_id, user_id, source, kind, title, body, link, dedup_key)
    SELECT v_tid, x.user_id, p_source, x.kind, x.title, COALESCE(x.body, ''), x.link,
           COALESCE(x.dedup_key, gen_random_uuid()::text)
    FROM jsonb_to_recordset(p_batch) AS x(user_id uuid, kind text, title text, body text, link text, dedup_key text)
    WHERE EXISTS (SELECT 1 FROM admin.users u WHERE u.id = x.user_id AND u.tenant_id = v_tid)
    ON CONFLICT (tenant_id, user_id, source, dedup_key) DO NOTHING
    RETURNING 1)
  SELECT count(*)::integer INTO n FROM ins;
  RETURN n;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION notify.enqueue(text, jsonb) FROM PUBLIC;
--> statement-breakpoint
GRANT USAGE ON SCHEMA notify TO hub_rw;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION notify.enqueue(text, jsonb) TO hub_rw;
--> statement-breakpoint

-- ── (7) secrets: kind mới (nền tảng, không theo tenant) cho mật khẩu SMTP và khoá riêng VAPID (N3-FR-08) ────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'secrets_kind_ck' AND conrelid = 'hub.secrets'::regclass
                 AND pg_get_constraintdef(oid) LIKE '%smtp_password%') THEN
    ALTER TABLE hub.secrets DROP CONSTRAINT IF EXISTS secrets_kind_ck;
    ALTER TABLE hub.secrets ADD CONSTRAINT secrets_kind_ck CHECK (kind IN ('provider_api_key', 'kh_api_key',
      'source_credential', 'smtp_password', 'vapid_private_key'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'secrets_scope_ck' AND conrelid = 'hub.secrets'::regclass
                 AND pg_get_constraintdef(oid) LIKE '%smtp_password%') THEN
    ALTER TABLE hub.secrets DROP CONSTRAINT IF EXISTS secrets_scope_ck;
    ALTER TABLE hub.secrets ADD CONSTRAINT secrets_scope_ck CHECK (
      (kind IN ('provider_api_key', 'smtp_password', 'vapid_private_key') AND tenant_id IS NULL)
      OR (kind = 'source_credential' AND tenant_id IS NOT NULL) OR kind = 'kh_api_key');
  END IF;
END
$$;

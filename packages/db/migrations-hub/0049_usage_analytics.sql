-- ADM-FR-42 · usage-analytics · phân tích token "đổ vào đâu": mỗi dòng `hub.usage_logs` mang thêm `app` (bề mặt: chat AI System,
-- contracts = Sổ Hợp Tác (dock + trích HĐ + tìm giá/đối tác), knowledge, rooms, process…) và `outcome` (ok | error | cancelled).
-- Cột chỉ thêm, nullable — writer cũ (runtime agent, Dify) không đổi; Hub gắn khi run kết thúc (`hub.tag_run_usage`, thay
-- `hub.tag_chat_usage` — giữ hàm cũ). Bảng tổng hợp ngày `hub.usage_daily` (ngày VN = UTC+7) do trigger THEO CÂU LỆNH (bảng
-- chuyển tiếp, set-based) giữ đồng bộ với INSERT/UPDATE/DELETE/TRUNCATE — báo cáo đọc bảng này, không quét 1M dòng thô.
-- RLS `usage_daily` cho admin_rw (platform: mọi tenant; tenant: chỉ tenant mình) — không dựa vào tham số client.
ALTER TABLE hub.usage_logs
  ADD COLUMN IF NOT EXISTS app text CONSTRAINT usage_logs_app_check CHECK (app ~ '^[a-z][a-z0-9_-]{1,31}$'),
  ADD COLUMN IF NOT EXISTS outcome text
    CONSTRAINT usage_logs_outcome_check CHECK (outcome IN ('ok', 'error', 'cancelled'));
--> statement-breakpoint
ALTER TABLE hub.runs
  ADD COLUMN IF NOT EXISTS surface text CONSTRAINT runs_surface_check CHECK (surface ~ '^[a-z][a-z0-9_-]{1,31}$');
--> statement-breakpoint
-- App của một dòng: cột `app`; không có ⇒ tiền tố `feature` (`contracts.extract` → contracts, `chat` → chat); Dify ⇒ dify; còn lại other.
CREATE OR REPLACE FUNCTION hub.usage_app(p_app text, p_feature text, p_billing text)
  RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  AS $$
  SELECT coalesce(p_app, nullif(split_part(p_feature, '.', 1), ''),
    CASE WHEN p_billing = 'dify' THEN 'dify' ELSE 'other' END)
$$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION hub.usage_app(text, text, text) TO admin_rw, hub_rw;
--> statement-breakpoint
-- Backfill (trước khi có trigger): app theo run (quy trình / phòng / chat), outcome theo job của runtime.
UPDATE hub.usage_logs l SET app = CASE WHEN r.stage_run_id IS NOT NULL THEN 'process'
    WHEN r.room_id IS NOT NULL THEN 'rooms' ELSE 'chat' END
  FROM hub.runs r WHERE l.run_id = r.id AND l.app IS NULL;
--> statement-breakpoint
UPDATE hub.usage_logs l SET outcome = CASE j.status WHEN 'succeeded' THEN 'ok' WHEN 'cancelled' THEN 'cancelled'
    ELSE 'error' END
  FROM hub.jobs j WHERE l.job_id = j.id AND l.outcome IS NULL AND j.status NOT IN ('queued', 'running');
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS hub.usage_daily (
  tenant_id uuid NOT NULL,
  day date NOT NULL,
  app text NOT NULL,
  feature text,
  agent_id uuid,
  model text,
  provider_key text,
  billing text NOT NULL,
  outcome text,
  user_id uuid,
  calls bigint NOT NULL DEFAULT 0,
  runs bigint NOT NULL DEFAULT 0,
  input_tokens bigint NOT NULL DEFAULT 0,
  output_tokens bigint NOT NULL DEFAULT 0,
  cache_read_tokens bigint NOT NULL DEFAULT 0,
  cache_write_tokens bigint NOT NULL DEFAULT 0,
  cost_usd numeric(18, 6) NOT NULL DEFAULT 0,
  unpriced bigint NOT NULL DEFAULT 0,
  latency_ms_sum bigint NOT NULL DEFAULT 0,
  latency_n bigint NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS usage_daily_key_uq ON hub.usage_daily
  (tenant_id, day, app, feature, agent_id, model, provider_key, billing, outcome, user_id) NULLS NOT DISTINCT;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS usage_daily_day_idx ON hub.usage_daily (day);
--> statement-breakpoint
ALTER TABLE hub.usage_daily ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS usage_daily_admin_rw ON hub.usage_daily;
--> statement-breakpoint
CREATE POLICY usage_daily_admin_rw ON hub.usage_daily FOR SELECT TO admin_rw
  USING (current_setting('app.scope', true) = 'platform'
         OR (current_setting('app.scope', true) = 'tenant'
             AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid));
--> statement-breakpoint
GRANT SELECT ON hub.usage_daily TO admin_rw;
--> statement-breakpoint
-- Dựng lại từ dữ liệu cũ (một câu). `runs` = dòng sớm nhất của run (cộng dồn được qua ngày/nhóm).
INSERT INTO hub.usage_daily (tenant_id, day, app, feature, agent_id, model, provider_key, billing, outcome, user_id,
  calls, runs, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, unpriced, latency_ms_sum,
  latency_n)
SELECT x.tenant_id, ((x.at AT TIME ZONE 'UTC') + interval '420 minutes')::date,
  hub.usage_app(x.app, x.feature, x.billing), x.feature, x.agent_id, x.model, x.provider_key, x.billing, x.outcome,
  x.user_id, count(*), count(*) FILTER (WHERE x.run_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM hub.usage_logs e
    WHERE e.run_id = x.run_id AND (e.at, e.id) < (x.at, x.id))),
  sum(x.input_tokens), sum(x.output_tokens), sum(coalesce(x.cache_read_tokens, 0)),
  sum(coalesce(x.cache_write_tokens, 0)), sum(coalesce(x.cost_usd, 0)), count(*) FILTER (WHERE x.cost_usd IS NULL),
  sum(coalesce(x.latency_ms, 0)), count(x.latency_ms)
FROM hub.usage_logs x
GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- Trigger THEO CÂU LỆNH: gộp các dòng của câu (±1) theo khoá rồi upsert theo thứ tự khoá (tránh deadlock). Một câu SQL mỗi
-- lệnh ghi, không phụ thuộc số dòng. SECURITY DEFINER: writer (agent_runtime, hub_rw qua hàm) không cần quyền trên bảng.
CREATE OR REPLACE FUNCTION hub.usage_daily_ins()
  RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
  AS $$
BEGIN
  INSERT INTO hub.usage_daily AS d (tenant_id, day, app, feature, agent_id, model, provider_key, billing, outcome,
    user_id, calls, runs, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, unpriced,
    latency_ms_sum, latency_n)
  SELECT x.tenant_id, ((x.at AT TIME ZONE 'UTC') + interval '420 minutes')::date,
    hub.usage_app(x.app, x.feature, x.billing), x.feature, x.agent_id, x.model, x.provider_key, x.billing, x.outcome,
    x.user_id, count(*), count(*) FILTER (WHERE x.run_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM hub.usage_logs e
      WHERE e.run_id = x.run_id AND (e.at, e.id) < (x.at, x.id))),
    sum(x.input_tokens), sum(x.output_tokens), sum(coalesce(x.cache_read_tokens, 0)),
    sum(coalesce(x.cache_write_tokens, 0)), sum(coalesce(x.cost_usd, 0)), count(*) FILTER (WHERE x.cost_usd IS NULL),
    sum(coalesce(x.latency_ms, 0)), count(x.latency_ms)
  FROM new_rows x
  GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10
  ORDER BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10
  ON CONFLICT (tenant_id, day, app, feature, agent_id, model, provider_key, billing, outcome, user_id) DO UPDATE SET
    calls = d.calls + EXCLUDED.calls, runs = d.runs + EXCLUDED.runs,
    input_tokens = d.input_tokens + EXCLUDED.input_tokens, output_tokens = d.output_tokens + EXCLUDED.output_tokens,
    cache_read_tokens = d.cache_read_tokens + EXCLUDED.cache_read_tokens,
    cache_write_tokens = d.cache_write_tokens + EXCLUDED.cache_write_tokens,
    cost_usd = d.cost_usd + EXCLUDED.cost_usd, unpriced = d.unpriced + EXCLUDED.unpriced,
    latency_ms_sum = d.latency_ms_sum + EXCLUDED.latency_ms_sum, latency_n = d.latency_n + EXCLUDED.latency_n;
  RETURN NULL;
END
$$;
--> statement-breakpoint
-- UPDATE (gắn app/feature/outcome khi run xong) và DELETE: trừ phần cũ, cộng phần mới; nhóm không đổi (tổng 0) bỏ qua.
CREATE OR REPLACE FUNCTION hub.usage_daily_upd()
  RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
  AS $$
BEGIN
  INSERT INTO hub.usage_daily AS d (tenant_id, day, app, feature, agent_id, model, provider_key, billing, outcome,
    user_id, calls, runs, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, unpriced,
    latency_ms_sum, latency_n)
  SELECT x.tenant_id, ((x.at AT TIME ZONE 'UTC') + interval '420 minutes')::date,
    hub.usage_app(x.app, x.feature, x.billing), x.feature, x.agent_id, x.model, x.provider_key, x.billing, x.outcome,
    x.user_id, sum(x.s), coalesce(sum(x.s) FILTER (WHERE x.run_id IS NOT NULL AND NOT EXISTS (SELECT 1
      FROM hub.usage_logs e WHERE e.run_id = x.run_id AND (e.at, e.id) < (x.at, x.id))), 0),
    sum(x.s * x.input_tokens), sum(x.s * x.output_tokens), sum(x.s * coalesce(x.cache_read_tokens, 0)),
    sum(x.s * coalesce(x.cache_write_tokens, 0)), sum(x.s * coalesce(x.cost_usd, 0)),
    coalesce(sum(x.s) FILTER (WHERE x.cost_usd IS NULL), 0), sum(x.s * coalesce(x.latency_ms, 0)),
    coalesce(sum(x.s) FILTER (WHERE x.latency_ms IS NOT NULL), 0)
  FROM (SELECT -1 AS s, o.* FROM old_rows o UNION ALL SELECT 1, n.* FROM new_rows n) x
  GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10
  HAVING sum(x.s) <> 0 OR sum(x.s * x.input_tokens) <> 0 OR sum(x.s * x.output_tokens) <> 0
    OR sum(x.s * coalesce(x.cost_usd, 0)) <> 0
  ORDER BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10
  ON CONFLICT (tenant_id, day, app, feature, agent_id, model, provider_key, billing, outcome, user_id) DO UPDATE SET
    calls = d.calls + EXCLUDED.calls, runs = d.runs + EXCLUDED.runs,
    input_tokens = d.input_tokens + EXCLUDED.input_tokens, output_tokens = d.output_tokens + EXCLUDED.output_tokens,
    cache_read_tokens = d.cache_read_tokens + EXCLUDED.cache_read_tokens,
    cache_write_tokens = d.cache_write_tokens + EXCLUDED.cache_write_tokens,
    cost_usd = d.cost_usd + EXCLUDED.cost_usd, unpriced = d.unpriced + EXCLUDED.unpriced,
    latency_ms_sum = d.latency_ms_sum + EXCLUDED.latency_ms_sum, latency_n = d.latency_n + EXCLUDED.latency_n;
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION hub.usage_daily_del()
  RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
  AS $$
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    TRUNCATE hub.usage_daily;
    RETURN NULL;
  END IF;
  UPDATE hub.usage_daily d SET calls = d.calls - g.calls, runs = d.runs - g.runs,
    input_tokens = d.input_tokens - g.input_tokens, output_tokens = d.output_tokens - g.output_tokens,
    cache_read_tokens = d.cache_read_tokens - g.cache_read_tokens,
    cache_write_tokens = d.cache_write_tokens - g.cache_write_tokens, cost_usd = d.cost_usd - g.cost_usd,
    unpriced = d.unpriced - g.unpriced, latency_ms_sum = d.latency_ms_sum - g.latency_ms_sum,
    latency_n = d.latency_n - g.latency_n
  FROM (
    SELECT x.tenant_id, ((x.at AT TIME ZONE 'UTC') + interval '420 minutes')::date AS day,
      hub.usage_app(x.app, x.feature, x.billing) AS app, x.feature, x.agent_id, x.model, x.provider_key, x.billing,
      x.outcome, x.user_id, count(*) AS calls,
      count(*) FILTER (WHERE x.run_id IS NOT NULL AND x.rn = 1 AND NOT EXISTS (SELECT 1 FROM hub.usage_logs e
        WHERE e.run_id = x.run_id AND (e.at, e.id) < (x.at, x.id))) AS runs,
      sum(x.input_tokens) AS input_tokens, sum(x.output_tokens) AS output_tokens,
      sum(coalesce(x.cache_read_tokens, 0)) AS cache_read_tokens,
      sum(coalesce(x.cache_write_tokens, 0)) AS cache_write_tokens, sum(coalesce(x.cost_usd, 0)) AS cost_usd,
      count(*) FILTER (WHERE x.cost_usd IS NULL) AS unpriced, sum(coalesce(x.latency_ms, 0)) AS latency_ms_sum,
      count(x.latency_ms) AS latency_n
    FROM (SELECT o.*, row_number() OVER (PARTITION BY o.run_id ORDER BY o.at, o.id) AS rn FROM old_rows o) x
    GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10) g
  WHERE d.tenant_id = g.tenant_id AND d.day = g.day AND d.app = g.app AND d.billing = g.billing
    AND d.feature IS NOT DISTINCT FROM g.feature AND d.agent_id IS NOT DISTINCT FROM g.agent_id
    AND d.model IS NOT DISTINCT FROM g.model AND d.provider_key IS NOT DISTINCT FROM g.provider_key
    AND d.outcome IS NOT DISTINCT FROM g.outcome AND d.user_id IS NOT DISTINCT FROM g.user_id;
  DELETE FROM hub.usage_daily WHERE calls <= 0 AND day IN (SELECT DISTINCT ((at AT TIME ZONE 'UTC')
    + interval '420 minutes')::date FROM old_rows);
  RETURN NULL;
END
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS usage_logs_daily_ins ON hub.usage_logs;
--> statement-breakpoint
CREATE TRIGGER usage_logs_daily_ins AFTER INSERT ON hub.usage_logs REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION hub.usage_daily_ins();
--> statement-breakpoint
DROP TRIGGER IF EXISTS usage_logs_daily_upd ON hub.usage_logs;
--> statement-breakpoint
CREATE TRIGGER usage_logs_daily_upd AFTER UPDATE ON hub.usage_logs
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION hub.usage_daily_upd();
--> statement-breakpoint
DROP TRIGGER IF EXISTS usage_logs_daily_del ON hub.usage_logs;
--> statement-breakpoint
CREATE TRIGGER usage_logs_daily_del AFTER DELETE ON hub.usage_logs REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION hub.usage_daily_del();
--> statement-breakpoint
DROP TRIGGER IF EXISTS usage_logs_daily_trunc ON hub.usage_logs;
--> statement-breakpoint
CREATE TRIGGER usage_logs_daily_trunc AFTER TRUNCATE ON hub.usage_logs
  FOR EACH STATEMENT EXECUTE FUNCTION hub.usage_daily_del();
--> statement-breakpoint
-- AI client (lib/ai-client): như `hub.log_ai_usage_billed` (0044) + `outcome`. Giữ hàm cũ (gọi cũ vẫn chạy).
CREATE OR REPLACE FUNCTION hub.log_ai_usage_v3(
  p_tenant_id uuid, p_user_id uuid, p_feature text, p_provider_key text, p_model text,
  p_input_tokens integer, p_output_tokens integer, p_cache_read_tokens integer, p_cache_write_tokens integer,
  p_cost_usd numeric, p_latency_ms integer, p_billing text, p_outcome text)
  RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
  AS $$
BEGIN
  IF p_billing IS NULL OR p_billing NOT IN ('api', 'subscription') THEN
    RAISE EXCEPTION 'invalid billing' USING ERRCODE = '22023';
  END IF;
  INSERT INTO hub.usage_logs (tenant_id, user_id, feature, provider_key, model, billing, input_tokens, output_tokens,
    cache_read_tokens, cache_write_tokens, cost_usd, billable_usd, overage, latency_ms, outcome)
  VALUES (p_tenant_id, p_user_id, p_feature, p_provider_key, p_model, p_billing, greatest(p_input_tokens, 0),
    greatest(p_output_tokens, 0), greatest(p_cache_read_tokens, 0), greatest(p_cache_write_tokens, 0),
    CASE WHEN p_cost_usd IS NULL THEN NULL ELSE greatest(p_cost_usd, 0) END, NULL, false, greatest(p_latency_ms, 0),
    p_outcome);
END
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION hub.log_ai_usage_v3(uuid, uuid, text, text, text, integer, integer, integer, integer,
  numeric, integer, text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION hub.log_ai_usage_v3(uuid, uuid, text, text, text, integer, integer, integer, integer,
  numeric, integer, text, text) TO hub_rw;
--> statement-breakpoint
-- Kết thúc một job của run (runner): gắn `feature='chat'` (trừ run quy trình — giữ ngữ nghĩa trần token như 0042), `app`
-- theo run (process | rooms | bề mặt gửi tin | chat) và `outcome` cho các dòng chưa gắn. Trả số dòng usage của run.
CREATE OR REPLACE FUNCTION hub.tag_run_usage(p_tenant_id uuid, p_run_id uuid, p_stage boolean, p_ok boolean)
  RETURNS integer
  LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
  AS $$
  WITH r AS (SELECT CASE WHEN x.room_id IS NOT NULL THEN 'rooms' ELSE x.surface END AS app0 FROM hub.runs x
    WHERE x.id = p_run_id AND x.tenant_id = p_tenant_id),
  u AS (UPDATE hub.usage_logs l SET
      feature = CASE WHEN l.feature IS NULL AND NOT p_stage THEN 'chat' ELSE l.feature END,
      app = coalesce(l.app, CASE WHEN p_stage THEN 'process' END, (SELECT app0 FROM r), 'chat'),
      outcome = coalesce(l.outcome, CASE WHEN p_ok THEN 'ok' ELSE 'error' END)
    WHERE l.tenant_id = p_tenant_id AND l.run_id = p_run_id
      AND ((l.feature IS NULL AND NOT p_stage) OR l.app IS NULL OR l.outcome IS NULL)
    RETURNING 1)
  SELECT greatest((SELECT count(*) FROM u),
    (SELECT count(*) FROM hub.usage_logs WHERE tenant_id = p_tenant_id AND run_id = p_run_id))::integer
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION hub.tag_run_usage(uuid, uuid, boolean, boolean) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION hub.tag_run_usage(uuid, uuid, boolean, boolean) TO hub_rw;
--> statement-breakpoint
-- Bề mặt gửi tin (header `X-Ai-Surface` của E12, vd dock Sổ Hợp Tác = `contracts`): ghi lên run của chính người gửi và sửa
-- các dòng đã gắn `chat` mặc định (hai thứ tự đều hội tụ).
CREATE OR REPLACE FUNCTION hub.set_run_surface(p_tenant_id uuid, p_user_id uuid, p_run_id uuid, p_surface text)
  RETURNS void
  LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
  AS $$
  WITH r AS (UPDATE hub.runs SET surface = p_surface
    WHERE id = p_run_id AND tenant_id = p_tenant_id AND user_id = p_user_id AND stage_run_id IS NULL AND room_id IS NULL
    RETURNING id)
  UPDATE hub.usage_logs l SET app = p_surface FROM r
  WHERE l.tenant_id = p_tenant_id AND l.run_id = r.id AND l.app = 'chat'
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION hub.set_run_surface(uuid, uuid, uuid, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION hub.set_run_surface(uuid, uuid, uuid, text) TO hub_rw;
--> statement-breakpoint
-- Admin không đọc `hub.agents` (khoá H1 A51): nhãn agent theo lô id (một câu, chỉ key + tên).
CREATE OR REPLACE FUNCTION hub.agent_labels(p_ids uuid[])
  RETURNS TABLE (id uuid, key text, name jsonb)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
  AS $$
  SELECT a.id, a.key, a.name FROM hub.agents a WHERE a.id = ANY (p_ids)
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION hub.agent_labels(uuid[]) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION hub.agent_labels(uuid[]) TO admin_rw;

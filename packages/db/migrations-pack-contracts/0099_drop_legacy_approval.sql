-- CR-127 · Z1 · BR-78/79 · spec §5.8, §11 · D6: gỡ đường duyệt cũ (máy 2 bước `mode='machine'`, cờ `approval_on()`, đoạn huỷ mốc của trigger thay phiên bản).
-- Thứ tự: (1) CHỐT CHẶN — còn dữ liệu theo đường cũ/lệch thì RAISE (dừng deploy, tách hai đợt); (2) đổi trigger; (3) gỡ cờ; (4) quyền đọc cho ops-watch.
-- >>> Z1 CHOT CHAN
DO $$
DECLARE
  machine_open int;
  closed_with_run int;
  processing_no_run int;
BEGIN
  -- (a) lượt MÁY CŨ còn mở: cấp 1/cấp 2 (không còn đường nào mở/quyết) hoặc lượt đọc `extracting` mà HĐ không còn đang đọc (mồ côi).
  SELECT count(*) INTO machine_open FROM contracts.approvals a
  WHERE a.mode = 'machine' AND (a.status IN ('level1', 'level2') OR (a.status = 'extracting' AND NOT EXISTS (
      SELECT 1 FROM contracts.contracts c WHERE c.id = a.contract_id AND c.tenant_id = a.tenant_id
        AND c.run_id = a.id AND c.extract_state = 'reading')));
  IF machine_open > 0 THEN
    RAISE EXCEPTION 'Z1: còn % lượt duyệt máy cũ đang mở (mode machine, level1/level2/extracting mồ côi) — đóng hoặc chuyển trước khi gỡ', machine_open;
  END IF;
  -- (b) HĐ đã chốt (done/reject) mà vẫn trỏ lượt đang mở.
  SELECT count(*) INTO closed_with_run FROM contracts.contracts c
    JOIN contracts.approvals a ON a.id = c.run_id AND a.tenant_id = c.tenant_id
  WHERE c.status IN ('done', 'reject') AND a.status IN ('extracting', 'level1', 'level2');
  IF closed_with_run > 0 THEN
    RAISE EXCEPTION 'Z1: % HĐ done/reject còn lượt duyệt đang mở', closed_with_run;
  END IF;
  -- (c) HĐ đang xử lý (processing) không có lượt đang mở.
  SELECT count(*) INTO processing_no_run FROM contracts.contracts c
  WHERE c.status = 'processing' AND NOT EXISTS (
    SELECT 1 FROM contracts.approvals a WHERE a.id = c.run_id AND a.tenant_id = c.tenant_id
      AND a.status IN ('extracting', 'level1', 'level2'));
  IF processing_no_run > 0 THEN
    RAISE EXCEPTION 'Z1: % HĐ processing không có lượt duyệt đang mở', processing_no_run;
  END IF;
END $$;
--> statement-breakpoint
-- <<< Z1 CHOT CHAN
-- K5 chuyển mốc open sang phiên bản mới (giữ id) TRƯỚC khi cổng đổi trạng thái ⇒ trigger không còn huỷ mốc (bỏ cutover `replaced`, BR-36b);
-- chỉ còn: đánh dấu bản cũ bị thay + sự kiện (`cancelled`/`kept_stock` giữ khoá rỗng cho người đọc sự kiện cũ).
CREATE OR REPLACE FUNCTION contracts.k2_supersede() RETURNS trigger
  LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  sup uuid[];
  eff date := coalesce(NEW.start_date, current_date);
BEGIN
  WITH s AS (
    UPDATE contracts.contracts c SET superseded_at = now(), superseded_by = NEW.id
    WHERE c.tenant_id = NEW.tenant_id AND c.root_id = NEW.root_id AND c.version_no < NEW.version_no
      AND c.superseded_at IS NULL
    RETURNING c.id)
  SELECT coalesce(array_agg(s.id), '{}'::uuid[]) INTO sup FROM s;
  IF cardinality(sup) = 0 THEN
    RETURN NULL;
  END IF;
  INSERT INTO contracts.contract_events (tenant_id, contract_id, type, actor_user_id, data)
  SELECT NEW.tenant_id, NEW.id, 'version_cutover', NEW.confirmed_by, jsonb_build_object('superseded', to_jsonb(sup),
      'cancelled', '[]'::jsonb, 'kept_stock', '[]'::jsonb, 'effective_from', eff, 'version_no', NEW.version_no)
  UNION ALL
  SELECT NEW.tenant_id, x, 'superseded', NEW.confirmed_by, jsonb_build_object('by', NEW.id, 'version_no', NEW.version_no)
  FROM unnest(sup) x;
  RETURN NULL;
END $$;
--> statement-breakpoint
-- Cờ duyệt theo công ty (`approval_on()`) hết nghĩa: mọi HĐ đi qua quy trình khớp (không có ⇒ DONE ngay, §3 #1). Gỡ hàm + cột.
DROP FUNCTION IF EXISTS contracts.approval_on();
--> statement-breakpoint
DROP FUNCTION IF EXISTS contracts.approval_default();
--> statement-breakpoint
ALTER TABLE contracts.approval_settings DROP COLUMN IF EXISTS approval_enabled;
--> statement-breakpoint
-- ops-watch (`contract_state_drift`, hub-api) quét CHÉO công ty: không cấp quyền đọc bảng cho `contracts_job` (policy USING(true) quá rộng, lộ `fields`);
-- chỉ MỘT hàm SECURITY DEFINER trả 5 số đếm (không lộ hàng nào). Chủ hàm = role migrate (đọc mọi tenant).
CREATE OR REPLACE FUNCTION contracts.state_drift_counts()
  RETURNS TABLE (processing_no_run int, closed_with_run int, effect_drift int, over_plan int, request_no_event int)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  WITH live(s) AS (VALUES ('extracting'), ('level1'), ('level2')),
  c AS (SELECT tenant_id, id, status, run_id, effect, effect_outcome, superseded_at, start_date, end_date, fields, updated_at
    FROM contracts.contracts)
  SELECT
    (SELECT count(*)::int FROM c WHERE c.status = 'processing' AND c.updated_at < now() - interval '10 minutes'
      AND NOT EXISTS (SELECT 1 FROM contracts.approvals a WHERE a.id = c.run_id AND a.tenant_id = c.tenant_id
        AND a.status IN (SELECT s FROM live))),
    (SELECT count(*)::int FROM c JOIN contracts.approvals a ON a.id = c.run_id AND a.tenant_id = c.tenant_id
      WHERE c.status IN ('done', 'reject') AND a.status IN (SELECT s FROM live)),
    (SELECT count(*)::int FROM c
      WHERE (c.status = 'done' AND c.superseded_at IS NULL AND c.effect IS NULL)
        OR (c.effect IS DISTINCT FROM contracts.effect_of(c.status, c.superseded_at, c.effect_outcome, c.start_date, c.end_date, c.fields, current_date)
          AND c.effect IS DISTINCT FROM contracts.effect_of(c.status, c.superseded_at, c.effect_outcome, c.start_date, c.end_date, c.fields, current_date - 1)
          AND c.effect IS DISTINCT FROM contracts.effect_of(c.status, c.superseded_at, c.effect_outcome, c.start_date, c.end_date, c.fields, current_date + 1))),
    (SELECT count(*)::int FROM (
      SELECT o.tenant_id, o.contract_id FROM contracts.obligations o
      WHERE o.kind = 'payment' AND o.status <> 'cancelled' AND o.amount IS NOT NULL
      GROUP BY o.tenant_id, o.contract_id
      HAVING sum(o.amount) > 1.05 * (SELECT (c2.fields -> 'total_value' ->> 'value')::numeric FROM c c2
        WHERE c2.id = o.contract_id AND c2.tenant_id = o.tenant_id AND (c2.fields -> 'total_value' ->> 'value') ~ '^[0-9]{1,15}$')) x),
    (SELECT count(*)::int FROM contracts.exec_requests r WHERE r.status = 'pending' AND r.flow_event_id IS NULL
      AND r.requested_at < now() - interval '10 minutes')
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION contracts.state_drift_counts() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION contracts.state_drift_counts() TO contracts_job;

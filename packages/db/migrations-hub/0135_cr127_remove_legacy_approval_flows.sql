-- CR-127 · Z3 · gỡ quy trình duyệt HĐ KIỂU CŨ (CR-121 "máy duyệt trên engine": stage tool `contracts-route` / `contracts-finalize`).
-- Lý do: submit CR-127 (`POST /contracts/:id/submit`) không điền `approvals.flow_steps` ⇒ tool cũ ném PACK_TOOL_BUSINESS ⇒ lượt kẹt
-- `needs_decision`, HĐ kẹt `processing`. Người dùng chốt 2026-11-10: "quy trình cũ chưa ai xài, remove luôn".
-- Làm theo thứ tự (một tx, chạy lại vô hại):
--   1. Tập def cũ = def (bản nháp HOẶC mọi bản phát hành) có stage `executor.kind='tool'` + `tool_key` ∈ {contracts-route, contracts-finalize}
--      (def mẫu nền tảng `tenant_id IS NULL` lẫn bản riêng của công ty).
--   2. Lượt đang mở của các def đó ⇒ `cancelled` (decision.reason = 'legacy_flow_removed'), đóng stage/hẹn/việc mở (như `cancelEnd`).
--   3. (KHÔNG ở hub) HĐ `processing` gắn lượt vừa huỷ ⇒ `draft` + `contract_events` + đóng `contracts.approvals`: migration gói
--      contracts 0100 (hub chạy trước gói; schema gói có thể < 0091) — tìm HĐ theo lượt đã huỷ `reason='legacy_flow_removed'`.
--   4. Gỡ gán: luật định tuyến + `process_tenant_defs` + `company_flows`; mặc định khe (`process_slots`) trỏ def cũ ⇒ xoá dòng khe
--      (người dùng chốt 2026-11-10: không còn quy trình mặc định/mẫu thư viện cho app Hợp đồng — công ty tự tạo flow; hub 0136).
--   5. Lưu trữ def (`deleted_at`, `enabled=false`); KHÔNG xoá cứng (lượt cũ + bản phát hành còn tham chiếu — FK RESTRICT).
-- Chốt chặn (kiểu 0099): sau khi chạy, còn gán / lượt mở / def chưa lưu trữ ⇒ RAISE (rollback cả migration).
DO $$
DECLARE
  legacy uuid[];
  n_runs int;
  n_left int;
  n_slots int := 0;
BEGIN
  -- 1. Tập def cũ.
  SELECT coalesce(array_agg(DISTINCT d.id), '{}') INTO legacy
  FROM hub.process_defs d
  WHERE EXISTS (
      SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(d.stages) = 'array' THEN d.stages ELSE '[]'::jsonb END) s
      WHERE s #>> '{executor,kind}' = 'tool' AND s #>> '{executor,tool_key}' IN ('contracts-route', 'contracts-finalize'))
    OR EXISTS (
      SELECT 1 FROM hub.process_def_releases r,
        jsonb_array_elements(CASE WHEN jsonb_typeof(r.stages) = 'array' THEN r.stages ELSE '[]'::jsonb END) s
      WHERE r.def_id = d.id
        AND s #>> '{executor,kind}' = 'tool' AND s #>> '{executor,tool_key}' IN ('contracts-route', 'contracts-finalize'));

  IF cardinality(legacy) = 0 THEN
    RAISE NOTICE '0135: không có def kiểu cũ — bỏ qua';
    RETURN;
  END IF;

  -- 2. Huỷ lượt đang mở (hẹn + việc + stage đóng như cancelEnd). Giữ danh sách để chuyển HĐ ở bước 3.
  CREATE TEMP TABLE _z3_runs ON COMMIT DROP AS
    SELECT id, tenant_id, pack_key, pack_record_id FROM hub.process_runs
    WHERE process_def_id = ANY (legacy)
      AND status IN ('running', 'waiting_review', 'waiting_answer', 'needs_decision', 'waiting_timer');
  UPDATE hub.stage_runs SET status = 'cancelled', updated_at = now()
    WHERE process_run_id IN (SELECT id FROM _z3_runs)
      AND status IN ('pending', 'queued', 'running', 'waiting_review', 'waiting_answer', 'needs_decision', 'waiting_timer');
  UPDATE hub.process_timers SET cancelled_at = now()
    WHERE process_run_id IN (SELECT id FROM _z3_runs) AND fired_at IS NULL AND cancelled_at IS NULL;
  UPDATE hub.review_tasks SET status = 'closed', result = 'cancelled', decided_at = now()
    WHERE process_run_id IN (SELECT id FROM _z3_runs) AND status = 'open';
  UPDATE hub.process_runs SET status = 'cancelled', finished_at = now(), updated_at = now(),
      decision = coalesce(decision, '{}'::jsonb) || '{"reason":"legacy_flow_removed"}'::jsonb
    WHERE id IN (SELECT id FROM _z3_runs);
  GET DIAGNOSTICS n_runs = ROW_COUNT;

  -- 3. (HĐ processing gắn lượt vừa huỷ ⇒ draft + đóng lượt `contracts.approvals`: KHÔNG làm ở đây — hub chạy TRƯỚC gói, schema gói
  --    có thể < 0091 (chưa có `effect`/`effect_of`). Việc đó ở migration gói contracts 0100_cr127_close_cancelled_flow_contracts, tìm HĐ
  --    theo lượt đã huỷ với `decision.reason = 'legacy_flow_removed'`.)

  -- 4. Gỡ gán (thứ tự theo FK: luật → gán def → company_flows → mặc định khe).
  DELETE FROM hub.process_routing_rules WHERE def_id = ANY (legacy);
  DELETE FROM hub.process_tenant_defs WHERE def_id = ANY (legacy);
  DELETE FROM hub.company_flows WHERE flow_id = ANY (legacy);
  DELETE FROM hub.process_slots WHERE default_def_id = ANY (legacy);
  GET DIAGNOSTICS n_slots = ROW_COUNT;

  -- 5. Lưu trữ def.
  UPDATE hub.process_defs SET deleted_at = coalesce(deleted_at, now()), enabled = false, updated_at = now()
    WHERE id = ANY (legacy) AND (deleted_at IS NULL OR enabled);

  -- Chốt chặn.
  SELECT (SELECT count(*) FROM hub.process_tenant_defs WHERE def_id = ANY (legacy))
       + (SELECT count(*) FROM hub.process_routing_rules WHERE def_id = ANY (legacy))
       + (SELECT count(*) FROM hub.company_flows WHERE flow_id = ANY (legacy))
       + (SELECT count(*) FROM hub.process_runs WHERE process_def_id = ANY (legacy)
            AND status IN ('running', 'waiting_review', 'waiting_answer', 'needs_decision', 'waiting_timer'))
       + (SELECT count(*) FROM hub.process_defs WHERE id = ANY (legacy) AND deleted_at IS NULL)
       + (SELECT count(*) FROM hub.process_slots WHERE default_def_id = ANY (legacy))
    INTO n_left;
  IF n_left <> 0 THEN
    RAISE EXCEPTION '0135: còn % mục gán/lượt mở/def chưa gỡ', n_left;
  END IF;
  RAISE NOTICE '0135: gỡ % def kiểu cũ, huỷ % lượt, xoá % khe mặc định (HĐ về draft: gói contracts 0100)', cardinality(legacy), n_runs, n_slots;
END $$;

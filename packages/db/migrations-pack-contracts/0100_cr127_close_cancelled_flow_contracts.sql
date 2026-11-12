-- CR-127 · Z3/Z4 · (chuyển từ hub 0135/0136 — hub chạy TRƯỚC gói nên không được dùng `contracts.effect_of`/`effect` của 0091).
-- Hub 0135/0136 huỷ lượt engine của quy trình duyệt HĐ kiểu cũ / mẫu `hd-*` với `decision.reason` = `legacy_flow_removed` | `template_removed`.
-- Ở đây (gói đã tới 0091+) xử lý phía HĐ, theo lượt đã huỷ đó (`hub.process_runs.pack_key='contracts'`, `pack_record_id` = id HĐ):
--   1. HĐ `processing` ⇒ `draft` + `contract_events(status_changed)` — cùng thay đổi cột của `applyTransition` (K1a/K1b): GUC
--      `contracts.state_gate = 'bulk:<txid>'`, CAS `status = 'processing'`, effect + version. Bỏ qua HĐ còn lượt engine MỞ khác
--      (người dùng đã gửi duyệt lại) — không kéo nhầm HĐ đang chạy quy trình mới.
--   2. Lượt `contracts.approvals` còn sống (`extracting`/`level1`/`level2`) của chính các lượt engine đã huỷ ⇒ `cancelled` (không để chỉ mục
--      `approvals_live_uq` chặn Gửi duyệt lại; cả HĐ đã về draft bởi bản cũ của 0135/0136 trên DB dev).
-- Idempotent: chạy lại không còn HĐ processing / lượt sống thuộc lượt đã huỷ ⇒ không đổi gì. Chốt chặn cuối ⇒ RAISE (rollback).
DO $$
DECLARE
  n_contracts int := 0;
  n_approvals int := 0;
  n_left int;
BEGIN
  DROP TABLE IF EXISTS _cr127_cancelled;
  CREATE TEMP TABLE _cr127_cancelled ON COMMIT DROP AS
    SELECT DISTINCT ON (r.tenant_id, r.pack_record_id) r.id AS run_id, r.tenant_id, r.pack_record_id AS contract_id,
      r.decision ->> 'reason' AS reason
    FROM hub.process_runs r
    WHERE r.pack_key = 'contracts' AND r.status = 'cancelled' AND r.pack_record_id IS NOT NULL
      AND r.decision ->> 'reason' IN ('legacy_flow_removed', 'template_removed')
    ORDER BY r.tenant_id, r.pack_record_id, r.finished_at DESC NULLS LAST, r.id;

  PERFORM set_config('contracts.state_gate', 'bulk:' || txid_current()::text, true);
  WITH u AS (
    UPDATE contracts.contracts c SET status = 'draft',
        effect = contracts.effect_of('draft', c.superseded_at, c.effect_outcome, c.start_date, c.end_date, c.fields, current_date),
        version = c.version + 1, updated_at = now()
      FROM _cr127_cancelled t
      WHERE c.id = t.contract_id AND c.tenant_id = t.tenant_id AND c.status = 'processing'
        AND NOT EXISTS (SELECT 1 FROM hub.process_runs o WHERE o.tenant_id = c.tenant_id AND o.pack_key = 'contracts'
          AND o.pack_record_id = c.id AND o.status IN ('running', 'waiting_review', 'waiting_answer', 'needs_decision', 'waiting_timer'))
      RETURNING c.id, c.tenant_id, t.reason),
  ev AS (
    INSERT INTO contracts.contract_events (tenant_id, contract_id, type, actor_user_id, data)
    SELECT u.tenant_id, u.id, 'status_changed', NULL,
      jsonb_build_object('from', 'processing', 'to', 'draft', 'ev', 'flow_cancelled',
        'reason', CASE u.reason
          WHEN 'template_removed' THEN 'Mẫu quy trình đã được gỡ — vào Quy trình tạo quy trình của công ty rồi Gửi duyệt lại'
          ELSE 'Quy trình duyệt cũ đã được gỡ — kiểm lại rồi Gửi duyệt' END,
        'code', u.reason, 'evidence_id', NULL)
    FROM u RETURNING 1)
  SELECT count(*) INTO n_contracts FROM u;
  PERFORM set_config('contracts.state_gate', '', true);

  WITH a AS (
    UPDATE contracts.approvals p SET status = 'cancelled', decided_at = coalesce(p.decided_at, now()), updated_at = now()
      FROM _cr127_cancelled t
      WHERE p.tenant_id = t.tenant_id AND p.engine_run_id = t.run_id AND p.status IN ('extracting', 'level1', 'level2')
      RETURNING 1)
  SELECT count(*) INTO n_approvals FROM a;

  -- Chốt chặn: không còn HĐ processing (không có lượt engine mở khác) / lượt sống gắn lượt đã huỷ.
  SELECT (SELECT count(*) FROM contracts.contracts c JOIN _cr127_cancelled t ON c.id = t.contract_id AND c.tenant_id = t.tenant_id
            WHERE c.status = 'processing'
              AND NOT EXISTS (SELECT 1 FROM hub.process_runs o WHERE o.tenant_id = c.tenant_id AND o.pack_key = 'contracts'
                AND o.pack_record_id = c.id AND o.status IN ('running', 'waiting_review', 'waiting_answer', 'needs_decision', 'waiting_timer')))
       + (SELECT count(*) FROM contracts.approvals p JOIN _cr127_cancelled t ON p.tenant_id = t.tenant_id AND p.engine_run_id = t.run_id
            WHERE p.status IN ('extracting', 'level1', 'level2'))
    INTO n_left;
  IF n_left <> 0 THEN
    RAISE EXCEPTION '0100: còn % HĐ processing/lượt duyệt sống gắn lượt engine đã huỷ (flow gỡ)', n_left;
  END IF;
  RAISE NOTICE '0100: % HĐ về draft, % lượt duyệt đóng', n_contracts, n_approvals;
END $$;

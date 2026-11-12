-- CR-127 · Z4 · gỡ 11 mẫu quy trình Sổ Hợp Tác khỏi Thư viện (người dùng chốt 2026-11-10: "hiện chỉ cho tạo flow trống, không cần thư viện gì, bỏ luôn 11 mẫu").
-- Mẫu (tenant_id NULL): hd-duyet-2-cap, hd-duyet-theo-gia-tri, hd-duyet-theo-phong-ban, hd-giao-dich-lon, hd-moc-qua-han, hd-nhan-hop-dong,
-- hd-nhan-quan-trong, hd-nhan-thuong, hd-sap-het-han, hd-thay-doi-thuc-hien, hd-xac-nhan-moc. KHÔNG đụng quy trình app khác (Mua hàng, AISDLC/DLC,
-- Community, Hoá đơn) và bản sao của công ty (tenant_id có giá trị). Khuôn 0135, một tx, chạy lại vô hại:
--   1. Tập mẫu theo mã.   2. Lượt đang mở trên chính mẫu ⇒ `cancelled` (decision.reason = 'template_removed'), đóng stage/hẹn/việc mở.
--   3. (KHÔNG ở hub) HĐ `processing` gắn lượt vừa huỷ ⇒ `draft` + `contract_events` + đóng `contracts.approvals`: migration gói
--      contracts 0100 (hub chạy trước gói; schema gói có thể < 0091) — tìm HĐ theo lượt đã huỷ `reason='template_removed'`.
--   4. Gỡ gán: luật định tuyến + `process_tenant_defs` + `company_flows` + dòng khe `process_slots` (khe không còn mặc định ⇒ xoá dòng).
--   5. Lưu trữ mẫu (`deleted_at`, `enabled=false`); KHÔNG xoá cứng (lượt cũ + bản phát hành còn tham chiếu — FK RESTRICT).
-- Chốt chặn: còn gán / lượt mở / def chưa lưu trữ ⇒ RAISE (rollback cả migration).
DO $$
DECLARE
  legacy uuid[];
  n_runs int;
  n_left int;
  n_slots int := 0;
BEGIN
  -- 1. Tập mẫu: 11 mẫu Thư viện (tenant_id NULL) theo mã; bản sao của công ty (tenant_id có giá trị) KHÔNG nằm trong tập.
  SELECT coalesce(array_agg(d.id), '{}') INTO legacy
  FROM hub.process_defs d
  WHERE d.tenant_id IS NULL AND d.key IN (
    'hd-duyet-2-cap', 'hd-duyet-theo-gia-tri', 'hd-duyet-theo-phong-ban', 'hd-giao-dich-lon', 'hd-moc-qua-han',
    'hd-nhan-hop-dong', 'hd-nhan-quan-trong', 'hd-nhan-thuong', 'hd-sap-het-han', 'hd-thay-doi-thuc-hien', 'hd-xac-nhan-moc');

  IF cardinality(legacy) = 0 THEN
    RAISE NOTICE '0136: không có mẫu Thư viện nào để gỡ — bỏ qua';
    RETURN;
  END IF;

  -- 2. Huỷ lượt đang mở (hẹn + việc + stage đóng như cancelEnd). Giữ danh sách để chuyển HĐ ở bước 3.
  CREATE TEMP TABLE _z4_runs ON COMMIT DROP AS
    SELECT id, tenant_id, pack_key, pack_record_id FROM hub.process_runs
    WHERE process_def_id = ANY (legacy)
      AND status IN ('running', 'waiting_review', 'waiting_answer', 'needs_decision', 'waiting_timer');
  UPDATE hub.stage_runs SET status = 'cancelled', updated_at = now()
    WHERE process_run_id IN (SELECT id FROM _z4_runs)
      AND status IN ('pending', 'queued', 'running', 'waiting_review', 'waiting_answer', 'needs_decision', 'waiting_timer');
  UPDATE hub.process_timers SET cancelled_at = now()
    WHERE process_run_id IN (SELECT id FROM _z4_runs) AND fired_at IS NULL AND cancelled_at IS NULL;
  UPDATE hub.review_tasks SET status = 'closed', result = 'cancelled', decided_at = now()
    WHERE process_run_id IN (SELECT id FROM _z4_runs) AND status = 'open';
  UPDATE hub.process_runs SET status = 'cancelled', finished_at = now(), updated_at = now(),
      decision = coalesce(decision, '{}'::jsonb) || '{"reason":"template_removed"}'::jsonb
    WHERE id IN (SELECT id FROM _z4_runs);
  GET DIAGNOSTICS n_runs = ROW_COUNT;

  -- 3. (HĐ processing ⇒ draft + đóng `contracts.approvals`: migration gói contracts 0100, tìm theo `decision.reason = 'template_removed'`.)

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
    RAISE EXCEPTION '0136: còn % mục gán/lượt mở/def chưa gỡ', n_left;
  END IF;
  RAISE NOTICE '0136: gỡ % mẫu, huỷ % lượt, xoá % khe mặc định (HĐ về draft: gói contracts 0100)', cardinality(legacy), n_runs, n_slots;
END $$;

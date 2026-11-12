-- CR-127 · Z6 · gỡ quy trình DÙNG CHUNG kiểu cũ khỏi công ty (người dùng chốt 2026-11-11: "xoá mẫu cũ — admin nền tảng tự tạo lại từ sơ đồ trống;
-- trong lúc chưa tạo, công ty bị chặn Gửi duyệt"). Phạm vi CHỈ app contracts + community (không đụng DLC, AISDLC, Hoá đơn, def công ty).
-- Một tx, chạy lại vô hại:
--   1. Tập A = def dùng chung (`tenant_id IS NULL`, `app IN ('contracts','community')`).
--   2. Gỡ gán: xoá `company_flows` có `flow_id` ∈ A (def công ty — `tenant_id` có giá trị — KHÔNG nằm trong A nên không bị chạm).
--   3. Lưu trữ (`deleted_at`, `enabled=false`; KHÔNG xoá cứng — lượt cũ + bản phát hành còn FK RESTRICT) các def thuộc A mà:
--      (a) không phải mặc định khe (`slot IS NULL` và không có dòng `process_slots`) — def khe là nền tảng, không phải "mẫu gán công ty";
--      (b) KHÔNG còn lượt đang mở (running/waiting_*/needs_decision): lượt đang chạy dùng ảnh chụp `snapshot` nên vẫn chạy tiếp, nhưng giữ def
--          nguyên để không ai bấm vào một def "đã xoá" từ lượt đó ⇒ chỉ gỡ gán (bước 2), def giữ lại tới lần chạy kế (idempotent: lượt xong ⇒ lưu trữ).
--      KHÔNG đụng `process_runs`.
--   4. Báo cache cấu hình Hub (`hub_config_version`) để công ty đang đăng nhập thấy ngay.
DO $$
DECLARE
  shared uuid[];
  n_cf int;
  n_arch int;
  n_kept int;
BEGIN
  SELECT coalesce(array_agg(d.id), '{}') INTO shared
  FROM hub.process_defs d
  WHERE d.tenant_id IS NULL AND d.app IN ('contracts', 'community');

  IF cardinality(shared) = 0 THEN
    RAISE NOTICE '0138: không có quy trình dùng chung contracts/community — bỏ qua';
    RETURN;
  END IF;

  DELETE FROM hub.company_flows WHERE flow_id = ANY (shared);
  GET DIAGNOSTICS n_cf = ROW_COUNT;

  UPDATE hub.process_defs d SET deleted_at = coalesce(d.deleted_at, now()), enabled = false, updated_at = now()
  WHERE d.id = ANY (shared) AND d.deleted_at IS NULL
    AND d.slot IS NULL
    AND NOT EXISTS (SELECT 1 FROM hub.process_slots s WHERE s.default_def_id = d.id)
    AND NOT EXISTS (SELECT 1 FROM hub.process_tenant_defs t WHERE t.def_id = d.id)
    AND NOT EXISTS (SELECT 1 FROM hub.process_routing_rules r WHERE r.def_id = d.id)
    AND NOT EXISTS (SELECT 1 FROM hub.process_runs pr WHERE pr.process_def_id = d.id
      AND pr.status IN ('running', 'waiting_review', 'waiting_answer', 'needs_decision', 'waiting_timer'));
  GET DIAGNOSTICS n_arch = ROW_COUNT;

  SELECT count(*) INTO n_kept FROM hub.process_defs d WHERE d.id = ANY (shared) AND d.deleted_at IS NULL;

  IF n_cf > 0 OR n_arch > 0 THEN
    UPDATE hub.config_meta SET hub_config_version = hub_config_version + 1 WHERE id = 1;
  END IF;
  RAISE NOTICE '0138: gỡ % dòng company_flows, lưu trữ % def dùng chung, giữ % def (mặc định khe / còn lượt mở)', n_cf, n_arch, n_kept;
END $$;

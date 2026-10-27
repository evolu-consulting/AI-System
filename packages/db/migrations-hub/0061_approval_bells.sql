-- approval-inbox · bước duyệt xong/huỷ ⇒ chuông gói của task đó (do `notify.enqueue_pack_runs` ghi, `dedup_key` = id notice) được
-- đánh dấu ĐÃ ĐỌC cho MỌI người nhận (cột duy nhất hạ tầng hỗ trợ: `read_at`). Cổng DEFINER riêng vì hub_rw chỉ sửa được hàng
-- của chính user theo RLS. Tenant lấy từ hàng run; scope khác `system` ⇒ chỉ run của `app.tenant_id`. MỘT câu UPDATE cho cả
-- lô task (Luật 4c), không vòng từng user. Chỉ thêm hàm; chạy lại vô hại.
CREATE OR REPLACE FUNCTION notify.resolve_pack_tasks(p_task_ids uuid[]) RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_sys boolean := current_setting('app.scope', true) = 'system';
  v_tid uuid := NULLIF(current_setting('app.tenant_id', true), '')::uuid;
  n integer;
BEGIN
  IF p_task_ids IS NULL OR cardinality(p_task_ids) = 0 THEN
    RETURN 0;
  END IF;
  IF NOT v_sys AND v_tid IS NULL THEN
    RAISE EXCEPTION 'notify.resolve_pack_tasks: thiếu app.tenant_id' USING ERRCODE = '22023';
  END IF;
  WITH upd AS (
    UPDATE hub.notifications b SET read_at = now()
    FROM hub.process_notices pn
    JOIN hub.process_runs pr ON pr.id = pn.process_run_id AND pr.tenant_id = pn.tenant_id
    WHERE pn.task_id = ANY (p_task_ids)
      AND pn.kind IN ('review_requested', 'ask_requested', 'decision_requested', 'reminder', 'escalated')
      AND pr.pack_key IS NOT NULL
      AND (v_sys OR pr.tenant_id = v_tid)
      AND b.tenant_id = pn.tenant_id
      AND b.user_id = pn.user_id
      AND b.source = replace(pr.pack_key, '-', '_')
      AND b.dedup_key = pn.id::text
      AND b.read_at IS NULL
    RETURNING 1)
  SELECT count(*)::integer INTO n FROM upd;
  RETURN n;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION notify.resolve_pack_tasks(uuid[]) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION notify.resolve_pack_tasks(uuid[]) TO hub_rw;

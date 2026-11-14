-- CR-161 · sửa lỗi lát 3/6 · tệp trò chuyện: `file_id` của FileBox THẬT là 16 ký tự hex (không phải uuid) ⇒ `cc_files.id` (uuid) KHÔNG thể = id FileBox.
-- Nay: `cc_files.id` uuid do route sinh (khoá `<tenant>/<id>` như 0146, CHECK `cc_files_key_ck` giữ nguyên); id FileBox lưu ở cột riêng `box_file_id`.
-- Bảng đang trống/dữ liệu thử: dòng cũ (nếu có) có id = id FileBox ⇒ backfill `box_file_id = id::text` (không mất gì), rồi NOT NULL.
-- Chữ ký hàm đổi ⇒ DROP rồi tạo lại (kiểm quyền + cách ly giữ NGUYÊN VĂN 0146; chỉ thêm tham số/cột box id) + cấp lại GRANT (DROP làm mất quyền).
ALTER TABLE hub.cc_files ADD COLUMN IF NOT EXISTS box_file_id text;
--> statement-breakpoint
UPDATE hub.cc_files SET box_file_id = id::text WHERE box_file_id IS NULL;
--> statement-breakpoint
ALTER TABLE hub.cc_files ALTER COLUMN box_file_id SET NOT NULL;
--> statement-breakpoint
ALTER TABLE hub.cc_files DROP CONSTRAINT IF EXISTS cc_files_box_ck;
--> statement-breakpoint
ALTER TABLE hub.cc_files ADD CONSTRAINT cc_files_box_ck CHECK (box_file_id ~ '^[A-Za-z0-9_-]{1,64}$');
--> statement-breakpoint
DROP FUNCTION IF EXISTS hub.cc_file_add(uuid, uuid, text, text, bigint, text);
--> statement-breakpoint
DROP FUNCTION IF EXISTS hub.cc_file_get(uuid);
--> statement-breakpoint
DROP FUNCTION IF EXISTS hub.cc_files_sweep(interval);
--> statement-breakpoint
-- R11 · ghi tệp tải lên (route đã lưu nội dung lên FileBox ⇒ `p_box_id`; `p_id` uuid + `p_storage_key` do route sinh, key = '<tenant bên tải>/<p_id>').
CREATE OR REPLACE FUNCTION hub.cc_file_add(
  p_other uuid, p_id uuid, p_box_id text, p_name text, p_mime text, p_size bigint, p_storage_key text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_tid uuid;
  v_uid uuid;
  th hub.cc_threads;
BEGIN
  v_tid := hub.cc_ctx();
  v_uid := NULLIF(current_setting('app.user_id', true), '')::uuid;
  IF p_other IS NULL OR p_other = v_tid OR p_id IS NULL THEN
    RAISE EXCEPTION 'cc_file_add: đầu vào không hợp lệ' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(least(v_tid::text, p_other::text) || greatest(v_tid::text, p_other::text), 161));
  IF NOT hub.cc_connected_raw(v_tid, p_other) THEN
    RAISE EXCEPTION 'CONNECT_READ_ONLY' USING ERRCODE = 'CC409';
  END IF;
  -- Kiểm tệp trong hàm (lỗi nghiệp vụ CC422, không phải 23514): tên 1..255, mime 1..100, 1 ≤ size ≤ 20 MB, khoá = '<tenant>/<id>', id FileBox dạng an toàn.
  IF p_name IS NULL OR char_length(btrim(p_name)) NOT BETWEEN 1 AND 255 OR p_mime IS NULL OR char_length(p_mime) NOT BETWEEN 1 AND 100
     OR p_size IS NULL OR p_size NOT BETWEEN 1 AND 20971520 OR p_storage_key IS DISTINCT FROM v_tid::text || '/' || p_id::text
     OR p_box_id IS NULL OR p_box_id !~ '^[A-Za-z0-9_-]{1,64}$' THEN
    RAISE EXCEPTION 'MSG_FILE_INVALID' USING ERRCODE = 'CC422';
  END IF;
  -- Trần tệp chưa gắn tin mỗi người (chống nhồi dung lượng): 50.
  IF (SELECT count(*) FROM hub.cc_files f WHERE f.user_id = v_uid AND f.seq IS NULL AND f.deleted_at IS NULL) >= 50 THEN
    RAISE EXCEPTION 'MSG_FILE_INVALID' USING ERRCODE = 'CC422';
  END IF;
  th := hub.cc_thread_ensure(v_tid, p_other);
  INSERT INTO hub.cc_files (id, thread_id, tenant_id, user_id, name, mime, size, storage_key, box_file_id)
  VALUES (p_id, th.id, v_tid, v_uid, btrim(p_name), p_mime, p_size, p_storage_key, p_box_id);
  RETURN jsonb_build_object('id', p_id, 'name', btrim(p_name), 'mime', p_mime, 'size', p_size);
END $$;
--> statement-breakpoint
-- R11 · nơi lưu nội dung của tệp: khoá (suy ra org FileBox bên tải) + id FileBox. Chỉ người Toàn quyền của một trong hai công ty trong cặp; tệp chưa gắn tin
-- chỉ người tải thấy. Không thấy ⇒ 0 dòng (route 404, không lộ). Đã ngắt vẫn tải được tệp của tin cũ (chỉ đọc).
CREATE OR REPLACE FUNCTION hub.cc_file_get(p_file_id uuid)
RETURNS TABLE (storage_key text, box_file_id text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_tid uuid;
  v_uid uuid;
BEGIN
  v_tid := hub.cc_ctx();
  v_uid := NULLIF(current_setting('app.user_id', true), '')::uuid;
  RETURN QUERY
  SELECT f.storage_key, f.box_file_id
    FROM hub.cc_files f JOIN hub.cc_threads t ON t.id = f.thread_id
   WHERE f.id = p_file_id AND f.deleted_at IS NULL AND v_tid IN (t.tenant_lo, t.tenant_hi)
     AND (f.seq IS NOT NULL OR f.user_id = v_uid);
END $$;
--> statement-breakpoint
-- R11 · dọn tệp chưa gắn tin quá p_older (việc nền, CHỈ scope system): soft delete + trả khoá + id FileBox để xoá nội dung. Không đụng tệp đã gắn tin.
CREATE OR REPLACE FUNCTION hub.cc_files_sweep(p_older interval)
RETURNS TABLE (file_id uuid, storage_key text, box_file_id text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
#variable_conflict use_column
BEGIN
  IF current_setting('app.scope', true) IS DISTINCT FROM 'system' THEN
    RAISE EXCEPTION 'cc_files_sweep: chỉ việc nền (scope system)' USING ERRCODE = '42501';
  END IF;
  IF p_older IS NULL OR p_older < interval '1 hour' THEN
    RAISE EXCEPTION 'cc_files_sweep: khoảng thời gian không hợp lệ' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  WITH u AS (
    UPDATE hub.cc_files f SET deleted_at = now()
     WHERE f.seq IS NULL AND f.deleted_at IS NULL AND f.created_at < now() - p_older
    RETURNING f.id AS fid, f.storage_key AS skey, f.box_file_id AS bid)
  SELECT u.fid, u.skey, u.bid FROM u;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION hub.cc_file_add(uuid, uuid, text, text, text, bigint, text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION hub.cc_file_get(uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION hub.cc_files_sweep(interval) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION hub.cc_file_add(uuid, uuid, text, text, text, bigint, text), hub.cc_file_get(uuid),
  hub.cc_files_sweep(interval) TO hub_rw;
--> statement-breakpoint
-- `contracts_rw` (tạo SAU hub ⇒ khối DO như 0147; trên DB dựng sạch migration gói 0117 cấp lại không điều kiện). Sweep KHÔNG cấp cho contracts_rw.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'contracts_rw') THEN
    GRANT USAGE ON SCHEMA hub TO contracts_rw;
    GRANT EXECUTE ON FUNCTION hub.cc_file_add(uuid, uuid, text, text, text, bigint, text), hub.cc_file_get(uuid) TO contracts_rw;
  END IF;
END $$;

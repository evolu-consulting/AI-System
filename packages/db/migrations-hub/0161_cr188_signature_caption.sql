-- CR-188 · BR-188-1 · «Dòng dưới chữ ký» (Họ tên · Chức vụ · Phòng ban) LƯU THEO TỪNG PHIÊN BẢN chữ ký: cột `hub.user_signatures.caption` (null ⇒ máy chủ dựng từ hồ sơ lúc ký).
-- Hàm DEFINER của 0155 đổi hình dạng trả về (thêm `caption`) ⇒ CREATE OR REPLACE không đủ (đổi cột OUT bị chặn): DROP đúng chữ ký cũ rồi CREATE lại, cấp lại quyền như 0155.
-- `sig_create` nhận thêm `p_caption` (mặc định NULL ⇒ lời gọi cũ 3 tham số vẫn chạy). Quyền đọc KHÔNG đổi: người dùng chỉ đọc caption của CHÍNH MÌNH (ngữ cảnh `app.user_id`),
-- `signature_for_stamp` vẫn đòi tham số khớp ngữ cảnh; `signature_png_by_ids` (0157, quản trị đọc theo luật cũ) không trả caption.
-- `signature_settings.caption` (0155) GIỮ nguyên, ngừng đọc (nợ ghi docs/TECH-DEBT.md). Không backfill: bản cũ caption = NULL ⇒ dựng từ hồ sơ lúc ký (không ghi đè).
-- Chỉ THÊM (+ thay hàm). Chạy lại được: IF NOT EXISTS / DROP IF EXISTS + CREATE.

ALTER TABLE hub.user_signatures ADD COLUMN IF NOT EXISTS caption text;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_signatures_caption_ck' AND conrelid = 'hub.user_signatures'::regclass) THEN
    ALTER TABLE hub.user_signatures ADD CONSTRAINT user_signatures_caption_ck CHECK (caption IS NULL OR char_length(caption) <= 200);
  END IF;
END $$;
--> statement-breakpoint
DROP FUNCTION IF EXISTS hub.sig_get_active(text);
--> statement-breakpoint
DROP FUNCTION IF EXISTS hub.sig_create(text, text, bytea);
--> statement-breakpoint
DROP FUNCTION IF EXISTS hub.signature_for_stamp(uuid, uuid, text);
--> statement-breakpoint
-- Bản ĐANG DÙNG của tôi (0 hàng nếu chưa có), kèm dòng dưới chữ ký. p_kind null ⇒ cả hai loại.
CREATE FUNCTION hub.sig_get_active(p_kind text)
RETURNS TABLE (id uuid, kind text, method text, png bytea, created_at timestamptz, caption text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  c record;
BEGIN
  SELECT * INTO c FROM hub.sig_ctx();
  RETURN QUERY
  SELECT s.id, s.kind, s.method, s.png, s.created_at, s.caption
    FROM hub.user_signatures s
   WHERE s.tenant_id = c.tid AND s.user_id = c.uid AND s.retired_at IS NULL AND (p_kind IS NULL OR s.kind = p_kind)
   ORDER BY s.kind;
END $$;
--> statement-breakpoint
-- Tạo/đổi chữ ký (như 0155) + lưu `p_caption` (≤ 200 ký tự, đã cắt khoảng trắng; rỗng ⇒ NULL).
CREATE FUNCTION hub.sig_create(p_kind text, p_method text, p_png bytea, p_caption text DEFAULT NULL)
RETURNS TABLE (id uuid, created_at timestamptz, replaced_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  c record;
  v_old uuid;
  v_new uuid;
  v_at timestamptz;
  v_cap text := NULLIF(btrim(p_caption), '');
BEGIN
  SELECT * INTO c FROM hub.sig_ctx();
  IF p_kind IS NULL OR p_kind NOT IN ('main', 'initials') OR p_method IS NULL OR p_method NOT IN ('draw', 'upload', 'type')
     OR p_png IS NULL OR octet_length(p_png) NOT BETWEEN 1 AND 204800
     OR (v_cap IS NOT NULL AND char_length(v_cap) > 200) THEN
    RAISE EXCEPTION 'sig_create: đầu vào sai' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(c.tid::text || ':' || c.uid::text || ':' || p_kind, 181));
  UPDATE hub.user_signatures s SET retired_at = now()
   WHERE s.tenant_id = c.tid AND s.user_id = c.uid AND s.kind = p_kind AND s.retired_at IS NULL
  RETURNING s.id INTO v_old;
  INSERT INTO hub.user_signatures AS n (tenant_id, user_id, kind, method, png, caption)
  VALUES (c.tid, c.uid, p_kind, p_method, p_png, v_cap)
  RETURNING n.id, n.created_at INTO v_new, v_at;
  id := v_new; created_at := v_at; replaced_id := v_old;
  RETURN NEXT;
END $$;
--> statement-breakpoint
-- Máy chủ in (BR-K3): bản đang dùng của đúng người ký trong ngữ cảnh, kèm dòng dưới chữ ký (null ⇒ máy chủ dựng từ hồ sơ).
CREATE FUNCTION hub.signature_for_stamp(p_tenant uuid, p_user uuid, p_kind text)
RETURNS TABLE (id uuid, method text, png bytea, created_at timestamptz, caption text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  c record;
BEGIN
  SELECT * INTO c FROM hub.sig_ctx();
  IF p_tenant IS DISTINCT FROM c.tid OR p_user IS DISTINCT FROM c.uid THEN
    RAISE EXCEPTION 'signature_for_stamp: tham số không khớp ngữ cảnh' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT s.id, s.method, s.png, s.created_at, s.caption
    FROM hub.user_signatures s
   WHERE s.tenant_id = p_tenant AND s.user_id = p_user AND s.kind = p_kind AND s.retired_at IS NULL;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION hub.sig_get_active(text), hub.sig_create(text, text, bytea, text), hub.signature_for_stamp(uuid, uuid, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION hub.sig_get_active(text), hub.sig_create(text, text, bytea, text), hub.signature_for_stamp(uuid, uuid, text) TO hub_rw;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'contracts_rw') THEN
    GRANT EXECUTE ON FUNCTION hub.sig_get_active(text), hub.signature_for_stamp(uuid, uuid, text) TO contracts_rw;
  END IF;
END $$;

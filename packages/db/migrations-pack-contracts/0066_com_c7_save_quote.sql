-- com-c7 · CR-102b · R19–R23 (nghiep-vu community §8): "Lưu báo giá" vào SP & Giá. Chỉ cộng thêm; chạy lại vô hại; dòng cũ giữ nguyên
-- (null hết = còn hiệu lực, VAT chưa rõ). `vat_included` (R19) · `expires_on` (R20, quá hạn ⇒ "Đã hết hạn") · `replaced_at` (R22, giá
-- Báo giá cùng NCC + SP + loại bị giá mới thay, vẫn trong lịch sử) · `removed_at` (R21, gỡ MỀM thay DELETE) · `origin_ref` (R23, nguồn
-- ngoài SHT, vd {pack:"community", post_id, item_idx}). Ghi: `contracts_rw` chỉ được UPDATE hai cột mốc `replaced_at`/`removed_at`
-- (giá/NCC/nguồn vẫn không sửa được, như 0031); policy UPDATE hạn chế như DELETE của 0031 + cho thay giá nguồn `quote` của người
-- khác (R28: hai thành viên cùng lưu). Đọc: không đổi (cả tenant thấy, RLS tenant `secure_table`).
ALTER TABLE contracts.product_supplier_prices ADD COLUMN IF NOT EXISTS vat_included boolean;
--> statement-breakpoint
ALTER TABLE contracts.product_supplier_prices ADD COLUMN IF NOT EXISTS expires_on date;
--> statement-breakpoint
ALTER TABLE contracts.product_supplier_prices ADD COLUMN IF NOT EXISTS replaced_at timestamptz;
--> statement-breakpoint
ALTER TABLE contracts.product_supplier_prices ADD COLUMN IF NOT EXISTS removed_at timestamptz;
--> statement-breakpoint
ALTER TABLE contracts.product_supplier_prices ADD COLUMN IF NOT EXISTS origin_ref jsonb;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_supplier_prices_origin_ck') THEN
    ALTER TABLE contracts.product_supplier_prices ADD CONSTRAINT product_supplier_prices_origin_ck
      CHECK (origin_ref IS NULL OR (jsonb_typeof(origin_ref) = 'object' AND pg_column_size(origin_ref) <= 1000));
  END IF;
END
$$;
--> statement-breakpoint
-- Giá Báo giá đang dùng của một NCC cho SP (tìm giá cần thay): một index một phần nhỏ.
CREATE INDEX IF NOT EXISTS product_supplier_prices_quote_live_idx
  ON contracts.product_supplier_prices (tenant_id, product_id, supplier_party_key, kind)
  WHERE source = 'quote' AND replaced_at IS NULL AND removed_at IS NULL;
--> statement-breakpoint
GRANT UPDATE (replaced_at, removed_at) ON contracts.product_supplier_prices TO contracts_rw;
--> statement-breakpoint
DROP POLICY IF EXISTS product_supplier_prices_upd ON contracts.product_supplier_prices;
--> statement-breakpoint
-- Nhánh `quote` (review TB-4): người khác CHỈ được đánh dấu "đã thay" (replaced_at) trên dòng Báo giá còn sống; gỡ (removed_at) vẫn
-- chỉ người tạo / người thấy hết.
CREATE POLICY product_supplier_prices_upd ON contracts.product_supplier_prices AS RESTRICTIVE FOR UPDATE TO contracts_rw
  USING ((SELECT contracts.sees_all())
    OR created_by = NULLIF(current_setting('app.user_id', true), '')::uuid
    OR (source = 'quote' AND removed_at IS NULL))
  WITH CHECK ((SELECT contracts.sees_all())
    OR created_by = NULLIF(current_setting('app.user_id', true), '')::uuid
    OR (source = 'quote' AND removed_at IS NULL AND replaced_at IS NOT NULL));

-- gap-d1 · Sổ Hợp Tác › Sản phẩm & Giá: (1) quy cách (`spec`) khi thêm SP tay; (2) dòng sổ kho `manual` (nhập lô tay — vẫn đi qua
-- `applyDelivery`, BQ + FIFO giữ nguyên); (3) "Cách lấy hàng" theo SP: bảng `product_sources` (NCC, thời gian giao, SL tối thiểu,
-- giá tham chiếu) để dựng bảng rủi ro phụ thuộc NCC. Chỉ cộng thêm; chạy lại vô hại. Tiền = bigint đồng chưa VAT.
ALTER TABLE contracts.products ADD COLUMN IF NOT EXISTS spec text;
--> statement-breakpoint
ALTER TABLE contracts.products DROP CONSTRAINT IF EXISTS products_spec_ck;
--> statement-breakpoint
ALTER TABLE contracts.products ADD CONSTRAINT products_spec_ck CHECK (char_length(spec) <= 500);
--> statement-breakpoint
ALTER TABLE contracts.stock_moves DROP CONSTRAINT IF EXISTS stock_moves_reason_ck;
--> statement-breakpoint
ALTER TABLE contracts.stock_moves ADD CONSTRAINT stock_moves_reason_ck
  CHECK (reason IN ('delivery', 'expire', 'reversal', 'manual'));
--> statement-breakpoint
-- Thấy (M1): như danh mục SP — cả tenant thấy; ghi: `created_by` phải là chính phiên; không sửa; xoá: người tạo hoặc người thấy hết.
CREATE TABLE IF NOT EXISTS contracts.product_sources (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  product_id uuid NOT NULL,
  supplier_name text NOT NULL,
  supplier_party_key text NOT NULL,
  lead_days integer,
  moq numeric(18, 4),
  price_ref bigint,
  note text,
  created_by uuid DEFAULT NULLIF(current_setting('app.user_id', true), '')::uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_sources_pkey PRIMARY KEY (id),
  CONSTRAINT product_sources_uq UNIQUE (tenant_id, product_id, supplier_party_key),
  CONSTRAINT product_sources_num_ck CHECK ((lead_days IS NULL OR lead_days BETWEEN 0 AND 3650)
    AND (moq IS NULL OR moq > 0) AND (price_ref IS NULL OR price_ref BETWEEN 1 AND 1000000000000)),
  CONSTRAINT product_sources_text_ck CHECK (char_length(supplier_name) BETWEEN 1 AND 300
    AND char_length(supplier_party_key) BETWEEN 1 AND 300 AND char_length(note) <= 500),
  CONSTRAINT product_sources_product_fk FOREIGN KEY (product_id, tenant_id)
    REFERENCES contracts.products (id, tenant_id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS product_sources_product_idx ON contracts.product_sources (tenant_id, product_id);
--> statement-breakpoint
SELECT packs.secure_table('contracts', 'product_sources');
--> statement-breakpoint
REVOKE UPDATE ON contracts.product_sources FROM contracts_rw;
--> statement-breakpoint
DROP POLICY IF EXISTS product_sources_own_ins ON contracts.product_sources;
--> statement-breakpoint
CREATE POLICY product_sources_own_ins ON contracts.product_sources AS RESTRICTIVE FOR INSERT TO contracts_rw
  WITH CHECK (created_by IS NOT DISTINCT FROM NULLIF(current_setting('app.user_id', true), '')::uuid);
--> statement-breakpoint
DROP POLICY IF EXISTS product_sources_del ON contracts.product_sources;
--> statement-breakpoint
CREATE POLICY product_sources_del ON contracts.product_sources AS RESTRICTIVE FOR DELETE TO contracts_rw
  USING ((SELECT contracts.sees_all())
    OR created_by = NULLIF(current_setting('app.user_id', true), '')::uuid);

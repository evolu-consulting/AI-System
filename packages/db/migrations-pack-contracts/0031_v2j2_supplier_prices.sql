-- V2-J2 · BA v2 §3.3 SP-04/05 · tab "Nhà cung cấp & giá" của chi tiết SP: bảng so sánh giá NCC theo SP (Mua mới / Gia hạn) mà người
-- dùng lưu từ kết quả AI tìm giá, báo giá hoặc nhập tay. Giá đã NHẬP KHO không lưu ở đây — đọc thẳng từ sổ kho (`stock_moves`).
-- Chỉ cộng thêm; chạy lại vô hại. Tiền = bigint đồng chưa VAT. Thấy (M1): như danh mục SP — cả tenant thấy (giá thị trường là thông
-- tin chung của danh mục); ghi: `created_by` phải là chính phiên; không sửa; xoá: người tạo hoặc người thấy hết.
CREATE TABLE IF NOT EXISTS contracts.product_supplier_prices (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  product_id uuid NOT NULL,
  supplier_name text NOT NULL,
  supplier_party_key text,
  kind text NOT NULL,
  price bigint NOT NULL,
  unit text,
  source text NOT NULL,
  url text,
  seen_on date NOT NULL DEFAULT CURRENT_DATE,
  note text,
  created_by uuid DEFAULT NULLIF(current_setting('app.user_id', true), '')::uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_supplier_prices_pkey PRIMARY KEY (id),
  CONSTRAINT product_supplier_prices_kind_ck CHECK (kind IN ('new', 'renew')),
  CONSTRAINT product_supplier_prices_source_ck CHECK (source IN ('market', 'quote', 'manual')),
  CONSTRAINT product_supplier_prices_price_ck CHECK (price BETWEEN 1 AND 1000000000000),
  CONSTRAINT product_supplier_prices_text_ck CHECK (char_length(supplier_name) BETWEEN 1 AND 300
    AND char_length(supplier_party_key) BETWEEN 1 AND 300 AND char_length(unit) <= 40
    AND char_length(url) <= 2000 AND char_length(note) <= 500),
  CONSTRAINT product_supplier_prices_product_fk FOREIGN KEY (product_id, tenant_id)
    REFERENCES contracts.products (id, tenant_id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS product_supplier_prices_product_idx
  ON contracts.product_supplier_prices (tenant_id, product_id, seen_on DESC);
--> statement-breakpoint
SELECT packs.secure_table('contracts', 'product_supplier_prices');
--> statement-breakpoint
REVOKE UPDATE ON contracts.product_supplier_prices FROM contracts_rw;
--> statement-breakpoint
DROP POLICY IF EXISTS product_supplier_prices_own_ins ON contracts.product_supplier_prices;
--> statement-breakpoint
CREATE POLICY product_supplier_prices_own_ins ON contracts.product_supplier_prices AS RESTRICTIVE FOR INSERT TO contracts_rw
  WITH CHECK (created_by IS NOT DISTINCT FROM NULLIF(current_setting('app.user_id', true), '')::uuid);
--> statement-breakpoint
DROP POLICY IF EXISTS product_supplier_prices_del ON contracts.product_supplier_prices;
--> statement-breakpoint
CREATE POLICY product_supplier_prices_del ON contracts.product_supplier_prices AS RESTRICTIVE FOR DELETE TO contracts_rw
  USING ((SELECT contracts.sees_all())
    OR created_by = NULLIF(current_setting('app.user_id', true), '')::uuid);

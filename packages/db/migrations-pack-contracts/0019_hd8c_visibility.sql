-- HD8 · review HD78 #2 (làn đầy đủ): M1 trên bảng HD8 — người dùng ở chế độ `org` chỉ thấy/sửa/xoá hàng của đối tác mình thấy
-- (`visible_party_keys()`, khoá bên của HĐ đã duyệt mình thấy) hoặc do chính mình tạo; `sees_all()` (chế độ tenant, owner, việc nền)
-- như cũ. RESTRICTIVE (AND với policy tenant của `packs.secure_table`). Chỉ cộng thêm; chạy lại vô hại.
ALTER TABLE contracts.companies ADD COLUMN IF NOT EXISTS created_by uuid
  DEFAULT NULLIF(current_setting('app.user_id', true), '')::uuid;
--> statement-breakpoint
ALTER TABLE contracts.price_quotes ALTER COLUMN created_by SET DEFAULT NULLIF(current_setting('app.user_id', true), '')::uuid;
--> statement-breakpoint
DROP POLICY IF EXISTS companies_visible ON contracts.companies;
--> statement-breakpoint
CREATE POLICY companies_visible ON contracts.companies AS RESTRICTIVE FOR SELECT TO contracts_rw
  USING ((SELECT contracts.sees_all())
    OR created_by = NULLIF(current_setting('app.user_id', true), '')::uuid
    OR party_key = ANY ((SELECT contracts.visible_party_keys())::text[]));
--> statement-breakpoint
DROP POLICY IF EXISTS companies_visible_upd ON contracts.companies;
--> statement-breakpoint
CREATE POLICY companies_visible_upd ON contracts.companies AS RESTRICTIVE FOR UPDATE TO contracts_rw
  USING ((SELECT contracts.sees_all())
    OR created_by = NULLIF(current_setting('app.user_id', true), '')::uuid
    OR party_key = ANY ((SELECT contracts.visible_party_keys())::text[]));
--> statement-breakpoint
REVOKE DELETE ON contracts.companies FROM contracts_rw;
--> statement-breakpoint
DROP POLICY IF EXISTS price_quotes_visible ON contracts.price_quotes;
--> statement-breakpoint
CREATE POLICY price_quotes_visible ON contracts.price_quotes AS RESTRICTIVE FOR SELECT TO contracts_rw
  USING ((SELECT contracts.sees_all())
    OR created_by = NULLIF(current_setting('app.user_id', true), '')::uuid
    OR supplier_party_key = ANY ((SELECT contracts.visible_party_keys())::text[]));
--> statement-breakpoint
-- Xoá: ngoài luật thấy, route đòi quyền `admin` (owner gói). Ở DB: chỉ hàng mình thấy.
DROP POLICY IF EXISTS price_quotes_visible_del ON contracts.price_quotes;
--> statement-breakpoint
CREATE POLICY price_quotes_visible_del ON contracts.price_quotes AS RESTRICTIVE FOR DELETE TO contracts_rw
  USING ((SELECT contracts.sees_all())
    OR created_by = NULLIF(current_setting('app.user_id', true), '')::uuid
    OR supplier_party_key = ANY ((SELECT contracts.visible_party_keys())::text[]));
--> statement-breakpoint
REVOKE UPDATE ON contracts.price_quotes FROM contracts_rw;
--> statement-breakpoint
DROP POLICY IF EXISTS score_snapshots_visible ON contracts.score_snapshots;
--> statement-breakpoint
CREATE POLICY score_snapshots_visible ON contracts.score_snapshots AS RESTRICTIVE FOR SELECT TO contracts_rw
  USING ((SELECT contracts.sees_all())
    OR party_key = ANY ((SELECT contracts.visible_party_keys())::text[]));
--> statement-breakpoint
-- Giá thị trường hàng hoá: giá công khai theo mặt hàng (không gắn đối tác/người) ⇒ đọc theo tenant như cũ; người dùng không ghi
-- (chỉ việc dò giá nền ghi) — D8-23.
REVOKE INSERT, UPDATE, DELETE ON contracts.market_observations FROM contracts_rw;
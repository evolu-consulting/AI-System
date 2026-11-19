-- CR-191 (BR-191-1/7) · «Ai thấy bài»: thêm mức «Chỉ nội bộ» (`aud_mode = 'internal'`) + cột `aud_tenants` = id TENANT của công ty ĐÃ KẾT NỐI
-- được chọn đích danh (mode `companies`). `aud_orgs` giữ nguyên nghĩa: id ext_org (đối tác trong cộng đồng) — hai tập khác kiểu id, không gộp.
-- Prod có khách: CHỈ THÊM. Bài cũ giữ nguyên `aud_mode` (all/suppliers/buyers/cats/companies), `aud_tenants` = '{}' ⇒ KHÔNG backfill, không mất người xem:
-- `all` vẫn là tất cả đối tác; `companies` cũ (chỉ có ext_org) không hiện cho công ty kết nối (tác giả chọn lại). KHÔNG đổi RLS / `audience_ok`
-- (`ELSE false` đã loại `internal` khỏi mọi người ngoài; luật đọc mới nằm ở migration sau).
-- Chờ khoá tối đa 5s. Cột mới mặc định hằng ⇒ chỉ đổi catalog (không viết lại bảng); CHECK cột nằm ngay lệnh ADD COLUMN.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
ALTER TABLE community.posts ADD COLUMN IF NOT EXISTS aud_tenants uuid[] NOT NULL DEFAULT '{}'::uuid[]
  CONSTRAINT posts_aud_tenants_ck CHECK (cardinality(aud_tenants) <= 200);
--> statement-breakpoint
-- Mở CHECK `aud_mode` thêm `internal` (giữ `cats` trong CHECK: bài cũ còn dùng, UI bỏ ở lát sau). NOT VALID + VALIDATE để không giữ khoá lâu.
ALTER TABLE community.posts DROP CONSTRAINT IF EXISTS posts_aud_ck;
--> statement-breakpoint
ALTER TABLE community.posts ADD CONSTRAINT posts_aud_ck CHECK ((author_org IS NULL) = (aud_mode IS NOT NULL)
  AND (aud_mode IS NULL OR aud_mode IN ('all', 'suppliers', 'buyers', 'cats', 'companies', 'internal'))) NOT VALID;
--> statement-breakpoint
ALTER TABLE community.posts VALIDATE CONSTRAINT posts_aud_ck;

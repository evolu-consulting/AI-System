-- V2-GAPS · DT-01 (V2-I còn lại): số điện thoại + người liên hệ của đối tác nằm trên danh bạ `companies` (đầu trang chi tiết đối tác).
-- Chỉ cộng thêm hai cột (null = chưa nhập ⇒ liên hệ rơi về người đại diện ở HĐ mới nhất). Bảng đã `packs.secure_table` (RLS FORCE
-- theo tenant) từ 0015 + M1 0019 ⇒ cột mới thừa hưởng; khẳng định lại FORCE (không gọi lại secure_table: nó cấp lại DELETE đã thu hồi ở 0019).
ALTER TABLE contracts.companies ADD COLUMN IF NOT EXISTS phone text;
--> statement-breakpoint
ALTER TABLE contracts.companies ADD COLUMN IF NOT EXISTS contact_person text;
--> statement-breakpoint
ALTER TABLE contracts.companies DROP CONSTRAINT IF EXISTS companies_contact_ck;
--> statement-breakpoint
ALTER TABLE contracts.companies ADD CONSTRAINT companies_contact_ck
  CHECK (char_length(phone) <= 30 AND char_length(contact_person) <= 120);
--> statement-breakpoint
ALTER TABLE contracts.companies FORCE ROW LEVEL SECURITY;

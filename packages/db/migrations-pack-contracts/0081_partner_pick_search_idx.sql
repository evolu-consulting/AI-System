-- CR-122 p10: tìm đối tác theo tiền tố (ô Nhà cung cấp/Đối tác chọn từ sổ) — index text_pattern_ops cho LIKE 'x%' (không cần pg_trgm).
-- Chỉ cộng thêm; chạy lại vô hại. Không đổi dữ liệu.
CREATE INDEX IF NOT EXISTS partner_roles_name_pfx_idx ON contracts.partner_roles (tenant_id, (contracts.fold(name)) text_pattern_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS partner_roles_key_pfx_idx ON contracts.partner_roles (tenant_id, party_key text_pattern_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS companies_name_pfx_idx ON contracts.companies (tenant_id, (contracts.fold(name)) text_pattern_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS companies_short_pfx_idx ON contracts.companies (tenant_id, (contracts.fold(short_name)) text_pattern_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS companies_tax_pfx_idx ON contracts.companies (tenant_id, tax_id text_pattern_ops);

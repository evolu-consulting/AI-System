-- CR-182 · R7 «Kiểm tra tệp»: dấu vân tay (sha256) của TỆP GỐC cần ký, ghi lúc bật «Cần ký» (đọc PDF để đếm trang).
-- CHỈ THÊM, chạy lại được. Tệp bật «Cần ký» trước đợt này chưa có ⇒ NULL (kiểm tệp chỉ so được bản đã ký của chúng).
ALTER TABLE contracts.sign_docs ADD COLUMN IF NOT EXISTS src_sha256 text;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE contracts.sign_docs ADD CONSTRAINT sign_docs_src_sha_ck CHECK (src_sha256 IS NULL OR src_sha256 ~ '^[0-9a-f]{64}$');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS sign_docs_src_sha_idx ON contracts.sign_docs (tenant_id, src_sha256) WHERE src_sha256 IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS sign_versions_sha_idx ON contracts.sign_versions (tenant_id, sha256);

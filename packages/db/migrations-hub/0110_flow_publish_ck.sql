-- CR-122 · N1 · ADR-0038 · flow Thư viện theo sự kiện (có `trigger`, không khe) phải xuất bản được: nới CHECK 0068
-- `process_defs_published_ck` từ "có bản xuất bản ⇒ có khe" thành "có bản xuất bản ⇒ có khe HOẶC có Bắt đầu khi". Chỉ nới (mọi dòng cũ
-- vẫn thoả). Chạy lại vô hại.
ALTER TABLE hub.process_defs DROP CONSTRAINT IF EXISTS process_defs_published_ck;
--> statement-breakpoint
ALTER TABLE hub.process_defs ADD CONSTRAINT process_defs_published_ck CHECK (
  published_version IS NULL OR (published_version >= 1 AND (slot IS NOT NULL OR trigger IS NOT NULL)));

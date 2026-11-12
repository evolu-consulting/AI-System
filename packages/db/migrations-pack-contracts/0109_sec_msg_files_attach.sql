-- SEC 2026-11-12 (security review cuối đợt CR-132) · `msg_files_ins` (0107) cho gắn BẤT KỲ tệp mình tạo — kể cả tệp hợp đồng
-- (`contracts.file_id`, phiên bản = hàng `contracts` khác, tệp CR-133 `contract_files`, «Bản đã ký» `esign_envelopes.signed_file_id`).
-- Gắn xong thì `files_msg_sel` (0108) giấu tệp HĐ với đồng nghiệp ngoài hội thoại, và Thu hồi tin soft-delete luôn tệp HĐ.
-- Sửa: chỉ gắn được tệp CHƯA được dùng ở đâu khác (thực tế = tệp vừa tải lên qua luồng tin nhắn, chèn `files` rồi `msg_files` cùng tx).
-- Hàm SECURITY DEFINER (cùng khuôn `msg_file_visible` 0108): policy phải thấy MỌI hàng tham chiếu, không bị RLS của người gọi giấu.
-- Index theo `(tenant_id, file_id)` cho từng bảng tham chiếu ⇒ mỗi lần gắn tệp = 3 tra cứu index (không quét bảng).
CREATE INDEX IF NOT EXISTS contracts_file_idx ON contracts.contracts (tenant_id, file_id) WHERE file_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS contract_files_file_idx ON contracts.contract_files (tenant_id, file_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS esign_envelopes_signed_file_idx ON contracts.esign_envelopes (tenant_id, signed_file_id)
  WHERE signed_file_id IS NOT NULL;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION contracts.msg_file_attachable(fid uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT NOT EXISTS (SELECT 1 FROM contracts.contracts c
      WHERE c.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND c.file_id = fid)
    AND NOT EXISTS (SELECT 1 FROM contracts.contract_files cf
      WHERE cf.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND cf.file_id = fid)
    AND NOT EXISTS (SELECT 1 FROM contracts.esign_envelopes e
      WHERE e.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND e.signed_file_id = fid)
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION contracts.msg_file_attachable(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION contracts.msg_file_attachable(uuid) TO contracts_rw;
--> statement-breakpoint
DROP POLICY IF EXISTS msg_files_ins ON contracts.msg_files;
--> statement-breakpoint
CREATE POLICY msg_files_ins ON contracts.msg_files AS RESTRICTIVE FOR INSERT TO contracts_rw
  WITH CHECK ((SELECT packs.viewer_ext_org()) IS NULL AND conversation_id = ANY ((SELECT contracts.msg_my_conversations())::uuid[])
    AND uploaded_by = NULLIF(current_setting('app.user_id', true), '')::uuid
    -- chỉ gắn được tệp do CHÍNH MÌNH tải lên …
    AND EXISTS (SELECT 1 FROM contracts.files f WHERE f.id = msg_files.file_id AND f.tenant_id = msg_files.tenant_id
      AND f.created_by = NULLIF(current_setting('app.user_id', true), '')::uuid)
    -- … và tệp chưa là tệp hợp đồng / tệp kèm HĐ / bản đã ký (SEC 2026-11-12)
    AND contracts.msg_file_attachable(msg_files.file_id));

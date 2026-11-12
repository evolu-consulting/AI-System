-- CR-132 M5 · tệp trong tin nhắn chỉ THÀNH VIÊN hội thoại đọc được, kể cả qua đường tải chung `GET /pack/contracts/files/:id/content` (đọc `contracts.files`).
-- Policy RESTRICTIVE SELECT trên `contracts.files`: tệp KHÔNG gắn `msg_files` (tệp HĐ, tệp CR-133, bản đã ký…) ⇒ như cũ (chỉ policy tenant); tệp có hàng `msg_files`
-- ⇒ chỉ khi người gọi là nhân viên nội bộ và là thành viên của hội thoại đó. Hàm SECURITY DEFINER (chủ migration không chịu FORCE RLS — cùng khuôn 0103/0107) vì
-- subquery trong policy phải thấy MỌI hàng `msg_files` (RLS của `msg_files` giấu hội thoại của người khác ⇒ «không thấy hàng» sẽ bị hiểu nhầm là «tệp thường»).
-- Mỗi lần đọc một hàng `files` = một tra cứu PK `msg_files (tenant_id, file_id)` (+ một tra cứu PK `msg_members` khi là tệp tin nhắn).
-- Chèn tệp tải lên: hàng `files` được chèn TRƯỚC `msg_files` (câu riêng, cùng tx) nên lúc đó chưa có hàng `msg_files` ⇒ thấy được.
CREATE OR REPLACE FUNCTION contracts.msg_file_visible(fid uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT NOT EXISTS (SELECT 1 FROM contracts.msg_files mf
      WHERE mf.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND mf.file_id = fid)
    OR (packs.viewer_ext_org() IS NULL AND EXISTS (SELECT 1 FROM contracts.msg_files mf
      JOIN contracts.msg_members m ON m.tenant_id = mf.tenant_id AND m.conversation_id = mf.conversation_id
        AND m.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
      WHERE mf.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND mf.file_id = fid))
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION contracts.msg_file_visible(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION contracts.msg_file_visible(uuid) TO contracts_rw;
--> statement-breakpoint
DROP POLICY IF EXISTS files_msg_sel ON contracts.files;
--> statement-breakpoint
CREATE POLICY files_msg_sel ON contracts.files AS RESTRICTIVE FOR SELECT TO contracts_rw
  USING (contracts.msg_file_visible(id));

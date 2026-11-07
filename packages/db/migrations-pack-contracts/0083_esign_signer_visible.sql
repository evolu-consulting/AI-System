-- CR-122 p21 · người ký công ty của phong bì ký số ĐANG MỞ (`esign_envelopes.status` sent/delivered, `signers[]` có
-- `{role: company, client_user_id: tôi}`) ĐỌC được HĐ (để mở trang HĐ và bấm "Ký ngay") dù ngoài cây quản lý của chủ HĐ — cùng cơ chế
-- nhánh người duyệt 0070 (`reviewer_contract_ids()`). Chỉ ĐỌC (policy SELECT); policy UPDATE giữ nguyên (người ký không sửa/khoá HĐ).
-- Phong bì xong/huỷ/từ chối ⇒ hết thấy theo nhánh này. Tenant theo `app.tenant_id` (RLS của `esign_envelopes` cũng lọc tenant).
-- `esign_signer_contract_ids()` SECURITY INVOKER (contracts_rw đọc được `esign_envelopes` trong tenant); không tham số ⇒ không hỏi được
-- về người khác. MỘT mảng mỗi câu (InitPlan); quét phong bì đang mở của tenant qua index một phần `esign_envelopes_open_uq`
-- (tối đa một phong bì mở mỗi HĐ). Chỉ cộng thêm; chạy lại vô hại.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
CREATE OR REPLACE FUNCTION contracts.esign_signer_contract_ids() RETURNS uuid[]
  LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce(array_agg(DISTINCT e.contract_id), '{}'::uuid[])
  FROM contracts.esign_envelopes e
  WHERE e.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND e.status IN ('sent', 'delivered')
    AND NULLIF(current_setting('app.user_id', true), '') IS NOT NULL
    AND e.signers @> jsonb_build_array(jsonb_build_object('role', 'company',
          'client_user_id', NULLIF(current_setting('app.user_id', true), '')))
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION contracts.esign_signer_contract_ids() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION contracts.esign_signer_contract_ids() TO contracts_rw;
--> statement-breakpoint
-- Như 0070 + nhánh người ký đang chờ ký.
DROP POLICY IF EXISTS contracts_visible ON contracts.contracts;
--> statement-breakpoint
CREATE POLICY contracts_visible ON contracts.contracts AS RESTRICTIVE FOR SELECT TO contracts_rw
  USING ((SELECT contracts.sees_all() OR coalesce(current_setting('app.vis_cascade', true), '') = '1')
    OR owner_user_id = ANY ((SELECT contracts.org_owner_ids())::uuid[])
    OR (owner_user_id IS NULL
        AND (created_by = NULLIF(current_setting('app.user_id', true), '')::uuid
             OR visibility_owner_id = ANY ((SELECT contracts.org_owner_ids())::uuid[])))
    OR id IN (SELECT unnest(contracts.reviewer_contract_ids()))
    OR id IN (SELECT unnest(contracts.esign_signer_contract_ids())));

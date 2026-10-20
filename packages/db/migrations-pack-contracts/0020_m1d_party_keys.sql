-- M1D-FR-01 · docs/specs/M1d-fixes (security review CR-095 sửa: N-1, N-4). Chỉ cộng thêm; chạy lại vô hại. Số 0018 dành cho HD8.
-- N-1 (b): khoá bên chỉ mở từ HĐ đã duyệt mà người duyệt KHÁC người tạo. HĐ tự duyệt (dưới ngưỡng, người tạo tự xác nhận cấp 1;
--      bán CKS ghi người bán là người duyệt) chỉ thấy đối tác qua chính HĐ đó (`partner_events.contract_id`, chữ ký CKS của HĐ).
--      HĐ không ghi người duyệt (dữ liệu cũ / nhập) giữ hành vi M1c.
CREATE OR REPLACE FUNCTION contracts.visible_party_keys() RETURNS text[]
  LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce(array_agg(DISTINCT k.k) FILTER (WHERE k.k IS NOT NULL), '{}'::text[])
  FROM contracts.contracts c CROSS JOIN LATERAL (VALUES
    (contracts.party_key(c.fields -> 'buyer_name' ->> 'value', c.fields -> 'buyer_tax_id' ->> 'value')),
    (contracts.party_key(c.fields -> 'supplier_name' ->> 'value', c.fields -> 'supplier_tax_id' ->> 'value'))) k(k)
  WHERE c.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND c.status IN ('active', 'expiring', 'expired', 'renewed', 'terminated')
    AND c.confirmed_by IS DISTINCT FROM c.created_by
$$;
--> statement-breakpoint
-- N-4: nhắc hạn theo HĐ thấy được (như `contract_items`).
DROP POLICY IF EXISTS contract_reminders_visible ON contracts.contract_reminders;
--> statement-breakpoint
CREATE POLICY contract_reminders_visible ON contracts.contract_reminders AS RESTRICTIVE FOR SELECT TO contracts_rw
  USING ((SELECT contracts.sees_all()) OR EXISTS (SELECT 1 FROM contracts.contracts c
    WHERE c.id = contract_reminders.contract_id AND c.tenant_id = contract_reminders.tenant_id));

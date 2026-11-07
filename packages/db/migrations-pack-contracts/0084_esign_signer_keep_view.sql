-- CR-122 p21b · người ký công ty GIỮ quyền ĐỌC HĐ sau khi ký: 0083 chỉ tính phong bì đang mở ⇒ ký xong ở nhà cung cấp, quay về trang
-- HĐ (tự làm mới ⇒ `completed`) là mất thấy. Nay tính phong bì `sent`/`delivered`/`completed`/`declined` (HĐ mình đang/đã ký, hoặc
-- đã từ chối — xem được điều mình từ chối). `voided` (HĐ mở lại / quá hạn huỷ) KHÔNG tính. Vẫn chỉ ĐỌC (policy UPDATE không đổi),
-- theo `app.tenant_id`. Phong bì đã kết thúc tích luỹ theo thời gian ⇒ index GIN `jsonb_path_ops` trên `signers` cho `@>` (bảng nhỏ,
-- migration gói chạy trong một tx ⇒ không CONCURRENTLY; `lock_timeout` như 0070). Policy SELECT giữ nguyên văn 0083 (gọi hàm theo tên).
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS esign_envelopes_signers_gin ON contracts.esign_envelopes USING gin (signers jsonb_path_ops);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION contracts.esign_signer_contract_ids() RETURNS uuid[]
  LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce(array_agg(DISTINCT e.contract_id), '{}'::uuid[])
  FROM contracts.esign_envelopes e
  WHERE e.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND e.status IN ('sent', 'delivered', 'completed', 'declined')
    AND NULLIF(current_setting('app.user_id', true), '') IS NOT NULL
    AND e.signers @> jsonb_build_array(jsonb_build_object('role', 'company',
          'client_user_id', NULLIF(current_setting('app.user_id', true), '')))
$$;

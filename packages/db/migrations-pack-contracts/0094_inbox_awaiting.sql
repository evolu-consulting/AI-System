-- CR-127 · K8 · BR-57/58/59 · spec §2.4, §3 #9–11, #9b: bên nhận HĐ đối tác theo 4 trạng thái.
-- (1) `partner_inbox.awaiting_decision` (#71): HĐ nhận KHÔNG có quy trình nhận khớp (hoặc lượt nhận huỷ/lỗi/không mở được) ⇒ HĐ giữ
--     processing, chờ người phụ trách HĐ nhận quyết (Đồng ý / Trả lại / Từ chối — `POST /contracts/:id/inbox-decision`).
-- (2) Bản sửa của đối tác vào CÙNG HĐ nhận (Q10): một HĐ nhận có nhiều bản ghi nhận (mỗi vòng một dòng) ⇒ bỏ unique `(tenant, contract)`,
--     thay bằng unique một-dòng-đang-chờ mỗi HĐ + chỉ mục tra vòng mới nhất.
-- (3) `hub.partner_inbox_take` trả thêm `prev_id` (lần gửi trước CỦA CHÍNH bên gửi tới tenant này — bên nhận đã có id đó ở `mailbox_id`
--     của vòng trước, không lộ gì mới) để nối bản sửa vào HĐ nhận cũ. Đổi kiểu trả ⇒ DROP + CREATE (thân giữ nguyên 0119), cấp lại quyền.
-- (4) (đã chuyển) CHECK `hub.evidence.subject_kind` += 'inbox_decision' nay ở hub 0137 — migration gói KHÔNG sửa bảng hub.
ALTER TABLE contracts.partner_inbox ADD COLUMN IF NOT EXISTS awaiting_decision boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE contracts.partner_inbox DROP CONSTRAINT IF EXISTS partner_inbox_contract_uq;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS partner_inbox_contract_pending_uq ON contracts.partner_inbox (tenant_id, contract_id)
  WHERE status = 'pending';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS partner_inbox_contract_round_idx ON contracts.partner_inbox (tenant_id, contract_id, round DESC);
--> statement-breakpoint
-- "Việc của tôi" + đếm: chỉ dòng đang chờ người quyết (ít) ⇒ chỉ mục partial.
CREATE INDEX IF NOT EXISTS partner_inbox_awaiting_idx ON contracts.partner_inbox (tenant_id, contract_id)
  WHERE awaiting_decision AND status = 'pending';
--> statement-breakpoint
DROP FUNCTION IF EXISTS hub.partner_inbox_take(integer);
--> statement-breakpoint
CREATE FUNCTION hub.partner_inbox_take(p_limit integer DEFAULT 100)
RETURNS TABLE (
  id uuid, round integer, prev_reason text, payload jsonb, file_ref text, pdf_sha256 text, expires_at timestamptz,
  sender_name text, sender_tax_code text, sender_verified boolean, prev_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_tid uuid := NULLIF(current_setting('app.tenant_id', true), '')::uuid;
  v_lim integer := LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500);
BEGIN
  IF v_tid IS NULL THEN
    RAISE EXCEPTION 'partner_inbox_take: chưa đặt tenant' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH c AS (
    SELECT m.id FROM hub.partner_mailbox m
     WHERE m.to_tenant = v_tid AND m.channel = 'platform' AND m.status = 'sent' AND m.expires_at > now()
       AND NOT EXISTS (SELECT 1 FROM hub.partner_links l
                        WHERE l.from_tenant = m.from_tenant AND l.to_tenant = v_tid AND l.blocked_at IS NOT NULL)
     ORDER BY m.created_at LIMIT v_lim FOR UPDATE SKIP LOCKED
  ), u AS (
    UPDATE hub.partner_mailbox m SET status = 'delivered', updated_at = now()
      FROM c WHERE m.id = c.id
    RETURNING m.id, m.from_tenant, m.prev_id, m.round, m.payload, m.file_ref, m.pdf_sha256, m.expires_at
  )
  SELECT u.id, u.round, (SELECT p.reason FROM hub.partner_mailbox p
                          WHERE p.id = u.prev_id AND p.from_tenant = u.from_tenant),
         u.payload, u.file_ref, u.pdf_sha256, u.expires_at,
         t.legal_name, t.tax_code, t.directory_verified_at IS NOT NULL,
         (SELECT p.id FROM hub.partner_mailbox p
           WHERE p.id = u.prev_id AND p.from_tenant = u.from_tenant AND p.to_tenant = v_tid)
    FROM u LEFT JOIN admin.tenants t ON t.id = u.from_tenant;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION hub.partner_inbox_take(integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION hub.partner_inbox_take(integer) TO hub_rw, contracts_rw;

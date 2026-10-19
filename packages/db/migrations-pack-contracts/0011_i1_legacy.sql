-- I1 · vùng chờ của importer mgmt-app: bản ghi CHƯA có bảng đích (danh bạ công ty, báo giá/sourcing, góp ý, chấm điểm, quét
-- thị trường, file chat, hội thoại trợ lý, thông báo cũ, hẹn nhắc ngoài CKS, danh mục hàng) giữ nguyên văn theo tenant ⇒ tắt
-- mgmt-app không mất dữ liệu; lát sau đọc từ đây rồi chuyển vào bảng riêng. Chỉ thêm (không UPDATE/DELETE cho role gói).
CREATE TABLE IF NOT EXISTS contracts.legacy_records (
  tenant_id uuid NOT NULL,
  kind text NOT NULL,
  mgmt_id text NOT NULL,
  doc jsonb NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT legacy_records_pkey PRIMARY KEY (tenant_id, kind, mgmt_id),
  CONSTRAINT legacy_records_ck CHECK (kind ~ '^[a-z_]{2,40}$' AND char_length(mgmt_id) BETWEEN 1 AND 300
    AND jsonb_typeof(doc) = 'object')
);
--> statement-breakpoint
SELECT packs.secure_table('contracts', 'legacy_records');
--> statement-breakpoint
REVOKE UPDATE, DELETE ON contracts.legacy_records FROM contracts_rw;

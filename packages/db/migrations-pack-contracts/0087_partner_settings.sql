-- CR-124 · q4 · spec §6, §8c · cài đặt NHẬN hợp đồng đối tác theo công ty (một dòng mỗi công ty): ngưỡng mức quan trọng theo giá trị
-- (mặc định Quan trọng ≥ 500 triệu, Rất quan trọng ≥ 2 tỷ) + người phụ trách HĐ nhận (owner mặc định; vắng ⇒ quản trị thấy). RLS tenant.
-- Cấp EXECUTE hàm lời mời nối (hub 0122) cho contracts_rw. Chỉ cộng thêm; chạy lại vô hại.
CREATE TABLE IF NOT EXISTS contracts.partner_settings (
  tenant_id uuid NOT NULL,
  important_min bigint NOT NULL DEFAULT 500000000,
  critical_min bigint NOT NULL DEFAULT 2000000000,
  owner_user_id uuid,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT partner_settings_pkey PRIMARY KEY (tenant_id),
  CONSTRAINT partner_settings_range_ck CHECK (important_min >= 0 AND critical_min > important_min AND critical_min <= 1000000000000000)
);
--> statement-breakpoint
SELECT packs.secure_table('contracts', 'partner_settings');
--> statement-breakpoint
REVOKE DELETE ON contracts.partner_settings FROM contracts_rw;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION hub.partner_link_invites() TO contracts_rw;
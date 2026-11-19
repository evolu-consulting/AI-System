-- CR-191 · BR-191-11 · cài đặt «Ai được tìm và mời đối tác mới» của từng công ty: `admin` (Chỉ quản trị công ty — mặc định) | `all` (Mọi nhân viên).
-- Nguồn duy nhất của cài đặt này. Vắng hàng = `admin` (không cần backfill: công ty cũ giữ đúng hành vi cũ). Hàm hub `cc_invite_mode_of` (hub 0168) đọc bảng này;
-- ghi chỉ qua route `PUT /pack/contracts/connect/settings` (người Toàn quyền). CHỈ THÊM, chạy lại được.
CREATE TABLE IF NOT EXISTS contracts.connect_settings (
  tenant_id uuid NOT NULL,
  invite_by text NOT NULL DEFAULT 'admin',
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT connect_settings_pkey PRIMARY KEY (tenant_id),
  CONSTRAINT connect_settings_invite_by_ck CHECK (invite_by IN ('admin', 'all'))
);
--> statement-breakpoint
SELECT packs.secure_table('contracts', 'connect_settings');
--> statement-breakpoint
DROP POLICY IF EXISTS connect_settings_internal ON contracts.connect_settings;
--> statement-breakpoint
CREATE POLICY connect_settings_internal ON contracts.connect_settings AS RESTRICTIVE FOR ALL TO contracts_rw
  USING ((SELECT packs.viewer_ext_org()) IS NULL)
  WITH CHECK ((SELECT packs.viewer_ext_org()) IS NULL);
--> statement-breakpoint
-- Hàm hub mới (hub 0168) cho role gói: migration hub chạy TRƯỚC khi role gói có trên DB dựng sạch ⇒ cấp lại ở đây, không điều kiện (khuôn 0126).
GRANT USAGE ON SCHEMA hub TO contracts_rw;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION hub.cc_can_invite(uuid), hub.cc_decline(uuid, text), hub.cc_withdraw(uuid), hub.cc_company_page(uuid) TO contracts_rw;

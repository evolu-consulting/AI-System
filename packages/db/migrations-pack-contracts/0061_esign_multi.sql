-- esign-multi · nhiều nhà cung cấp ký số song song (`ESIGN_PROVIDERS`): công ty chọn nhà cung cấp MẶC ĐỊNH ở Cài đặt
-- (`approval_settings.esign_default_provider`, NULL ⇒ nhà cung cấp khả dụng đầu tiên theo thứ tự env). Gửi ký chọn được nhà cung
-- cấp khác; mọi lệnh sau dùng `esign_envelopes.provider` đã lưu. Người ký lưu `provider` + `certificate_ref` theo từng người trong
-- jsonb `signers` (không cần cột). Chỉ cộng thêm; chạy lại vô hại. Không đổi RLS (cột trên bảng đã FORCE RLS).
ALTER TABLE contracts.approval_settings ADD COLUMN IF NOT EXISTS esign_default_provider text;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE contracts.approval_settings ADD CONSTRAINT approval_settings_esign_default_ck
    CHECK (esign_default_provider IS NULL OR esign_default_provider ~ '^[a-z][a-z0-9-]{1,30}$');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

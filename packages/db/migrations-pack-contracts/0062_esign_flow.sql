-- esign-flow · bước Ký số cuối luồng duyệt (cấu hình nằm trong `flow_steps` chụp của lượt): trạng thái bước của LƯỢT duyệt
-- (`esign_status`: sending | sent | completed | needs_decision; NULL = luồng không có bước ký / chưa tới) + lý do cần quyết +
-- người ký công ty đã chọn + lúc đổi. Chỉ cộng thêm; chạy lại vô hại.
ALTER TABLE contracts.approvals ADD COLUMN IF NOT EXISTS esign_status text;
--> statement-breakpoint
ALTER TABLE contracts.approvals ADD COLUMN IF NOT EXISTS esign_reason text;
--> statement-breakpoint
ALTER TABLE contracts.approvals ADD COLUMN IF NOT EXISTS esign_signer uuid;
--> statement-breakpoint
ALTER TABLE contracts.approvals ADD COLUMN IF NOT EXISTS esign_at timestamptz;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'approvals_esign_ck') THEN
    ALTER TABLE contracts.approvals ADD CONSTRAINT approvals_esign_ck CHECK (
      (esign_status IS NULL OR esign_status IN ('sending', 'sent', 'completed', 'needs_decision'))
      AND (esign_reason IS NULL OR esign_reason IN ('NO_PARTNER_EMAIL', 'NO_SIGNER', 'SEND_FAILED', 'DECLINED', 'VOIDED')));
  END IF;
END
$$;

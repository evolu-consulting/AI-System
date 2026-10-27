-- esign-sweep · vòng nền bước Ký số: mốc nhắc người ký lần cuối + mốc đã chuyển cấp quá hạn (của LẦN gửi hiện tại — so với
-- `esign_at`; Gửi lại đặt `esign_at` mới ⇒ mốc cũ tự hết hiệu lực). Index một phần chỉ trên bước còn mở (`sending`/`sent`) cho câu
-- quét theo tenant. Chỉ cộng thêm; chạy lại vô hại. Không đổi RLS (cột trên bảng đã FORCE RLS).
ALTER TABLE contracts.approvals ADD COLUMN IF NOT EXISTS esign_reminded_at timestamptz;
--> statement-breakpoint
ALTER TABLE contracts.approvals ADD COLUMN IF NOT EXISTS esign_escalated_at timestamptz;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS approvals_esign_open_idx ON contracts.approvals (tenant_id, esign_at, id)
  WHERE esign_status IN ('sending', 'sent');

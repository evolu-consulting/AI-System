-- CR-101 DOC-legal (Câu 8): ngưỡng cảnh báo pháp lý của tenant (đồng). Giao dịch đứng riêng (không thuộc HĐ NT) có tổng giá trị ≥ ngưỡng
-- mà còn mốc thu/trả chưa xong ⇒ cảnh báo "cần kế toán xác nhận" (chỉ cảnh báo, không chặn). 0 = tắt. Chỉ cộng thêm; chạy lại vô hại.
ALTER TABLE contracts.approval_settings ADD COLUMN IF NOT EXISTS legal_warn_threshold bigint NOT NULL DEFAULT 5000000;
--> statement-breakpoint
ALTER TABLE contracts.approval_settings DROP CONSTRAINT IF EXISTS approval_settings_legal_warn_ck;
--> statement-breakpoint
ALTER TABLE contracts.approval_settings ADD CONSTRAINT approval_settings_legal_warn_ck
  CHECK (legal_warn_threshold BETWEEN 0 AND 1000000000000000);
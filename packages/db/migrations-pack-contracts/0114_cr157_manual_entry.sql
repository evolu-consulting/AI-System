-- CR-157 · Nhập tay = dự phòng khi AI đọc lỗi/hết giờ: nhập ngay trên HĐ đó, người nhập phải tích "đã đối chiếu với tệp gốc".
-- Chỉ cộng cột (chưa có khách, không backfill): `entry_source` ai|manual (mặc định ai), `reconciled_by/at` = ai/lúc xác nhận đối chiếu.
-- RLS FORCE theo bảng + trigger `contracts_status_gate` (BEFORE UPDATE OF status) không đụng cột mới. Cặp reconciled_* cùng null / cùng có.
ALTER TABLE contracts.contracts ADD COLUMN IF NOT EXISTS entry_source text NOT NULL DEFAULT 'ai';
--> statement-breakpoint
ALTER TABLE contracts.contracts ADD COLUMN IF NOT EXISTS reconciled_by uuid;
--> statement-breakpoint
ALTER TABLE contracts.contracts ADD COLUMN IF NOT EXISTS reconciled_at timestamptz;
--> statement-breakpoint
ALTER TABLE contracts.contracts DROP CONSTRAINT IF EXISTS contracts_entry_source_ck;
--> statement-breakpoint
ALTER TABLE contracts.contracts ADD CONSTRAINT contracts_entry_source_ck CHECK (
  entry_source IN ('ai', 'manual') AND ((reconciled_by IS NULL) = (reconciled_at IS NULL))
  AND (entry_source = 'manual' OR reconciled_at IS NULL));

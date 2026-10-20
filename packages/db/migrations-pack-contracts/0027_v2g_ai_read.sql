-- V2-G · BA v2 §3.1 HD-02/HD-08 · §4.2 "Upload và xác nhận": phần AI đọc lưu cùng HĐ (loại đoán, trường chưa chắc, tóm tắt 5 mục,
-- mốc tìm thấy). Chỉ cộng thêm một cột jsonb (null = HĐ nhập tay / chưa đọc); không backfill, chạy lại vô hại. Hình do contract zod
-- `AiReadSchema` giữ (hub-api ghi/đọc qua mapper); DB chỉ chặn kiểu và cỡ để một lỗi mapper không nhồi rác vào hàng.
ALTER TABLE contracts.contracts ADD COLUMN IF NOT EXISTS ai_read jsonb;
--> statement-breakpoint
ALTER TABLE contracts.contracts DROP CONSTRAINT IF EXISTS contracts_ai_read_ck;
--> statement-breakpoint
ALTER TABLE contracts.contracts ADD CONSTRAINT contracts_ai_read_ck
  CHECK (ai_read IS NULL OR (jsonb_typeof(ai_read) = 'object' AND pg_column_size(ai_read) <= 262144));

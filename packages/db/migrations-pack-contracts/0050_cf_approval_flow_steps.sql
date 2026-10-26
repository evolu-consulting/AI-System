-- contract-flow S3a · bản chụp bước mẫu luồng lúc mở run engine (`flow_steps`): tool `contracts-route`/`contracts-finalize` tính
-- bước kế / bước bắt buộc theo đúng mẫu mà def của run được biên dịch (sửa luồng giữa chừng không đổi đường run cũ). Chỉ cộng
-- thêm; chạy lại vô hại.
ALTER TABLE contracts.approvals ADD COLUMN IF NOT EXISTS flow_steps jsonb;
--> statement-breakpoint
ALTER TABLE contracts.approvals DROP CONSTRAINT IF EXISTS approvals_flow_steps_ck;
--> statement-breakpoint
ALTER TABLE contracts.approvals ADD CONSTRAINT approvals_flow_steps_ck CHECK (flow_steps IS NULL
  OR (jsonb_typeof(flow_steps) = 'array' AND jsonb_array_length(flow_steps) BETWEEN 1 AND 8));

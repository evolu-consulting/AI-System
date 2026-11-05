-- CR-121 D-1 · mẫu luồng duyệt HĐ tối đa 20 bước (`APPROVAL_FLOW_STEPS_MAX`): nới CHECK số bước của mẫu tenant (`approval_flows.steps`,
-- 0047) và bản chụp bước của lượt engine (`approvals.flow_steps`, 0050) từ 1..8 lên 1..20. Chỉ NỚI (hàng cũ luôn thoả) ⇒ ADD … NOT
-- VALID rồi VALIDATE (không chặn ghi khi quét). Không sửa migration cũ (đã chạy prod).
ALTER TABLE contracts.approval_flows DROP CONSTRAINT IF EXISTS approval_flows_steps_ck;
--> statement-breakpoint
ALTER TABLE contracts.approval_flows ADD CONSTRAINT approval_flows_steps_ck CHECK (jsonb_typeof(steps) = 'array'
  AND jsonb_array_length(steps) BETWEEN 1 AND 20) NOT VALID;
--> statement-breakpoint
ALTER TABLE contracts.approval_flows VALIDATE CONSTRAINT approval_flows_steps_ck;
--> statement-breakpoint
ALTER TABLE contracts.approvals DROP CONSTRAINT IF EXISTS approvals_flow_steps_ck;
--> statement-breakpoint
ALTER TABLE contracts.approvals ADD CONSTRAINT approvals_flow_steps_ck CHECK (flow_steps IS NULL
  OR (jsonb_typeof(flow_steps) = 'array' AND jsonb_array_length(flow_steps) BETWEEN 1 AND 20)) NOT VALID;
--> statement-breakpoint
ALTER TABLE contracts.approvals VALIDATE CONSTRAINT approvals_flow_steps_ck;

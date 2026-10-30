-- CR-105 · L2a pl-library-api · seed thư viện quy trình (design §1, §4; tasks.md L2a).
-- (1) `hub_audit_log_action_check`: + publish, rollback, assign, unassign, set_default (giữ toàn bộ giá trị 0037).
-- (2) Def thư viện "Quy trình HĐ mặc định" (khe `contracts.approval`) = máy 2 bước cũ (`defaultSlotBody` — ngưỡng 500 tr, Group
--     `contracts-editor` / `contracts-owner` theo MÃ), stages = `compileSlotStages(body)` (khớp kiểm ở `library-seed.rules.test.ts`),
--     bản phát hành v1, và hàng `process_slots` mặc định của khe. Id cố định + ON CONFLICT DO NOTHING ⇒ chạy lại vô hại; khe đã có
--     mặc định (do admin đổi) ⇒ giữ nguyên. Chỉ THÊM hàng; không mất dữ liệu.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'hub_audit_log_action_check'
                 AND conrelid = 'hub.audit_log'::regclass AND pg_get_constraintdef(oid) LIKE '%set_default%') THEN
    ALTER TABLE hub.audit_log DROP CONSTRAINT IF EXISTS hub_audit_log_action_check;
    ALTER TABLE hub.audit_log ADD CONSTRAINT hub_audit_log_action_check CHECK (action IN (
      'grant', 'revoke', 'view_trace', 'create', 'update', 'delete', 'enable', 'disable', 'start', 'cancel', 'decide', 'review', 'answer', 'forward', 'view', 'copy', 'authorize_real_action', 'rotate', 'check', 'degrade', 'write_fail', 'escalate', 'escalate_skipped', 'tool_call', 'branch', 'publish', 'rollback', 'assign', 'unassign', 'set_default'));
  END IF;
END $$;
--> statement-breakpoint
INSERT INTO hub.process_defs (id, tenant_id, key, name, description, input_hint, run_group_ids, stages, token_budget, enabled,
  sources, inputs, slot, slot_body, published_version)
VALUES ('0c105000-0000-4000-8000-000000000069', NULL, 'hd-mac-dinh', 'Quy trình HĐ mặc định', 'Duyệt hợp đồng qua các phòng ban theo luồng công ty cài đặt.', 'Mã hợp đồng', '{}'::uuid[],
  '[{"key":"s0","name":"Kiểm tra hợp đồng","step":0,"executor":{"kind":"tool","tool_key":"contracts-route","args":{"contract_id":{"from":"input","key":"contract-id"},"from_step":{"from":"const","value":0}}},"instruction":"","output":{"filename":"s0.md","template":"x","required_sections":["x"],"fields":[{"key":"next","type":"number","required":true}]},"after":{"kind":"review","back_to_steps":[],"remind_every_h":null,"branch":[],"exclude_starter":false,"group_id":null,"group_key":"contracts-editor","escalate":null},"real_action":false,"answerer":{"kind":"starter"},"timeout_s":60,"token_budget":null,"slot":{"kind":"review","head_only":false,"due_h":72,"remind_every_h":null,"escalate_group_id":null,"key":"level1","name":"Kiểm tra hợp đồng","department_group_id":null,"exclude_starter":false,"when":null,"escalate_group_key":null,"department_group_key":"contracts-editor"}},{"key":"route","name":"Chọn bước kế","step":1,"executor":{"kind":"tool","tool_key":"contracts-route","args":{"contract_id":{"from":"input","key":"contract-id"},"from_step":{"from":"const","value":0}}},"instruction":"","output":{"filename":"route.md","template":"x","required_sections":["x"],"fields":[{"key":"next","type":"number","required":true}]},"after":{"kind":"auto","branch":[{"field":"next","op":"eq","value":3,"goto_step":3}]},"real_action":false,"answerer":{"kind":"starter"},"timeout_s":60,"token_budget":null},{"key":"s1","name":"Duyệt cấp 2","step":2,"executor":{"kind":"tool","tool_key":"contracts-route","args":{"contract_id":{"from":"input","key":"contract-id"},"from_step":{"from":"const","value":1}}},"instruction":"","output":{"filename":"s1.md","template":"x","required_sections":["x"],"fields":[{"key":"next","type":"number","required":true}]},"after":{"kind":"review","back_to_steps":[0],"remind_every_h":null,"branch":[],"exclude_starter":true,"group_id":null,"group_key":"contracts-owner","escalate":null},"real_action":false,"answerer":{"kind":"starter"},"timeout_s":60,"token_budget":null,"slot":{"kind":"review","head_only":false,"due_h":72,"remind_every_h":null,"escalate_group_id":null,"key":"level2","name":"Duyệt cấp 2","department_group_id":null,"exclude_starter":true,"when":{"op":"and","conds":[{"field":"total_value","op":"ge","value":500000000}]},"escalate_group_key":null,"department_group_key":"contracts-owner"}},{"key":"finalize","name":"Ghi Đã duyệt","step":3,"executor":{"kind":"tool","tool_key":"contracts-finalize","args":{"contract_id":{"from":"input","key":"contract-id"}}},"instruction":"","output":{"filename":"finalize.md","template":"x","required_sections":["x"],"fields":[]},"after":{"kind":"auto","branch":[]},"real_action":false,"answerer":{"kind":"starter"},"timeout_s":60,"token_budget":null}]'::jsonb,
  NULL, true, '[]'::jsonb, '[{"key":"contract-id","label":"Hợp đồng","type":"text","required":true}]'::jsonb, 'contracts.approval',
  '{"steps":[{"kind":"review","head_only":false,"due_h":72,"remind_every_h":null,"escalate_group_id":null,"key":"level1","name":"Kiểm tra hợp đồng","department_group_id":null,"exclude_starter":false,"when":null,"escalate_group_key":null,"department_group_key":"contracts-editor"},{"kind":"review","head_only":false,"due_h":72,"remind_every_h":null,"escalate_group_id":null,"key":"level2","name":"Duyệt cấp 2","department_group_id":null,"exclude_starter":true,"when":{"op":"and","conds":[{"field":"total_value","op":"ge","value":500000000}]},"escalate_group_key":null,"department_group_key":"contracts-owner"}]}'::jsonb, 1)
ON CONFLICT (id) DO NOTHING;
--> statement-breakpoint
INSERT INTO hub.process_def_releases (def_id, rel_version, name, stages, slot_body, note)
SELECT d.id, 1, d.name, d.stages, d.slot_body, 'seed 0069'
FROM hub.process_defs d WHERE d.id = '0c105000-0000-4000-8000-000000000069'
ON CONFLICT (def_id, rel_version) DO NOTHING;
--> statement-breakpoint
INSERT INTO hub.process_slots (slot, default_def_id) VALUES ('contracts.approval', '0c105000-0000-4000-8000-000000000069')
ON CONFLICT (slot) DO NOTHING;

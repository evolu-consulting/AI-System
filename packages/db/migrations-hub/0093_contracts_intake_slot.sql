-- CR-120 · cr120-contracts-flow · hub 0093 contracts_intake_slot (when 1803900000000):
-- (1) `hub.process_run_events` — sự kiện run cho node `wait_event` (G4): PK (run, event), FK kép tenant, RLS mẫu `process_timers`;
--     không UPDATE/DELETE (sự kiện đã tới là bất biến; xoá theo run qua CASCADE).
-- (2) Khe `contracts.intake` (luôn bật): def thư viện "Nhận hợp đồng (mặc định)" (stages = `contractsIntakeStages()`, khớp kiểm ở
--     `contracts-intake.seed.test.ts`), bản phát hành v1, hàng `process_slots`. Id cố định + ON CONFLICT DO NOTHING ⇒ chạy lại vô hại;
--     khe đã có mặc định (admin đổi) ⇒ giữ nguyên. Chỉ THÊM hàng/bảng; không mất dữ liệu.
CREATE TABLE IF NOT EXISTS hub.process_run_events (
  tenant_id uuid NOT NULL,
  process_run_id uuid NOT NULL,
  event text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT process_run_events_pkey PRIMARY KEY (process_run_id, event),
  CONSTRAINT process_run_events_event_ck CHECK (event ~ '^[a-z][a-z0-9_.-]{1,63}$'),
  CONSTRAINT process_run_events_run_fk FOREIGN KEY (process_run_id, tenant_id)
    REFERENCES hub.process_runs (id, tenant_id) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE hub.process_run_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$
DECLARE
  v_t constant text := '(current_setting(''app.scope'', true) = ''system'' OR (current_setting(''app.scope'', true) = '
    || '''user'' AND tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid))';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'hub' AND tablename = 'process_run_events'
                 AND policyname = 'process_run_events_hub_rw') THEN
    EXECUTE format('CREATE POLICY process_run_events_hub_rw ON hub.process_run_events FOR ALL TO hub_rw USING %s WITH CHECK %s',
      v_t, v_t);
  END IF;
END
$$;
--> statement-breakpoint
GRANT SELECT, INSERT ON hub.process_run_events TO hub_rw;
--> statement-breakpoint
INSERT INTO hub.process_defs (id, tenant_id, key, name, description, input_hint, run_group_ids, stages, token_budget, enabled,
  sources, inputs, slot, slot_body, published_version)
VALUES ('0c120000-0000-4000-8000-000000000093', NULL, 'hd-nhan-hop-dong', 'Nhận hợp đồng (mặc định)', 'Nhận hợp đồng → AI trích xuất → xác nhận và lưu → duyệt theo luật → ký số → chờ ký → nhắc nghĩa vụ.', 'Mã hợp đồng', '{}'::uuid[],
  '[{"instruction":"","real_action":false,"answerer":{"kind":"starter"},"timeout_s":120,"token_budget":null,"sources":[],"must_know":[],"autofix":null,"key":"extract","name":"AI trích xuất","step":0,"executor":{"kind":"tool","tool_key":"contracts-extract","args":{"contract_id":{"from":"input","key":"contract-id"}}},"output":{"filename":"extract.md","template":"# {name}\n\n## Kết quả\n\n## Bàn giao\n","required_sections":["Kết quả","Bàn giao"],"fields":[{"key":"status","type":"string","required":true}]},"after":{"kind":"auto","branch":[]}},{"instruction":"","real_action":false,"answerer":{"kind":"starter"},"timeout_s":120,"token_budget":null,"sources":[],"must_know":[],"autofix":null,"key":"confirm","name":"Xác nhận và lưu","step":1,"executor":{"kind":"form","fields":[{"key":"obligation_date","label":"Ngày đến hạn nghĩa vụ","type":"date","required":true},{"key":"payment_terms","label":"Điều khoản thanh toán","type":"text","max_len":200,"required":false},{"key":"note","label":"Ghi chú bổ sung","type":"textarea","max_len":2000,"required":false}]},"output":{"filename":"confirm.md","template":"# {name}\n\n## Kết quả\n","required_sections":["Kết quả"],"fields":[{"key":"obligation_date","type":"date","required":false},{"key":"payment_terms","type":"string","required":false},{"key":"note","type":"string","required":false}]},"after":{"kind":"review","group_id":null,"group_key":"contracts-editor","back_to_steps":[],"remind_every_h":24,"escalate":{"after_h":48,"group_key":"contracts-owner"},"branch":[],"exclude_starter":false}},{"instruction":"","real_action":false,"answerer":{"kind":"starter"},"timeout_s":120,"token_budget":null,"sources":[],"must_know":[],"autofix":null,"key":"approve","name":"Duyệt theo luật","step":2,"executor":{"kind":"set","values":[{"key":"outcome","from":{"const":"approved"}}]},"output":{"filename":"approve.md","template":"# {name}\n\n## Kết quả\n","required_sections":["Kết quả"],"fields":[{"key":"outcome","type":"string","required":true}]},"after":{"kind":"review","group_id":null,"group_key":"contracts-owner","back_to_steps":[1],"remind_every_h":null,"escalate":null,"branch":[],"exclude_starter":true,"head_only":true}},{"instruction":"","real_action":true,"answerer":{"kind":"starter"},"timeout_s":120,"token_budget":null,"sources":[],"must_know":[],"autofix":null,"key":"esign","name":"Ký số","step":3,"executor":{"kind":"tool","tool_key":"contracts-esign-send","args":{"contract_id":{"from":"input","key":"contract-id"}}},"output":{"filename":"esign.md","template":"# {name}\n\n## Kết quả\n\n## Bàn giao\n","required_sections":["Kết quả","Bàn giao"],"fields":[{"key":"status","type":"string","required":true}]},"after":{"kind":"auto","branch":[]}},{"instruction":"","real_action":false,"answerer":{"kind":"starter"},"timeout_s":600,"token_budget":null,"sources":[],"must_know":[],"autofix":null,"key":"signed","name":"Chờ ký xong","step":4,"executor":{"kind":"wait_event","event":"esign.completed","timeout_h":336},"output":{"filename":"signed.md","template":"# {name}\n\n## Bàn giao\n","required_sections":["Bàn giao"],"fields":[]},"after":{"kind":"auto","branch":[]}},{"instruction":"","real_action":false,"answerer":{"kind":"starter"},"timeout_s":600,"token_budget":null,"sources":[],"must_know":[],"autofix":null,"key":"wait-obligation","name":"Chờ tới ngày nghĩa vụ","step":5,"executor":{"kind":"wait_until","from":{"kind":"field","stage_key":"confirm","field":"obligation_date"},"offset_days":-7,"time":"09:00"},"output":{"filename":"wait-obligation.md","template":"# {name}\n\n## Bàn giao\n","required_sections":["Bàn giao"],"fields":[]},"after":{"kind":"auto","branch":[]}},{"instruction":"","real_action":false,"answerer":{"kind":"starter"},"timeout_s":120,"token_budget":null,"sources":[],"must_know":[],"autofix":null,"key":"remind","name":"Nhắc nghĩa vụ","step":6,"executor":{"kind":"tool","tool_key":"contracts-obligation-remind","args":{"contract_id":{"from":"input","key":"contract-id"}}},"output":{"filename":"remind.md","template":"# {name}\n\n## Kết quả\n\n## Bàn giao\n","required_sections":["Kết quả","Bàn giao"],"fields":[{"key":"status","type":"string","required":true}]},"after":{"kind":"auto","branch":[]}}]'::jsonb,
  NULL, true, '[]'::jsonb, '[{"key":"contract-id","label":"Hợp đồng","type":"text","required":true}]'::jsonb, 'contracts.intake', NULL, 1)
ON CONFLICT (id) DO NOTHING;
--> statement-breakpoint
INSERT INTO hub.process_def_releases (def_id, rel_version, name, stages, slot_body, note)
SELECT d.id, 1, d.name, d.stages, d.slot_body, 'seed 0093'
FROM hub.process_defs d WHERE d.id = '0c120000-0000-4000-8000-000000000093'
ON CONFLICT (def_id, rel_version) DO NOTHING;
--> statement-breakpoint
INSERT INTO hub.process_slots (slot, default_def_id) VALUES ('contracts.intake', '0c120000-0000-4000-8000-000000000093')
ON CONFLICT (slot) DO NOTHING;
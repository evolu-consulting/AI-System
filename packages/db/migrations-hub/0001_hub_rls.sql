-- HUB-FR-75 · HUB-BR-14 · RLS 5 bảng hội thoại (plan H1 §3.4, mẫu 0002_admin_rls). Migration custom: policy không khai
-- trong schema Drizzle. Hàng chỉ thấy khi app.scope = 'system' (việc nền) hoặc 'user' VÀ đúng app.tenant_id + app.user_id;
-- scope lạ/thiếu → không thấy gì. Policy chỉ cho hub_rw; agent_runtime không có GRANT bảng hội thoại (0000).
ALTER TABLE hub.conversations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE hub.flows ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE hub.messages ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE hub.runs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE hub.run_steps ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY conversations_hub_rw ON hub.conversations FOR ALL TO hub_rw
  USING (current_setting('app.scope', true) = 'system'
         OR (current_setting('app.scope', true) = 'user'
             AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
             AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid))
  WITH CHECK (current_setting('app.scope', true) = 'system'
         OR (current_setting('app.scope', true) = 'user'
             AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
             AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid));
--> statement-breakpoint
CREATE POLICY flows_hub_rw ON hub.flows FOR ALL TO hub_rw
  USING (current_setting('app.scope', true) = 'system'
         OR (current_setting('app.scope', true) = 'user'
             AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
             AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid))
  WITH CHECK (current_setting('app.scope', true) = 'system'
         OR (current_setting('app.scope', true) = 'user'
             AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
             AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid));
--> statement-breakpoint
CREATE POLICY messages_hub_rw ON hub.messages FOR ALL TO hub_rw
  USING (current_setting('app.scope', true) = 'system'
         OR (current_setting('app.scope', true) = 'user'
             AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
             AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid))
  WITH CHECK (current_setting('app.scope', true) = 'system'
         OR (current_setting('app.scope', true) = 'user'
             AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
             AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid));
--> statement-breakpoint
CREATE POLICY runs_hub_rw ON hub.runs FOR ALL TO hub_rw
  USING (current_setting('app.scope', true) = 'system'
         OR (current_setting('app.scope', true) = 'user'
             AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
             AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid))
  WITH CHECK (current_setting('app.scope', true) = 'system'
         OR (current_setting('app.scope', true) = 'user'
             AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
             AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid));
--> statement-breakpoint
CREATE POLICY run_steps_hub_rw ON hub.run_steps FOR ALL TO hub_rw
  USING (current_setting('app.scope', true) = 'system'
         OR (current_setting('app.scope', true) = 'user'
             AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
             AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid))
  WITH CHECK (current_setting('app.scope', true) = 'system'
         OR (current_setting('app.scope', true) = 'user'
             AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
             AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid));

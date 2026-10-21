-- agents-background · cờ dữ liệu `hub.agents.surface`: 'chat' (chat được, cấp quyền cho người/nhóm) | 'background' (chạy nền cho app/
-- tính năng, KHÔNG cấp quyền, không hiện ở @mention). `serves` = app + nhãn tính năng mà agent nền phục vụ (hiện ở màn Agents).
-- Dữ liệu có sẵn: price-scout + mọi Orchestrator ⇒ background. Grant (user/group/tenant) của agent nền bị gỡ (không còn ý nghĩa).
-- Bật/tắt agent nền theo công ty dùng chính `agent_entitlements`: mặc định BẬT, hàng `revoked_at` ≠ NULL = tắt (price-scout).
-- Có đổi ⇒ tăng `hub_config_version` + NOTIFY. Chạy lại vô hại. Số câu cố định.
ALTER TABLE hub.agents
  ADD COLUMN IF NOT EXISTS surface text NOT NULL DEFAULT 'chat',
  ADD COLUMN IF NOT EXISTS serves jsonb;
--> statement-breakpoint
ALTER TABLE hub.agents DROP CONSTRAINT IF EXISTS agents_surface_ck;
--> statement-breakpoint
ALTER TABLE hub.agents ADD CONSTRAINT agents_surface_ck CHECK (surface IN ('chat', 'background'));
--> statement-breakpoint
DO $$
DECLARE
  n int := 0;
  k int;
  v bigint;
BEGIN
  UPDATE hub.agents SET surface = 'background', updated_at = now()
    WHERE surface <> 'background'
      AND (key = 'price-scout' OR id IN (SELECT agent_id FROM hub.orchestrator_settings));
  GET DIAGNOSTICS k = ROW_COUNT; n := n + k;
  UPDATE hub.agents SET serves = '{"app":"contracts","label":{"vi":"Sổ Hợp Tác › Dò giá thị trường","en":"Contract ledger › Price scout"}}'::jsonb
    WHERE key = 'price-scout' AND serves IS NULL;
  GET DIAGNOSTICS k = ROW_COUNT; n := n + k;
  UPDATE hub.agents SET serves = '{"app":"chat","label":{"vi":"Chat AI › điều phối tin nhắn","en":"AI chat › message routing"}}'::jsonb
    WHERE id IN (SELECT agent_id FROM hub.orchestrator_settings) AND serves IS NULL;
  GET DIAGNOSTICS k = ROW_COUNT; n := n + k;
  DELETE FROM hub.agent_grants WHERE agent_id IN (SELECT id FROM hub.agents WHERE surface = 'background')
    AND agent_id NOT IN (SELECT agent_id FROM hub.orchestrator_settings);
  GET DIAGNOSTICS k = ROW_COUNT; n := n + k;
  IF n > 0 THEN
    UPDATE hub.config_meta SET hub_config_version = hub_config_version + 1 WHERE id = 1
      RETURNING hub_config_version INTO v;
    PERFORM pg_notify('hub_config_changed', v::text);
  END IF;
END $$;

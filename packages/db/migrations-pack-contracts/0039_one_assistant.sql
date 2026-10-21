-- one-agent · trợ lý của gói `contracts` là agent chung `assistant` (đã gộp `mgmt-assistant`, hub 0051): bật gói cho tenant ⇒
-- `packs.grant_agents` cấp `assistant` cho 3 Group vai. Idempotent.
INSERT INTO packs.pack_agents (pack_key, agent_key) VALUES ('contracts', 'assistant')
  ON CONFLICT (pack_key, agent_key) DO NOTHING;
--> statement-breakpoint
DELETE FROM packs.pack_agents WHERE pack_key = 'contracts' AND agent_key = 'mgmt-assistant';

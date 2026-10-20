-- PK-FR-05 · UAT CR-095 B4 · M2-chat: trợ lý của gói `contracts` là agent Hub `mgmt-assistant` — bật gói cho tenant ⇒
-- `packs.grant_agents` cấp entitlement + grant 3 Group vai (migrations-packs 0005). Idempotent.
INSERT INTO packs.pack_agents (pack_key, agent_key) VALUES ('contracts', 'mgmt-assistant')
  ON CONFLICT (pack_key, agent_key) DO NOTHING;

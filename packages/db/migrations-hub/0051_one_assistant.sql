-- one-agent · MỘT trợ lý chat: `mgmt-assistant` (trợ lý riêng của dock Sổ Hợp Tác) gộp vào `assistant`.
-- (1) entitlement còn hiệu lực của agent cũ ⇒ entitlement `assistant` cho tenant đó khi CHƯA có hàng (hàng đã thu hồi giữ nguyên:
--     platform_admin tắt `assistant` cho tenant thì không tự bật lại); entitlement cũ thu hồi.
-- (2) grant (group/user/tenant) của agent cũ ⇒ grant `assistant` khi chưa có (giữ người cấp/lúc cấp), rồi xoá grant cũ.
-- (3) agent mặc định / dự phòng của tenant trỏ agent cũ ⇒ `assistant`.
-- (4) agent cũ: `enabled = false`, bỏ `studio_overrides` (bản ghi đè Studio của agent cũ không chuyển; của `assistant` giữ).
--     Hàng run / usage / flow lịch sử giữ nguyên (FK tới agent còn).
-- (5) có đổi ⇒ tăng `hub_config_version` + NOTIFY (instance đang chạy nạp lại ảnh cấu hình).
-- Thiếu một trong hai agent (DB mới, chưa seed) ⇒ không làm gì. Chạy lại vô hại. Số câu cố định, không lặp theo hàng (Luật 4c).
DO $$
DECLARE
  old_id uuid;
  new_id uuid;
  n int := 0;
  k int;
  v bigint;
BEGIN
  SELECT id INTO old_id FROM hub.agents WHERE key = 'mgmt-assistant';
  SELECT id INTO new_id FROM hub.agents WHERE key = 'assistant';
  IF old_id IS NULL OR new_id IS NULL THEN
    RETURN;
  END IF;
  PERFORM 1 FROM hub.config_meta WHERE id = 1 FOR UPDATE;
  INSERT INTO hub.agent_entitlements (agent_id, tenant_id, granted_by)
    SELECT new_id, e.tenant_id, e.granted_by FROM hub.agent_entitlements e
    WHERE e.agent_id = old_id AND e.revoked_at IS NULL
    ON CONFLICT (agent_id, tenant_id) DO NOTHING;
  GET DIAGNOSTICS k = ROW_COUNT; n := n + k;
  UPDATE hub.agent_entitlements SET revoked_at = now()
    WHERE agent_id = old_id AND revoked_at IS NULL;
  GET DIAGNOSTICS k = ROW_COUNT; n := n + k;
  INSERT INTO hub.agent_grants (agent_id, tenant_id, subject_type, subject_id, granted_by, granted_at)
    SELECT new_id, g.tenant_id, g.subject_type, g.subject_id, g.granted_by, g.granted_at FROM hub.agent_grants g
    WHERE g.agent_id = old_id
    ON CONFLICT (agent_id, tenant_id, subject_type, subject_id) DO NOTHING;
  GET DIAGNOSTICS k = ROW_COUNT; n := n + k;
  DELETE FROM hub.agent_grants WHERE agent_id = old_id;
  GET DIAGNOSTICS k = ROW_COUNT; n := n + k;
  UPDATE hub.tenant_agent_defaults SET
      default_agent_id = CASE WHEN default_agent_id = old_id THEN new_id ELSE default_agent_id END,
      fallback_agent_id = CASE WHEN fallback_agent_id = old_id THEN new_id ELSE fallback_agent_id END,
      updated_at = now()
    WHERE default_agent_id = old_id OR fallback_agent_id = old_id;
  GET DIAGNOSTICS k = ROW_COUNT; n := n + k;
  UPDATE hub.agents SET enabled = false, studio_overrides = '{}', version = version + 1, updated_at = now()
    WHERE id = old_id AND (enabled OR studio_overrides <> '{}');
  GET DIAGNOSTICS k = ROW_COUNT; n := n + k;
  IF n > 0 THEN
    UPDATE hub.config_meta SET hub_config_version = hub_config_version + 1 WHERE id = 1
      RETURNING hub_config_version INTO v;
    PERFORM pg_notify('hub_config_changed', v::text);
  END IF;
END $$;

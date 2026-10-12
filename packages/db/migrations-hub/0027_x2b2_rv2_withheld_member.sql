-- HUB-FR-44 · HUB-FR-101 · X2b2-R11 (review RV2 #4): phòng thủ nhiều lớp cho definer `hub.room_msg_withheld` (0026) — ở
-- scope `user` chỉ trả trạng thái chờ của tin thuộc phòng người gọi đang là thành viên (`hub.is_room_member`), để definer
-- không thành "oracle" đọc trạng thái `tool_confirmations` của phòng khác. Không thành viên ⇒ false (không lộ gì); quyền đọc
-- file vẫn do vế thành viên ở mọi nơi gọi (policy `attachments_room_member_select`, `findReadableAttachment`, route phòng).
-- Scope `system` giữ nguyên. Viết tay, chạy lại an toàn (CREATE OR REPLACE; giữ owner/ACL). Không đổi bảng/dữ liệu.

CREATE OR REPLACE FUNCTION hub.room_msg_withheld(p_msg uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
  AS $$
  SELECT EXISTS (
    SELECT 1 FROM hub.room_messages m
    JOIN hub.tool_confirmations t ON t.run_id = m.run_id AND t.tenant_id = m.tenant_id AND t.status = 'pending'
    WHERE m.id = p_msg AND m.sender_type = 'agent' AND m.wait_kind = 'side_effect'
      AND (current_setting('app.scope', true) = 'system'
           OR (m.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
               AND hub.is_room_member(m.room_id))))
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION hub.room_msg_withheld(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION hub.room_msg_withheld(uuid) TO hub_rw;

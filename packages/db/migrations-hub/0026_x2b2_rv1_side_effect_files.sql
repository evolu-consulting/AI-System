-- HUB-FR-44 · HUB-FR-101 · HUB-BR-22 · X2b2-R11 bổ sung (review RV1 #1): `out/` gắn vào tin agent phòng đang chờ xác
-- nhận `side_effect` (X2b D3 giấu nội dung với người khác) chỉ người gọi (= `attachments.user_id`) xem/tải tới khi chờ được
-- giải quyết (`tool_confirmations` của run hết `pending` — `decideConfirmations` ở run kế của người gọi). Người khác: không
-- ref, `/content` 404, không vào cửa sổ file run của họ. `tool_confirmations` RLS chỉ cho chủ ⇒ cần definer.
-- Viết tay, chạy lại an toàn (CREATE OR REPLACE; ALTER POLICY ghi đè). Không đổi bảng/dữ liệu.

CREATE OR REPLACE FUNCTION hub.room_msg_withheld(p_msg uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
  AS $$
  SELECT EXISTS (
    SELECT 1 FROM hub.room_messages m
    JOIN hub.tool_confirmations t ON t.run_id = m.run_id AND t.tenant_id = m.tenant_id AND t.status = 'pending'
    WHERE m.id = p_msg AND m.sender_type = 'agent' AND m.wait_kind = 'side_effect'
      AND (current_setting('app.scope', true) = 'system'
           OR m.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid))
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION hub.room_msg_withheld(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION hub.room_msg_withheld(uuid) TO hub_rw;
--> statement-breakpoint

-- Lớp 2: thành viên khác chủ file chỉ đọc file phòng khi tin không còn bị giữ. Chủ đọc qua `attachments_hub_rw`.
ALTER POLICY attachments_room_member_select ON hub.attachments
  USING (current_setting('app.scope', true) = 'user'
         AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         AND room_id IS NOT NULL
         AND hub.is_room_member(room_id)
         AND (room_message_id IS NULL OR NOT hub.room_msg_withheld(room_message_id)));

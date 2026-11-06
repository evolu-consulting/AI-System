-- CR-122 · A2 · FLOW2-FR-19 · role gói `community_rw` được ghi sự kiện flow CÙNG tx bản ghi: chỉ EXECUTE hàm SECURITY DEFINER
-- `hub.emit_flow_event` (hub 0109) + USAGE schema `hub`; KHÔNG quyền bảng `hub.flow_events`. Role gói do `packs.install` (0001) tạo SAU
-- hub 0109 nên khối GRANT trong 0109 bỏ qua nó ⇒ cấp lại ở đây (idempotent; hub luôn migrate trước gói). Hàm tự khoá tenant = `app.tenant_id`.
GRANT USAGE ON SCHEMA hub TO community_rw;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION hub.emit_flow_event(uuid, text, text, text, jsonb, uuid) TO community_rw;

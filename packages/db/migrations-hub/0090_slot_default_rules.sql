-- CR-120 §3 · cr120-single-source · ADR-0036 · gán cũ (`process_slot_assignments`, CR-105) ⇒ luật `is_default` của nguồn duy nhất
-- (`process_tenant_defs` + `process_routings` + `process_routing_rules`, hub 0087). Chỉ cho tenant × khe CHƯA có luật nào: không
-- luật ⇒ launch đi `RESOLVE_SLOT_SQL` = gán cũ, nay luật mặc định trỏ đúng def đó ⇒ def hiệu lực không đổi. Tenant × khe đã có
-- luật (do tenant admin đặt) giữ nguyên (launch của họ vốn đi theo luật, bỏ qua gán cũ). Priority 49 (cuối; luật mặc định chỉ là
-- dự phòng bất kể priority). Chạy với vai owner (bảng ENABLE, không FORCE RLS ⇒ thấy mọi tenant). Theo tập; chạy lại vô hại
-- (ON CONFLICT DO NOTHING + điều kiện "chưa có luật"). Bảng cũ còn là bảng ở bước này (0091 mới đổi thành VIEW).
INSERT INTO hub.process_tenant_defs (tenant_id, def_id, slot, assigned_by)
SELECT a.tenant_id, a.def_id, a.slot, a.assigned_by
FROM hub.process_slot_assignments a
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO hub.process_routings (tenant_id, slot, updated_by)
SELECT a.tenant_id, a.slot, a.assigned_by
FROM hub.process_slot_assignments a
WHERE NOT EXISTS (SELECT 1 FROM hub.process_routing_rules r WHERE r.tenant_id = a.tenant_id AND r.slot = a.slot)
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO hub.process_routing_rules (tenant_id, slot, priority, condition, def_id, is_default)
SELECT a.tenant_id, a.slot, 49, '{}'::jsonb, a.def_id, true
FROM hub.process_slot_assignments a
WHERE NOT EXISTS (SELECT 1 FROM hub.process_routing_rules r WHERE r.tenant_id = a.tenant_id AND r.slot = a.slot)
ON CONFLICT DO NOTHING;

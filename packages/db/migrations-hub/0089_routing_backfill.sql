-- hub-routing-backfill · CR-118 §11.2 · tenant gán theo đường cũ (`process_slot_assignments`, CR-105/CR-113 — vd "Demo Sổ Hợp
-- Tác") chưa có hàng trong tập gán `process_tenant_defs` (0087 không backfill) ⇒ màn luật chọn quy trình rỗng. Chép mỗi gán
-- cũ (tenant × khe × def) vào tập, `assigned_by` NULL = hệ thống. KHÔNG tạo luật (không luật ⇒ launch đi đường gán cũ như
-- trước). Chạy với vai owner của migration (bảng ENABLE, không FORCE RLS ⇒ owner thấy mọi tenant). Một câu theo tập; chạy lại
-- vô hại (ON CONFLICT DO NOTHING, hàng có sẵn không bị đè).
INSERT INTO hub.process_tenant_defs (tenant_id, def_id, slot, assigned_by)
SELECT a.tenant_id, a.def_id, a.slot, NULL
FROM hub.process_slot_assignments a
ON CONFLICT DO NOTHING;

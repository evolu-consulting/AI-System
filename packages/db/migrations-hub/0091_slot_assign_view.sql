-- CR-120 §3 · cr120-single-source · ADR-0036 · bảng gán cũ thôi là nguồn: đổi tên → `process_slot_assignments_legacy` (giữ dữ liệu
-- + RLS/policy để đối chiếu/rollback, KHÔNG cấp cho hub_rw), tạo VIEW cùng tên CHỈ ĐỌC dẫn xuất từ luật `is_default` (một bản phát
-- hành cho code đọc cũ; CR-121 xoá cả hai). `security_invoker` ⇒ RLS của `process_routing_rules`/`process_tenant_defs` áp theo
-- người gọi (scope user chỉ thấy tenant mình) — không có thì view chạy quyền owner và lộ chéo tenant. Audit giữ nguyên (audit_log
-- không đổi). Chạy lại vô hại (đổi tên chỉ khi còn là bảng; CREATE OR REPLACE VIEW).
DO $$
BEGIN
  IF (SELECT c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'hub' AND c.relname = 'process_slot_assignments') = 'r' THEN
    ALTER TABLE hub.process_slot_assignments RENAME TO process_slot_assignments_legacy;
  END IF;
END $$;
--> statement-breakpoint
REVOKE ALL ON hub.process_slot_assignments_legacy FROM hub_rw;
--> statement-breakpoint
CREATE OR REPLACE VIEW hub.process_slot_assignments WITH (security_invoker = true) AS
  SELECT r.tenant_id, r.slot, r.def_id, a.assigned_by, a.assigned_at
  FROM hub.process_routing_rules r
  JOIN hub.process_tenant_defs a ON a.tenant_id = r.tenant_id AND a.slot = r.slot AND a.def_id = r.def_id
  WHERE r.is_default;
--> statement-breakpoint
REVOKE ALL ON hub.process_slot_assignments FROM hub_rw;
--> statement-breakpoint
GRANT SELECT ON hub.process_slot_assignments TO hub_rw;
--> statement-breakpoint
-- Đọc cũ qua view theo def (`tenant_count`, tập bị ảnh hưởng khi xuất bản) ⇒ index def của luật mặc định.
CREATE INDEX IF NOT EXISTS process_routing_rules_default_def_idx ON hub.process_routing_rules (def_id) WHERE is_default;

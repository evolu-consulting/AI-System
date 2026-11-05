-- CR-121 §A · cr121-a1-drop-legacy-view · gỡ VIEW `hub.process_slot_assignments` (hub 0091, dẫn xuất từ luật `is_default`). Nguồn duy nhất của
-- việc gán quy trình = `process_tenant_defs` + `process_routing_rules` (cột `source` từ hub 0096); mọi chỗ đọc view đã chuyển/xoá trong cùng lát.
-- Chỉ gỡ khi đối tượng là VIEW (relkind 'v'): không bao giờ DROP nhầm bảng; DB chưa qua 0091 (đang là bảng) ⇒ bỏ qua. Grant của view (SELECT hub_rw)
-- đi theo khi DROP; view không có policy riêng (security_invoker ⇒ RLS của bảng nguồn). Bảng `process_slot_assignments_legacy` (dữ liệu cũ, RLS,
-- không cấp hub_rw) GIỮ NGUYÊN để đối chiếu — gỡ ở lát dọn dữ liệu sau khi prod đã đối chiếu. Migration cũ (0068/0089/0090/0091) giữ nguyên
-- thứ tự: chạy lại trên DB mới vẫn dựng rồi gỡ view. Chạy lại vô hại.
DO $$
BEGIN
  IF (SELECT c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'hub' AND c.relname = 'process_slot_assignments') = 'v' THEN
    DROP VIEW hub.process_slot_assignments;
  END IF;
END $$;

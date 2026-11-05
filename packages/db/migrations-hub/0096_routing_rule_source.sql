-- CR-121 · D-4 · "đã gán quy trình" phải là DẤU TƯỜNG MINH, không suy từ so sánh với mẫu khe lúc hỏi (đổi mẫu mặc định của khe sẽ
-- làm mọi luật do `ensureSlotDefaults` tự cấp bỗng thành "đã gán"; admin chủ động gán đúng mẫu mặc định lại bị coi "chưa gán").
-- Cột `source` của luật: 'admin' = do người gán/sửa (đường admin gán, PUT luật, seed) · 'auto' = do `ensureSlotDefaults` tự cấp.
-- Mặc định 'admin' ⇒ mọi đường ghi luật hiện có đúng nghĩa mà không phải sửa; chỉ `ensureSlotDefaults` ghi 'auto', và `upsertAssignment`
-- (admin gán) đổi luật mặc định sang 'admin'. Cổng engine duyệt HĐ: có ≥ 1 luật `source = 'admin'` của tenant × khe.
-- Backfill (quy tắc): luật là 'auto' CHỈ KHI còn nguyên trạng lúc cấp tự động — luật mặc định priority 49 điều kiện rỗng, là luật duy nhất của
-- tenant × khe, đầu luật `updated_by IS NULL` và `version = 1` (mọi đường admin gán/sửa đều ghi `updated_by` + tăng `version`), và tập gán
-- `process_tenant_defs` của def đó `assigned_by IS NULL` (như hub 0094). Mọi dấu hiệu admin ⇒ giữ 'admin'. Không chắc ⇒ 'admin' (an toàn: tenant
-- đã chủ động gán không bị rơi về máy cũ); ca "admin gán đúng mẫu khe, chưa từng sửa" không phân biệt được với tự cấp ⇒ 'auto' (= hành vi hiện
-- tại: chưa gán ⇒ máy cũ, admin gán lại một lần là xong). Chạy với vai owner; chạy lại vô hại.
ALTER TABLE hub.process_routing_rules ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'admin';
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'process_routing_rules_source_ck'
                 AND conrelid = 'hub.process_routing_rules'::regclass) THEN
    ALTER TABLE hub.process_routing_rules
      ADD CONSTRAINT process_routing_rules_source_ck CHECK (source IN ('admin', 'auto'));
  END IF;
END $$;
--> statement-breakpoint
UPDATE hub.process_routing_rules r SET source = 'auto'
WHERE r.source = 'admin' AND r.is_default AND r.priority = 49 AND r.condition = '{}'::jsonb
  AND NOT EXISTS (SELECT 1 FROM hub.process_routing_rules o
                  WHERE o.tenant_id = r.tenant_id AND o.slot = r.slot AND o.id <> r.id)
  AND EXISTS (SELECT 1 FROM hub.process_routings h
              WHERE h.tenant_id = r.tenant_id AND h.slot = r.slot AND h.updated_by IS NULL AND h.version = 1)
  AND NOT EXISTS (SELECT 1 FROM hub.process_tenant_defs d
                  WHERE d.tenant_id = r.tenant_id AND d.slot = r.slot AND d.def_id = r.def_id AND d.assigned_by IS NOT NULL);

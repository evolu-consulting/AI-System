-- CR-120 · cr120-review-fixes · duyệt bài là OPT-IN (quyết định điều phối 2026-11-05): `ensureSlotDefaults` từng cấp luật mặc định cho
-- MỌI tenant bật `community-read` ⇒ khe `community.post-moderation` tự bật cho tất cả (và bỏ gán không tắt được). Code mới loại khe
-- Community khỏi cấp mặc định (`SlotSpec.optIn`); migration này gỡ những gì lần cấp tự động ĐÃ tạo.
-- Nhận diện "do cấp tự động" (KHÔNG xoá thứ platform admin đã gán): đầu luật tenant × khe còn NGUYÊN TRẠNG lúc `ensureSlotDefaults`
-- chèn — `updated_by IS NULL` và `version = 1` (mọi đường admin gán/sửa luật đều ghi `updated_by` + tăng `version`) — và luật duy
-- nhất là luật mặc định priority 49. Tập gán `process_tenant_defs` do cấp tự động có `assigned_by IS NULL` (đường admin luôn ghi
-- người gán). Bất kỳ dấu hiệu admin nào (updated_by, version > 1, luật thứ hai, priority khác 49, assigned_by) ⇒ GIỮ.
-- Hai câu theo tập (không theo hàng): (1) xoá đầu luật (luật xoá theo CASCADE), (2) xoá tập gán mồ côi do cấp tự động.
-- Chạy lại vô hại (lần sau không còn hàng khớp). Chạy với vai owner như các backfill hub trước.
DELETE FROM hub.process_routings h
WHERE h.slot IN ('community.post-moderation', 'community.partner-join', 'community.report')
  AND h.updated_by IS NULL AND h.version = 1
  AND EXISTS (SELECT 1 FROM hub.process_routing_rules r
              WHERE r.tenant_id = h.tenant_id AND r.slot = h.slot AND r.is_default AND r.priority = 49)
  AND NOT EXISTS (SELECT 1 FROM hub.process_routing_rules r
                  WHERE r.tenant_id = h.tenant_id AND r.slot = h.slot AND NOT (r.is_default AND r.priority = 49));
--> statement-breakpoint
DELETE FROM hub.process_tenant_defs a
WHERE a.slot IN ('community.post-moderation', 'community.partner-join', 'community.report')
  AND a.assigned_by IS NULL
  AND NOT EXISTS (SELECT 1 FROM hub.process_routings h WHERE h.tenant_id = a.tenant_id AND h.slot = a.slot)
  AND NOT EXISTS (SELECT 1 FROM hub.process_routing_rules r WHERE r.tenant_id = a.tenant_id AND r.slot = a.slot);
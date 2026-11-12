-- CR-130 pha 3 · lát 2 (ADR-0044): Group `community-admin` không còn (Bảng tin dùng quyền gói contracts) ⇒ thân khe/mẫu mang nhãn
-- người duyệt `contracts-admin` (nhóm chủ gói contracts). Khe Community đã opt-in theo gán của admin nền tảng (hub 0094), không đổi.
-- Chỉ thay chuỗi mã nhóm; chạy lại vô hại (lần sau không còn hàng khớp).
UPDATE hub.process_defs
SET stages = replace(stages::text, 'community-admin', 'contracts-admin')::jsonb,
    slot_body = replace(slot_body::text, 'community-admin', 'contracts-admin')::jsonb
WHERE stages::text LIKE '%community-admin%' OR slot_body::text LIKE '%community-admin%';
--> statement-breakpoint
UPDATE hub.process_def_releases
SET stages = replace(stages::text, 'community-admin', 'contracts-admin')::jsonb,
    slot_body = replace(slot_body::text, 'community-admin', 'contracts-admin')::jsonb
WHERE stages::text LIKE '%community-admin%' OR slot_body::text LIKE '%community-admin%';

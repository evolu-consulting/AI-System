-- CR-107 (eng-links-race) · `pending_links` của lượt engine gắn với NGƯỜI GIỮ (một người một lúc): `pending_claim` (mã lần bấm),
-- `pending_by` (người Đạt), `pending_task` (task duyệt cuối), `pending_at` (lúc giữ). Người thứ hai Đạt cùng task bị chặn trước `act`
-- ⇒ không ghi đè / không xoá SP của người thắng. Bảng đã RLS FORCE (0047) — chỉ thêm cột, policy giữ nguyên; chạy lại vô hại.
ALTER TABLE contracts.approvals ADD COLUMN IF NOT EXISTS pending_claim uuid;
--> statement-breakpoint
ALTER TABLE contracts.approvals ADD COLUMN IF NOT EXISTS pending_by uuid;
--> statement-breakpoint
ALTER TABLE contracts.approvals ADD COLUMN IF NOT EXISTS pending_task text;
--> statement-breakpoint
ALTER TABLE contracts.approvals ADD COLUMN IF NOT EXISTS pending_at timestamptz;

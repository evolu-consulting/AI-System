-- fix-review-r1 · avatar chỉ là ảnh thẻ người đã cắt vuông ~256 px WebP (vài chục KB) nhưng thẻ người được đọc THEO LÔ (≤ 50 người mỗi lần):
-- hạ trần từ 2,8 triệu ký tự (~2 MB) xuống 205 000 ký tự (~150 KB) để một lô không kéo hàng chục MB. Dữ liệu cũ vượt trần (nếu có) bị gỡ
-- (CHƯA có khách ⇒ không backfill; ảnh gốc luôn tải lại được). Ảnh bìa cá nhân giữ ≤ 3 MB.
UPDATE hub.people_profiles SET avatar = NULL WHERE avatar IS NOT NULL AND char_length(avatar) > 205000;
--> statement-breakpoint
ALTER TABLE hub.people_profiles DROP CONSTRAINT IF EXISTS people_profiles_avatar_ck;
--> statement-breakpoint
ALTER TABLE hub.people_profiles ADD CONSTRAINT people_profiles_avatar_ck
  CHECK (avatar IS NULL OR (char_length(avatar) <= 205000 AND avatar ~ '^data:image/(png|jpeg|webp);base64,'));

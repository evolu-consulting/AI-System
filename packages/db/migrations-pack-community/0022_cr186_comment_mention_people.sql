-- CR-186 · lưu NGƯỜI được nhắc theo từng bình luận (như `post_mentions` của bài, CR-145): cột `mention_people` = [{id, name, org}] ngay trong
-- hàng bình luận (`name` chụp lúc nhắc; `org` NULL = chủ quản). Một nguồn (policy `comments_*` đã lọc hàng); đọc không join thêm bảng.
-- Che theo người xem làm ở câu SELECT (đối tác chỉ nhận phần tử là chủ quản hoặc công ty mình — cùng luật `post_mentions_visible`).
-- Prod có khách: CHỈ THÊM cột (mặc định '[]' ⇒ bình luận cũ không đổi, KHÔNG backfill), không đổi cột cũ `mention_orgs`.
-- Bảng có thể lớn: ADD … NOT VALID (khoá ngắn) rồi VALIDATE ở statement riêng; chờ khoá tối đa 5s.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
ALTER TABLE community.comments ADD COLUMN IF NOT EXISTS mention_people jsonb NOT NULL DEFAULT '[]'::jsonb;
--> statement-breakpoint
ALTER TABLE community.comments ADD CONSTRAINT comments_mention_people_ck
  CHECK (jsonb_typeof(mention_people) = 'array' AND jsonb_array_length(mention_people) <= 10) NOT VALID;
--> statement-breakpoint
ALTER TABLE community.comments VALIDATE CONSTRAINT comments_mention_people_ck;

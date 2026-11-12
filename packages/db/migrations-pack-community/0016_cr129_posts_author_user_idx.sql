-- CR-129 L5 · hồ sơ cá nhân: `GET /feed?authorUserId=` lọc bài của MỘT người (`p.author_user_id`) trong tenant, mới nhất trước.
-- Index đi đúng thứ tự trang (tenant_id, author_user_id, created_at DESC, id DESC); RLS/audience giữ nguyên (chỉ thêm điều kiện).
CREATE INDEX IF NOT EXISTS posts_author_user_idx
  ON community.posts (tenant_id, author_user_id, created_at DESC, id DESC);

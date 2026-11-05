-- CR-120 · cr120-review-fixes · siết trigger `posts_moderation_guard` (0008 đã gộp ⇒ migration mới):
-- (1) tuple được canh thêm `mod_reason`, `mod_decided_name`, `mod_feedback`, `mod_at` (trước chỉ moderation/screen/decided_by/task) ⇒
--     đối tác không tự viết lý do/tên người duyệt/phản hồi/mốc mở lượt.
-- (2) ngoại lệ DUY NHẤT cho người xem đối tác: MỞ/MỞ LẠI lượt duyệt khi đăng/sửa nội dung bài của chính mình —
--     none|approved|rejected|pending → pending + screen running, MỌI trường quyết định (người/tên/mốc/phản hồi/lý do) phải rỗng.
--     (`pending` thêm vào vì sửa bài đang chờ phải mở lại với task mới — screen/quyết định của nội dung cũ vô hiệu.)
-- Chủ quản/việc nền (viewer_ext_org NULL) không bị chặn. Chạy lại vô hại (CREATE OR REPLACE).
CREATE OR REPLACE FUNCTION community.posts_moderation_guard() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF (NEW.moderation, NEW.mod_screen, NEW.mod_decided_by, NEW.mod_task_id, NEW.mod_reason, NEW.mod_decided_name,
      NEW.mod_feedback, NEW.mod_at)
     IS DISTINCT FROM (OLD.moderation, OLD.mod_screen, OLD.mod_decided_by, OLD.mod_task_id, OLD.mod_reason, OLD.mod_decided_name,
      OLD.mod_feedback, OLD.mod_at)
     AND (SELECT packs.viewer_ext_org()) IS NOT NULL
     AND NOT (OLD.moderation IN ('none', 'approved', 'rejected', 'pending') AND NEW.moderation = 'pending'
       AND NEW.mod_screen = 'running' AND NEW.mod_decided_by IS NULL AND NEW.mod_decided_name IS NULL
       AND NEW.mod_decided_at IS NULL AND NEW.mod_feedback IS NULL AND NEW.mod_reason IS NULL) THEN
    RAISE EXCEPTION 'moderation is host-only' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
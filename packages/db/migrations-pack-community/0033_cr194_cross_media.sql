-- CR-194 · BR-194-1/2/3 · người của công ty ĐÃ KẾT NỐI xem ảnh/video/tệp của bài họ thấy trên bảng tin gộp. Chỉ THÊM hàm DEFINER, không đổi
-- chính sách/bảng nào. «Thấy bài» = ĐÚNG hàm `community.cross_post_tenant(post)` (0032: kết nối hai chiều, add-on, active, «Ai thấy bài»…) — không
-- viết điều kiện thứ hai (G1). Không thấy bài ⇒ không có hàng (tệp: NULL ⇒ route trả 404 giống hệt tệp không tồn tại). Chỉ ĐỌC; không có đường
-- ghi/xoá tệp chéo công ty (BR-194-3).
-- • `cross_media(post_ids)`: MỘT câu theo tập (≤ 101 bài) ⇒ các đính kèm (theo vị trí) của bài người xem thấy.
-- • `cross_file(file_id)`: hàng tệp (tenant chủ + mã kho + tên/mime/cỡ) nếu tệp nằm trên bài người xem thấy; còn lại không có hàng.
CREATE OR REPLACE FUNCTION community.cross_media(p_posts uuid[])
RETURNS TABLE (post_id uuid, id uuid, kind text, label text, url text, file_id uuid, name text, mime text, size_bytes bigint, "position" smallint)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT m.post_id, m.id, m.kind, m.label, m.url, m.file_id, m.name, m.mime, m.size_bytes, m.position
    FROM (SELECT x.p, community.cross_post_tenant(x.p) AS t FROM unnest(p_posts[1:101]) AS x(p)) s
    JOIN community.media m ON m.post_id = s.p AND m.tenant_id = s.t
   WHERE s.t IS NOT NULL
   ORDER BY m.post_id, m.position
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION community.cross_media(uuid[]) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION community.cross_media(uuid[]) TO community_rw;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION community.cross_file(p_file uuid)
RETURNS TABLE (tenant_id uuid, blob_id text, name text, mime text, size_bytes bigint)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT f.tenant_id, f.file_id, f.name, f.mime, f.size_bytes
    FROM community.files f
   WHERE f.id = p_file AND f.deleted_at IS NULL
     AND EXISTS (SELECT 1 FROM community.media m
                  WHERE m.file_id = f.id AND m.tenant_id = f.tenant_id
                    AND community.cross_post_tenant(m.post_id) IS NOT NULL)
   LIMIT 1
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION community.cross_file(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION community.cross_file(uuid) TO community_rw;

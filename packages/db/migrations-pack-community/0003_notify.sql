-- CR-102 · com-c9-notify · docs/current/community/nghiep-vu.md §10: chuông 8 loại. Không bảng mới — tuỳ chọn từng người nằm sẵn ở
-- `community.settings.notify` (0001, RLS "chỉ hàng của mình"). Thêm: (1) mốc đã nhắc "sắp hết hạn" trên bài + index cho vòng quét
-- (tự lưu trữ sau 30 ngày); (2) ngày đã gửi tổng hợp 8:00 của từng người; (3) hàm DEFINER trả "ai muốn nhận loại nào" cho một LÔ
-- người nhận (người đăng/đối tác chạy dưới RLS "chỉ hàng của mình" nên không tự đọc được tuỳ chọn người khác). Chỉ cộng thêm.
ALTER TABLE community.posts ADD COLUMN IF NOT EXISTS expiry_notified_at timestamptz;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS posts_active_expiry_idx ON community.posts (tenant_id, expires_at, id) WHERE status = 'active';
--> statement-breakpoint
ALTER TABLE community.settings ADD COLUMN IF NOT EXISTS digest_on date;
--> statement-breakpoint
-- Tenant lấy từ `app.tenant_id` (không từ đầu vào) ⇒ không đọc tuỳ chọn tenant khác. Mặc định: Bật, trừ `digest` = Tắt.
-- Chỉ trả cặp (người, loại) — không lộ giá trị cài đặt khác.
CREATE OR REPLACE FUNCTION community.notify_wanted(p_items jsonb) RETURNS TABLE (user_id uuid, kind text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT x.user_id, x.kind
  FROM jsonb_to_recordset(p_items) AS x(user_id uuid, kind text)
  LEFT JOIN community.settings s
    ON s.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND s.user_id = x.user_id
  WHERE coalesce(CASE WHEN jsonb_typeof(s.notify -> x.kind) = 'boolean' THEN (s.notify ->> x.kind)::boolean END,
                 x.kind <> 'digest')
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION community.notify_wanted(jsonb) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION community.notify_wanted(jsonb) TO community_rw;
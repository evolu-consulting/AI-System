-- TD #241 (review an ninh N-6) · `hub.ai_release_tokens` nhận thêm tenant: chỉ xoá chỗ giữ khi id VÀ tenant cùng khớp
-- (phòng thủ nhiều lớp — id là uuid ngẫu nhiên nhưng không để hàm xoá chỗ giữ của tenant khác). Đổi chữ ký ⇒ bỏ hàm 1 tham số.
DROP FUNCTION IF EXISTS hub.ai_release_tokens(uuid);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION hub.ai_release_tokens(p_hold_id uuid, p_tenant_id uuid)
  RETURNS void
  LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
  AS $$
  DELETE FROM hub.ai_token_holds WHERE id = p_hold_id AND tenant_id = p_tenant_id
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION hub.ai_release_tokens(uuid, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION hub.ai_release_tokens(uuid, uuid) TO hub_rw;

-- CR-169 · lát 3a · sửa Major soát 2b: `pmsg_people` gọi `pmsg_eligible_raw` theo TỪNG ứng viên (N+1 trong SQL, ~5.000 lần ở mốc spec §6, p95 ≈ 0,8 s).
-- G1: thân điều kiện «người hợp lệ» (P1) tách thành MỘT view `hub.pmsg_eligible_v` (tập (tenant, user)); `pmsg_eligible_raw` (một người) và `pmsg_people` (cả tập)
-- cùng đọc view này — planner đẩy `tenant_id = … AND user_id = …` xuống nên cả hai cùng đi index, không lặp thân điều kiện. View (không phải hàm trả tập)
-- vì hàm DEFINER/`SET search_path` không được inline ⇒ không đẩy được điều kiện. View chạy quyền chủ sở hữu như hàm DEFINER; KHÔNG cấp cho ai (chỉ hàm DEFINER đọc).
-- Không sửa 0149/0150: hàm thay bằng CREATE OR REPLACE (quyền EXECUTE giữ nguyên).
CREATE OR REPLACE VIEW hub.pmsg_eligible_v AS
  SELECT u.tenant_id, u.id AS user_id, u.display_name
    FROM admin.users u
   WHERE u.active AND NOT u.locked_by_tenant AND u.kind <> 'external'
     AND EXISTS (SELECT 1 FROM admin.features fr
                   JOIN admin.feature_entitlements er ON er.feature_id = fr.id AND er.tenant_id = u.tenant_id AND er.revoked_at IS NULL
                  WHERE fr.key = 'contracts-read' AND fr.status <> 'off')
     AND EXISTS (SELECT 1 FROM admin.features fg
                   JOIN admin.feature_entitlements eg ON eg.feature_id = fg.id AND eg.tenant_id = u.tenant_id AND eg.revoked_at IS NULL
                   JOIN admin.feature_grants g ON g.feature_id = fg.id AND g.tenant_id = u.tenant_id AND g.group_id IS NOT NULL
                   JOIN admin.group_members gm ON gm.tenant_id = g.tenant_id AND gm.group_id = g.group_id AND gm.user_id = u.id
                  WHERE fg.key IN ('contracts-read', 'contracts-write', 'contracts-admin') AND fg.status <> 'off');
--> statement-breakpoint
REVOKE ALL ON hub.pmsg_eligible_v FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON hub.pmsg_eligible_v FROM hub_rw;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION hub.pmsg_eligible_raw(p_tenant uuid, p_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT EXISTS (SELECT 1 FROM hub.pmsg_eligible_v e WHERE e.tenant_id = p_tenant AND e.user_id = p_user)
$$;
--> statement-breakpoint
-- Danh bạ (P8): thân như 0150, nhưng «hợp lệ» lấy từ view theo TẬP công ty (không gọi hàm theo từng người). `ts` (công ty của A + đang kết nối, ∩ p_tenants) tính MỘT lần.
CREATE OR REPLACE FUNCTION hub.pmsg_people(p_tenants uuid[], p_q text, p_cur_name text, p_cur_id uuid, p_limit integer)
RETURNS TABLE (user_id uuid, name text, job_title text, tenant_id uuid, company_name text, department_id uuid, department_name text, sort_key text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_tid uuid;
  v_uid uuid;
  v_lim integer := LEAST(GREATEST(COALESCE(p_limit, 30), 1), 101);
  v_q text := hub.fold(replace(replace(replace(btrim(COALESCE(p_q, '')), '\', '\'), '%', '\%'), '_', '\_'));
BEGIN
  SELECT c.tid, c.uid INTO v_tid, v_uid FROM hub.pmsg_ctx() c;
  RETURN QUERY
  WITH ts AS (
    SELECT x.tid FROM (SELECT v_tid AS tid UNION SELECT k.tid FROM hub.pmsg_connected(v_tid) k) x
     WHERE p_tenants IS NULL OR x.tid = ANY (p_tenants)),
  pg AS (
    SELECT e.user_id AS uid, COALESCE(e.display_name, '') AS nm, hub.fold(COALESCE(e.display_name, '')) AS k, e.tenant_id AS tid, pp.job_title AS jt
      FROM ts
      JOIN hub.pmsg_eligible_v e ON e.tenant_id = ts.tid
      LEFT JOIN hub.people_profiles pp ON pp.tenant_id = e.tenant_id AND pp.user_id = e.user_id
     WHERE e.user_id <> v_uid
       AND (v_q = '' OR hub.fold(COALESCE(e.display_name, '')) LIKE '%' || v_q || '%' OR hub.fold(COALESCE(pp.job_title, '')) LIKE '%' || v_q || '%')
       AND (p_cur_name IS NULL OR p_cur_id IS NULL OR (hub.fold(COALESCE(e.display_name, '')), e.user_id) > (p_cur_name, p_cur_id))
     ORDER BY hub.fold(COALESCE(e.display_name, '')), e.user_id
     LIMIT v_lim)
  SELECT pg.uid, pg.nm, pg.jt, pg.tid, COALESCE(tn.legal_name, tn.name), d.gid, d.gname, pg.k
    FROM pg
    JOIN admin.tenants tn ON tn.id = pg.tid
    LEFT JOIN LATERAL (
      SELECT g.id AS gid, COALESCE(g.name ->> 'vi', g.key) AS gname
        FROM admin.group_members gm
        JOIN admin.departments dp ON dp.group_id = gm.group_id AND dp.tenant_id = gm.tenant_id
        JOIN admin.groups g ON g.id = gm.group_id AND g.tenant_id = gm.tenant_id
       WHERE pg.tid = v_tid AND gm.user_id = pg.uid AND gm.tenant_id = pg.tid
       ORDER BY g.key LIMIT 1) d ON true
   ORDER BY pg.k, pg.uid;
END $$;
--> statement-breakpoint
-- Trigram cho tìm theo tên (nếu pg_trgm có sẵn; thiếu/không đủ quyền ⇒ bỏ qua, hàm vẫn đúng — chỉ chậm hơn khi lọc `q` trên nhiều người). Cùng khuôn 0038.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    BEGIN
      EXECUTE format('CREATE INDEX IF NOT EXISTS users_fold_name_trgm_idx ON admin.users USING gin (hub.fold(COALESCE(display_name, '''')) %I.gin_trgm_ops)',
                     (SELECT n.nspname FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace WHERE e.extname = 'pg_trgm'));
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'không tạo được index trigram tên người dùng (%): bỏ qua', SQLERRM;
    END;
  END IF;
END $$;
--> statement-breakpoint
-- Tên công ty của CHÍNH người gọi (`app.tenant_id`) cho danh bạ `own` (hub_rw không đọc được admin.tenants). Chỉ công ty mình; không có tham số ⇒ không dò công ty khác.
CREATE OR REPLACE FUNCTION hub.pmsg_self_company()
RETURNS TABLE (id uuid, name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT t.id, COALESCE(t.legal_name, t.name) FROM admin.tenants t
   WHERE t.id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION hub.pmsg_self_company() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION hub.pmsg_self_company() TO hub_rw;

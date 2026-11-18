-- CR-182 · lát cr182-migrate · R4 · chuyển quy trình HIỆN TẠI sang giao việc theo VAI. CHỈ THÊM: `role` vào stage Duyệt (chính / nhóm cùng duyệt / chuyển cấp) và
-- `args.signer_role` vào stage Ký; thêm hàng `hub.process_role_assignments` (tenant, flow, vai) ⇒ chính nhóm/người đang dùng. MỌI trường cũ (group_id, group_key,
-- approver_user_id, provider, company_signers…) GIỮ nguyên trong jsonb ⇒ công tắc lùi `on_doc_enabled` tắt vẫn chạy y như cũ. KHÔNG đụng `process_runs` (snapshot lượt
-- đang chạy), không đụng def `dlc.*` của Rowan. Theo tập: mỗi bảng một câu UPDATE/INSERT (hàm tạm theo hàng chỉ biến đổi jsonb). Chạy lại vô hại:
--   · stage đã có `role` / `signer_role` bị bỏ qua; hàng giao việc chỉ lấy từ stage CHƯA có vai ở lần chạy này (không đè lựa chọn của quản trị, không hồi sinh hàng đã bỏ giao);
--   · `ON CONFLICT DO NOTHING`.
-- Luật chuyển:
--   · Duyệt: nhóm (id hoặc mã) / người duyệt cố định ⇒ vai khoá `nhom-<10 hex của md5(loại:giá trị)>` / `nguoi-…` (cùng nhóm ⇒ cùng vai, trong mọi stage và mọi bản xuất bản);
--     nhãn = tên nhóm (def công ty) hoặc «Người duyệt cấp n» (n = thứ tự nhóm khác nhau theo lần xuất hiện; def Thư viện và người cố định).
--   · Giao việc: def công ty ⇒ (công ty đó, nhóm/người trong stage); def Thư viện (tenant null, nhóm theo MÃ) ⇒ mỗi công ty được gán (`company_flows`) ⇒ nhóm cùng MÃ của công ty đó.
--     Nhóm không còn / người đã khoá ⇒ có vai nhưng KHÔNG hàng giao ⇒ «Chưa giao người» (như trước: thiếu nhóm thì không chạy được).
--   · Ký: stage `contracts-esign-send` có `company_signers` ĐÚNG MỘT mục (user:<id> hoặc group:<id>) ⇒ `signer_role = nguoi-ky-hop-dong` + giao việc mục đó.
--     Nhiều hơn một mục (nhiều người/nhóm) KHÔNG chuyển được thành một giao việc (vai nhận một nhóm HOẶC một người; lấy người đầu = giảm số người phải ký, tạo nhóm = ghi
--     dữ liệu công ty) ⇒ GIỮ cấu hình cũ, không thêm vai (cr182-migrate-preview liệt kê, quản trị tự gom).
--   · Chỗ có NHIỀU hơn một đích cũ cùng lúc (vd group_id lẫn approver_user_id: người cụ thể thắng) KHÔNG chuyển (vai = một đích; đổi sẽ chuyển việc từ người sang cả nhóm) ⇒
--     giữ cấu hình cũ, không thêm vai (preview liệt kê «Mơ hồ»).
--   · Mẫu Thư viện dùng qua KHE (`process_routing_rules`) cũng được giao theo mã nhóm; công ty chưa có hàng giao (gán sau ngày chuyển, qua khe mặc định) vẫn chạy theo cấu hình cũ
--     còn giữ trong stage (runtime `withRoles`: vai chưa giao + còn cấu hình cũ ⇒ dùng cũ, không chặn).
-- Bản xuất bản (`process_def_releases`) nhận cùng `role` (cùng khoá) để lượt mở từ Thư viện đọc đúng; không sinh bản mới.

CREATE TEMP TABLE IF NOT EXISTS _cr182_cand (
  def_id uuid NOT NULL, def_tenant uuid, role_key text NOT NULL, ref_kind text NOT NULL, ref text NOT NULL, ref_uuid uuid
);
--> statement-breakpoint
TRUNCATE _cr182_cand;
--> statement-breakpoint
-- Tạo vai cho MỘT tham chiếu (loại: group_id | group_key | user). Trả {role:{key,label}, seen:{…}}; ghi ứng viên giao việc khi p_collect.
CREATE OR REPLACE FUNCTION pg_temp.cr182_mk(p_def uuid, p_dt uuid, p_collect boolean, p_seen jsonb, p_kind text, p_ref text)
RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE
  v_id text := p_kind || ':' || lower(p_ref);
  v_seen jsonb := p_seen;
  v_n int;
  v_key text;
  v_label text;
  v_name text;
  v_uuid uuid;
BEGIN
  IF v_seen ? v_id THEN
    v_n := (v_seen ->> v_id)::int;
  ELSE
    v_n := (SELECT count(*) FROM jsonb_object_keys(v_seen)) + 1;
    v_seen := v_seen || jsonb_build_object(v_id, v_n);
  END IF;
  v_key := (CASE WHEN p_kind = 'user' THEN 'nguoi-' ELSE 'nhom-' END) || substr(md5(v_id), 1, 10);
  IF p_ref ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN v_uuid := p_ref::uuid; END IF;
  v_label := 'Người duyệt cấp ' || v_n;
  IF p_dt IS NOT NULL AND p_kind <> 'user' THEN
    SELECT g.name ->> 'vi' INTO v_name FROM admin.groups g
     WHERE g.tenant_id = p_dt AND ((p_kind = 'group_id' AND g.id = v_uuid) OR (p_kind = 'group_key' AND g.key = p_ref)) LIMIT 1;
    IF coalesce(btrim(v_name), '') <> '' THEN v_label := left(btrim(v_name), 80); END IF;
  END IF;
  IF p_collect THEN
    INSERT INTO _cr182_cand (def_id, def_tenant, role_key, ref_kind, ref, ref_uuid) VALUES (p_def, p_dt, v_key, p_kind, p_ref, v_uuid);
  END IF;
  RETURN jsonb_build_object('role', jsonb_build_object('key', v_key, 'label', v_label), 'seen', v_seen);
END $f$;
--> statement-breakpoint
-- Một chỗ nhóm/người ({group_id|group_key|approver_user_id|user_id}) chưa có vai ⇒ thêm `role`. Trả {obj, seen}; không có tham chiếu ⇒ giữ nguyên.
CREATE OR REPLACE FUNCTION pg_temp.cr182_slot(p_def uuid, p_dt uuid, p_collect boolean, p_seen jsonb, p_obj jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE
  v_kind text;
  v_ref text;
  m jsonb;
BEGIN
  IF jsonb_typeof(p_obj) <> 'object' OR p_obj ? 'role' THEN RETURN jsonb_build_object('obj', p_obj, 'seen', p_seen); END IF;
  -- nhiều hơn một đích cũ ⇒ mơ hồ, bỏ qua (giữ cấu hình cũ)
  IF (CASE WHEN coalesce(p_obj ->> 'group_id', '') <> '' THEN 1 ELSE 0 END
      + CASE WHEN coalesce(p_obj ->> 'group_key', '') <> '' THEN 1 ELSE 0 END
      + CASE WHEN coalesce(p_obj ->> 'approver_user_id', '') <> '' THEN 1 ELSE 0 END
      + CASE WHEN coalesce(p_obj ->> 'user_id', '') <> '' THEN 1 ELSE 0 END) > 1 THEN
    RETURN jsonb_build_object('obj', p_obj, 'seen', p_seen);
  END IF;
  IF coalesce(p_obj ->> 'group_id', '') <> '' THEN v_kind := 'group_id'; v_ref := p_obj ->> 'group_id';
  ELSIF coalesce(p_obj ->> 'group_key', '') <> '' THEN v_kind := 'group_key'; v_ref := p_obj ->> 'group_key';
  ELSIF coalesce(p_obj ->> 'approver_user_id', '') <> '' THEN v_kind := 'user'; v_ref := p_obj ->> 'approver_user_id';
  ELSIF coalesce(p_obj ->> 'user_id', '') <> '' THEN v_kind := 'user'; v_ref := p_obj ->> 'user_id';
  ELSE RETURN jsonb_build_object('obj', p_obj, 'seen', p_seen);
  END IF;
  m := pg_temp.cr182_mk(p_def, p_dt, p_collect, p_seen, v_kind, v_ref);
  RETURN jsonb_build_object('obj', p_obj || jsonb_build_object('role', m -> 'role'), 'seen', m -> 'seen');
END $f$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION pg_temp.cr182_roles(p_def uuid, p_dt uuid, p_collect boolean, p_stages jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE
  v_out jsonb := '[]'::jsonb;
  v_seen jsonb := '{}'::jsonb;
  s jsonb; a jsonb; g jsonb; gs jsonb; r jsonb; ex jsonb; args jsonb;
  v_sv text; v_parts text[]; v_kind text;
BEGIN
  IF jsonb_typeof(p_stages) <> 'array' THEN RETURN p_stages; END IF;
  FOR s IN SELECT x FROM jsonb_array_elements(p_stages) WITH ORDINALITY t (x, o) ORDER BY o LOOP
    IF jsonb_typeof(s) = 'object' THEN
      a := s -> 'after';
      IF jsonb_typeof(a) = 'object' AND a ->> 'kind' = 'review' THEN
        -- bước Duyệt chính
        r := pg_temp.cr182_slot(p_def, p_dt, p_collect, v_seen, a);
        a := r -> 'obj'; v_seen := r -> 'seen';
        -- nhóm cùng duyệt (nhánh chỉ nhận NHÓM: không đọc user_id)
        IF jsonb_typeof(a -> 'parallel') = 'object' AND jsonb_typeof(a -> 'parallel' -> 'groups') = 'array' THEN
          gs := '[]'::jsonb;
          FOR g IN SELECT x FROM jsonb_array_elements(a -> 'parallel' -> 'groups') WITH ORDINALITY t (x, o) ORDER BY o LOOP
            IF jsonb_typeof(g) = 'object' AND (coalesce(g ->> 'group_id', '') <> '' OR coalesce(g ->> 'group_key', '') <> '') THEN
              r := pg_temp.cr182_slot(p_def, p_dt, p_collect, v_seen, g);
              g := r -> 'obj'; v_seen := r -> 'seen';
            END IF;
            gs := gs || jsonb_build_array(g);
          END LOOP;
          a := jsonb_set(a, '{parallel,groups}', gs);
        END IF;
        -- chuyển cấp
        IF jsonb_typeof(a -> 'escalate') = 'object' THEN
          r := pg_temp.cr182_slot(p_def, p_dt, p_collect, v_seen, a -> 'escalate');
          a := jsonb_set(a, '{escalate}', r -> 'obj'); v_seen := r -> 'seen';
        END IF;
        s := jsonb_set(s, '{after}', a);
      END IF;
      -- bước Ký: chỉ def công ty (id người/nhóm là của công ty), đúng MỘT mục
      ex := s -> 'executor';
      IF jsonb_typeof(ex) = 'object' AND ex ->> 'kind' = 'tool' AND ex ->> 'tool_key' = 'contracts-esign-send'
         AND jsonb_typeof(ex -> 'args') = 'object' AND NOT (ex -> 'args' ? 'signer_role')
         AND p_dt IS NOT NULL AND ex -> 'args' -> 'company_signers' ->> 'from' = 'const' THEN
        v_sv := btrim(coalesce(ex -> 'args' -> 'company_signers' ->> 'value', ''));
        v_parts := regexp_split_to_array(v_sv, '\s*,\s*');
        IF array_length(v_parts, 1) = 1
           AND v_parts[1] ~* '^(user|group):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
          v_kind := CASE WHEN lower(v_parts[1]) LIKE 'user:%' THEN 'user' ELSE 'group_id' END;
          IF p_collect THEN
            INSERT INTO _cr182_cand (def_id, def_tenant, role_key, ref_kind, ref, ref_uuid)
            VALUES (p_def, p_dt, 'nguoi-ky-hop-dong', v_kind, split_part(v_parts[1], ':', 2), split_part(v_parts[1], ':', 2)::uuid);
          END IF;
          args := (ex -> 'args') || jsonb_build_object('signer_role', jsonb_build_object('from', 'const', 'value', 'nguoi-ky-hop-dong'));
          s := jsonb_set(s, '{executor,args}', args);
        END IF;
      END IF;
    END IF;
    v_out := v_out || jsonb_build_array(s);
  END LOOP;
  RETURN v_out;
END $f$;
--> statement-breakpoint
-- Khoá ngắn + trần thời gian: dữ liệu quy trình nhỏ, nhưng không bao giờ giữ khoá lâu trên prod có khách.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
SET LOCAL statement_timeout = '120s';
--> statement-breakpoint
DO $m$
DECLARE d_n int; r_n int; a_n int;
BEGIN
  -- (1) def (Thư viện + công ty): thêm vai, ghi ứng viên giao việc (stage chưa có vai ở lần chạy này)
  UPDATE hub.process_defs d SET stages = x.n
  FROM (SELECT p.id, pg_temp.cr182_roles(p.id, p.tenant_id, true, p.stages) AS n
        FROM hub.process_defs p
        WHERE p.deleted_at IS NULL AND jsonb_typeof(p.stages) = 'array' AND coalesce(p.slot, '') NOT LIKE 'dlc.%'
          AND (p.stages::text LIKE '%"review"%' OR p.stages::text LIKE '%contracts-esign-send%')) x
  WHERE d.id = x.id AND x.n IS DISTINCT FROM d.stages;
  GET DIAGNOSTICS d_n = ROW_COUNT;

  -- (2) bản xuất bản: cùng vai (không ghi ứng viên)
  UPDATE hub.process_def_releases r SET stages = x.n
  FROM (SELECT q.def_id, q.rel_version, pg_temp.cr182_roles(q.def_id, p.tenant_id, false, q.stages) AS n
        FROM hub.process_def_releases q JOIN hub.process_defs p ON p.id = q.def_id
        WHERE p.deleted_at IS NULL AND jsonb_typeof(q.stages) = 'array' AND coalesce(p.slot, '') NOT LIKE 'dlc.%'
          AND (q.stages::text LIKE '%"review"%' OR q.stages::text LIKE '%contracts-esign-send%')) x
  WHERE r.def_id = x.def_id AND r.rel_version = x.rel_version AND x.n IS DISTINCT FROM r.stages;
  GET DIAGNOSTICS r_n = ROW_COUNT;

  -- (3) giao việc: nhóm/người đang dùng ⇒ hàng (công ty, quy trình, vai). Công ty = chủ def, hoặc mỗi công ty được gán def Thư viện.
  INSERT INTO hub.process_role_assignments (tenant_id, flow_id, role_key, group_id, user_id, updated_at)
  SELECT DISTINCT ON (t.tenant_id, c.def_id, c.role_key) t.tenant_id, c.def_id, c.role_key, t.group_id, t.user_id, now()
  FROM _cr182_cand c
  CROSS JOIN LATERAL (
    SELECT tn.tenant_id,
           CASE c.ref_kind WHEN 'group_id' THEN (SELECT g.id FROM admin.groups g WHERE g.id = c.ref_uuid AND g.tenant_id = tn.tenant_id)
                           WHEN 'group_key' THEN (SELECT g.id FROM admin.groups g WHERE g.key = c.ref AND g.tenant_id = tn.tenant_id) END AS group_id,
           CASE c.ref_kind WHEN 'user' THEN (SELECT u.id FROM admin.users u WHERE u.id = c.ref_uuid AND u.tenant_id = tn.tenant_id
                                               AND u.kind = 'internal' AND u.active AND NOT u.locked_by_tenant) END AS user_id
    FROM (SELECT c.def_tenant AS tenant_id WHERE c.def_tenant IS NOT NULL
          UNION ALL
          SELECT cf.tenant_id FROM hub.company_flows cf WHERE c.def_tenant IS NULL AND cf.flow_id = c.def_id
          UNION
          SELECT rr.tenant_id FROM hub.process_routing_rules rr WHERE c.def_tenant IS NULL AND rr.def_id = c.def_id) tn
  ) t
  WHERE (t.group_id IS NOT NULL) <> (t.user_id IS NOT NULL)
  ORDER BY t.tenant_id, c.def_id, c.role_key
  ON CONFLICT (tenant_id, flow_id, role_key) DO NOTHING;
  GET DIAGNOSTICS a_n = ROW_COUNT;

  RAISE NOTICE 'hub 0160: thêm vai: % def, % release; giao việc: % hàng', d_n, r_n, a_n;
END $m$;
--> statement-breakpoint
DROP FUNCTION IF EXISTS pg_temp.cr182_roles(uuid, uuid, boolean, jsonb);
--> statement-breakpoint
DROP FUNCTION IF EXISTS pg_temp.cr182_slot(uuid, uuid, boolean, jsonb, jsonb);
--> statement-breakpoint
DROP FUNCTION IF EXISTS pg_temp.cr182_mk(uuid, uuid, boolean, jsonb, text, text);
--> statement-breakpoint
DROP TABLE IF EXISTS _cr182_cand;

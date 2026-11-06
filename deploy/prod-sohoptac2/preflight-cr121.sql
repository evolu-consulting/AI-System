-- sohoptac2 · CR-121 P-1 · kiểm trước deploy CR-120 + CR-121. CHỈ ĐỌC: toàn bộ chạy trong BEGIN READ ONLY … ROLLBACK (Postgres từ chối mọi ghi).
-- Chạy bởi preflight-cr121.sh (psql -v hub_when=… -v hub_n=… -v pack_when=… -v pack_n=… -v admin_when=… -v admin_n=…; -1 = không có số liệu repo).
-- Mỗi câu trả các cột: id · trạng thái (OK|WARN|BLOCK) · chi tiết · cách sửa (trống khi OK). Không có ';' trong chuỗi (test tách câu theo ';' cuối dòng).
BEGIN READ ONLY;
SET LOCAL statement_timeout = '60s';

-- 1. Phiên bản Postgres >= 15
SELECT 'pg-version',
  CASE WHEN current_setting('server_version_num')::int >= 150000 THEN 'OK' ELSE 'BLOCK' END,
  'Postgres ' || current_setting('server_version'),
  CASE WHEN current_setting('server_version_num')::int >= 150000 THEN ''
       ELSE 'Nâng Postgres lên bản 15 trở lên (dùng image postgres:15+ trong docker-compose.yml, dump/restore) rồi chạy lại kiểm tra.' END;

-- 2. Đối tượng phụ thuộc view hub.process_slot_assignments (migration hub 0099 sẽ DROP view này)
WITH v AS (
  SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'hub' AND c.relname = 'process_slot_assignments' AND c.relkind = 'v'),
dep AS (
  SELECT DISTINCT CASE WHEN rw.oid IS NOT NULL THEN rc.oid::regclass::text
                       ELSE d.classid::regclass::text || ' #' || d.objid END AS who
  FROM v JOIN pg_depend d ON d.refobjid = v.oid
  LEFT JOIN pg_rewrite rw ON d.classid = 'pg_rewrite'::regclass AND rw.oid = d.objid
  LEFT JOIN pg_class rc ON rc.oid = rw.ev_class
  WHERE d.deptype <> 'i' AND (rw.oid IS NULL OR rw.ev_class <> v.oid))
SELECT 'view-deps',
  CASE WHEN EXISTS (SELECT 1 FROM dep) THEN 'BLOCK' ELSE 'OK' END,
  CASE WHEN NOT EXISTS (SELECT 1 FROM v) THEN 'Không có view hub.process_slot_assignments (đã gỡ hoặc là bảng): migration 0099 sẽ bỏ qua'
       WHEN EXISTS (SELECT 1 FROM dep) THEN 'Có đối tượng phụ thuộc view hub.process_slot_assignments: ' || (SELECT string_agg(who, ', ' ORDER BY who) FROM dep)
       ELSE 'Không có đối tượng nào phụ thuộc view hub.process_slot_assignments' END,
  CASE WHEN EXISTS (SELECT 1 FROM dep)
       THEN 'Gỡ hoặc viết lại các đối tượng trên để không còn đọc view này (migration 0099 DROP view sẽ lỗi hoặc làm hỏng chúng), rồi chạy lại kiểm tra. Lưu ý: hàm viết bằng SQL/plpgsql không được pg_depend theo dõi, hãy tự grep tên view trong thân hàm.'
       ELSE '' END;

-- 3. Migration đã chạy trên prod so với repo (so mốc `when` cuối của journal với created_at cuối trong bảng drizzle)
WITH r(id, label, tbl, rwhen, rn) AS (VALUES
  ('mig-hub', 'hub', '__drizzle_migrations_hub', :hub_when::numeric, :hub_n::int),
  ('mig-pack-contracts', 'pack-contracts', '__drizzle_migrations_pack_contracts', :pack_when::numeric, :pack_n::int),
  ('mig-admin', 'admin', '__drizzle_migrations', :admin_when::numeric, :admin_n::int)),
p AS (
  SELECT r.*,
    CASE WHEN to_regclass('drizzle.' || quote_ident(tbl)) IS NULL THEN NULL
         ELSE (xpath('/row/n/text()', query_to_xml(format('select coalesce(max(created_at),0) n from drizzle.%I', tbl), false, true, '')))[1]::text::numeric END AS pw,
    CASE WHEN to_regclass('drizzle.' || quote_ident(tbl)) IS NULL THEN NULL
         ELSE (xpath('/row/n/text()', query_to_xml(format('select count(*) n from drizzle.%I', tbl), false, true, '')))[1]::text::int END AS pn
  FROM r)
SELECT id,
  CASE WHEN rwhen < 0 OR pw IS NULL THEN 'WARN' WHEN pw > rwhen THEN 'BLOCK' WHEN pw = rwhen THEN 'OK' ELSE 'WARN' END,
  CASE WHEN rwhen < 0 THEN label || ': không có số liệu journal của repo (chạy qua preflight-cr121.ps1 để có)'
       WHEN pw IS NULL THEN label || ': chưa thấy bảng migration trên prod (DB mới?)'
       WHEN pw > rwhen THEN label || ': prod đã chạy ' || pn || ' migration, repo chỉ có ' || rn || ' và prod có mốc mới hơn repo (nhánh lệch)'
       WHEN pw = rwhen THEN label || ': đã chạy ' || pn || '/' || rn || ' migration, khớp journal repo'
       ELSE label || ': prod đã chạy ' || pn || ', repo có ' || rn || ' ⇒ deploy sẽ chạy thêm khoảng ' || greatest(rn - pn, 1) || ' migration' END,
  CASE WHEN rwhen < 0 OR pw IS NULL THEN 'Chạy qua preflight-cr121.ps1 (tự đọc journal repo) hoặc kiểm tay bảng drizzle.' || tbl
       WHEN pw > rwhen THEN 'Dừng deploy: prod đang chạy nhánh khác (xem VERSION, README mục lệch deploy 2026-10-30). Gộp nhánh đó vào ref deploy trước.'
       WHEN pw = rwhen THEN ''
       ELSE 'Bình thường khi deploy bản mới: đối chiếu danh sách migration sắp chạy trước khi xác nhận.' END
FROM p ORDER BY id;

-- 4. Số hàng hub.process_runs / hub.dify_runs (hub 0100 tạo index không CONCURRENTLY ⇒ giữ khoá ghi bảng trong lúc xây)
WITH c AS (SELECT (SELECT count(*) FROM hub.process_runs) AS pr, (SELECT count(*) FROM hub.dify_runs) AS dr)
SELECT 'run-rows',
  CASE WHEN pr > 1000000 OR dr > 1000000 THEN 'WARN' ELSE 'OK' END,
  'hub.process_runs = ' || pr || ' hàng · hub.dify_runs = ' || dr || ' hàng (ngưỡng cảnh báo 1.000.000)',
  CASE WHEN pr > 1000000 OR dr > 1000000
       THEN 'Bảng lớn: tạo index ở migration 0100 sẽ khoá ghi bảng trong vài phút ⇒ deploy giờ vắng (ngoài giờ làm việc) và báo người dùng.'
       ELSE '' END
FROM c;

-- 5. Công ty active đọc được gói contracts: khe contracts.approval phải có quy trình chạy được
WITH ten AS (
  SELECT t.id, t.key, t.name FROM admin.tenants t
  WHERE t.active AND EXISTS (
    SELECT 1 FROM admin.feature_entitlements e JOIN admin.features f ON f.id = e.feature_id
    WHERE e.tenant_id = t.id AND e.revoked_at IS NULL AND f.key = 'contracts-read' AND f.status <> 'off')),
eff AS (
  SELECT t.*,
    (SELECT r.def_id FROM hub.process_routing_rules r WHERE r.tenant_id = t.id AND r.slot = 'contracts.approval' AND r.is_default) AS rule_def,
    (SELECT s.default_def_id FROM hub.process_slots s WHERE s.slot = 'contracts.approval') AS slot_def,
    EXISTS (SELECT 1 FROM hub.process_routing_rules r WHERE r.tenant_id = t.id AND r.slot = 'contracts.approval' AND r.source = 'admin') AS has_admin
  FROM ten t),
chk AS (
  SELECT e.*, coalesce(e.rule_def, e.slot_def) AS def_id,
    (SELECT d.id FROM hub.process_defs d
       JOIN hub.process_def_releases rel ON rel.def_id = d.id AND rel.rel_version = d.published_version
      WHERE d.id = coalesce(e.rule_def, e.slot_def) AND d.deleted_at IS NULL AND d.slot = 'contracts.approval') AS ok_def
  FROM eff e),
bad AS (SELECT * FROM chk WHERE ok_def IS NULL)
SELECT 'flow-slot', 'BLOCK',
  replace(name, E'\t', ' ') || ' (' || key || '): khe contracts.approval không có quy trình chạy được ('
    || CASE WHEN def_id IS NULL THEN 'chưa có luật gán và khe không có mẫu mặc định' ELSE 'quy trình đã xoá hoặc chưa xuất bản' END
    || ') ⇒ sau deploy mọi lượt duyệt mới của công ty này kẹt ở FLOW_MISSING',
  'Vào Admin › Quy trình: gán và xuất bản quy trình duyệt hợp đồng cho công ty này (hoặc đặt mẫu mặc định của khe) TRƯỚC khi deploy.'
FROM bad
UNION ALL
SELECT 'flow-slot', 'OK',
  (SELECT count(*) FROM chk) || ' công ty đọc được gói contracts, đều có quy trình chạy được ('
    || (SELECT count(*) FROM chk WHERE has_admin) || ' dùng luật admin, ' || (SELECT count(*) FROM chk WHERE NOT has_admin) || ' dùng mẫu mặc định của khe)',
  ''
WHERE NOT EXISTS (SELECT 1 FROM bad);

-- 6. Nhóm (Group) mà quy trình duyệt cần phải tồn tại ở từng công ty (kể cả contracts-editor cho bước xác nhận CR-120)
WITH ten AS (
  SELECT t.id, t.key, t.name FROM admin.tenants t
  WHERE t.active AND EXISTS (
    SELECT 1 FROM admin.feature_entitlements e JOIN admin.features f ON f.id = e.feature_id
    WHERE e.tenant_id = t.id AND e.revoked_at IS NULL AND f.key = 'contracts-read' AND f.status <> 'off')),
defs AS (
  SELECT t.id AS tenant_id, coalesce(
      (SELECT r.def_id FROM hub.process_routing_rules r WHERE r.tenant_id = t.id AND r.slot = 'contracts.approval' AND r.is_default),
      (SELECT s.default_def_id FROM hub.process_slots s WHERE s.slot = 'contracts.approval')) AS def_id
  FROM ten t
  UNION
  SELECT r.tenant_id, r.def_id FROM hub.process_routing_rules r JOIN ten t ON t.id = r.tenant_id WHERE r.slot = 'contracts.approval'),
body AS (
  SELECT df.tenant_id, rel.slot_body
  FROM defs df
  JOIN hub.process_defs d ON d.id = df.def_id AND d.deleted_at IS NULL
  JOIN hub.process_def_releases rel ON rel.def_id = d.id AND rel.rel_version = d.published_version),
keys AS (
  SELECT t.id AS tenant_id, 'contracts-editor'::text AS gkey FROM ten t
  UNION
  SELECT b.tenant_id, v.k
  FROM body b
  CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(b.slot_body -> 'steps') = 'array' THEN b.slot_body -> 'steps' ELSE '[]'::jsonb END) AS s(step)
  CROSS JOIN LATERAL (VALUES (s.step ->> 'department_group_key'), (s.step ->> 'escalate_group_key'),
                             (s.step -> 'company_signer' ->> 'department_group_key')) AS v(k)
  WHERE v.k IS NOT NULL AND v.k <> ''),
miss AS (
  SELECT k.tenant_id, string_agg(k.gkey, ', ' ORDER BY k.gkey) AS ks
  FROM keys k
  WHERE NOT EXISTS (SELECT 1 FROM admin.groups g WHERE g.tenant_id = k.tenant_id AND g.key = k.gkey)
  GROUP BY k.tenant_id)
SELECT 'flow-groups', 'BLOCK',
  replace(t.name, E'\t', ' ') || ' (' || t.key || '): thiếu nhóm ' || m.ks || ' ⇒ lượt duyệt mới kẹt ở FLOW_GROUP_MISSING',
  'Tạo nhóm (Admin › Nhóm) với đúng mã: ' || m.ks || ' ở công ty này, hoặc sửa quy trình bỏ nhóm đó, TRƯỚC khi deploy.'
FROM miss m JOIN ten t ON t.id = m.tenant_id
UNION ALL
SELECT 'flow-groups', 'OK',
  (SELECT count(*) FROM ten) || ' công ty: mọi nhóm quy trình duyệt cần (gồm contracts-editor) đều tồn tại', ''
WHERE NOT EXISTS (SELECT 1 FROM miss);

-- 6b. Nhóm chủ gói contracts-owner (đích chuyển cấp mặc định của engine) — chỉ cảnh báo
SELECT 'flow-owner-group', 'WARN',
  replace(t.name, E'\t', ' ') || ' (' || t.key || '): chưa có nhóm contracts-owner (đích chuyển cấp mặc định)',
  'Tạo nhóm contracts-owner ở công ty này nếu quy trình dùng chuyển cấp mặc định.'
FROM admin.tenants t
WHERE t.active
  AND EXISTS (SELECT 1 FROM admin.feature_entitlements e JOIN admin.features f ON f.id = e.feature_id
              WHERE e.tenant_id = t.id AND e.revoked_at IS NULL AND f.key = 'contracts-read' AND f.status <> 'off')
  AND NOT EXISTS (SELECT 1 FROM admin.groups g WHERE g.tenant_id = t.id AND g.key = 'contracts-owner');

-- 7. Lượt duyệt máy cũ còn dở (chỉ theo dõi)
SELECT 'machine-open', 'OK',
  'Lượt duyệt máy cũ (mode=machine) chưa xong: ' || count(*) || ' (chỉ theo dõi, không chặn)', ''
FROM contracts.approvals
WHERE mode = 'machine' AND status NOT IN ('done', 'rejected', 'cancelled', 'failed');

-- 8. (c18) Công ty còn entitlement `contracts-approval-engine` (admin 0037 sẽ xoá feature này) nhưng khe contracts.approval CHƯA có luật gán quy trình
--    ⇒ sau deploy hợp đồng mới của công ty đó không còn duyệt bằng engine. Chỉ cảnh báo để điều phối gán quy trình trước.
WITH eng AS (
  SELECT t.id, t.key, t.name FROM admin.tenants t
  WHERE EXISTS (SELECT 1 FROM admin.feature_entitlements e JOIN admin.features f ON f.id = e.feature_id
                WHERE e.tenant_id = t.id AND e.revoked_at IS NULL AND f.key = 'contracts-approval-engine')),
bad AS (
  SELECT e.* FROM eng e
  WHERE NOT EXISTS (SELECT 1 FROM hub.process_routing_rules r WHERE r.tenant_id = e.id AND r.slot = 'contracts.approval'))
SELECT 'engine-feature', 'WARN',
  replace(name, E'\t', ' ') || ' (' || key || '): còn feature contracts-approval-engine nhưng khe contracts.approval chưa có quy trình gán ⇒ sau deploy 0037 không còn duyệt bằng engine',
  'Admin › Công ty › Quy trình: gán quy trình duyệt hợp đồng cho công ty này TRƯỚC khi deploy.'
FROM bad
UNION ALL
SELECT 'engine-feature', 'OK',
  (SELECT count(*) FROM eng) || ' công ty còn feature engine, đều đã có quy trình gán cho khe contracts.approval', ''
WHERE NOT EXISTS (SELECT 1 FROM bad);
ROLLBACK;

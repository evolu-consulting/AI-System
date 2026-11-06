-- CR-122 · M1 · ADR-0038 · FLOW2-FR-20 · spec §4 "Backfill prod": khe cũ → FlowDef (`trigger` + `app`) + dòng `company_flows`. CHỈ THÊM/ĐỔI,
-- KHÔNG xoá gì (bảng khe/luật/tập gán, `slot_body`, release cũ giữ nguyên ⇒ đường khe cũ vẫn chạy khi `FLOW_TRIGGERS` tắt). Chạy lại vô hại.
-- (A) Def THƯ VIỆN có khe (`contracts.approval|intake`, `community.*`; KHÔNG đụng `dlc.*` của Rowan) mà chưa có `trigger`: đặt
--     `trigger {event}` + `app`; THÊM node Kết thúc (`outcome` dương tính của sự kiện) vào cuối `stages` (các stage cũ giữ nguyên);
--     đã xuất bản ⇒ release MỚI = max(rel_version)+1 (bất biến, release cũ giữ ⇒ lượt đang chạy giữ snapshot; `slot_body` chép sang để
--     đường cũ đọc như cũ) rồi `published_version` trỏ bản mới. Def đầy 22 stage ⇒ KHÔNG đổi (để trống `trigger`, ops báo).
-- (B) Bản riêng của công ty đã sao từ Thư viện (cr121-c Q9: `source_rel_version`) cùng đổi như (A) (không release).
-- (C) `company_flows`: mỗi (công ty × khe) — luật `is_default` ⇒ dòng "được gán" Bật cuối danh sách (position 900+priority); công ty bật app
--     mà KHÔNG có luật nào ⇒ mẫu khe (như `resolveSlot`); luật có điều kiện (phòng ban/loại HĐ) ⇒ BẢN CÔNG TY mang điều kiện ở
--     `trigger.when` (Group mã → id công ty), Bật, position = priority; bản riêng Q9 đang Bật ⇒ dòng gốc Tắt `replaced`; tập gán còn lại ⇒ Tắt.
--     Luật không chuyển được (phòng ban đã xoá, khe không có dữ kiện tương ứng, thiếu Group mã) ⇒ KHÔNG tạo (đường cũ vẫn chạy), NOTICE đếm.
-- KHÔNG đụng `process_runs` (28 lượt prod giữ snapshot), KHÔNG bật `tenant_flow_settings` (cờ mặc định tắt = bóng).
-- Theo tập: mỗi bảng một câu (+ vài hàm phụ tạm, gỡ cuối file). Hàm phụ trước (C) cần schema `admin` — vắng ⇒ bỏ qua phần (C).
CREATE OR REPLACE FUNCTION hub.m1_map() RETURNS TABLE (slot text, event text, app text, outcome text, label text)
LANGUAGE sql IMMUTABLE AS $$
  SELECT * FROM (VALUES
    ('contracts.approval', 'contract.submitted', 'contracts', 'approved', 'Đã duyệt'),
    ('contracts.intake', 'contract.uploaded', 'contracts', 'accepted', 'Đã nhận'),
    ('community.post-moderation', 'post.created', 'community', 'shown', 'Hiện bài'),
    ('community.partner-join', 'partner.join_requested', 'community', 'accepted', 'Nhận'),
    ('community.report', 'report.created', 'community', 'kept', 'Giữ')
  ) v (slot, event, app, outcome, label)
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION hub.m1_can_finish(p jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_typeof(p) = 'array' AND (jsonb_array_length(p) < 22
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(p) e WHERE jsonb_typeof(e) = 'object' AND e ? 'outcome'))
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION hub.m1_finish(p jsonb, p_outcome text, p_label text) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN NOT hub.m1_can_finish(p) THEN p
    WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(p) e WHERE jsonb_typeof(e) = 'object' AND e ? 'outcome') THEN p
    ELSE p || jsonb_build_array(jsonb_build_object(
      'key', 'end-' || p_outcome,
      'name', 'Kết thúc · ' || p_label,
      'step', (SELECT coalesce(max(coalesce((x.e ->> 'step')::int, x.i - 1)), -1) + 1
               FROM jsonb_array_elements(p) WITH ORDINALITY x (e, i)),
      'executor', jsonb_build_object('kind', 'set', 'values', '[]'::jsonb),
      'instruction', '',
      'output', jsonb_build_object('filename', 'end.md', 'template', '# end',
        'required_sections', jsonb_build_array('end'), 'fields', '[]'::jsonb),
      'after', jsonb_build_object('kind', 'auto', 'branch', '[]'::jsonb),
      'real_action', false,
      'answerer', jsonb_build_object('kind', 'starter'),
      'timeout_s', 60,
      'token_budget', 'null'::jsonb,
      'outcome', p_outcome))
  END
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION hub.m1_bind(p jsonb, t uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE AS $$
DECLARE r jsonb; k text; v jsonb; gid uuid;
BEGIN
  IF jsonb_typeof(p) = 'array' THEN
    SELECT coalesce(jsonb_agg(hub.m1_bind(x.e, t) ORDER BY x.ord), '[]'::jsonb) INTO r
    FROM jsonb_array_elements(p) WITH ORDINALITY x (e, ord);
    RETURN r;
  END IF;
  IF jsonb_typeof(p) <> 'object' THEN RETURN p; END IF;
  r := '{}'::jsonb;
  FOR k, v IN SELECT * FROM jsonb_each(p) LOOP
    r := r || jsonb_build_object(k, hub.m1_bind(v, t));
  END LOOP;
  IF jsonb_typeof(p -> 'group_key') = 'string' THEN
    SELECT g.id INTO gid FROM admin.groups g WHERE g.tenant_id = t AND g.key = p ->> 'group_key';
    r := r || jsonb_build_object('group_id', to_jsonb(gid));
  END IF;
  IF jsonb_typeof(p -> 'also_group_keys') = 'array' THEN
    SELECT coalesce(jsonb_agg(g.id), '[]'::jsonb) INTO v FROM admin.groups g
    WHERE g.tenant_id = t AND g.key IN (SELECT jsonb_array_elements_text(p -> 'also_group_keys'));
    r := r || jsonb_build_object('also_group_ids', v);
  END IF;
  RETURN r;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION hub.m1_missing_groups(p jsonb, t uuid) RETURNS boolean
LANGUAGE plpgsql STABLE AS $$
BEGIN
  RETURN EXISTS (SELECT 1 FROM regexp_matches(p::text, '"group_key": "([^"]+)"', 'g') m
                 WHERE NOT EXISTS (SELECT 1 FROM admin.groups g WHERE g.tenant_id = t AND g.key = m[1]));
END $$;
--> statement-breakpoint
-- (A.1) def Thư viện ĐÃ xuất bản: release mới + def trỏ bản mới, MỘT câu.
WITH todo AS (
  SELECT d.id, m.event, m.app, m.outcome, m.label, rl.name AS rname, rl.stages AS rstages, rl.slot_body AS rbody,
    (SELECT max(x.rel_version) FROM hub.process_def_releases x WHERE x.def_id = d.id) + 1 AS next_v
  FROM hub.process_defs d
  JOIN hub.m1_map() m ON m.slot = d.slot
  JOIN hub.process_def_releases rl ON rl.def_id = d.id AND rl.rel_version = d.published_version
  WHERE d.tenant_id IS NULL AND d.deleted_at IS NULL AND d.trigger IS NULL
    AND hub.m1_can_finish(d.stages) AND hub.m1_can_finish(rl.stages)),
ins AS (
  INSERT INTO hub.process_def_releases (def_id, rel_version, name, stages, slot_body, note)
  SELECT t.id, t.next_v, t.rname, hub.m1_finish(t.rstages, t.outcome, t.label), t.rbody, 'CR-122 M1 backfill (hub 0111)'
  FROM todo t
  RETURNING def_id)
UPDATE hub.process_defs d SET trigger = jsonb_build_object('event', t.event), app = t.app,
  stages = hub.m1_finish(d.stages, t.outcome, t.label), published_version = t.next_v, updated_at = now()
FROM todo t
WHERE d.id = t.id AND EXISTS (SELECT 1 FROM ins WHERE ins.def_id = d.id);
--> statement-breakpoint
-- (A.2) def Thư viện CHƯA xuất bản (nháp): chỉ def, không release.
UPDATE hub.process_defs d SET trigger = jsonb_build_object('event', m.event), app = m.app,
  stages = hub.m1_finish(d.stages, m.outcome, m.label), updated_at = now()
FROM hub.m1_map() m
WHERE m.slot = d.slot AND d.tenant_id IS NULL AND d.deleted_at IS NULL AND d.trigger IS NULL
  AND d.published_version IS NULL AND hub.m1_can_finish(d.stages);
--> statement-breakpoint
-- (B) bản riêng của công ty (sao từ Thư viện, cr121-c Q9): cùng đổi, không release. Def vật chất hoá của đường cũ (`source_ref`) KHÔNG đụng.
UPDATE hub.process_defs c SET trigger = jsonb_build_object('event', m.event), app = m.app,
  stages = hub.m1_finish(c.stages, m.outcome, m.label), updated_at = now()
FROM hub.process_defs src
JOIN hub.m1_map() m ON m.slot = src.slot
WHERE src.id = c.source_template_id AND src.tenant_id IS NULL
  AND c.tenant_id IS NOT NULL AND c.deleted_at IS NULL AND c.trigger IS NULL AND c.source_ref IS NULL
  AND c.source_rel_version IS NOT NULL AND hub.m1_can_finish(c.stages);
--> statement-breakpoint
-- (C) company_flows + bản công ty cho luật có điều kiện. Cần schema admin (Group mã → id, công ty bật app).
DO $m1$
BEGIN
  IF to_regclass('admin.groups') IS NULL OR to_regclass('admin.feature_entitlements') IS NULL
     OR to_regclass('admin.tenants') IS NULL OR to_regclass('admin.features') IS NULL THEN
    RAISE NOTICE 'hub 0111: bỏ qua company_flows (chưa có schema admin)';
    RETURN;
  END IF;

  -- C0 · luật định tuyến cũ chuẩn hoá. `wh` = điều kiện Bắt đầu khi tương đương (NULL = không chuyển được hoặc luật mặc định).
  DROP TABLE IF EXISTS m1_rules;
  CREATE TEMP TABLE m1_rules ON COMMIT DROP AS
  SELECT r.tenant_id, r.slot, r.id AS rule_id, r.priority, r.is_default, r.def_id,
    CASE
      WHEN r.is_default OR (jsonb_array_length(c.dep) = 0 AND jsonb_array_length(c.kinds) = 0) THEN NULL
      WHEN jsonb_array_length(c.dep) > 0 AND dk.keys IS NULL THEN NULL
      WHEN r.slot = 'contracts.approval' THEN jsonb_build_object('op', 'and', 'conds',
        (CASE WHEN jsonb_array_length(c.dep) > 0
           THEN jsonb_build_array(jsonb_build_object('fact', 'creator_department', 'op', 'in', 'value', dk.keys))
           ELSE '[]'::jsonb END)
        || (CASE WHEN jsonb_array_length(c.kinds) > 0
           THEN jsonb_build_array(jsonb_build_object('fact', 'deal', 'op', 'in', 'value', c.kinds))
           ELSE '[]'::jsonb END))
      WHEN r.slot = 'contracts.intake' AND jsonb_array_length(c.dep) > 0 THEN jsonb_build_object('op', 'and', 'conds',
        jsonb_build_array(jsonb_build_object('fact', 'uploader_department', 'op', 'in', 'value', dk.keys)))
      ELSE NULL
    END AS wh
  FROM hub.process_routing_rules r
  JOIN hub.m1_map() m ON m.slot = r.slot
  CROSS JOIN LATERAL (SELECT
      CASE WHEN jsonb_typeof(r.condition -> 'departmentIds') = 'array' THEN r.condition -> 'departmentIds' ELSE '[]'::jsonb END AS dep,
      CASE WHEN jsonb_typeof(r.condition -> 'contractKinds') = 'array' THEN r.condition -> 'contractKinds' ELSE '[]'::jsonb END AS kinds) c
  LEFT JOIN LATERAL (SELECT jsonb_agg(g.key ORDER BY g.key) AS keys FROM admin.groups g
      WHERE g.tenant_id = r.tenant_id AND g.id::text IN (SELECT jsonb_array_elements_text(c.dep))) dk ON true;

  -- C1a · luật điều kiện trỏ def THƯ VIỆN ⇒ bản công ty mang `trigger.when` (stages = release hiện hành, Group mã → id công ty).
  -- Khoá xác định theo id luật ⇒ chạy lại không tạo thêm. Bản đầu tiên của (công ty × def) nhận `source_rel_version` (index duy nhất 0103).
  INSERT INTO hub.process_defs (tenant_id, key, name, description, input_hint, run_group_ids, stages, token_budget, enabled,
    sources, inputs, trigger, app, source_template_id, source_rel_version)
  SELECT q.tenant_id, q.ckey, q.cname, q.description, q.input_hint, '{}'::uuid[], q.cstages, q.token_budget, true,
    q.sources, q.inputs, q.ctrigger, q.app, q.lib_id,
    CASE WHEN q.rn = 1 AND NOT EXISTS (SELECT 1 FROM hub.process_defs x WHERE x.tenant_id = q.tenant_id
         AND x.source_template_id = q.lib_id AND x.source_rel_version IS NOT NULL AND x.deleted_at IS NULL)
      THEN q.rel END
  FROM (
    SELECT r.tenant_id, l.id AS lib_id, l.app, l.description, l.input_hint, l.token_budget, l.sources, l.inputs,
      left(l.key, 20) || '-' || substr(md5(r.rule_id::text), 1, 10) AS ckey,
      left(rl.name, 80) AS cname,
      hub.m1_bind(rl.stages, r.tenant_id) AS cstages,
      jsonb_build_object('event', l.trigger ->> 'event', 'when', r.wh) AS ctrigger,
      rl.rel_version AS rel,
      row_number() OVER (PARTITION BY r.tenant_id, l.id ORDER BY r.priority, r.rule_id) AS rn
    FROM m1_rules r
    JOIN hub.process_defs l ON l.id = r.def_id AND l.tenant_id IS NULL AND l.deleted_at IS NULL AND l.trigger IS NOT NULL
    JOIN hub.process_def_releases rl ON rl.def_id = l.id AND rl.rel_version = l.published_version
    WHERE r.wh IS NOT NULL AND NOT hub.m1_missing_groups(rl.stages, r.tenant_id)) q
  ON CONFLICT DO NOTHING;

  -- C1b · luật điều kiện trỏ BẢN CÔNG TY có sẵn ⇒ điều kiện ghi lên trigger của bản đó (luật thấp nhất thắng; bản đang là mặc định thì không).
  UPDATE hub.process_defs c SET trigger = c.trigger || jsonb_build_object('when', q.wh), updated_at = now()
  FROM (SELECT DISTINCT ON (r.def_id) r.def_id, r.tenant_id, r.wh FROM m1_rules r
        WHERE r.wh IS NOT NULL ORDER BY r.def_id, r.priority) q
  WHERE c.id = q.def_id AND c.tenant_id = q.tenant_id AND c.trigger IS NOT NULL AND NOT (c.trigger ? 'when')
    AND NOT EXISTS (SELECT 1 FROM m1_rules x WHERE x.def_id = c.id AND x.is_default);

  -- C2 · dòng company_flows mong muốn (mỗi (công ty, flow) một dòng: Bật trước, position nhỏ trước).
  DROP TABLE IF EXISTS m1_want;
  CREATE TEMP TABLE m1_want ON COMMIT DROP AS
  WITH tslot AS (
    SELECT en.tenant_id, m.slot FROM hub.m1_map() m
    JOIN admin.features f ON f.key = m.app || '-read' AND f.status <> 'off'
    JOIN admin.feature_entitlements en ON en.feature_id = f.id AND en.revoked_at IS NULL
    JOIN admin.tenants tn ON tn.id = en.tenant_id AND tn.active
    WHERE m.slot LIKE 'contracts.%'),
  w AS (
    SELECT r.tenant_id, r.def_id AS flow_id, true AS en, least(900 + r.priority, 999) AS pos, 1 AS rk
    FROM m1_rules r WHERE r.is_default
    UNION ALL
    SELECT s.tenant_id, ps.default_def_id, true, 900, 1 FROM tslot s
    JOIN hub.process_slots ps ON ps.slot = s.slot
    WHERE NOT EXISTS (SELECT 1 FROM hub.process_routing_rules x WHERE x.tenant_id = s.tenant_id AND x.slot = s.slot)
    UNION ALL
    SELECT r.tenant_id, r.def_id, true, r.priority, 0 FROM m1_rules r
    JOIN hub.process_defs d ON d.id = r.def_id AND d.tenant_id = r.tenant_id
    WHERE r.wh IS NOT NULL AND NOT EXISTS (SELECT 1 FROM m1_rules x WHERE x.def_id = r.def_id AND x.is_default)
    UNION ALL
    SELECT r.tenant_id, c.id, true, r.priority, 0 FROM m1_rules r
    JOIN hub.process_defs l ON l.id = r.def_id AND l.tenant_id IS NULL
    JOIN hub.process_defs c ON c.tenant_id = r.tenant_id AND c.deleted_at IS NULL
      AND c.key = left(l.key, 20) || '-' || substr(md5(r.rule_id::text), 1, 10)
    WHERE r.wh IS NOT NULL
    UNION ALL
    SELECT a.tenant_id, a.def_id, false, 500, 2 FROM hub.process_tenant_defs a
    JOIN hub.m1_map() m ON m.slot = a.slot),
  f AS (
    SELECT DISTINCT ON (w.tenant_id, w.flow_id) w.tenant_id, w.flow_id, w.en, w.pos
    FROM w ORDER BY w.tenant_id, w.flow_id, w.en DESC, w.pos, w.rk),
  rep AS (
    SELECT c.tenant_id, c.source_template_id AS flow_id, c.id AS replaced_by_flow
    FROM f JOIN hub.process_defs c ON c.id = f.flow_id AND c.tenant_id = f.tenant_id AND f.en
      AND c.source_rel_version IS NOT NULL AND c.trigger IS NOT NULL AND NOT (c.trigger ? 'when')
    WHERE NOT EXISTS (SELECT 1 FROM f f2 WHERE f2.tenant_id = c.tenant_id AND f2.flow_id = c.source_template_id AND f2.en))
  SELECT f.tenant_id, f.flow_id, f.en, f.pos, rep.replaced_by_flow
  FROM f LEFT JOIN rep ON rep.tenant_id = f.tenant_id AND rep.flow_id = f.flow_id AND NOT f.en
  UNION ALL
  SELECT rep.tenant_id, rep.flow_id, false, 500, rep.replaced_by_flow FROM rep
  WHERE NOT EXISTS (SELECT 1 FROM f WHERE f.tenant_id = rep.tenant_id AND f.flow_id = rep.flow_id);

  -- C3 · ghi (flow phải có trigger, chưa xoá, của Thư viện hoặc của CHÍNH công ty ⇒ không chéo tenant). Dòng đã có KHÔNG bị đè.
  INSERT INTO hub.company_flows (tenant_id, flow_id, enabled, position, off_reason)
  SELECT w.tenant_id, w.flow_id, w.en, w.pos,
    CASE WHEN w.replaced_by_flow IS NOT NULL THEN 'replaced' WHEN NOT w.en THEN 'turned_off' END
  FROM m1_want w
  JOIN hub.process_defs d ON d.id = w.flow_id AND d.deleted_at IS NULL AND d.trigger IS NOT NULL
    AND (d.tenant_id IS NULL OR d.tenant_id = w.tenant_id)
  ON CONFLICT (tenant_id, flow_id) DO NOTHING;

  UPDATE hub.company_flows cf SET replaced_by = tgt.id
  FROM m1_want w
  JOIN hub.company_flows tgt ON tgt.tenant_id = w.tenant_id AND tgt.flow_id = w.replaced_by_flow
  WHERE w.replaced_by_flow IS NOT NULL AND cf.tenant_id = w.tenant_id AND cf.flow_id = w.flow_id
    AND cf.replaced_by IS NULL AND cf.off_reason = 'replaced' AND NOT cf.enabled;

  RAISE NOTICE 'hub 0111: % luật điều kiện không chuyển được (đường khe cũ vẫn chạy), % dòng company_flows',
    (SELECT count(*) FROM m1_rules WHERE NOT is_default AND wh IS NULL), (SELECT count(*) FROM hub.company_flows);
END $m1$;
--> statement-breakpoint
-- Soát: flow mặc định hd-mac-dinh phải có trigger sau backfill (check:app-events đọc khoá này); chưa ⇒ cảnh báo (đầy 22 stage / chưa có release).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM hub.process_defs WHERE key = 'hd-mac-dinh' AND tenant_id IS NULL AND deleted_at IS NULL
             AND trigger IS NULL) THEN
    RAISE WARNING 'hub 0111: flow mặc định hd-mac-dinh chưa có trigger (stages đầy hoặc thiếu release) — Hub báo ops';
  END IF;
END $$;
--> statement-breakpoint
DROP FUNCTION IF EXISTS hub.m1_missing_groups(jsonb, uuid);
--> statement-breakpoint
DROP FUNCTION IF EXISTS hub.m1_bind(jsonb, uuid);
--> statement-breakpoint
DROP FUNCTION IF EXISTS hub.m1_finish(jsonb, text, text);
--> statement-breakpoint
DROP FUNCTION IF EXISTS hub.m1_can_finish(jsonb);
--> statement-breakpoint
DROP FUNCTION IF EXISTS hub.m1_map();

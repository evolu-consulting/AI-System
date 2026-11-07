-- CR-122 · bước Ký số trong flow đã lưu (mẫu Thư viện + bản sao công ty + bản đã xuất bản) gắn `node: "contracts.esign"` để editor
-- hiện panel cấu hình riêng của node Ký số (người ký công ty, nhà cung cấp, hạn). Chỉ cộng khoá `node` vào phần tử stage:
-- stage tool `contracts-esign-send` và stage chờ `esign.completed`, khi chưa có `node`. Không đổi hành vi chạy. Không đụng
-- `process_runs` (snapshot) và def `dlc.*`. Theo tập, mỗi bảng một câu; chạy lại vô hại.
DO $m$
DECLARE d_n int; r_n int;
BEGIN
  UPDATE hub.process_defs d SET stages = (
    SELECT jsonb_agg(CASE
      WHEN NOT (s ? 'node') AND (s->'executor'->>'tool_key' = 'contracts-esign-send'
        OR (s->'executor'->>'kind' = 'wait_event' AND s->'executor'->>'event' = 'esign.completed'))
      THEN s || '{"node":"contracts.esign"}'::jsonb ELSE s END ORDER BY t.ord)
    FROM jsonb_array_elements(d.stages) WITH ORDINALITY t(s, ord))
  WHERE jsonb_typeof(d.stages) = 'array' AND d.stages::text LIKE '%contracts-esign-send%'
    AND coalesce(d.slot, '') NOT LIKE 'dlc.%';
  GET DIAGNOSTICS d_n = ROW_COUNT;

  UPDATE hub.process_def_releases r SET stages = (
    SELECT jsonb_agg(CASE
      WHEN NOT (s ? 'node') AND (s->'executor'->>'tool_key' = 'contracts-esign-send'
        OR (s->'executor'->>'kind' = 'wait_event' AND s->'executor'->>'event' = 'esign.completed'))
      THEN s || '{"node":"contracts.esign"}'::jsonb ELSE s END ORDER BY t.ord)
    FROM jsonb_array_elements(r.stages) WITH ORDINALITY t(s, ord))
  WHERE jsonb_typeof(r.stages) = 'array' AND r.stages::text LIKE '%contracts-esign-send%'
    AND NOT EXISTS (SELECT 1 FROM hub.process_defs d WHERE d.id = r.def_id AND d.slot LIKE 'dlc.%');
  GET DIAGNOSTICS r_n = ROW_COUNT;

  RAISE NOTICE 'hub 0113: gắn node contracts.esign: % def, % release', d_n, r_n;
END $m$;

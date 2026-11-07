-- CR-122 p17 · sửa hub 0112: điều kiện "chưa khai contract_id" viết bằng `NOT LIKE '%"contract_id"%'` — `_` trong LIKE là ký tự đại diện nên khớp
-- cả `"contract-id"` ⇒ KHÔNG hàng nào được đổi `inputs` (stages thì đổi) ⇒ khai input `contract-id` lệch args `contract_id` ⇒ TOOL_INVALID khi lưu/đồng bộ
-- def. Làm lại phần `inputs` với so khớp chuỗi đúng (`strpos`). Chỉ hàng còn khoá cũ và chưa khai khoá mới (đã khai cả hai ⇒ giữ nguyên, xử lý tay);
-- idempotent; không đụng `dlc.*`, `process_runs`.
DO $m$
DECLARE n int;
BEGIN
  UPDATE hub.process_defs SET inputs = replace(inputs::text, '"contract-id"', '"contract_id"')::jsonb
  WHERE inputs IS NOT NULL AND strpos(inputs::text, '"contract-id"') > 0 AND strpos(inputs::text, '"contract_id"') = 0
    AND coalesce(slot, '') NOT LIKE 'dlc.%';
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'hub 0114: % def.inputs contract-id → contract_id', n;
END $m$;

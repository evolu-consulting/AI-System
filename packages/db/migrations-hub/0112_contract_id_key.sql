-- CR-122 p17 · MỘT khoá bản ghi hợp đồng `contract_id` (trước đây Thư viện/flow chuyển đổi khai `contract-id`, còn lượt mở từ sự kiện của app mang
-- `contract_id`). Đổi `"contract-id"` → `"contract_id"` trong dữ liệu flow đã lưu: khai input (`process_defs.inputs`), stage (`args {from:"input",
-- key}`…) của def (bản nháp / đang chạy thử) VÀ các bản đã xuất bản (`process_def_releases.stages`, bản chép nội dung — lượt đang chạy giữ snapshot
-- riêng nên không ảnh hưởng). KHÔNG đụng `process_runs` (snapshot lượt đang chạy; hub vẫn nhận khoá cũ qua `inputKeyOf`), KHÔNG đụng def `dlc.*`.
-- Theo tập: mỗi bảng một câu; chạy lại vô hại (chỉ hàng còn chứa khoá cũ); chỉ khớp đúng chuỗi JSON `"contract-id"` (có nháy) nên không chạm
-- chữ thường trong mô tả.
DO $m$
DECLARE d_in int; d_st int; r_st int;
BEGIN
  UPDATE hub.process_defs SET inputs = replace(inputs::text, '"contract-id"', '"contract_id"')::jsonb
  WHERE inputs IS NOT NULL AND inputs::text LIKE '%"contract-id"%' AND coalesce(slot, '') NOT LIKE 'dlc.%'
    -- đã khai cả hai khoá ⇒ không đổi (tránh hai input trùng khoá); báo NOTICE bên dưới để xử lý tay
    AND inputs::text NOT LIKE '%"contract_id"%';
  GET DIAGNOSTICS d_in = ROW_COUNT;
  RAISE NOTICE 'hub 0112: % def khai cả contract-id và contract_id (giữ nguyên inputs)',
    (SELECT count(*) FROM hub.process_defs WHERE inputs::text LIKE '%"contract-id"%' AND inputs::text LIKE '%"contract_id"%');

  UPDATE hub.process_defs SET stages = replace(stages::text, '"contract-id"', '"contract_id"')::jsonb
  WHERE stages::text LIKE '%"contract-id"%' AND coalesce(slot, '') NOT LIKE 'dlc.%';
  GET DIAGNOSTICS d_st = ROW_COUNT;

  UPDATE hub.process_def_releases r SET stages = replace(r.stages::text, '"contract-id"', '"contract_id"')::jsonb
  WHERE r.stages::text LIKE '%"contract-id"%'
    AND NOT EXISTS (SELECT 1 FROM hub.process_defs d WHERE d.id = r.def_id AND d.slot LIKE 'dlc.%');
  GET DIAGNOSTICS r_st = ROW_COUNT;

  RAISE NOTICE 'hub 0112: contract-id → contract_id: % def.inputs, % def.stages, % release.stages', d_in, d_st, r_st;
END $m$;

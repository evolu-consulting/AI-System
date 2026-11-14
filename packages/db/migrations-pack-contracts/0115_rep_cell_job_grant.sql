-- Sửa CR-152c (0113): cột sinh `rep_cell` gọi `contracts.rep_cell_of` (→ `v2e_cell`) trên MỌI UPDATE hàng HĐ, kể cả UPDATE của
-- role nền `contracts_job` (vòng quét: hết hạn/flow lỗi ⇒ `transition_set`). Hai hàm chỉ cấp cho `contracts_rw` ⇒ job lỗi
-- 42501 «permission denied for function rep_cell_of». Cấp EXECUTE cho `contracts_job` (hàm IMMUTABLE thuần, không đọc bảng).
GRANT EXECUTE ON FUNCTION contracts.rep_cell_of(text, text, text, jsonb) TO contracts_job;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION contracts.v2e_cell(text, text) TO contracts_job;

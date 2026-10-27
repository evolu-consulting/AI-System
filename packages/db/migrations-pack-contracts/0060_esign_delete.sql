-- esign-fix · xoá HĐ (V2-M, `deleteContract` repo) dọn luôn hàng `esign_envelopes` của HĐ + phụ lục trong CÙNG tx (không FK — giữ
-- TRUNCATE của bộ test HD1). Chỉ cấp DELETE cho role gói; RLS FORCE theo tenant (`secure_table`) vẫn áp. Chạy lại vô hại.
GRANT DELETE ON contracts.esign_envelopes TO contracts_rw;

-- CR-124 · q3 · tách từ 0085: kiểm hàng cũ của contracts_deal_source_ck (NOT VALID ở 0085) riêng một migration — VALIDATE chỉ giữ SHARE UPDATE EXCLUSIVE,
-- không chặn ghi trong lúc quét contracts.contracts (mẫu hub 0115/0116). Chạy lại vô hại.
ALTER TABLE contracts.contracts VALIDATE CONSTRAINT contracts_deal_source_ck;

-- CR-188 · BR-188-5 «Giấy tờ đã ký bằng chữ ký này»: tra ngược từ một phiên bản chữ ký sang các dấu ký đã in. Chỉ mục một phần, không backfill.
CREATE INDEX IF NOT EXISTS sign_marks_sig_ix ON contracts.sign_marks (tenant_id, user_signature_id) WHERE user_signature_id IS NOT NULL;

-- CR-127 · K3 (soát Opus): `contract_submissions` (0092) chưa có FK tới `contracts` ⇒ hồ sơ gửi có thể mồ côi / trỏ HĐ tenant khác.
-- FK kép (contract_id, tenant_id) → contracts(id, tenant_id) ON DELETE CASCADE — FK kép xem 0101 (cùng khuôn sign_session_refs/penalty_terms).
-- Không sửa 0092 (đã áp, hash bị guard chặn). Xoá dòng mồ côi trước (không có HĐ cùng tenant); chạy lại vô hại.
DELETE FROM contracts.contract_submissions s
  WHERE NOT EXISTS (SELECT 1 FROM contracts.contracts c WHERE c.id = s.contract_id AND c.tenant_id = s.tenant_id);
--> statement-breakpoint
ALTER TABLE contracts.contract_submissions DROP CONSTRAINT IF EXISTS contract_submissions_contract_fk;
--> statement-breakpoint
ALTER TABLE contracts.contract_submissions ADD CONSTRAINT contract_submissions_contract_fk
  FOREIGN KEY (contract_id, tenant_id) REFERENCES contracts.contracts (id, tenant_id) ON DELETE CASCADE;

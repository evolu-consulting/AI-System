-- CR-127 · C1 (phân loại ca đỏ, PK-FR-02): FK nội schema gói phải KÉP tenant ở cả hai đầu. `sign_session_refs_contract_fk` (0095) và
-- `penalty_terms_contract_fk` (0097) chỉ `(contract_id) → contracts(id)` ⇒ đổi thành `(contract_id, tenant_id) → contracts(id, tenant_id)`
-- (`contracts_id_tenant_uq`, như contract_items_contract_fk). Migration mới (không sửa 0095/0097 đã áp ở DB dev); chạy lại vô hại.
ALTER TABLE contracts.sign_session_refs DROP CONSTRAINT IF EXISTS sign_session_refs_contract_fk;
--> statement-breakpoint
ALTER TABLE contracts.sign_session_refs ADD CONSTRAINT sign_session_refs_contract_fk
  FOREIGN KEY (contract_id, tenant_id) REFERENCES contracts.contracts (id, tenant_id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE contracts.penalty_terms DROP CONSTRAINT IF EXISTS penalty_terms_contract_fk;
--> statement-breakpoint
ALTER TABLE contracts.penalty_terms ADD CONSTRAINT penalty_terms_contract_fk
  FOREIGN KEY (contract_id, tenant_id) REFERENCES contracts.contracts (id, tenant_id) ON DELETE CASCADE;

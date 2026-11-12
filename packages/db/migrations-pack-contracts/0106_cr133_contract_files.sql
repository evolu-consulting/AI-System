-- CR-133 · «Tài liệu kèm» trên hợp đồng: tệp người dùng gắn THẲNG vào HĐ (không đem đi ký). Nguồn duy nhất cho tệp của HĐ ngoài file
-- chính (`contracts.file_id`); byte ở FileBox qua `contracts.files` (cùng kho với file chính — không FK sang hub.*). Xoá HĐ ⇒ gỡ liên kết
-- (CASCADE); xoá tệp = `files.deleted_at` (kit không DELETE `files`) nên file bên FileBox của HĐ đã xoá chỉ còn là hàng mồ côi đã đánh dấu.
CREATE TABLE IF NOT EXISTS contracts.contract_files (
  tenant_id uuid NOT NULL,
  contract_id uuid NOT NULL,
  file_id uuid NOT NULL,
  added_by uuid NOT NULL,
  added_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contract_files_pkey PRIMARY KEY (contract_id, file_id),
  CONSTRAINT contract_files_contract_fk FOREIGN KEY (contract_id, tenant_id)
    REFERENCES contracts.contracts (id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT contract_files_file_fk FOREIGN KEY (file_id, tenant_id)
    REFERENCES contracts.files (id, tenant_id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS contract_files_list_idx ON contracts.contract_files (tenant_id, contract_id, added_at, file_id);
--> statement-breakpoint
SELECT packs.secure_table('contracts', 'contract_files');

-- CR-181 · Ký trên tài liệu (đợt 1): cờ «Cần ký» + chỗ ký + bản đã ký + dấu chữ ký, theo TỪNG tệp của HĐ (tệp chính lẫn tệp kèm — byte ở FileBox qua
-- `contracts.files`). CHỈ THÊM. Tệp gốc không bao giờ bị sửa: mỗi lần Lưu = một `sign_versions` mới (tệp mới `out_file_id`); trả lại/từ chối ⇒ `voided_at`
-- (Q17, không xoá). `sign_fields`/`sign_versions` trỏ `sign_docs (contract_id, file_id, tenant_id)` ⇒ cùng một HĐ/tệp/công ty, xoá HĐ ⇒ gỡ cả chuỗi (CASCADE);
-- `sign_docs` là hàng khoá `FOR UPDATE` khi thêm bản (seq không trùng). `user_signature_id`/`field_id` ở dấu KHÔNG có FK (hub.* ở schema khác; chỗ ký có thể bị
-- thay khi chuẩn bị lại sau khi bản cũ bị void — dấu là lịch sử).
CREATE TABLE IF NOT EXISTS contracts.sign_docs (
  tenant_id uuid NOT NULL,
  contract_id uuid NOT NULL,
  file_id uuid NOT NULL,
  needs_sign boolean NOT NULL DEFAULT false,
  pages integer,
  set_by uuid NOT NULL,
  set_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sign_docs_pkey PRIMARY KEY (contract_id, file_id),
  CONSTRAINT sign_docs_tenant_uq UNIQUE (contract_id, file_id, tenant_id),
  CONSTRAINT sign_docs_contract_fk FOREIGN KEY (contract_id, tenant_id)
    REFERENCES contracts.contracts (id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT sign_docs_file_fk FOREIGN KEY (file_id, tenant_id)
    REFERENCES contracts.files (id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT sign_docs_pages_ck CHECK (pages IS NULL OR pages BETWEEN 1 AND 50)
);
--> statement-breakpoint
SELECT packs.secure_table('contracts', 'sign_docs');
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS contracts.sign_versions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  contract_id uuid NOT NULL,
  file_id uuid NOT NULL,
  seq integer NOT NULL,
  out_file_id uuid NOT NULL,
  sha256 text NOT NULL,
  signed_by uuid NOT NULL,
  signature_kind text NOT NULL DEFAULT 'internal',
  run_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  voided_at timestamptz,
  CONSTRAINT sign_versions_pkey PRIMARY KEY (id),
  CONSTRAINT sign_versions_tenant_uq UNIQUE (id, tenant_id),
  CONSTRAINT sign_versions_seq_uq UNIQUE (tenant_id, contract_id, file_id, seq),
  CONSTRAINT sign_versions_doc_fk FOREIGN KEY (contract_id, file_id, tenant_id)
    REFERENCES contracts.sign_docs (contract_id, file_id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT sign_versions_out_fk FOREIGN KEY (out_file_id, tenant_id)
    REFERENCES contracts.files (id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT sign_versions_seq_ck CHECK (seq >= 1),
  CONSTRAINT sign_versions_sha_ck CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT sign_versions_kind_ck CHECK (signature_kind IN ('internal', 'digital'))
);
--> statement-breakpoint
-- «Bản mới nhất chưa void của tệp» (quét ngược một dòng) + «void theo lượt duyệt».
CREATE INDEX IF NOT EXISTS sign_versions_latest_idx ON contracts.sign_versions (tenant_id, contract_id, file_id, seq DESC)
  WHERE voided_at IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS sign_versions_run_idx ON contracts.sign_versions (tenant_id, run_id) WHERE run_id IS NOT NULL AND voided_at IS NULL;
--> statement-breakpoint
SELECT packs.secure_table('contracts', 'sign_versions');
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS contracts.sign_fields (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  contract_id uuid NOT NULL,
  file_id uuid NOT NULL,
  side text NOT NULL,
  signer_kind text NOT NULL,
  signer_ref text NOT NULL,
  label text NOT NULL DEFAULT '',
  parts jsonb NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  signed_by uuid,
  signed_version_id uuid,
  CONSTRAINT sign_fields_pkey PRIMARY KEY (id),
  CONSTRAINT sign_fields_tenant_uq UNIQUE (id, tenant_id),
  CONSTRAINT sign_fields_doc_fk FOREIGN KEY (contract_id, file_id, tenant_id)
    REFERENCES contracts.sign_docs (contract_id, file_id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT sign_fields_version_fk FOREIGN KEY (signed_version_id, tenant_id)
    REFERENCES contracts.sign_versions (id, tenant_id),
  CONSTRAINT sign_fields_side_ck CHECK (side IN ('A', 'B')),
  CONSTRAINT sign_fields_kind_ck CHECK (signer_kind IN ('user', 'group', 'partner')),
  CONSTRAINT sign_fields_text_ck CHECK (char_length(signer_ref) BETWEEN 1 AND 300 AND char_length(label) <= 200),
  CONSTRAINT sign_fields_parts_ck CHECK (jsonb_typeof(parts) = 'array' AND jsonb_array_length(parts) BETWEEN 1 AND 5),
  CONSTRAINT sign_fields_signed_ck CHECK ((signed_by IS NULL) = (signed_version_id IS NULL))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS sign_fields_file_idx ON contracts.sign_fields (tenant_id, contract_id, file_id, created_at, id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS sign_fields_version_idx ON contracts.sign_fields (tenant_id, signed_version_id) WHERE signed_version_id IS NOT NULL;
--> statement-breakpoint
SELECT packs.secure_table('contracts', 'sign_fields');
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS contracts.sign_marks (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  version_id uuid NOT NULL,
  signer_id uuid NOT NULL,
  field_id uuid,
  placement text NOT NULL,
  parts jsonb NOT NULL,
  user_signature_id uuid NOT NULL,
  caption text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sign_marks_pkey PRIMARY KEY (id),
  CONSTRAINT sign_marks_version_fk FOREIGN KEY (version_id, tenant_id)
    REFERENCES contracts.sign_versions (id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT sign_marks_placement_ck CHECK (placement IN ('field', 'free', 'seam', 'initials')),
  CONSTRAINT sign_marks_parts_ck CHECK (jsonb_typeof(parts) = 'array' AND jsonb_array_length(parts) BETWEEN 1 AND 5),
  CONSTRAINT sign_marks_caption_ck CHECK (caption IS NULL OR char_length(caption) <= 500)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS sign_marks_version_idx ON contracts.sign_marks (tenant_id, version_id, created_at, id);
--> statement-breakpoint
SELECT packs.secure_table('contracts', 'sign_marks');

-- N4-FR-01 · N4-FR-02 · N4-FR-05 · ADR-0021 §1–3: dịch vụ tri thức — schema `knowledge` theo khuôn gói N1 (`packs.install`:
-- role `knowledge_rw` NOINHERIT NOBYPASSRLS, RLS FORCE theo `app.tenant_id`, hub_api chỉ SET ROLE trong tx). Tài liệu gốc ở
-- FileBox (`knowledge.files` của bộ khung), metadata ở `documents`; `chunks` (+ `tsv` sinh tự động) và `chunk_embeddings` là
-- bản dẫn xuất, xoá đi dựng lại được. Tìm kiếm (c): cấu hình FTS `knowledge.vi` = unaccent + simple (tiếng Việt đơn lập:
-- không stem; bỏ dấu để "thanh toán" ≡ "thanh toan"). Embedding (a) lưu `real[]` (chưa có pgvector — TECH-DEBT).
CREATE EXTENSION IF NOT EXISTS unaccent;
--> statement-breakpoint
SELECT packs.install('knowledge');
--> statement-breakpoint
-- `knowledge.fold`: bỏ dấu + chữ thường TRƯỚC bộ tách từ (chữ "Đ" giữa mã "01/2026/HĐMB-PN" làm parser cắt sai nếu chỉ bỏ dấu ở
-- từ điển). Bọc IMMUTABLE với từ điển ghi rõ (khuôn chuẩn của unaccent) để dùng trong cột sinh `tsv`.
DO $$
DECLARE s text;
BEGIN
  SELECT n.nspname INTO s FROM pg_ts_dict t JOIN pg_namespace n ON n.oid = t.dictnamespace
    WHERE t.dictname = 'unaccent' LIMIT 1;
  EXECUTE format('CREATE OR REPLACE FUNCTION knowledge.fold(t text) RETURNS text LANGUAGE sql IMMUTABLE STRICT '
    'PARALLEL SAFE AS $f$ SELECT lower(%1$I.unaccent(%2$L::regdictionary, t)) $f$', s, s || '.unaccent');
  IF NOT EXISTS (SELECT 1 FROM pg_ts_config c JOIN pg_namespace n ON n.oid = c.cfgnamespace
                 WHERE n.nspname = 'knowledge' AND c.cfgname = 'vi') THEN
    CREATE TEXT SEARCH CONFIGURATION knowledge.vi (COPY = pg_catalog.simple);
  END IF;
END $$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION knowledge.fold(text) TO knowledge_rw;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS knowledge.documents (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  title text NOT NULL,
  kind text NOT NULL DEFAULT 'markdown',
  source text NOT NULL DEFAULT 'mcp',
  uri text,
  content_hash text NOT NULL,
  chunk_count integer NOT NULL DEFAULT 0,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT documents_pkey PRIMARY KEY (id),
  CONSTRAINT documents_id_tenant_uq UNIQUE (id, tenant_id),
  CONSTRAINT documents_hash_uq UNIQUE (tenant_id, content_hash),
  CONSTRAINT documents_kind_ck CHECK (kind IN ('markdown', 'contract')),
  CONSTRAINT documents_ck CHECK (char_length(title) BETWEEN 1 AND 300 AND char_length(source) BETWEEN 1 AND 40
    AND (uri IS NULL OR char_length(uri) <= 1000) AND content_hash ~ '^[0-9a-f]{64}$' AND chunk_count >= 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS knowledge.chunks (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  doc_id uuid NOT NULL,
  ord integer NOT NULL,
  heading text NOT NULL DEFAULT '',
  clause_no text,
  context text NOT NULL DEFAULT '',
  body text NOT NULL,
  tsv tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('knowledge.vi'::regconfig, knowledge.fold(heading)), 'A')
    || setweight(to_tsvector('knowledge.vi'::regconfig, knowledge.fold(context)), 'C')
    || setweight(to_tsvector('knowledge.vi'::regconfig, knowledge.fold(body)), 'B')) STORED,
  CONSTRAINT chunks_pkey PRIMARY KEY (id),
  CONSTRAINT chunks_id_tenant_uq UNIQUE (id, tenant_id),
  CONSTRAINT chunks_doc_ord_uq UNIQUE (doc_id, ord),
  CONSTRAINT chunks_ck CHECK (ord >= 0 AND char_length(heading) <= 400 AND char_length(context) <= 600
    AND char_length(body) BETWEEN 1 AND 8000 AND (clause_no IS NULL OR char_length(clause_no) <= 20)),
  CONSTRAINT chunks_doc_fk FOREIGN KEY (doc_id, tenant_id)
    REFERENCES knowledge.documents (id, tenant_id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS chunks_tsv_idx ON knowledge.chunks USING gin (tsv);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS chunks_tenant_idx ON knowledge.chunks (tenant_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS knowledge.chunk_embeddings (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  chunk_id uuid NOT NULL,
  model text NOT NULL,
  emb real[] NOT NULL,
  CONSTRAINT chunk_embeddings_pkey PRIMARY KEY (id),
  CONSTRAINT chunk_embeddings_uq UNIQUE (chunk_id, model),
  CONSTRAINT chunk_embeddings_ck CHECK (char_length(model) BETWEEN 1 AND 80
    AND cardinality(emb) BETWEEN 1 AND 4096),
  CONSTRAINT chunk_embeddings_chunk_fk FOREIGN KEY (chunk_id, tenant_id)
    REFERENCES knowledge.chunks (id, tenant_id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS chunk_embeddings_tenant_model_idx ON knowledge.chunk_embeddings (tenant_id, model);
--> statement-breakpoint
SELECT packs.secure_table('knowledge', 'documents');
--> statement-breakpoint
SELECT packs.secure_table('knowledge', 'chunks');
--> statement-breakpoint
SELECT packs.secure_table('knowledge', 'chunk_embeddings');

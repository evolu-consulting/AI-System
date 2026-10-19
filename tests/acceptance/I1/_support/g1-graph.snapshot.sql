-- G1 (CR-095 "bỏ Neo4j"): đồ thị tri thức của mgmt-app sang bảng Postgres trong schema `knowledge` (cùng RLS FORCE theo
-- `app.tenant_id`, role `knowledge_rw`). Mô hình Neo4j ⇒ bảng:
--   Document–HAS_CHUNK→Chunk = `chunks.doc_id` (N4) · Chunk–MENTIONS→Entity = `chunk_entities` · Entity ALIAS_OF Entity =
--   `entity_aliases` (vô hướng, lưu a_id < b_id) · Entity REL Entity = `entity_rels` (type + đoạn làm chứng) · Chunk
--   SIMILAR/CONFLICTS Chunk = `chunk_links` (có hướng như MERGE gốc; mang sẵn doc hai đầu để truy vấn mức tài liệu không
--   phải đi qua `chunks`) · Document LINKS_TO Document = `document_links`.
-- Luật 4c: mọi truy vấn lọc `tenant_id` tường minh ⇒ mọi PK/index cạnh bắt đầu bằng `tenant_id`, có index CẢ HAI chiều;
-- FK kép (id, tenant_id) ⇒ không thể nối cạnh sang hàng của tenant khác; xoá tài liệu/đoạn ⇒ cạnh đi theo (CASCADE).
CREATE TABLE IF NOT EXISTS knowledge.entities (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  key text NOT NULL,
  name text NOT NULL,
  type text NOT NULL,
  CONSTRAINT entities_pkey PRIMARY KEY (id),
  CONSTRAINT entities_id_tenant_uq UNIQUE (id, tenant_id),
  CONSTRAINT entities_key_uq UNIQUE (tenant_id, key),
  CONSTRAINT entities_ck CHECK (char_length(key) BETWEEN 1 AND 300 AND char_length(name) BETWEEN 1 AND 300
    AND char_length(type) BETWEEN 1 AND 60)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS entities_type_idx ON knowledge.entities (tenant_id, type);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS knowledge.chunk_entities (
  tenant_id uuid NOT NULL,
  chunk_id uuid NOT NULL,
  entity_id uuid NOT NULL,
  CONSTRAINT chunk_entities_pkey PRIMARY KEY (tenant_id, chunk_id, entity_id),
  CONSTRAINT chunk_entities_chunk_fk FOREIGN KEY (chunk_id, tenant_id)
    REFERENCES knowledge.chunks (id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT chunk_entities_entity_fk FOREIGN KEY (entity_id, tenant_id)
    REFERENCES knowledge.entities (id, tenant_id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS chunk_entities_entity_idx ON knowledge.chunk_entities (tenant_id, entity_id, chunk_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS knowledge.entity_aliases (
  tenant_id uuid NOT NULL,
  a_id uuid NOT NULL,
  b_id uuid NOT NULL,
  CONSTRAINT entity_aliases_pkey PRIMARY KEY (tenant_id, a_id, b_id),
  CONSTRAINT entity_aliases_order_ck CHECK (a_id < b_id),
  CONSTRAINT entity_aliases_a_fk FOREIGN KEY (a_id, tenant_id)
    REFERENCES knowledge.entities (id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT entity_aliases_b_fk FOREIGN KEY (b_id, tenant_id)
    REFERENCES knowledge.entities (id, tenant_id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS entity_aliases_b_idx ON knowledge.entity_aliases (tenant_id, b_id, a_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS knowledge.entity_rels (
  tenant_id uuid NOT NULL,
  src_id uuid NOT NULL,
  dst_id uuid NOT NULL,
  type text NOT NULL,
  evidence_chunk_id uuid,
  CONSTRAINT entity_rels_pkey PRIMARY KEY (tenant_id, src_id, type, dst_id),
  CONSTRAINT entity_rels_ck CHECK (char_length(type) BETWEEN 1 AND 60),
  CONSTRAINT entity_rels_src_fk FOREIGN KEY (src_id, tenant_id)
    REFERENCES knowledge.entities (id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT entity_rels_dst_fk FOREIGN KEY (dst_id, tenant_id)
    REFERENCES knowledge.entities (id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT entity_rels_evidence_fk FOREIGN KEY (evidence_chunk_id, tenant_id)
    REFERENCES knowledge.chunks (id, tenant_id) ON DELETE SET NULL (evidence_chunk_id)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS entity_rels_dst_idx ON knowledge.entity_rels (tenant_id, dst_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS entity_rels_evidence_idx ON knowledge.entity_rels (tenant_id, evidence_chunk_id)
  WHERE evidence_chunk_id IS NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS knowledge.chunk_links (
  tenant_id uuid NOT NULL,
  src_id uuid NOT NULL,
  dst_id uuid NOT NULL,
  kind text NOT NULL,
  score real,
  reason text,
  src_doc_id uuid NOT NULL,
  dst_doc_id uuid NOT NULL,
  CONSTRAINT chunk_links_pkey PRIMARY KEY (tenant_id, src_id, dst_id, kind),
  CONSTRAINT chunk_links_ck CHECK (kind IN ('SIMILAR', 'CONFLICTS') AND src_id <> dst_id
    AND (reason IS NULL OR char_length(reason) <= 2000)),
  CONSTRAINT chunk_links_src_fk FOREIGN KEY (src_id, tenant_id)
    REFERENCES knowledge.chunks (id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT chunk_links_dst_fk FOREIGN KEY (dst_id, tenant_id)
    REFERENCES knowledge.chunks (id, tenant_id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS chunk_links_dst_idx ON knowledge.chunk_links (tenant_id, dst_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS chunk_links_src_doc_idx ON knowledge.chunk_links (tenant_id, src_doc_id, dst_doc_id, kind);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS chunk_links_dst_doc_idx ON knowledge.chunk_links (tenant_id, dst_doc_id, src_doc_id, kind);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS knowledge.document_links (
  tenant_id uuid NOT NULL,
  src_id uuid NOT NULL,
  dst_id uuid NOT NULL,
  CONSTRAINT document_links_pkey PRIMARY KEY (tenant_id, src_id, dst_id),
  CONSTRAINT document_links_ck CHECK (src_id <> dst_id),
  CONSTRAINT document_links_src_fk FOREIGN KEY (src_id, tenant_id)
    REFERENCES knowledge.documents (id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT document_links_dst_fk FOREIGN KEY (dst_id, tenant_id)
    REFERENCES knowledge.documents (id, tenant_id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS document_links_dst_idx ON knowledge.document_links (tenant_id, dst_id);
--> statement-breakpoint
-- `link_documents` khớp tài liệu đích theo uri.
CREATE INDEX IF NOT EXISTS documents_uri_idx ON knowledge.documents (tenant_id, uri) WHERE uri IS NOT NULL;
--> statement-breakpoint
SELECT packs.secure_table('knowledge', 'entities');
--> statement-breakpoint
SELECT packs.secure_table('knowledge', 'chunk_entities');
--> statement-breakpoint
SELECT packs.secure_table('knowledge', 'entity_aliases');
--> statement-breakpoint
SELECT packs.secure_table('knowledge', 'entity_rels');
--> statement-breakpoint
SELECT packs.secure_table('knowledge', 'chunk_links');
--> statement-breakpoint
SELECT packs.secure_table('knowledge', 'document_links');

-- PK-FR-01 · PK-FR-02 · PK-AC01 · PK-AC02 · N1 plan §3, D-08: gói kiểm thử `pkdemo` (chỉ ngoài production) — khuôn bảng
-- nghiệp vụ gói: cha `UNIQUE (id, tenant_id)`, con FK kép `(item_id, tenant_id)` ON DELETE CASCADE, xong `packs.secure_table`.
SELECT packs.install('pkdemo');
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS pkdemo.items (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  title text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT items_pkey PRIMARY KEY (id),
  CONSTRAINT items_id_tenant_uq UNIQUE (id, tenant_id),
  CONSTRAINT items_title_ck CHECK (char_length(title) BETWEEN 1 AND 200)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS pkdemo.item_lines (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  item_id uuid NOT NULL,
  text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT item_lines_pkey PRIMARY KEY (id),
  CONSTRAINT item_lines_text_ck CHECK (char_length(text) BETWEEN 1 AND 200),
  CONSTRAINT item_lines_item_fk FOREIGN KEY (item_id, tenant_id)
    REFERENCES pkdemo.items (id, tenant_id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS item_lines_item_idx ON pkdemo.item_lines (item_id);
--> statement-breakpoint
SELECT packs.secure_table('pkdemo', 'items');
--> statement-breakpoint
SELECT packs.secure_table('pkdemo', 'item_lines');

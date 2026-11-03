-- CR-114 · hub-agent-handoff · kho artifact theo nội dung: kết quả text/JSON của một bước, khoá sha256 hex (64) của nội
-- dung, dedup theo (tenant, key). `tokens` ước tính, `summary` 1–2 dòng, `run_id`/`step_id` nơi tạo, `expires_at` (TTL —
-- dọn bằng `DELETE … WHERE expires_at < now()` theo index). `emb real[]` + `emb_model`: cùng cách lưu của gói knowledge
-- (chưa pgvector), chỉ cho artifact lớn. `tsv` cho `artifact.search` khi không có embedding.
-- RLS: scope system hoặc user đúng `app.tenant_id` (đọc + ghi). Chỉ THÊM bảng; chạy lại vô hại.
CREATE TABLE IF NOT EXISTS hub.artifacts (
  tenant_id uuid NOT NULL,
  key text NOT NULL,
  kind text NOT NULL DEFAULT 'text',
  body text NOT NULL,
  size_bytes integer NOT NULL,
  tokens integer NOT NULL,
  summary text NOT NULL DEFAULT '',
  run_id uuid,
  step_id uuid,
  emb real[],
  emb_model text,
  tsv tsvector GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, left(summary || ' ' || body, 200000))) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  CONSTRAINT artifacts_pkey PRIMARY KEY (tenant_id, key),
  CONSTRAINT artifacts_key_ck CHECK (key ~ '^[0-9a-f]{64}$'),
  CONSTRAINT artifacts_kind_ck CHECK (kind IN ('text', 'json')),
  CONSTRAINT artifacts_size_ck CHECK (size_bytes >= 0 AND tokens >= 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS artifacts_expires_idx ON hub.artifacts (expires_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS artifacts_run_idx ON hub.artifacts (tenant_id, run_id) WHERE run_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS artifacts_tsv_idx ON hub.artifacts USING gin (tsv);
--> statement-breakpoint
ALTER TABLE hub.artifacts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS artifacts_tenant ON hub.artifacts;
--> statement-breakpoint
CREATE POLICY artifacts_tenant ON hub.artifacts FOR ALL TO hub_rw
  USING (current_setting('app.scope', true) = 'system'
         OR (current_setting('app.scope', true) = 'user'
             AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid))
  WITH CHECK (current_setting('app.scope', true) = 'system'
         OR (current_setting('app.scope', true) = 'user'
             AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid));
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON hub.artifacts TO hub_rw;
--> statement-breakpoint
-- Nối run ↔ artifact: một nội dung (dedup) dùng được cho nhiều run; token job đọc artifact khi có link với run của nó.
-- Xoá artifact (dọn hết hạn) ⇒ link xoá theo (CASCADE).
CREATE TABLE IF NOT EXISTS hub.artifact_runs (
  tenant_id uuid NOT NULL,
  run_id uuid NOT NULL,
  key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT artifact_runs_pkey PRIMARY KEY (tenant_id, run_id, key),
  CONSTRAINT artifact_runs_artifact_fk FOREIGN KEY (tenant_id, key)
    REFERENCES hub.artifacts (tenant_id, key) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS artifact_runs_key_idx ON hub.artifact_runs (tenant_id, key);
--> statement-breakpoint
ALTER TABLE hub.artifact_runs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS artifact_runs_tenant ON hub.artifact_runs;
--> statement-breakpoint
CREATE POLICY artifact_runs_tenant ON hub.artifact_runs FOR ALL TO hub_rw
  USING (current_setting('app.scope', true) = 'system'
         OR (current_setting('app.scope', true) = 'user'
             AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid))
  WITH CHECK (current_setting('app.scope', true) = 'system'
         OR (current_setting('app.scope', true) = 'user'
             AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid));
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON hub.artifact_runs TO hub_rw;

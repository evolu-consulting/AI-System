-- PK-FR-01 · PK-FR-02 · PK-FR-03 · PK-FR-04 · N1 plan §3: bộ khung gói nghiệp vụ. Viết tay, idempotent; chạy SAU migrations/ +
-- migrations-hub/ (cần role `hub_api`, bảng `admin.features`) bằng role chủ migration, trong `withMigrateLock` (CREATE ROLE).
-- `packs.install(k)`: role `<k>_rw` NOINHERIT NOBYPASSRLS + schema `<k>` + bảng khung `files`/`index_outbox` + 3 feature
-- `<k'>-read|write|admin` + registry. `packs.secure_table(k, t)`: ENABLE + FORCE RLS, policy tenant (không nhánh system).
CREATE SCHEMA IF NOT EXISTS packs;
--> statement-breakpoint
REVOKE ALL ON SCHEMA packs FROM PUBLIC;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS packs.registry (
  key text NOT NULL,
  installed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT registry_pkey PRIMARY KEY (key),
  CONSTRAINT registry_key_ck CHECK (key ~ '^[a-z][a-z0-9_]{1,20}$')
);
--> statement-breakpoint
-- Cùng luật với `PackKeySchema` (packages/contracts/src/packs.ts): 2–21 ký tự, cấm tên schema có sẵn và tiền tố `pg_`.
CREATE OR REPLACE FUNCTION packs.check_key(p_key text) RETURNS void
  LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF p_key IS NULL OR p_key !~ '^[a-z][a-z0-9_]{1,20}$' OR left(p_key, 3) = 'pg_'
     OR p_key = ANY (ARRAY['public', 'admin', 'hub', 'drizzle', 'packs', 'information_schema']) THEN
    RAISE EXCEPTION 'packs: khoá gói không hợp lệ: %', p_key USING ERRCODE = '22023';
  END IF;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION packs.secure_table(p_key text, p_table text) RETURNS void
  LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  r text := p_key || '_rw';
  t regclass;
  cond text := 'tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid';
BEGIN
  PERFORM packs.check_key(p_key);
  t := to_regclass(format('%I.%I', p_key, p_table));
  IF t IS NULL THEN
    RAISE EXCEPTION 'packs: không có bảng %.%', p_key, p_table USING ERRCODE = '42P01';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = t AND a.attname = 'tenant_id'
                 AND NOT a.attisdropped AND a.attnotnull AND a.atttypid = 'uuid'::regtype) THEN
    RAISE EXCEPTION 'packs: %.% thiếu cột tenant_id uuid NOT NULL', p_key, p_table USING ERRCODE = '22023';
  END IF;
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', t);
  EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', t);
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = t AND polname = p_table || '_tenant') THEN
    EXECUTE format('CREATE POLICY %I ON %s FOR ALL TO %I USING (%s) WITH CHECK (%s)',
      p_table || '_tenant', t, r, cond, cond);
  END IF;
  EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %s TO %I', t, r);
END $$;
--> statement-breakpoint
-- Bảng khung mỗi gói (plan §3): `files` (FileBox org = t_<tenant>, D-07) và `index_outbox` (ADR-0016 §2, chỉ INSERT).
CREATE OR REPLACE FUNCTION packs.create_kit_tables(p_key text) RETURNS void
  LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
DECLARE r text := p_key || '_rw';
BEGIN
  PERFORM packs.check_key(p_key);
  EXECUTE format($f$CREATE TABLE IF NOT EXISTS %I.files (
    id uuid NOT NULL DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL,
    org text NOT NULL, file_id text NOT NULL, version_id text,
    name text NOT NULL, mime text NOT NULL, size_bytes bigint NOT NULL,
    created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz,
    CONSTRAINT files_pkey PRIMARY KEY (id), CONSTRAINT files_id_tenant_uq UNIQUE (id, tenant_id),
    CONSTRAINT files_org_ck CHECK (org = 't_' || tenant_id::text),
    CONSTRAINT files_ck CHECK (char_length(name) BETWEEN 1 AND 255 AND char_length(mime) <= 128
      AND size_bytes BETWEEN 0 AND 20971520 AND char_length(file_id) <= 128
      AND (version_id IS NULL OR char_length(version_id) <= 128)))$f$, p_key);
  EXECUTE format($f$CREATE TABLE IF NOT EXISTS %I.index_outbox (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, tenant_id uuid NOT NULL,
    entity text NOT NULL CHECK (entity ~ '^[a-z][a-z0-9_]{1,40}$'), entity_id uuid NOT NULL,
    op text NOT NULL CHECK (op IN ('upsert', 'delete')),
    created_at timestamptz NOT NULL DEFAULT now(), processed_at timestamptz)$f$, p_key);
  EXECUTE format('CREATE INDEX IF NOT EXISTS index_outbox_pending_idx ON %I.index_outbox (id) WHERE processed_at IS NULL',
    p_key);
  PERFORM packs.secure_table(p_key, 'files');
  PERFORM packs.secure_table(p_key, 'index_outbox');
  -- files: xoá = deleted_at (không DELETE); index_outbox: chỉ INSERT (worker N4 có role riêng).
  EXECUTE format('REVOKE DELETE ON %I.files FROM %I', p_key, r);
  EXECUTE format('REVOKE SELECT, UPDATE, DELETE ON %I.index_outbox FROM %I', p_key, r);
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION packs.install(p_key text) RETURNS void
  LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  r text := p_key || '_rw';
  fk text := replace(p_key, '_', '-');
BEGIN
  PERFORM packs.check_key(p_key);
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
    EXECUTE format('CREATE ROLE %I NOLOGIN NOINHERIT NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION', r);
  END IF;
  EXECUTE format('ALTER ROLE %I NOLOGIN NOINHERIT NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION', r);
  EXECUTE format('CREATE SCHEMA IF NOT EXISTS %I', p_key);
  EXECUTE format('REVOKE ALL ON SCHEMA %I FROM PUBLIC', p_key);
  EXECUTE format('GRANT USAGE ON SCHEMA %I TO %I', p_key, r);
  -- D-06: hub_api chỉ thấy bảng gói trong tx đã SET ROLE <k>_rw; không GRANT gì trên hub/admin cho <k>_rw.
  EXECUTE format('GRANT %I TO hub_api WITH INHERIT FALSE, SET TRUE', r);
  PERFORM packs.create_kit_tables(p_key);
  INSERT INTO admin.features (key, name, status)
    SELECT fk || '-' || a, jsonb_build_object('vi', p_key || '.' || a, 'en', p_key || '.' || a), 'on'
    FROM unnest(ARRAY['read', 'write', 'admin']) AS a
  ON CONFLICT (key) DO NOTHING;
  INSERT INTO packs.registry (key) VALUES (p_key) ON CONFLICT (key) DO NOTHING;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION packs.check_key(text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION packs.secure_table(text, text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION packs.create_kit_tables(text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION packs.install(text) FROM PUBLIC;

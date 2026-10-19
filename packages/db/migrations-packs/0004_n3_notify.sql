-- N3-FR-01 · N3-NFR-02 · cổng thông báo cho MỌI gói: role `<k>_rw` chỉ được USAGE schema `notify` + EXECUTE `notify.enqueue`
-- (hàm DEFINER ở migrations-hub/0040). Không cấp gì trên schema `hub` ⇒ PK-AC03 giữ nguyên. Chạy SAU 0003. Idempotent.
CREATE OR REPLACE FUNCTION packs.grant_notify(p_key text) RETURNS void
  LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
DECLARE r text := p_key || '_rw';
BEGIN
  PERFORM packs.check_key(p_key);
  EXECUTE format('GRANT USAGE ON SCHEMA notify TO %I', r);
  EXECUTE format('GRANT EXECUTE ON FUNCTION notify.enqueue(text, jsonb) TO %I', r);
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION packs.grant_notify(text) FROM PUBLIC;
--> statement-breakpoint
-- Thay nguyên hàm của 0003, thêm một dòng `grant_notify` (gói cài sau 0004 tự có cổng).
CREATE OR REPLACE FUNCTION packs.install(p_key text) RETURNS void
  LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  r text := p_key || '_rw';
  fk text := replace(p_key, '_', '-');
  feats text[] := ARRAY[fk || '-read', fk || '-write', fk || '-admin'];
  taken text;
BEGIN
  PERFORM packs.check_key(p_key);
  IF NOT EXISTS (SELECT 1 FROM packs.registry WHERE key = p_key) THEN
    SELECT string_agg(key, ', ' ORDER BY key) INTO taken FROM admin.features WHERE key = ANY (feats);
    IF taken IS NOT NULL THEN
      RAISE EXCEPTION 'packs.install(%): feature đã tồn tại và không thuộc gói: %', p_key, taken
        USING ERRCODE = 'unique_violation';
    END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
    EXECUTE format('CREATE ROLE %I NOLOGIN NOINHERIT NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION', r);
  END IF;
  EXECUTE format('ALTER ROLE %I NOLOGIN NOINHERIT NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION', r);
  EXECUTE format('CREATE SCHEMA IF NOT EXISTS %I', p_key);
  EXECUTE format('REVOKE ALL ON SCHEMA %I FROM PUBLIC', p_key);
  EXECUTE format('GRANT USAGE ON SCHEMA %I TO %I', p_key, r);
  -- D-06: hub_api chỉ thấy bảng gói trong tx đã SET ROLE <k>_rw; không GRANT gì trên hub/admin cho <k>_rw (trừ cổng notify).
  EXECUTE format('GRANT %I TO hub_api WITH INHERIT FALSE, SET TRUE', r);
  PERFORM packs.create_kit_tables(p_key);
  PERFORM packs.grant_notify(p_key);
  INSERT INTO admin.features (key, name, status)
    SELECT fk || '-' || a, jsonb_build_object('vi', p_key || '.' || a, 'en', p_key || '.' || a), 'on'
    FROM unnest(ARRAY['read', 'write', 'admin']) AS a
  ON CONFLICT (key) DO NOTHING; -- chỉ còn xảy ra khi cài lại (gói đã sở hữu feature)
  INSERT INTO packs.registry (key) VALUES (p_key) ON CONFLICT (key) DO NOTHING;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION packs.install(text) FROM PUBLIC;
--> statement-breakpoint
-- Gói đã cài trước 0004 (chạy lại = vô hại).
DO $$
DECLARE k text;
BEGIN
  FOR k IN SELECT key FROM packs.registry LOOP
    PERFORM packs.grant_notify(k);
  END LOOP;
END
$$;
--> statement-breakpoint
-- Khoá "notify" thành tên schema có sẵn: cấm làm khoá gói (cùng danh sách RESERVED_PACK_KEYS của @ai/contracts).
CREATE OR REPLACE FUNCTION packs.check_key(p_key text) RETURNS void
  LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF p_key IS NULL OR p_key !~ '^[a-z][a-z0-9_]{1,20}$' OR left(p_key, 3) = 'pg_'
     OR p_key = ANY (ARRAY['public', 'admin', 'hub', 'drizzle', 'packs', 'notify', 'information_schema']) THEN
    RAISE EXCEPTION 'packs: khoá gói không hợp lệ: %', p_key USING ERRCODE = '22023';
  END IF;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION packs.check_key(text) FROM PUBLIC;

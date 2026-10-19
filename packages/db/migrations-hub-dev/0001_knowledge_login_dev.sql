-- R1 · role đăng nhập của pool tri thức (`KNOWLEDGE_DATABASE_URL`) ở dev/test, mật khẩu dev (không phải secret). Quyền
-- (`GRANT knowledge_rw … SET TRUE`, không gì khác) do `migrations-pack-knowledge/0004` cấp. Không chạy ở production.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'knowledge_api') THEN
    CREATE ROLE knowledge_api NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
ALTER ROLE knowledge_api WITH LOGIN PASSWORD 'knowledge_api_dev_pw';

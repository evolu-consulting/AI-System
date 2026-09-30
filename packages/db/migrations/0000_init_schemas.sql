-- ADM-NFR-06 · spec M0 §4.1: schema admin/hub, role admin_rw/hub_ro (idempotent), quyền mặc định. Không tạo bảng.
CREATE SCHEMA IF NOT EXISTS admin;
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS hub;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'admin_rw') THEN
    CREATE ROLE admin_rw NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hub_ro') THEN
    CREATE ROLE hub_ro NOLOGIN;
  END IF;
END
$$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA admin TO admin_rw;
--> statement-breakpoint
GRANT USAGE ON SCHEMA hub TO admin_rw;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA admin GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO admin_rw;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA admin GRANT USAGE, SELECT ON SEQUENCES TO admin_rw;
--> statement-breakpoint
GRANT USAGE ON SCHEMA admin TO hub_ro;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA admin GRANT SELECT ON TABLES TO hub_ro;

CREATE TABLE "admin"."user_backup_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"code_hash" "bytea" NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_backup_codes_user_hash_uq" UNIQUE("user_id","code_hash"),
	CONSTRAINT "user_backup_codes_hash_len_check" CHECK (octet_length("admin"."user_backup_codes"."code_hash") = 32)
);
--> statement-breakpoint
CREATE TABLE "admin"."user_totp" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"secret_ct" "bytea" NOT NULL,
	"secret_iv" "bytea" NOT NULL,
	"key_version" smallint DEFAULT 1 NOT NULL,
	"enabled_at" timestamp with time zone,
	"pending_expires_at" timestamp with time zone,
	"last_used_step" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_totp_tenant_user_uq" UNIQUE("tenant_id","user_id"),
	CONSTRAINT "user_totp_secret_ct_len_check" CHECK (octet_length("admin"."user_totp"."secret_ct") = 36),
	CONSTRAINT "user_totp_secret_iv_len_check" CHECK (octet_length("admin"."user_totp"."secret_iv") = 12),
	CONSTRAINT "user_totp_key_version_check" CHECK ("admin"."user_totp"."key_version" >= 1),
	CONSTRAINT "user_totp_pending_check" CHECK (("admin"."user_totp"."enabled_at" IS NULL) = ("admin"."user_totp"."pending_expires_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "admin"."user_backup_codes" ADD CONSTRAINT "user_backup_codes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "admin"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin"."user_backup_codes" ADD CONSTRAINT "user_backup_codes_totp_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "admin"."user_totp"("tenant_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin"."user_totp" ADD CONSTRAINT "user_totp_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "admin"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin"."user_totp" ADD CONSTRAINT "user_totp_user_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "admin"."users"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_backup_codes_unused_idx" ON "admin"."user_backup_codes" USING btree ("user_id") WHERE "admin"."user_backup_codes"."used_at" IS NULL;--> statement-breakpoint
-- ADM-FR-08, ADM-BR-04, ADM-BR-09, M4-R10 · phần nối tay (plan-cd §5, D1): RLS theo tenant, không policy hub_ro,
-- thu hồi SELECT mặc định của hub_ro (0000) — secret TOTP và hash mã dự phòng không có đường đọc từ Hub.
ALTER TABLE admin.user_totp ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE admin.user_backup_codes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY user_totp_admin_rw ON admin.user_totp FOR ALL TO admin_rw
  USING (current_setting('app.scope', true) = 'platform'
         OR (current_setting('app.scope', true) = 'tenant'
             AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid))
  WITH CHECK (current_setting('app.scope', true) = 'platform'
         OR (current_setting('app.scope', true) = 'tenant'
             AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid));
--> statement-breakpoint
CREATE POLICY user_backup_codes_admin_rw ON admin.user_backup_codes FOR ALL TO admin_rw
  USING (current_setting('app.scope', true) = 'platform'
         OR (current_setting('app.scope', true) = 'tenant'
             AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid))
  WITH CHECK (current_setting('app.scope', true) = 'platform'
         OR (current_setting('app.scope', true) = 'tenant'
             AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid));
--> statement-breakpoint
REVOKE ALL ON admin.user_totp FROM hub_ro;
--> statement-breakpoint
REVOKE ALL ON admin.user_backup_codes FROM hub_ro;

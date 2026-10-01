-- ADM-NFR-06 · spec M1 §4: 4 bảng admin (drizzle-kit sinh). Schema admin đã tạo ở 0000 nên thêm IF NOT EXISTS.
CREATE SCHEMA IF NOT EXISTS "admin";
--> statement-breakpoint
CREATE TABLE "admin"."features" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" jsonb NOT NULL,
	"description" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"icon" text,
	"status" text DEFAULT 'on' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "features_key_check" CHECK ("admin"."features"."key" ~ '^[a-z0-9-]{2,32}$'),
	CONSTRAINT "features_status_check" CHECK ("admin"."features"."status" IN ('on', 'off', 'beta')),
	CONSTRAINT "features_version_check" CHECK ("admin"."features"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "admin"."refresh_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"family_id" uuid NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"client" text NOT NULL,
	"user_agent" text,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text,
	"replaced_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refresh_tokens_hash_len_check" CHECK (octet_length("admin"."refresh_tokens"."token_hash") = 32),
	CONSTRAINT "refresh_tokens_client_check" CHECK ("admin"."refresh_tokens"."client" IN ('web', 'extension')),
	CONSTRAINT "refresh_tokens_revoked_reason_check" CHECK ("admin"."refresh_tokens"."revoked_reason" IN ('rotated', 'reuse', 'logout', 'logout_all', 'user_locked', 'tenant_locked', 'password_changed', 'password_reset')),
	CONSTRAINT "refresh_tokens_revoked_pair_check" CHECK (("admin"."refresh_tokens"."revoked_at" IS NULL) = ("admin"."refresh_tokens"."revoked_reason" IS NULL)),
	CONSTRAINT "refresh_tokens_user_agent_check" CHECK (char_length("admin"."refresh_tokens"."user_agent") <= 512)
);
--> statement-breakpoint
CREATE TABLE "admin"."tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"max_concurrent_sub" integer,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_key_check" CHECK ("admin"."tenants"."key" ~ '^[a-z0-9-]{2,32}$'),
	CONSTRAINT "tenants_name_check" CHECK (char_length("admin"."tenants"."name") BETWEEN 1 AND 128),
	CONSTRAINT "tenants_max_concurrent_sub_check" CHECK ("admin"."tenants"."max_concurrent_sub" IS NULL OR "admin"."tenants"."max_concurrent_sub" BETWEEN 1 AND 10000),
	CONSTRAINT "tenants_version_check" CHECK ("admin"."tenants"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "admin"."users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"username" text NOT NULL,
	"email" text,
	"password_hash" text NOT NULL,
	"display_name" text NOT NULL,
	"role" text NOT NULL,
	"locale" text DEFAULT 'vi' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"locked_by_tenant" boolean DEFAULT false NOT NULL,
	"must_change_password" boolean DEFAULT true NOT NULL,
	"failed_logins" smallint DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"password_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_username_check" CHECK ("admin"."users"."username" ~ '^[a-z0-9._-]{2,32}$'),
	CONSTRAINT "users_email_check" CHECK (char_length("admin"."users"."email") <= 254),
	CONSTRAINT "users_display_name_check" CHECK (char_length("admin"."users"."display_name") BETWEEN 1 AND 64),
	CONSTRAINT "users_role_check" CHECK ("admin"."users"."role" IN ('platform_admin', 'tenant_admin', 'member')),
	CONSTRAINT "users_tenant_admin_email_check" CHECK ("admin"."users"."role" <> 'tenant_admin' OR "admin"."users"."email" IS NOT NULL),
	CONSTRAINT "users_locale_check" CHECK ("admin"."users"."locale" IN ('vi', 'en')),
	CONSTRAINT "users_failed_logins_check" CHECK ("admin"."users"."failed_logins" >= 0),
	CONSTRAINT "users_version_check" CHECK ("admin"."users"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "admin"."refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "admin"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin"."refresh_tokens" ADD CONSTRAINT "refresh_tokens_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "admin"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin"."users" ADD CONSTRAINT "users_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "admin"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "features_key_uq" ON "admin"."features" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "refresh_tokens_hash_uq" ON "admin"."refresh_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "refresh_tokens_user_active_idx" ON "admin"."refresh_tokens" USING btree ("user_id") WHERE "admin"."refresh_tokens"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "refresh_tokens_tenant_active_idx" ON "admin"."refresh_tokens" USING btree ("tenant_id") WHERE "admin"."refresh_tokens"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "refresh_tokens_family_idx" ON "admin"."refresh_tokens" USING btree ("family_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tenants_key_uq" ON "admin"."tenants" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "users_tenant_username_uq" ON "admin"."users" USING btree ("tenant_id","username");--> statement-breakpoint
CREATE UNIQUE INDEX "users_tenant_email_uq" ON "admin"."users" USING btree ("tenant_id",lower("email")) WHERE "admin"."users"."email" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "users_tenant_role_active_idx" ON "admin"."users" USING btree ("tenant_id","role") WHERE "admin"."users"."active";--> statement-breakpoint
CREATE INDEX "users_username_idx" ON "admin"."users" USING btree ("username","id");
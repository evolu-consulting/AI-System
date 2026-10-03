CREATE TABLE "admin"."audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "admin"."audit_log_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"tenant_id" uuid,
	"actor_id" uuid,
	"actor_username" text,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" uuid,
	"entity_name" text DEFAULT '' NOT NULL,
	"config_version" integer,
	"entity_version" integer,
	"before" jsonb,
	"after" jsonb,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"snapshot" boolean DEFAULT false NOT NULL,
	CONSTRAINT "audit_log_seq_uq" UNIQUE("seq"),
	CONSTRAINT "audit_log_action_check" CHECK ("admin"."audit_log"."action" IN ('create', 'update', 'delete', 'lock', 'unlock', 'grant', 'revoke', 'restore', 'import')),
	CONSTRAINT "audit_log_entity_check" CHECK ("admin"."audit_log"."entity" IN ('tenant', 'user', 'user_totp', 'group', 'grant', 'entitlement', 'feature', 'workflow', 'command', 'secret', 'quota', 'config')),
	CONSTRAINT "audit_log_entity_name_check" CHECK (char_length("admin"."audit_log"."entity_name") <= 200)
);
--> statement-breakpoint
CREATE TABLE "admin"."quota_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"feature_id" uuid,
	"level" smallint NOT NULL,
	"month" date NOT NULL,
	"pct" smallint NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"claimed_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quota_alerts_once_uq" UNIQUE NULLS NOT DISTINCT("tenant_id","feature_id","level","month"),
	CONSTRAINT "quota_alerts_level_check" CHECK ("admin"."quota_alerts"."level" IN (80, 100)),
	CONSTRAINT "quota_alerts_pct_check" CHECK ("admin"."quota_alerts"."pct" >= 0),
	CONSTRAINT "quota_alerts_status_check" CHECK ("admin"."quota_alerts"."status" IN ('pending', 'sending', 'sent', 'skipped', 'failed')),
	CONSTRAINT "quota_alerts_attempts_check" CHECK ("admin"."quota_alerts"."attempts" >= 0),
	CONSTRAINT "quota_alerts_last_error_check" CHECK (char_length("admin"."quota_alerts"."last_error") <= 200)
);
--> statement-breakpoint
CREATE TABLE "admin"."tenant_quotas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"feature_id" uuid,
	"period" text DEFAULT 'month' NOT NULL,
	"max_runs" integer,
	"max_tokens" bigint,
	"max_usd" numeric(12, 2),
	"warn_pct" smallint DEFAULT 80 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "tenant_quotas_scope_uq" UNIQUE NULLS NOT DISTINCT("tenant_id","feature_id"),
	CONSTRAINT "tenant_quotas_period_check" CHECK ("admin"."tenant_quotas"."period" = 'month'),
	CONSTRAINT "tenant_quotas_max_runs_check" CHECK ("admin"."tenant_quotas"."max_runs" > 0),
	CONSTRAINT "tenant_quotas_max_tokens_check" CHECK ("admin"."tenant_quotas"."max_tokens" > 0),
	CONSTRAINT "tenant_quotas_max_usd_check" CHECK ("admin"."tenant_quotas"."max_usd" > 0),
	CONSTRAINT "tenant_quotas_warn_pct_check" CHECK ("admin"."tenant_quotas"."warn_pct" = 80),
	CONSTRAINT "tenant_quotas_limit_check" CHECK (num_nonnulls("admin"."tenant_quotas"."max_runs", "admin"."tenant_quotas"."max_tokens", "admin"."tenant_quotas"."max_usd") >= 1)
);
--> statement-breakpoint
ALTER TABLE "admin"."tenants" ADD COLUMN "updated_by" uuid;--> statement-breakpoint
ALTER TABLE "admin"."users" ADD COLUMN "updated_by" uuid;--> statement-breakpoint
ALTER TABLE "admin"."quota_alerts" ADD CONSTRAINT "quota_alerts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "admin"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin"."quota_alerts" ADD CONSTRAINT "quota_alerts_feature_id_features_id_fk" FOREIGN KEY ("feature_id") REFERENCES "admin"."features"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin"."tenant_quotas" ADD CONSTRAINT "tenant_quotas_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "admin"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin"."tenant_quotas" ADD CONSTRAINT "tenant_quotas_feature_id_features_id_fk" FOREIGN KEY ("feature_id") REFERENCES "admin"."features"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin"."tenant_quotas" ADD CONSTRAINT "tenant_quotas_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "admin"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_tenant_seq_idx" ON "admin"."audit_log" USING btree ("tenant_id","seq" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_log_entity_seq_idx" ON "admin"."audit_log" USING btree ("entity","entity_id","seq" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_log_actor_seq_idx" ON "admin"."audit_log" USING btree ("actor_id","seq" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "quota_alerts_queue_idx" ON "admin"."quota_alerts" USING btree ("status","claimed_at") WHERE "admin"."quota_alerts"."status" IN ('pending', 'sending');--> statement-breakpoint
ALTER TABLE "admin"."tenants" ADD CONSTRAINT "tenants_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "admin"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin"."users" ADD CONSTRAINT "users_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "admin"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- ADM-FR-40, ADM-FR-41, ADM-FR-51, ADM-NFR-07 · phần nối tay (plan M4 §3.4): RLS, quyền, append-only audit_log.
ALTER TABLE admin.tenant_quotas ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE admin.quota_alerts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE admin.audit_log ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_quotas_admin_rw ON admin.tenant_quotas FOR ALL TO admin_rw
  USING (current_setting('app.scope', true) = 'platform'
         OR (current_setting('app.scope', true) = 'tenant'
             AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid))
  WITH CHECK (current_setting('app.scope', true) = 'platform'
         OR (current_setting('app.scope', true) = 'tenant'
             AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid));
--> statement-breakpoint
CREATE POLICY tenant_quotas_hub_ro ON admin.tenant_quotas FOR SELECT TO hub_ro USING (true);
--> statement-breakpoint
CREATE POLICY quota_alerts_admin_rw ON admin.quota_alerts FOR ALL TO admin_rw
  USING (current_setting('app.scope', true) = 'platform'
         OR (current_setting('app.scope', true) = 'tenant'
             AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid))
  WITH CHECK (current_setting('app.scope', true) = 'platform'
         OR (current_setting('app.scope', true) = 'tenant'
             AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid));
--> statement-breakpoint
REVOKE ALL ON admin.quota_alerts FROM hub_ro;
--> statement-breakpoint
-- audit_log: hàng tenant_id NULL (toàn hệ thống) chỉ platform thấy/ghi; không có policy UPDATE/DELETE.
CREATE POLICY audit_log_select ON admin.audit_log FOR SELECT TO admin_rw
  USING (current_setting('app.scope', true) = 'platform'
         OR (current_setting('app.scope', true) = 'tenant'
             AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid));
--> statement-breakpoint
CREATE POLICY audit_log_insert ON admin.audit_log FOR INSERT TO admin_rw
  WITH CHECK (current_setting('app.scope', true) = 'platform'
         OR (current_setting('app.scope', true) = 'tenant'
             AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid));
--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON admin.audit_log FROM admin_rw;
--> statement-breakpoint
REVOKE ALL ON admin.audit_log FROM hub_ro;
--> statement-breakpoint
-- Append-only cả với owner (M4-R11): trigger chặn UPDATE/DELETE theo hàng và TRUNCATE theo câu → P0001.
CREATE FUNCTION admin.audit_log_append_only() RETURNS trigger
  LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'admin.audit_log is append-only (%)', TG_OP;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION admin.audit_log_append_only() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON admin.audit_log
  FOR EACH ROW EXECUTE FUNCTION admin.audit_log_append_only();
--> statement-breakpoint
CREATE TRIGGER audit_log_append_only_truncate BEFORE TRUNCATE ON admin.audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION admin.audit_log_append_only();

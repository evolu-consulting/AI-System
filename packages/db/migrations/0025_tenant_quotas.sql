-- tenant-quotas · docs/specs/tenant-quotas/tasks.md: hạn mức NGÀY theo công ty (lượt tải HĐ, lượt thao tác AI gói contracts,
-- token AI). Cột null = dùng env của hub-api. `ai_tokens_reset_at` = lúc platform_admin "Đặt lại hôm nay" token AI (hub đếm
-- token từ max(00:00 UTC, mốc này)). Ghi qua admin-api `configWrite` (bump config_version ⇒ hub nạp lại cache tenant).
-- Tên bảng `tenant_daily_limits` vì `admin.tenant_quotas` (quota tháng, 0007) đã có.
CREATE TABLE "admin"."tenant_daily_limits" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"uploads_day" integer,
	"actions_day" integer,
	"ai_tokens_day" bigint,
	"ai_tokens_reset_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "tenant_daily_limits_uploads_day_check" CHECK ("uploads_day" IS NULL OR "uploads_day" BETWEEN 1 AND 1000000),
	CONSTRAINT "tenant_daily_limits_actions_day_check" CHECK ("actions_day" IS NULL OR "actions_day" BETWEEN 1 AND 1000000),
	CONSTRAINT "tenant_daily_limits_ai_tokens_day_check" CHECK ("ai_tokens_day" IS NULL OR "ai_tokens_day" BETWEEN 1 AND 1000000000000)
);
--> statement-breakpoint
ALTER TABLE "admin"."tenant_daily_limits" ADD CONSTRAINT "tenant_daily_limits_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "admin"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin"."tenant_daily_limits" ADD CONSTRAINT "tenant_daily_limits_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "admin"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- RLS viết tay như 0012 `tenant_workflow_tools`: admin_rw theo scope/tenant; hub_ro chỉ SELECT (cache cấu hình đọc mọi tenant).
ALTER TABLE admin.tenant_daily_limits ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_daily_limits_admin_rw ON admin.tenant_daily_limits FOR ALL TO admin_rw
  USING (current_setting('app.scope', true) = 'platform'
         OR (current_setting('app.scope', true) = 'tenant'
             AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid))
  WITH CHECK (current_setting('app.scope', true) = 'platform'
         OR (current_setting('app.scope', true) = 'tenant'
             AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY tenant_daily_limits_hub_ro ON admin.tenant_daily_limits FOR SELECT TO hub_ro USING (true);

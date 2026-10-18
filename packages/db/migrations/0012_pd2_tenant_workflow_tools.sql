CREATE TABLE "admin"."tenant_workflow_tools" (
	"workflow_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"granted_by" uuid,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "tenant_workflow_tools_pkey" PRIMARY KEY("workflow_id","tenant_id")
);
--> statement-breakpoint
ALTER TABLE "admin"."tenant_workflow_tools" ADD CONSTRAINT "tenant_workflow_tools_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "admin"."workflows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin"."tenant_workflow_tools" ADD CONSTRAINT "tenant_workflow_tools_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "admin"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin"."tenant_workflow_tools" ADD CONSTRAINT "tenant_workflow_tools_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "admin"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tenant_workflow_tools_tenant_active_idx" ON "admin"."tenant_workflow_tools" USING btree ("tenant_id","workflow_id") WHERE "admin"."tenant_workflow_tools"."revoked_at" IS NULL;--> statement-breakpoint
-- ADM-FR-73 · TT-R02 (plan-db §4) · RLS viết tay như 0004 `feature_entitlements`: admin_rw theo scope/tenant;
-- hub_ro chỉ SELECT (GRANT mặc định 0000) — Hub lọc tenant_id tường minh (TT-R08). Không quyền ghi cho Hub.
ALTER TABLE admin.tenant_workflow_tools ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_workflow_tools_admin_rw ON admin.tenant_workflow_tools FOR ALL TO admin_rw
  USING (current_setting('app.scope', true) = 'platform'
         OR (current_setting('app.scope', true) = 'tenant'
             AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid))
  WITH CHECK (current_setting('app.scope', true) = 'platform'
         OR (current_setting('app.scope', true) = 'tenant'
             AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY tenant_workflow_tools_hub_ro ON admin.tenant_workflow_tools FOR SELECT TO hub_ro USING (true);
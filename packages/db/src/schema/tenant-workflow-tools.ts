// ADM-FR-73 · bảng `admin.tenant_workflow_tools` (tách khỏi schema/admin.ts để giữ file ≤ 400 dòng — CR-102a thêm cột users).
import { sql } from "drizzle-orm";
import { index, primaryKey, timestamp, uuid } from "drizzle-orm/pg-core";
import { admin, tenants, users, workflows } from "./admin";

const tsz = (name: string) => timestamp(name, { withTimezone: true });

/** ADM-FR-73 · TT-R01 công tắc tool theo tenant: bật ⇔ hàng `revoked_at IS NULL` (mẫu `feature_entitlements`). */
export const tenantWorkflowTools = admin.table(
  "tenant_workflow_tools",
  {
    workflowId: uuid("workflow_id")
      .notNull()
      .references(() => workflows.id, { onDelete: "cascade" }),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    grantedBy: uuid("granted_by").references(() => users.id, { onDelete: "set null" }),
    grantedAt: tsz("granted_at").notNull().defaultNow(),
    revokedAt: tsz("revoked_at"),
  },
  (t) => [
    primaryKey({ name: "tenant_workflow_tools_pkey", columns: [t.workflowId, t.tenantId] }),
    index("tenant_workflow_tools_tenant_active_idx")
      .on(t.tenantId, t.workflowId)
      .where(sql`${t.revokedAt} IS NULL`),
  ],
);

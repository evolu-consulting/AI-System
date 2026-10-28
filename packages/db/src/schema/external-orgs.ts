// CR-102a · ADM-FR-74 · bảng `admin.external_orgs` (migration custom 0028; RLS/CHECK/unique/FK ở SQL).
import { boolean, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { admin } from "./admin";

const tsz = (name: string) => timestamp(name, { withTimezone: true });

/**
 * CR-102a · ADM-FR-74 (0028): công ty đối tác trong tenant chủ quản. User ngoài trỏ về đây bằng FK kép
 * (tenant_id, external_org_id). Không xoá cứng (FK restrict); vô hiệu = `active=false`. RLS + CHECK + unique tên ở SQL 0028.
 */
export const externalOrgs = admin.table("external_orgs", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  name: text("name").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: tsz("created_at").notNull().defaultNow(),
  createdBy: uuid("created_by"),
  updatedAt: tsz("updated_at").notNull().defaultNow(),
});

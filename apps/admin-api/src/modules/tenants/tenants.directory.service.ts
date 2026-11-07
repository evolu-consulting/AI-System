// CR-124 · q2 · FLOW4-FR-03/04 · danh bạ công ty (spec §4): bật/tắt "cho phép tìm thấy" (chỉ quản trị CHÍNH công ty đó),
// dấu "Đã xác minh" (chỉ quản trị nền tảng; DB cũng chặn bằng hàm DEFINER), tìm danh bạ (hàm `admin.directory_search`).
// Ghi qua configWrite + audit như mọi cấu hình công ty; audit chỉ tên trường, không giá trị hồ sơ.
import type { DirectoryEntry, TenantCompanyProfile } from "@ai/contracts/tenants";
import { type DbScope, type Tx, withScope } from "@ai/db";
import { sql } from "drizzle-orm";
import { configWrite } from "../../lib/config/config-write";
import { appError, tenantProfileError } from "../../lib/errors";
import * as repo from "./tenants.profile.repo";
import { type ProfileActor, profileView } from "./tenants.profile.service";
import * as tenantsRepo from "./tenants.repo";
import {
  mustFind,
  type TenantsCall,
  type TenantsCtx,
  tenantAudit,
  toTenant,
} from "./tenants.service";

type Call = TenantsCall & { actor: ProfileActor };

/** Bật/tắt: CHỈ tenant_admin của chính công ty (đồng ý của công ty; platform_admin không bật hộ). Bật cần tên pháp lý + MST. */
export async function setDirectoryListed(
  c: Call,
  id: string,
  listed: boolean,
): Promise<TenantCompanyProfile> {
  if (c.actor.role !== "tenant_admin") throw appError("FORBIDDEN");
  if (c.actor.tenantId !== id) throw appError("NOT_FOUND");
  return configWrite(c, "tenant.save", async (tx, ch) => {
    const cur = await mustFind(tx, id, true);
    const p = await repo.readProfileRow(tx, id);
    if (!p) throw appError("NOT_FOUND");
    if (p.directoryListed === listed) return profileView(tx, id);
    if (listed && (!p.legalName || !p.taxCode)) {
      throw tenantProfileError("DIRECTORY_NEEDS_PROFILE", { fields: ["legal_name", "tax_code"] });
    }
    await repo.setDirectoryListed(tx, id, listed, c.actor.userId);
    ch.changed({ entity: "tenant", tenantId: id });
    const after = toTenant((await tenantsRepo.findTenant(tx, id)) ?? cur);
    ch.audit(tenantAudit("update", toTenant(cur), after, { directory_listed: listed }));
    return profileView(tx, id);
  });
}

/** Đặt/xoá "Đã xác minh": chỉ platform_admin (route + service + hàm DB đều kiểm). */
export async function setDirectoryVerified(
  c: Call,
  id: string,
  verified: boolean,
): Promise<TenantCompanyProfile> {
  if (c.actor.role !== "platform_admin") throw appError("FORBIDDEN");
  return configWrite(c, "tenant.save", async (tx, ch) => {
    const cur = await mustFind(tx, id, true);
    const changed = await repo.setDirectoryVerified(tx, id, verified, c.actor.userId);
    if (changed) {
      ch.changed({ entity: "tenant", tenantId: id });
      const after = toTenant((await tenantsRepo.findTenant(tx, id)) ?? cur);
      ch.audit(tenantAudit("update", toTenant(cur), after, { directory_verified: verified }));
    }
    return profileView(tx, id);
  });
}

type Row = Record<string, unknown>;

/** Tìm danh bạ: MỘT câu SQL (hàm chỉ đọc, ≤ 20 dòng, loại công ty của người gọi, chỉ công ty đã bật). */
export async function searchDirectory(
  ctx: TenantsCtx,
  scope: DbScope,
  q: string,
): Promise<DirectoryEntry[]> {
  return withScope(ctx.db, scope, async (tx: Tx) => {
    const rows = (await tx.execute(
      sql`select tenant_id, legal_name, tax_code, address, verified from admin.directory_search(${q})`,
    )) as unknown as Row[];
    return rows.map((r) => ({
      tenant_id: String(r.tenant_id),
      legal_name: String(r.legal_name),
      tax_code: (r.tax_code as string | null) ?? null,
      address: (r.address as string | null) ?? null,
      verified: r.verified === true,
    }));
  });
}

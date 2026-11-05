// CR-121 · hồ sơ công ty nhập tay: GET (2 câu SQL) + PATCH theo `version` (khoá hàng, kiểm CEO/Giám đốc là thành viên,
// audit + bump như PATCH tenant). Quyền ở routes: GET platform_admin/tenant_admin công ty mình; PATCH chỉ platform_admin.
import type {
  TenantCompanyProfile,
  TenantDepartment,
  TenantPerson,
  TenantProfileUpdateRequest,
} from "@ai/contracts";
import { type DbScope, type Tx, withScope } from "@ai/db";
import { configWrite } from "../../lib/config/config-write";
import { appError, tenantProfileError } from "../../lib/errors";
import * as repo from "./tenants.profile.repo";
import * as tenantsRepo from "./tenants.repo";
import {
  changedProfileFields,
  LEADER_FIELDS,
  leaderIdsToCheck,
  type ProfileCols,
  type ProfileField,
} from "./tenants.rules";
import {
  mustFind,
  type TenantsCall,
  type TenantsCtx,
  tenantAudit,
  toTenant,
} from "./tenants.service";

const person = (id: string | null, name: string | null): TenantPerson | null =>
  id && name ? { id, display_name: name } : null;

async function profileView(tx: Tx, id: string): Promise<TenantCompanyProfile> {
  const p = await repo.readProfileRow(tx, id);
  if (!p) throw appError("NOT_FOUND");
  const departments: TenantDepartment[] = (await repo.listDepartments(tx, id)).map((d) => ({
    group_id: d.groupId,
    name: d.name,
    member_count: d.memberCount,
    head: person(d.headId, d.headName),
  }));
  return {
    tenant_id: id,
    version: p.version,
    legal_name: p.legalName,
    tax_code: p.taxCode,
    address: p.address,
    staff_size: p.staffSize,
    contact_name: p.contactName,
    contact_email: p.contactEmail,
    contact_phone: p.contactPhone,
    ceo: person(p.ceoUserId, p.ceoName),
    director: person(p.directorUserId, p.directorName),
    member_count: p.memberCount,
    departments,
  };
}

export async function getTenantProfile(
  ctx: TenantsCtx,
  scope: DbScope,
  id: string,
): Promise<TenantCompanyProfile> {
  return withScope(ctx.db, scope, (tx) => profileView(tx, id));
}

/** PATCH theo `version` (M1-R19): lệch → 409; không trường nào đổi → không tăng version; CEO/Giám đốc ngoài công ty → 422. */
export async function updateTenantProfile(
  c: TenantsCall,
  id: string,
  input: TenantProfileUpdateRequest,
): Promise<TenantCompanyProfile> {
  return configWrite(c, "tenant.save", async (tx, ch) => {
    const cur = await mustFind(tx, id, true);
    if (cur.version !== input.version) {
      const current = toTenant(cur);
      throw appError("VERSION_CONFLICT", { current, updated_at: current.updated_at });
    }
    const before = await repo.readProfileRow(tx, id);
    if (!before) throw appError("NOT_FOUND");
    const { version: _v, ...patch } = input;
    const { set, fields } = changedProfileFields(before as ProfileCols, patch);
    if (fields.length === 0) return profileView(tx, id);
    const ids = leaderIdsToCheck(set);
    if (ids.length > 0 && (await repo.countLeaderMembers(tx, id, ids)) !== ids.length) {
      const bad = LEADER_FIELDS.filter((f) => fields.includes(f as ProfileField));
      throw tenantProfileError("LEADER_NOT_MEMBER", { fields: bad });
    }
    await repo.updateProfileCols(tx, id, set, c.actor.userId);
    ch.changed({ entity: "tenant", tenantId: id });
    const after = toTenant((await tenantsRepo.findTenant(tx, id)) ?? cur);
    // Không đưa giá trị liên hệ (PII) vào audit: chỉ tên trường đã đổi.
    ch.audit(tenantAudit("update", toTenant(cur), after, { profile_fields: fields }));
    return profileView(tx, id);
  });
}

// ADM-FR-60, ADM-FR-61, ADM-FR-51 · nghiệp vụ tenants (plan M1 §5): list, tạo kèm tenant_admin đầu tiên (một
// transaction), xem, sửa theo `version`, khoá/mở khoá. Không biết HTTP; ghi qua configWrite (bump config_version +
// NOTIFY sau commit, M3-R15) kèm audit cùng transaction và `updated_by` = người ghi (plan M4 §4.2, M4-R17).
import { randomBytes } from "node:crypto";
import type {
  Tenant,
  TenantCreateRequest,
  TenantCreateResponse,
  TenantDetail,
  TenantListQuery,
  TenantListResponse,
  TenantUpdateRequest,
} from "@ai/contracts";
import {
  type AuditActionValue,
  type AuditInput,
  type Db,
  type DbScope,
  hashPassword,
  type Tx,
  withScope,
} from "@ai/db";
import { auditOf } from "../../lib/audit/audit.write";
import { type ConfigSink, configWrite } from "../../lib/config/config-write";
import { appError } from "../../lib/errors";
import { uniqueViolation } from "../../lib/pg-errors";
import { afterLock, type TestHooks } from "../../lib/test-hooks";
import { generateTempPassword } from "../auth/auth.rules";
import { revokeTenantSessions } from "../auth/auth.service";
import { createFirstAdmin, setTenantLockFlags, userAudit } from "../users/users.service";
import type { TenantRow } from "./tenants.repo";
import * as repo from "./tenants.repo";
import { changedTenantFields, checkTenantLock, tenantStatus } from "./tenants.rules";

export type TenantsCtx = { db: Db; hooks?: TestHooks };
/** Thao tác ghi: `actor` = người thực hiện (audit, `updated_by`). */
export type TenantsCall = { ctx: TenantsCtx; scope: DbScope; actor: { userId: string } };

export function toTenant(t: TenantRow): Tenant {
  return {
    id: t.id,
    key: t.key,
    name: t.name,
    active: t.active,
    status: tenantStatus(t),
    max_concurrent_sub: t.maxConcurrentSub,
    user_count: t.userCount,
    created_at: t.createdAt.toISOString(),
    updated_at: t.updatedAt.toISOString(),
    version: t.version,
    updated_by: t.updatedBy,
  };
}

/** Hàng audit `tenant` (plan M4 §4.2): tenant_id = chính tenant, snapshot false. */
function tenantAudit(action: AuditActionValue, before: Tenant | null, after: Tenant): AuditInput {
  return auditOf(action, "tenant", {
    entityId: after.id,
    entityName: after.key,
    tenantId: after.id,
    before,
    after,
    entityVersion: after.version,
  });
}

export async function listTenants(
  ctx: TenantsCtx,
  scope: DbScope,
  q: TenantListQuery,
): Promise<TenantListResponse> {
  const { rows, counts } = await withScope(ctx.db, scope, (tx) => repo.listTenants(tx, q));
  return {
    items: rows.map(({ total: _t, ...r }) => toTenant(r)),
    total: rows[0]?.total ?? 0,
    counts,
  };
}

async function mustFind(tx: Tx, id: string, forUpdate = false): Promise<TenantRow> {
  const t = await repo.findTenant(tx, id, { forUpdate });
  if (!t) throw appError("NOT_FOUND");
  return t;
}

/** Đọc lại sau ghi + `ch.audit` (before = bản đã khoá). */
async function rereadAudited(
  tx: Tx,
  ch: ConfigSink,
  action: AuditActionValue,
  cur: TenantRow,
): Promise<Tenant> {
  const after = toTenant(await mustFind(tx, cur.id));
  ch.audit(tenantAudit(action, toTenant(cur), after));
  return after;
}

export async function getTenant(
  ctx: TenantsCtx,
  scope: DbScope,
  id: string,
): Promise<TenantDetail> {
  return withScope(ctx.db, scope, async (tx) => {
    const t = await mustFind(tx, id);
    const s = await repo.tenantStats(tx, id);
    return { ...toTenant(t), stats: { user_count: t.userCount, ...s } };
  });
}

/** FR-60, M1-R18: tenant + tenant_admin đầu tiên trong một transaction; mật khẩu tạm sinh/băm ngoài transaction. */
export async function createTenant(
  c: TenantsCall,
  input: TenantCreateRequest,
): Promise<TenantCreateResponse> {
  const tempPassword = generateTempPassword((n) => randomBytes(n));
  const hash = await hashPassword(tempPassword);
  const by = c.actor.userId;
  return configWrite(c, "tenant.save", async (tx, ch) => {
    const t = { key: input.key, name: input.name, maxConcurrentSub: input.max_concurrent_sub };
    const id = await tx
      .transaction((sp) => repo.insertTenant(sp, { ...t, updatedBy: by }))
      .catch((err) => {
        if (uniqueViolation(err) === "tenants_key_uq") throw appError("KEY_TAKEN");
        throw err;
      });
    const fa = input.first_admin;
    const firstAdmin = await createFirstAdmin(
      tx,
      {
        tenantId: id,
        username: fa.username,
        displayName: fa.display_name,
        email: fa.email,
        locale: fa.locale,
      },
      hash,
      by,
    );
    // Trigger tenants_beta_group đã chèn beta-testers trong câu INSERT tenant (ngoại lệ khoá E3, plan §6).
    ch.changed({ entity: "tenant", tenantId: id });
    await afterLock(c.ctx.hooks, "tenant.save", "rows");
    const tenant = toTenant(await mustFind(tx, id));
    ch.audit(tenantAudit("create", null, tenant));
    ch.audit(userAudit("create", null, firstAdmin));
    return { tenant, first_admin: firstAdmin, temp_password: tempPassword };
  });
}

/** PATCH theo `version` (M1-R19): lệch → 409 {current, updated_at}; không trường nào đổi → không tăng version. */
export async function updateTenant(
  c: TenantsCall,
  id: string,
  input: TenantUpdateRequest,
): Promise<Tenant> {
  return configWrite(c, "tenant.save", async (tx, ch) => {
    const cur = await mustFind(tx, id, true);
    await afterLock(c.ctx.hooks, "tenant.save", "locked");
    if (cur.version !== input.version) {
      const current = toTenant(cur);
      throw appError("VERSION_CONFLICT", { current, updated_at: current.updated_at });
    }
    const set = changedTenantFields(cur, input);
    if (Object.keys(set).length === 0) return toTenant(cur);
    await repo.updateTenant(tx, id, set, c.actor.userId);
    ch.changed({ entity: "tenant", tenantId: id });
    await afterLock(c.ctx.hooks, "tenant.save", "rows");
    return rereadAudited(tx, ch, "update", cur);
  });
}

/** FR-61, M1-R10: khoá → user active bị `locked_by_tenant`, thu hồi mọi refresh token; lặp lại không ghi gì. */
export async function setTenantLocked(
  c: TenantsCall,
  id: string,
  locked: boolean,
): Promise<Tenant> {
  return configWrite(c, "tenant.save", async (tx, ch) => {
    const cur = await mustFind(tx, id, true);
    await afterLock(c.ctx.hooks, "tenant.save", "locked");
    if (locked) {
      const err = checkTenantLock(cur);
      if (err) throw appError(err.code, err.details);
    }
    if (cur.active === !locked) return toTenant(cur);
    await repo.updateTenant(tx, id, { active: !locked }, c.actor.userId);
    await setTenantLockFlags(tx, id, locked, c.actor.userId);
    if (locked) await revokeTenantSessions(tx, id, "tenant_locked");
    ch.changed({ entity: "tenant", tenantId: id });
    await afterLock(c.ctx.hooks, "tenant.save", "rows");
    return rereadAudited(tx, ch, locked ? "lock" : "unlock", cur);
  });
}

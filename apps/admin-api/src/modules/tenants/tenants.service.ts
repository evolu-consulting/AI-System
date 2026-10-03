// ADM-FR-60, ADM-FR-61 · nghiệp vụ tenants (plan M1 §5): list, tạo kèm tenant_admin đầu tiên (một transaction),
// xem, sửa theo `version`, khoá/mở khoá. Không biết HTTP; ghi qua configWrite (bump config_version + NOTIFY sau commit, M3-R15).
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
import { type Db, type DbScope, hashPassword, type Tx, withScope } from "@ai/db";
import { configWrite } from "../../lib/config/config-write";
import { appError } from "../../lib/errors";
import { uniqueViolation } from "../../lib/pg-errors";
import { afterLock, type TestHooks } from "../../lib/test-hooks";
import { generateTempPassword } from "../auth/auth.rules";
import { revokeTenantSessions } from "../auth/auth.service";
import { createFirstAdmin, setTenantLockFlags } from "../users/users.service";
import type { TenantRow } from "./tenants.repo";
import * as repo from "./tenants.repo";
import { changedTenantFields, checkTenantLock, tenantStatus } from "./tenants.rules";

export type TenantsCtx = { db: Db; hooks?: TestHooks };

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
    updated_by: null, // T1b điền username người ghi gần nhất (M4-R17)
  };
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
  ctx: TenantsCtx,
  scope: DbScope,
  input: TenantCreateRequest,
): Promise<TenantCreateResponse> {
  const tempPassword = generateTempPassword((n) => randomBytes(n));
  const hash = await hashPassword(tempPassword);
  return configWrite({ ctx, scope }, "tenant.save", async (tx, ch) => {
    const t = { key: input.key, name: input.name, maxConcurrentSub: input.max_concurrent_sub };
    const id = await tx
      .transaction((sp) => repo.insertTenant(sp, t))
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
    );
    // Trigger tenants_beta_group đã chèn beta-testers trong câu INSERT tenant (ngoại lệ khoá E3, plan §6).
    ch.changed({ entity: "tenant", tenantId: id });
    await afterLock(ctx.hooks, "tenant.save", "rows");
    return {
      tenant: toTenant(await mustFind(tx, id)),
      first_admin: firstAdmin,
      temp_password: tempPassword,
    };
  });
}

/** PATCH theo `version` (M1-R19): lệch → 409 {current, updated_at}; không trường nào đổi → không tăng version. */
export async function updateTenant(
  ctx: TenantsCtx,
  scope: DbScope,
  id: string,
  input: TenantUpdateRequest,
): Promise<Tenant> {
  return configWrite({ ctx, scope }, "tenant.save", async (tx, ch) => {
    const cur = await mustFind(tx, id, true);
    await afterLock(ctx.hooks, "tenant.save", "locked");
    if (cur.version !== input.version) {
      const current = toTenant(cur);
      throw appError("VERSION_CONFLICT", { current, updated_at: current.updated_at });
    }
    const set = changedTenantFields(cur, input);
    if (Object.keys(set).length === 0) return toTenant(cur);
    await repo.updateTenant(tx, id, set);
    ch.changed({ entity: "tenant", tenantId: id });
    await afterLock(ctx.hooks, "tenant.save", "rows");
    return toTenant(await mustFind(tx, id));
  });
}

/** FR-61, M1-R10: khoá → user active bị `locked_by_tenant`, thu hồi mọi refresh token; lặp lại không ghi gì. */
export async function setTenantLocked(
  ctx: TenantsCtx,
  scope: DbScope,
  id: string,
  locked: boolean,
): Promise<Tenant> {
  return configWrite({ ctx, scope }, "tenant.save", async (tx, ch) => {
    const cur = await mustFind(tx, id, true);
    await afterLock(ctx.hooks, "tenant.save", "locked");
    if (locked) {
      const err = checkTenantLock(cur);
      if (err) throw appError(err.code, err.details);
    }
    if (cur.active === !locked) return toTenant(cur);
    await repo.updateTenant(tx, id, { active: !locked });
    await setTenantLockFlags(tx, id, locked);
    if (locked) await revokeTenantSessions(tx, id, "tenant_locked");
    ch.changed({ entity: "tenant", tenantId: id });
    await afterLock(ctx.hooks, "tenant.save", "rows");
    return toTenant(await mustFind(tx, id));
  });
}

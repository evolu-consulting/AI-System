// CR-102a · ADM-FR-75 · nghiệp vụ công ty đối tác + user ngoài (com-c1-ext-identity). Không biết HTTP.
// Quyền: route chỉ cho platform_admin/tenant_admin; tenant_admin luôn tenant mình (resolveTenantScope), tenant khác ⇒ 404.
// Ghi = một `configWrite` (transaction + scope + NOTIFY sau commit); khoá tenant → org → user (cùng thứ tự users.service).
// Audit: thực thể `tenant` + summary `external_org` (AUDIT_ENTITIES khoá 12 giá trị); user ngoài audit như user.
import type {
  ExternalOrg,
  ExternalOrgCreateRequest,
  ExternalOrgListQuery,
  ExternalOrgListResponse,
  ExternalUserCreateRequest,
  User,
  UserCreateResponse,
  UserListQuery,
  UserListResponse,
} from "@ai/contracts";
import { type Tx, withScope } from "@ai/db";
import { auditOf } from "../../lib/audit/audit.write";
import { type ConfigSink, configWrite } from "../../lib/config/config-write";
import { appError, extOrgError } from "../../lib/errors";
import { uniqueViolation } from "../../lib/pg-errors";
import { deactivateOrgUsersTx, listOrgUsers } from "../users/users.external";
import { resolveTenantScope } from "../users/users.rules";
import { type Call, createExternalUser, deactivateExternalUser } from "../users/users.service";
import * as repo from "./external-orgs.repo";

export type { Call };

const iso = (d: Date | string) => new Date(d).toISOString();

export function toOrg(r: repo.OrgRow): ExternalOrg {
  return {
    id: r.id,
    tenant_id: r.tenant_id,
    name: r.name,
    active: r.active,
    user_count: r.user_count,
    active_user_count: r.active_user_count,
    created_at: iso(r.created_at),
    created_by: r.created_by,
    updated_at: iso(r.updated_at),
  };
}

/** tenant_admin: tenant mình; platform: không lọc (RLS scope platform). */
const tenantFilter = (c: Call) => (c.actor.role === "platform_admin" ? null : c.actor.tenantId);

async function mustFindOrg(c: Call, tx: Tx, id: string, lock?: "share" | "no key update") {
  const o = await repo.findOrg(tx, tenantFilter(c), id, lock);
  if (!o) throw appError("NOT_FOUND");
  return o;
}

const mapNameTaken = (err: unknown): never => {
  if (uniqueViolation(err) === "external_orgs_tenant_name_uq") throw appError("NAME_TAKEN");
  throw err;
};

function orgAudit(
  ch: ConfigSink,
  action: "create" | "update",
  before: ExternalOrg | null,
  after: ExternalOrg,
  op: string,
) {
  const summary = {
    external_org: { id: after.id, name: after.name, op, before_name: before?.name ?? null },
  };
  // Bất biến configWrite: có audit ⇔ có sự kiện; Hub nạp lại cấu hình tenant (tên công ty đối tác).
  ch.changed({ entity: "tenant", tenantId: after.tenant_id });
  ch.audit(
    auditOf(action, "tenant", {
      entityId: after.tenant_id,
      entityName: after.name.slice(0, 200),
      tenantId: after.tenant_id,
      before: null,
      after: null,
      summary,
    }),
  );
}

export async function listOrgs(c: Call, q: ExternalOrgListQuery): Promise<ExternalOrgListResponse> {
  const r = resolveTenantScope(c.actor, q.tenant_id, "read");
  if ("code" in r) throw appError(r.code);
  const f = { tenantId: r.tenantId, q: q.q, status: q.status, limit: q.limit, offset: q.offset };
  const rows = await withScope(c.ctx.db, c.scope, (tx) => repo.listOrgs(tx, f));
  return { items: rows.map(toOrg), total: rows[0]?.total ?? 0 };
}

export function getOrg(c: Call, id: string): Promise<ExternalOrg> {
  return withScope(c.ctx.db, c.scope, async (tx) => toOrg(await mustFindOrg(c, tx, id)));
}

export function createOrg(
  c: Call,
  queryTenantId: string | undefined,
  input: ExternalOrgCreateRequest,
): Promise<ExternalOrg> {
  const r = resolveTenantScope(c.actor, queryTenantId, "write");
  if ("code" in r) throw appError(r.code);
  const tenantId = r.tenantId as string;
  return configWrite(c, "user.save", async (tx, ch) => {
    // com-c2 (Thấp-3): tenant `platform` (nhà vận hành) không có đối tác ⇒ không có công ty ⇒ không có user ngoài.
    if (await repo.isPlatformTenant(tx, tenantId)) throw extOrgError("EXTERNAL_USER_NOT_ALLOWED");
    const ins = { tenantId, name: input.name, by: c.actor.userId };
    // Savepoint: 23505 (tên trùng) / 23503 (tenant không có) không làm hỏng transaction ngoài trước khi dịch.
    const id = await tx
      .transaction((sp) => repo.insertOrg(sp, ins))
      .catch((e) => {
        if ((e as { code?: string }).code === "23503") throw appError("NOT_FOUND");
        return mapNameTaken(e);
      });
    const org = toOrg((await repo.findOrg(tx, tenantId, id)) as repo.OrgRow);
    orgAudit(ch, "create", null, org, "create");
    return org;
  });
}

export function renameOrg(c: Call, id: string, input: { name: string }): Promise<ExternalOrg> {
  return configWrite(c, "user.save", async (tx, ch) => {
    const before = toOrg(await mustFindOrg(c, tx, id, "no key update"));
    if (before.name === input.name) return before;
    const t = { tenantId: before.tenant_id, id };
    await tx.transaction((sp) => repo.updateOrg(sp, t, { name: input.name })).catch(mapNameTaken);
    const after = toOrg(await mustFindOrg(c, tx, id));
    orgAudit(ch, "update", before, after, "rename");
    return after;
  });
}

/** Vô hiệu công ty (không hoàn tác ở C1) ⇒ vô hiệu mọi user của công ty + thu hồi phiên, theo tập. Lặp lại ⇒ không ghi. */
export function deactivateOrg(c: Call, id: string): Promise<ExternalOrg> {
  return configWrite(c, "user.save", async (tx, ch) => {
    const before = toOrg(await mustFindOrg(c, tx, id, "no key update"));
    if (!before.active) return before;
    const t = { tenantId: before.tenant_id, id };
    await repo.updateOrg(tx, t, { active: false });
    const by = c.actor.userId;
    const n = await deactivateOrgUsersTx(tx, ch, { tenantId: t.tenantId, orgId: id, by });
    const after = toOrg(await mustFindOrg(c, tx, id));
    orgAudit(ch, "update", before, after, `deactivate:${n}`);
    return after;
  });
}

/**
 * com-c2 · mở lại công ty đã vô hiệu: chỉ công ty (`active=true`). User đã vô hiệu GIỮ vô hiệu (C1: không mở khoá lại) —
 * admin tạo tài khoản mới cho người cần dùng. Lặp lại ⇒ không ghi.
 */
export function reactivateOrg(c: Call, id: string): Promise<ExternalOrg> {
  return configWrite(c, "user.save", async (tx, ch) => {
    const before = toOrg(await mustFindOrg(c, tx, id, "no key update"));
    if (before.active) return before;
    await repo.updateOrg(tx, { tenantId: before.tenant_id, id }, { active: true });
    const after = toOrg(await mustFindOrg(c, tx, id));
    orgAudit(ch, "update", before, after, "reactivate");
    return after;
  });
}

export async function listUsersOfOrg(
  c: Call,
  id: string,
  q: UserListQuery,
): Promise<UserListResponse> {
  const org = await getOrg(c, id);
  return listOrgUsers(c, { id: org.id, tenantId: org.tenant_id }, q);
}

/** User mới của công ty: khoá org FOR SHARE trong transaction tạo (không đua với vô hiệu công ty). */
export async function createOrgUser(
  c: Call,
  id: string,
  input: ExternalUserCreateRequest,
): Promise<UserCreateResponse> {
  const org = await getOrg(c, id);
  const guard = async (tx: Tx) => {
    const locked = await mustFindOrg(c, tx, id, "share");
    if (!locked.active) throw extOrgError("EXTERNAL_ORG_INACTIVE");
  };
  return createExternalUser(c, { id: org.id, tenantId: org.tenant_id }, input, guard);
}

export function deactivateOrgUser(c: Call, id: string, userId: string): Promise<User> {
  return deactivateExternalUser(c, id, userId);
}

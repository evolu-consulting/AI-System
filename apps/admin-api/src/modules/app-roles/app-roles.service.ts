// CR-112 S1 · ADM-FR-80/81/82 · ADM-BR-15/16: nghiệp vụ vai theo app. Vai là nguồn; Group của vai là đơn vị thực thi. Tạo vai
// tuỳ biến = Group mới + vai + grant theo mức (một tx `configWrite`); đổi mức ⇒ biên dịch lại; xoá chỉ vai tuỳ biến. Phân quyền:
// platform_admin mọi tenant; tenant_admin chỉ tenant mình — tenant/vai của công ty khác ⇒ 404 (cùng body "không có").
import type {
  AppRole,
  AppRoleCreateRequest,
  AppRoleListQuery,
  AppRoleListResponse,
  AppRoleUpdateRequest,
} from "@ai/contracts/app-roles";
import { GroupNameSchema } from "@ai/contracts/groups";
import { PACK_ACTIONS, PACK_ROLES, packFeatureKey } from "@ai/contracts/packs";
import {
  type AuditActionValue,
  type AuditInput,
  type ConfigSink,
  type Db,
  type DbScope,
  type Tx,
  withScope,
} from "@ai/db";
import { auditOf } from "../../lib/audit/audit.write";
import { configWrite } from "../../lib/config/config-write";
import { appError, roleError } from "../../lib/errors";
import { uniqueViolation } from "../../lib/pg-errors";
import type { TestHooks } from "../../lib/test-hooks";
import { createGroupIn, tenantFilter } from "../groups/groups.service";
import type { Actor } from "../users/users.rules";
import { grantRoleAgents, recordAgentGrants } from "./app-roles.agents";
import { compileRoles, recordCompile } from "./app-roles.compile";
import * as repo from "./app-roles.repo";
import {
  ceilingOf,
  generatedRoleKey,
  isEffective,
  roleGroupKey,
  roleKeyFits,
} from "./app-roles.rules";

/** Cho importer (module khác không import repo trực tiếp — depcruise `no-cross-module-repo`). */
export { insertDefaultRoles, insertDefaultRolesFor } from "./app-roles.repo";

/** Bật gói: Group vai mặc định đang thuộc vai tuỳ biến ⇒ 409 ROLE_GROUP_CONFLICT (không nhận nhầm Group, không cấp admin). */
export async function assertDefaultGroupsFree(
  tx: Tx,
  tenantId: string,
  pack: string,
): Promise<void> {
  const keys = await repo.customRolesOnDefaultKeys(tx, tenantId, pack);
  if (keys.length > 0) throw roleError("ROLE_GROUP_CONFLICT", { keys });
}

export type Call = { ctx: { db: Db; hooks?: TestHooks }; actor: Actor; scope: DbScope };

const iso = (d: Date | string) => new Date(d).toISOString();

export function toRole(r: repo.RoleListRow): AppRole {
  const ceiling = ceilingOf(r.pack, r.entitled ?? []);
  return {
    id: r.id,
    tenant_id: r.tenant_id,
    pack: r.pack,
    key: r.key,
    name: GroupNameSchema.parse(r.name),
    level: r.level,
    group_id: r.group_id,
    is_default: r.is_default,
    member_count: r.member_count,
    ceiling,
    effective: isEffective(r.level, ceiling),
    version: r.version,
    created_at: iso(r.created_at),
    updated_at: iso(r.updated_at),
  };
}

/**
 * Tenant mục tiêu: platform = `?tenant_id` (thiếu: đọc ⇒ mọi tenant, ghi ⇒ TENANT_REQUIRED); tenant_admin = tenant mình,
 * `?tenant_id` khác ⇒ 404 (không lộ tồn tại).
 */
export function targetTenant(a: Actor, q: string | undefined, op: "read" | "write"): string | null {
  if (a.role !== "platform_admin") {
    if (q !== undefined && q !== a.tenantId) throw appError("NOT_FOUND");
    return a.tenantId;
  }
  if (q) return q;
  if (op === "write") throw appError("TENANT_REQUIRED");
  return null;
}

function roleAudit(
  action: AuditActionValue,
  r: { id: string; tenant_id: string; group_id: string; pack: string; key: string },
  summary: Record<string, unknown>,
): AuditInput {
  return auditOf(action, "group", {
    entityId: r.group_id,
    entityName: roleGroupKey(r.pack, r.key),
    tenantId: r.tenant_id,
    before: null,
    after: null,
    summary: { role_id: r.id, pack: r.pack, key: r.key, ...summary },
  });
}

async function readRole(tx: Tx, c: Call, id: string): Promise<AppRole> {
  const [hit] = await repo.listRoles(tx, { tenantId: tenantFilter(c.actor), pack: null, id });
  if (!hit) throw appError("NOT_FOUND");
  return toRole(hit);
}

export async function listRoles(c: Call, q: AppRoleListQuery): Promise<AppRoleListResponse> {
  const tenantId = targetTenant(c.actor, q.tenant_id, "read");
  return withScope(c.ctx.db, c.scope, async (tx) => {
    if (tenantId !== null && !(await repo.tenantExists(tx, tenantId))) throw appError("NOT_FOUND");
    const rows = await repo.listRoles(tx, { tenantId, pack: q.pack ?? null });
    return { items: rows.map(toRole) };
  });
}

/** Vai tuỳ biến: tenant (404) → gói nghiệp vụ đã cài (422 PACK_NOT_ROLEABLE) → Group mới → vai → grant theo mức. */
export async function createRole(
  c: Call,
  queryTenantId: string | undefined,
  input: AppRoleCreateRequest,
): Promise<AppRole> {
  const tenantId = targetTenant(c.actor, queryTenantId, "write") as string;
  return configWrite(c, "group.save", async (tx, ch) => {
    if (!(await repo.tenantExists(tx, tenantId))) throw appError("NOT_FOUND");
    const codes = PACK_ACTIONS.map((a) => packFeatureKey(input.pack, a));
    if (!(await repo.packRoleable(tx, tenantId, codes))) throw roleError("PACK_NOT_ROLEABLE");
    const key = input.key ?? generatedRoleKey(Bun.randomUUIDv7());
    if ((PACK_ROLES as readonly string[]).includes(key)) throw roleError("ROLE_KEY_RESERVED");
    if (!roleKeyFits(input.pack, key)) throw appError("VALIDATION_ERROR", { field: "key" });
    const group = await createGroupIn({ tx, ch }, c, {
      tenantId,
      input: { key: roleGroupKey(input.pack, key), name: input.name, description: null },
    });
    const row = { tenantId, pack: input.pack, key, name: input.name, level: input.level };
    const id = await repo.insertRole(tx, { ...row, groupId: group.id }).catch((e: unknown) => {
      throw uniqueViolation(e) ? appError("KEY_TAKEN") : e;
    });
    const r = { id, tenant_id: tenantId, group_id: group.id, pack: input.pack, key };
    ch.audit(roleAudit("create", r, { op: "role.create", level: input.level }));
    recordCompile(
      ch,
      tenantId,
      await compileRoles(tx, { tenantId, roleIds: [id], actorId: c.actor.userId }),
    );
    // S6: trợ lý gói như Group vai mặc định cùng mức (nếu Group mặc định có).
    const agents = await grantRoleAgents(tx, { tenantId, roleIds: [id], actorId: c.actor.userId });
    recordAgentGrants(ch, tenantId, agents, () => roleGroupKey(input.pack, key));
    return readRole(tx, c, id);
  });
}

/** Đổi tên (Group đổi theo) và/hoặc mức (biên dịch lại). `version` lệch ⇒ 409 VERSION_CONFLICT. */
export function updateRole(c: Call, id: string, input: AppRoleUpdateRequest): Promise<AppRole> {
  return configWrite(c, "group.save", async (tx, ch) => {
    const cur = await repo.findRole(tx, tenantFilter(c.actor), id, "no key update");
    if (!cur) throw appError("NOT_FOUND");
    if (cur.version !== input.version) {
      const current = await readRole(tx, c, id);
      throw appError("VERSION_CONFLICT", { current, updated_at: current.updated_at });
    }
    if (cur.is_default && input.level !== undefined && input.level !== cur.level)
      throw roleError("DEFAULT_ROLE_PROTECTED");
    const set = {
      name: input.name,
      level: input.level !== undefined && input.level !== cur.level ? input.level : undefined,
    };
    await repo.bumpRole(tx, { id, groupId: cur.group_id, actorId: c.actor.userId }, set);
    ch.changed({ entity: "group", tenantId: cur.tenant_id });
    ch.audit(
      roleAudit("update", cur, { op: "role.update", from: cur.level, to: set.level ?? cur.level }),
    );
    if (set.level !== undefined) await recompileRole({ tx, ch }, cur, c.actor.userId);
    return readRole(tx, c, id);
  });
}

/** Mức đổi ⇒ biên dịch lại grant; vai tuỳ biến nhận thêm agent trợ lý của mức mới (S6). */
async function recompileRole(
  w: { tx: Tx; ch: ConfigSink },
  cur: repo.RoleRow,
  actorId: string,
): Promise<void> {
  const a = { tenantId: cur.tenant_id, roleIds: [cur.id], actorId };
  recordCompile(w.ch, cur.tenant_id, await compileRoles(w.tx, a));
  if (cur.is_default) return;
  recordAgentGrants(w.ch, cur.tenant_id, await grantRoleAgents(w.tx, a), () =>
    roleGroupKey(cur.pack, cur.key),
  );
}

/** Chỉ vai tuỳ biến (mặc định ⇒ 409); xoá Group của vai (cascade vai, thành viên, grant). */
export function deleteRole(c: Call, id: string): Promise<void> {
  return configWrite(c, "group.delete", async (tx, ch) => {
    const cur = await repo.findRole(tx, tenantFilter(c.actor), id, "no key update");
    if (!cur) throw appError("NOT_FOUND");
    if (cur.is_default) throw roleError("DEFAULT_ROLE_PROTECTED");
    // Vai FOR NO KEY UPDATE chặn gán người song song (gán khoá vai FOR SHARE) ⇒ đếm này đúng tới commit.
    const members = await repo.memberCount(tx, cur.group_id);
    if (members > 0) throw roleError("ROLE_HAS_MEMBERS", { member_count: members });
    await repo.deleteRoleGroup(tx, { tenantId: cur.tenant_id, groupId: cur.group_id });
    ch.changed({ entity: "group", tenantId: cur.tenant_id });
    ch.audit(roleAudit("delete", cur, { op: "role.delete", level: cur.level }));
  });
}

// ADM-FR-62, ADM-FR-55, ADM-BR-09 · nghiệp vụ groups (spec M3 §3, M3-R01…R06, R23; plan §5.4). Không biết HTTP.
// Ghi qua `configWrite` (một request = một transaction + bump + NOTIFY sau commit). Khoá: group NKU (PATCH/DELETE), hạng 3.
import {
  BETA_GROUP_KEY,
  GROUP_NAME_MAX,
  type Group,
  type GroupCreateRequest,
  type GroupListItem,
  type GroupListQuery,
  type GroupListResponse,
  type GroupRef,
  type GroupUpdateRequest,
  LocalizedTextSchema,
} from "@ai/contracts";
import {
  type AuditActionValue,
  type AuditInput,
  type Db,
  type DbScope,
  type Tx,
  withScope,
} from "@ai/db";
import { z } from "zod";
import type { InTx, RestoreAt } from "../../lib/audit/audit.write";
import { auditOf } from "../../lib/audit/audit.write";
import { configWrite } from "../../lib/config/config-write";
import { appError } from "../../lib/errors";
import { uniqueViolation } from "../../lib/pg-errors";
import { afterLock, type TestHooks } from "../../lib/test-hooks";
import { type Actor, resolveTenantScope } from "../users/users.rules";
import * as repo from "./groups.repo";
import { changedGroupFields, checkGroupDelete, type GroupState } from "./groups.rules";

export type GroupsCtx = { db: Db; hooks?: TestHooks };
export type Call = { ctx: GroupsCtx; actor: Actor; scope: DbScope };

const NameSchema = LocalizedTextSchema(GROUP_NAME_MAX);
const RefsJson = z.array(z.object({ id: z.string(), key: z.string(), name: NameSchema }));

/** tenant_admin chỉ tenant mình (BR-09); platform không lọc (RLS scope platform vẫn áp). */
export const tenantFilter = (a: Actor): string | null =>
  a.role === "platform_admin" ? null : a.tenantId;

/** jsonb `[{id,key,name}]` → GroupRef[] (validate ở biên đọc DB). */
export function groupRefsOf(raw: unknown): GroupRef[] {
  return RefsJson.parse(raw).map((g) => ({ ...g, is_beta: g.key === BETA_GROUP_KEY }));
}

/** Hàng danh sách: không có `created_at` (contract GroupListItem) nên không cần cột đó. */
export function toGroupListItem(r: Omit<repo.GroupRow, "createdAt">): GroupListItem {
  return {
    id: r.id,
    tenant_id: r.tenantId,
    tenant_key: r.tenantKey,
    tenant_name: r.tenantName,
    key: r.key,
    name: NameSchema.parse(r.name),
    description: r.description,
    is_beta: r.key === BETA_GROUP_KEY,
    member_count: r.memberCount,
    feature_count: r.featureCount,
    agent_count: 0,
    version: r.version,
    updated_at: r.updatedAt.toISOString(),
    updated_by: r.updatedBy,
  };
}

export function toGroup(r: repo.GroupRow): Group {
  return { ...toGroupListItem(r), created_at: r.createdAt.toISOString() };
}

/** Hàng audit `group` (plan M4 §4.2): tenant_id = tenant của group, snapshot true (khôi phục được). */
function groupAudit(
  action: AuditActionValue,
  before: Group | null,
  after: Group | null,
): AuditInput {
  const g = (after ?? before) as Group;
  return auditOf(action, "group", {
    entityId: g.id,
    entityName: g.key,
    tenantId: g.tenant_id,
    before,
    after,
    entityVersion: after?.version ?? null,
    snapshot: true,
  });
}

/** Thêm/bớt thành viên: update · group, before/after null, `summary.added|removed` = username (plan M4 §4.2). */
export function membersAudit(
  g: { id: string; tenantId: string; key: string },
  summary: { added: string[] } | { removed: string[] },
): AuditInput {
  return auditOf("update", "group", {
    entityId: g.id,
    entityName: g.key,
    tenantId: g.tenantId,
    before: null,
    after: null,
    summary,
  });
}

const fail = (e: { code: Parameters<typeof appError>[0]; details?: unknown } | null): void => {
  if (e) throw appError(e.code, e.details);
};

/** Tenant để GHI theo actor + `?tenant_id` (platform thiếu → TENANT_REQUIRED). */
export function writeTenant(actor: Actor, queryTenantId: string | undefined): string {
  const r = resolveTenantScope(actor, queryTenantId, "write");
  if ("code" in r) throw appError(r.code);
  return r.tenantId as string;
}

export async function listGroups(c: Call, q: GroupListQuery): Promise<GroupListResponse> {
  const r = resolveTenantScope(c.actor, q.tenant_id, "read");
  if ("code" in r) throw appError(r.code);
  const f = { tenantId: r.tenantId, q: q.q, limit: q.limit, offset: q.offset };
  const { rows, total } = await withScope(c.ctx.db, c.scope, (tx) => repo.listGroups(tx, f));
  return { items: rows.map(toGroupListItem), total };
}

async function mustFind(tx: Tx, c: Call, id: string): Promise<repo.GroupRow> {
  const g = await repo.findGroup(tx, tenantFilter(c.actor), id);
  if (!g) throw appError("NOT_FOUND");
  return g;
}

export function getGroup(c: Call, id: string): Promise<Group> {
  return withScope(c.ctx.db, c.scope, async (tx) => toGroup(await mustFind(tx, c, id)));
}

/** M3-R01: tenant (404) → insert (23505 → KEY_TAKEN). Không khoá tenant (FK KEY SHARE, không xung đột — E2). */
export function createGroup(
  c: Call,
  queryTenantId: string | undefined,
  input: GroupCreateRequest,
): Promise<Group> {
  const tenantId = writeTenant(c.actor, queryTenantId);
  return configWrite(c, "group.save", (tx, ch) =>
    createGroupIn({ tx, ch }, c, { tenantId, input }),
  );
}

/** Lõi tx của POST; `at` = chèn lại cùng id/version (khôi phục bản đã xoá, plan M4 §4.4). */
export async function createGroupIn(
  w: InTx,
  c: Call,
  req: { tenantId: string; input: GroupCreateRequest },
  at?: RestoreAt,
): Promise<Group> {
  const { tx, ch } = w;
  const { tenantId, input } = req;
  if (!(await repo.tenantExists(tx, tenantId))) throw appError("NOT_FOUND");
  const id = at?.id ?? Bun.randomUUIDv7();
  const row = { id, tenantId, ...input, actorId: c.actor.userId, version: at?.version };
  await tx
    .transaction((sp) => repo.insertGroup(sp, row))
    .catch((err) => {
      if (uniqueViolation(err) === "groups_tenant_key_uq") throw appError("KEY_TAKEN");
      throw err;
    });
  ch.changed({ entity: "group", tenantId });
  await afterLock(c.ctx.hooks, "group.save", "rows");
  const after = toGroup(await mustFind(tx, c, id));
  ch.audit(groupAudit("create", null, after));
  return after;
}

const stateOf = (g: repo.GroupRow): GroupState => ({
  name: NameSchema.parse(g.name),
  description: g.description,
});

/** 404 → version (trên bản đã khoá) → không đổi gì → ghi (version +1). */
export function updateGroup(c: Call, id: string, input: GroupUpdateRequest): Promise<Group> {
  return configWrite(c, "group.save", (tx, ch) => updateGroupIn({ tx, ch }, c, id, input));
}

/** Lõi tx của PATCH (khôi phục dùng lại, plan M4 §4.4). */
export async function updateGroupIn(
  w: InTx,
  c: Call,
  id: string,
  input: GroupUpdateRequest,
): Promise<Group> {
  const { tx, ch } = w;
  const locked = await repo.lockGroup(tx, tenantFilter(c.actor), id, "no key update");
  if (!locked) throw appError("NOT_FOUND");
  await afterLock(c.ctx.hooks, "group.save", "locked");
  const cur = await mustFind(tx, c, id);
  if (cur.version !== input.version) {
    const current = toGroup(cur);
    throw appError("VERSION_CONFLICT", { current, updated_at: current.updated_at });
  }
  const before = stateOf(cur);
  const next: GroupState = {
    name: input.name ?? before.name,
    description: input.description === undefined ? before.description : input.description,
  };
  const changed = changedGroupFields(before, next);
  if (changed.length === 0) return toGroup(cur);
  const set: repo.GroupSet = {};
  for (const k of changed) Object.assign(set, { [k]: next[k] });
  await repo.bumpGroup(tx, locked, set, c.actor.userId);
  ch.changed({ entity: "group", tenantId: locked.tenantId });
  await afterLock(c.ctx.hooks, "group.save", "rows");
  const after = toGroup(await mustFind(tx, c, id));
  ch.audit(groupAudit("update", toGroup(cur), after));
  return after;
}

/** 404 → BETA_GROUP_PROTECTED → xoá (cascade thành viên + grant, M3-R04). */
export function deleteGroup(c: Call, id: string): Promise<void> {
  return configWrite(c, "group.delete", async (tx, ch) => {
    const g = await repo.lockGroup(tx, tenantFilter(c.actor), id, "no key update");
    if (!g) throw appError("NOT_FOUND");
    await afterLock(c.ctx.hooks, "group.delete", "locked");
    fail(checkGroupDelete(g));
    const before = toGroup(await mustFind(tx, c, id));
    await repo.deleteGroup(tx, g);
    ch.changed({ entity: "group", tenantId: g.tenantId });
    ch.audit(groupAudit("delete", before, null));
    await afterLock(c.ctx.hooks, "group.delete", "rows");
  });
}

/** Cho module grants: tenant phải tồn tại (404). Không khoá (E2). */
export async function mustTenant(tx: Tx, tenantId: string): Promise<void> {
  if (!(await repo.tenantExists(tx, tenantId))) throw appError("NOT_FOUND");
}

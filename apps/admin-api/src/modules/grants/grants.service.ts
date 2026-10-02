// ADM-FR-32, ADM-BR-11, ADM-BR-12 · grant feature cho group/user trong phạm vi entitlement (spec M3 §3, M3-R05…R07;
// plan §5.5). Khoá đủ TRƯỚC rồi mới báo lỗi theo thứ tự spec (feature → subject → core → NOT_ENTITLED).
import type {
  Grant,
  GrantCreateRequest,
  GrantDeleteQuery,
  GrantListQuery,
  GrantListResponse,
} from "@ai/contracts";
import { type Db, type DbScope, type Tx, withScope } from "@ai/db";
import { configWrite } from "../../lib/config/config-write";
import { appError } from "../../lib/errors";
import { afterLock, type TestHooks } from "../../lib/test-hooks";
import { mustTenant, writeTenant } from "../groups/groups.service";
import { type Actor, resolveTenantScope } from "../users/users.rules";
import { grantById, grantRows, toGrant } from "./grants.read";
import * as repo from "./grants.repo";
import { checkGrantFeatures, type RuleError } from "./grants.rules";

export type GrantsCtx = { db: Db; hooks?: TestHooks };
export type Call = { ctx: GrantsCtx; actor: Actor; scope: DbScope };

export const fail = (e: RuleError | null): void => {
  if (e) throw appError(e.code, e.details);
};

export async function listGrants(c: Call, q: GrantListQuery): Promise<GrantListResponse> {
  const r = resolveTenantScope(c.actor, q.tenant_id, "read");
  if ("code" in r) throw appError(r.code);
  const f = {
    tenantId: r.tenantId,
    featureId: q.feature_id,
    groupId: q.group_id,
    userId: q.user_id,
    q: q.q,
    limit: q.limit,
    offset: q.offset,
  };
  const rows = await withScope(c.ctx.db, c.scope, (tx) => grantRows(tx, f));
  return { items: rows.map(toGrant), total: rows[0]?.total ?? 0 };
}

const subjectOf = (i: { group_id?: string; user_id?: string }): repo.Subject =>
  i.group_id ? { kind: "group", id: i.group_id } : { kind: "user", id: i.user_id as string };

type Locked = {
  feature: { id: string; key: string } | undefined;
  subjectOk: boolean;
  entitled: boolean;
};

/** Khoá: group SHARE (3) → feature SHARE (8) → entitlement SHARE (10). User: chỉ kiểm tồn tại (E2). */
async function lockRefs(
  tx: Tx,
  tenantId: string,
  featureId: string,
  s: repo.Subject,
): Promise<Locked> {
  const subjectOk =
    s.kind === "group"
      ? (await repo.shareGroups(tx, tenantId, [s.id])).has(s.id)
      : await repo.userInTenant(tx, tenantId, s.id);
  const [feature] = await repo.shareFeatures(tx, [featureId]);
  const entitled = (await repo.shareEntitled(tx, tenantId, [featureId])).has(featureId);
  return { feature, subjectOk, entitled };
}

function checkRefs(
  l: Locked,
  featureId: string,
  s: repo.Subject,
  forAdd: boolean,
): { id: string; key: string } {
  if (!l.feature) throw appError("INVALID_REFERENCE", { field: "feature_id", ids: [featureId] });
  if (!l.subjectOk) throw appError("INVALID_REFERENCE", { field: `${s.kind}_id`, ids: [s.id] });
  const f = { ...l.feature, entitled: l.entitled };
  fail(checkGrantFeatures([f], forAdd ? new Set([f.id]) : new Set()));
  return l.feature;
}

/** 201 khi tạo, 200 khi đã có (không ghi, không NOTIFY). */
export function createGrant(
  c: Call,
  queryTenantId: string | undefined,
  input: GrantCreateRequest,
): Promise<{ grant: Grant; created: boolean }> {
  const tenantId = writeTenant(c.actor, queryTenantId);
  const subject = subjectOf(input);
  return configWrite(c, "grant.save", async (tx, ch) => {
    await mustTenant(tx, tenantId);
    const l = await lockRefs(tx, tenantId, input.feature_id, subject);
    await afterLock(c.ctx.hooks, "grant.save", "locked");
    checkRefs(l, input.feature_id, subject, true);
    const t = { tenantId, featureId: input.feature_id, subject };
    const existing = await repo.lockGrant(tx, t);
    const id = existing ?? (await repo.insertGrant(tx, { ...t, actorId: c.actor.userId }));
    const created = existing === null && id !== null;
    if (created) ch.changed({ entity: "grant", tenantId });
    await afterLock(c.ctx.hooks, "grant.save", "rows");
    const grantId = id ?? (await repo.lockGrant(tx, t));
    return { grant: await grantById(tx, tenantId, grantId as string), created };
  });
}

/** Luôn 204 (idempotent, R05); feature/subject không thấy → 204 không ghi; `core` → 409 (đồng nhất POST). */
export function deleteGrant(c: Call, q: GrantDeleteQuery): Promise<void> {
  const tenantId = writeTenant(c.actor, q.tenant_id);
  const subject = subjectOf(q);
  return configWrite(c, "grant.save", async (tx, ch) => {
    await mustTenant(tx, tenantId);
    const l = await lockRefs(tx, tenantId, q.feature_id, subject);
    await afterLock(c.ctx.hooks, "grant.save", "locked");
    if (!l.feature || !l.subjectOk) return;
    checkRefs(l, q.feature_id, subject, false);
    const n = await repo.deleteGrant(tx, { tenantId, featureId: q.feature_id, subject });
    if (n > 0) ch.changed({ entity: "grant", tenantId });
    await afterLock(c.ctx.hooks, "grant.save", "rows");
  });
}

// ADM-FR-30, ADM-FR-33, ADM-FR-34, ADM-BR-10 · nghiệp vụ features (plan M2 §5 "Features", §5.1). Không biết HTTP.
// Mỗi hành động = một withScope platform; callback chỉ làm việc DB (TECH-DEBT #13). Khoá: commands (id tăng) →
// feature, chỉ FOR NO KEY UPDATE. Xoá feature KHÔNG tăng version command (readiness lần 2 #2).
import {
  COMMAND_DESC_MAX,
  type FeatureCreateRequest,
  type FeatureDetail,
  type FeatureListItem,
  type FeatureListQuery,
  type FeatureListResponse,
  type FeatureUpdateRequest,
  LocalizedTextSchema,
} from "@ai/contracts";
import { type Db, type DbScope, type Tx, withScope } from "@ai/db";
import type { Actor } from "../../lib/auth-middleware";
import { appError } from "../../lib/errors";
import { afterLock, type TestHooks } from "../../lib/test-hooks";
import { mapFeatureConflict } from "./features.errors";
import * as m from "./features.members";
import * as repo from "./features.repo";
import {
  changedFeatureFields,
  checkFeatureDelete,
  checkFeatureStatus,
  diffIds,
  type FeatureState,
  isCore,
  membershipError,
  orphanedByRemoval,
  type RuleError,
} from "./features.rules";

export type FeaturesCtx = { db: Db; hooks?: TestHooks };
export type Call = { ctx: FeaturesCtx; actor: Actor; scope: DbScope };

const CommandDesc = LocalizedTextSchema(COMMAND_DESC_MAX);

export const fail = (e: RuleError | null): void => {
  if (e) throw appError(e.code, e.details);
};

export function toFeatureItem(r: repo.FeatureRow): FeatureListItem {
  return {
    id: r.id,
    key: r.key,
    name: r.name,
    description: r.description,
    icon: r.icon,
    status: r.status,
    is_core: isCore(r),
    command_count: r.commandCount,
    tenant_count: r.tenantCount,
    version: r.version,
    updated_at: r.updatedAt.toISOString(),
    updated_by: r.updatedBy,
  };
}

export async function featureDetail(tx: Tx, id: string): Promise<FeatureDetail> {
  const row = await repo.findFeature(tx, id);
  if (!row) throw appError("NOT_FOUND");
  const items = await repo.featureCommandItems(tx, id);
  return {
    ...toFeatureItem(row),
    created_at: row.createdAt.toISOString(),
    commands: items.map((c) => ({ ...c, description: CommandDesc.parse(c.description) })),
    affected_user_count: await repo.affectedUserCount(tx, row),
  };
}

const missingIds = (want: readonly string[], have: readonly { id: string }[]) => {
  const seen = new Set(have.map((h) => h.id));
  return want.filter((id) => !seen.has(id));
};

function invalidCommands(ids: string[]): void {
  if (ids.length > 0) throw appError("INVALID_REFERENCE", { field: "command_ids", ids });
}

const pairs = (featureId: string, commandIds: readonly string[]) =>
  commandIds.map((commandId) => ({ featureId, commandId }));

export async function listFeatures(c: Call, q: FeatureListQuery): Promise<FeatureListResponse> {
  const { rows, counts } = await withScope(c.ctx.db, c.scope, (tx) => repo.listFeatures(tx, q));
  return { items: rows.map(toFeatureItem), total: rows[0]?.total ?? 0, counts };
}

export function getFeature(c: Call, id: string): Promise<FeatureDetail> {
  return withScope(c.ctx.db, c.scope, (tx) => featureDetail(tx, id));
}

export function createFeature(c: Call, input: FeatureCreateRequest): Promise<FeatureDetail> {
  return withScope(c.ctx.db, c.scope, async (tx) => {
    const locked = await m.lockCommands(tx, input.command_ids);
    await afterLock(c.ctx.hooks, "feature.save");
    invalidCommands(missingIds(input.command_ids, locked));
    const id = Bun.randomUUIDv7();
    const row = {
      id,
      key: input.key,
      actorId: c.actor.userId,
      name: input.name,
      description: input.description,
      icon: input.icon,
      status: input.status,
    };
    await tx.transaction((sp) => repo.insertFeature(sp, row)).catch(mapFeatureConflict);
    await m.addPairs(tx, pairs(id, input.command_ids));
    await m.bumpCommands(tx, input.command_ids, c.actor.userId);
    return featureDetail(tx, id);
  });
}

type Locked = {
  row: repo.FeatureRow;
  curIds: string[];
  lockedCmds: { id: string; name: string }[];
};

/** commands (cũ ∪ mới, id tăng) → feature; đọc lại sau khoá. Tập đổi giữa lúc đọc và khoá → khoá thêm (hiếm). */
async function lockForUpdate(tx: Tx, id: string, newIds?: string[]): Promise<Locked> {
  const before = await m.commandIdsOfFeature(tx, id);
  const lockedCmds = newIds ? await m.lockCommands(tx, [...new Set([...before, ...newIds])]) : [];
  if (!(await repo.lockFeature(tx, id, "no key update"))) throw appError("NOT_FOUND");
  const row = await repo.findFeature(tx, id);
  if (!row) throw appError("NOT_FOUND");
  const curIds = await m.commandIdsOfFeature(tx, id);
  if (newIds) lockedCmds.push(...(await m.lockCommands(tx, missingIds(curIds, lockedCmds))));
  return { row, curIds, lockedCmds };
}

const stateOf = (r: repo.FeatureRow, commandIds: string[]): FeatureState => ({
  name: r.name,
  description: r.description,
  icon: r.icon,
  status: r.status,
  commandIds,
});

/** Trường vắng = giữ nguyên. */
function mergeState(cur: FeatureState, input: FeatureUpdateRequest): FeatureState {
  return {
    name: input.name ?? cur.name,
    description: input.description ?? cur.description,
    icon: input.icon ?? cur.icon,
    status: input.status ?? cur.status,
    commandIds: input.command_ids ?? cur.commandIds,
  };
}

async function applyMembership(c: Call, tx: Tx, l: Locked, next: string[]): Promise<void> {
  const { added, removed } = diffIds(l.curIds, next);
  invalidCommands(missingIds(added, l.lockedCmds));
  const counts = await m.featureCounts(tx, removed);
  const names = new Map(l.lockedCmds.map((x) => [x.id, x.name]));
  const removedInfo = removed.map((id) => ({
    id,
    name: names.get(id) ?? "",
    featureCount: counts.get(id) ?? 0,
  }));
  const orphans = orphanedByRemoval(removedInfo).sort((a, b) => a.name.localeCompare(b.name));
  fail(membershipError(orphans));
  await m.removePairs(tx, pairs(l.row.id, removed));
  await m.addPairs(tx, pairs(l.row.id, added));
  await m.bumpCommands(tx, [...added, ...removed], c.actor.userId);
}

/** Thứ tự (spec §3): 404 → version → không đổi gì → CORE_FEATURE_PROTECTED → INVALID_REFERENCE → COMMAND_NEEDS_FEATURE. */
export function updateFeature(
  c: Call,
  id: string,
  input: FeatureUpdateRequest,
): Promise<FeatureDetail> {
  return withScope(c.ctx.db, c.scope, async (tx) => {
    if (!(await repo.findFeature(tx, id))) throw appError("NOT_FOUND");
    const l = await lockForUpdate(tx, id, input.command_ids);
    await afterLock(c.ctx.hooks, "feature.save");
    if (l.row.version !== input.version) {
      const current = await featureDetail(tx, id);
      throw appError("VERSION_CONFLICT", { current, updated_at: current.updated_at });
    }
    const cur = stateOf(l.row, l.curIds);
    const next = mergeState(cur, input);
    const changed = changedFeatureFields(cur, next);
    if (changed.length === 0) return featureDetail(tx, id);
    fail(checkFeatureStatus(l.row, input.status));
    if (changed.includes("commandIds")) await applyMembership(c, tx, l, next.commandIds);
    const set: repo.FeatureSet = {};
    for (const k of changed) if (k !== "commandIds") Object.assign(set, { [k]: next[k] });
    await repo.bumpFeature(tx, id, set, c.actor.userId);
    return featureDetail(tx, id);
  });
}

/** 404 → CORE_FEATURE_PROTECTED → FEATURE_HAS_EXCLUSIVE_COMMANDS → xoá (cascade feature_commands, entitlement). */
export function deleteFeature(c: Call, id: string): Promise<void> {
  return withScope(c.ctx.db, c.scope, async (tx) => {
    // Khoá command của feature trước (thứ tự commands → features) để luật "không mồ côi" không bị đua.
    await m.lockCommands(tx, await m.commandIdsOfFeature(tx, id));
    const f = await repo.lockFeature(tx, id, "no key update");
    if (!f) throw appError("NOT_FOUND");
    await afterLock(c.ctx.hooks, "feature.delete");
    fail(checkFeatureDelete(f, await repo.exclusiveCommands(tx, id)));
    await repo.deleteFeature(tx, id);
  });
}

// ---- cho module commands (T6): chạy trong transaction của command, SAU khi đã khoá hàng command ----

export const coreFeatureId = (tx: Tx): Promise<string> => repo.coreFeatureId(tx);
export const featureRefsByCommands = m.featureRefsByCommands;

/** Thay cả tập feature của command; khoá features (cũ ∪ mới, id tăng); thiếu → INVALID_REFERENCE {feature_ids}. */
export async function setCommandFeatures(
  tx: Tx,
  a: { commandId: string; featureIds: string[]; actorId: string },
): Promise<void> {
  const cur = await m.featureIdsOfCommand(tx, a.commandId);
  const locked = await m.lockFeatures(tx, [...new Set([...cur, ...a.featureIds])]);
  const missing = a.featureIds.filter((x) => !locked.includes(x));
  if (missing.length > 0)
    throw appError("INVALID_REFERENCE", { field: "feature_ids", ids: missing });
  const { added, removed } = diffIds(cur, a.featureIds);
  await m.removePairs(
    tx,
    removed.map((featureId) => ({ featureId, commandId: a.commandId })),
  );
  await m.addPairs(
    tx,
    added.map((featureId) => ({ featureId, commandId: a.commandId })),
  );
  await m.bumpFeatures(tx, [...added, ...removed], a.actorId);
}

/** Xoá command: tăng version mọi feature chứa nó (khoá features id tăng) trước khi xoá. */
export async function bumpFeaturesOfCommand(
  tx: Tx,
  commandId: string,
  actorId: string,
): Promise<void> {
  const ids = await m.lockFeatures(tx, await m.featureIdsOfCommand(tx, commandId));
  await m.bumpFeatures(tx, ids, actorId);
}

/** Id feature không tồn tại (đọc không khoá; thứ tự kiểm của command, spec §3). */
export async function missingFeatureIds(tx: Tx, ids: readonly string[]): Promise<string[]> {
  const found = await m.existingFeatureIds(tx, ids);
  return ids.filter((x) => !found.includes(x));
}

// ADM-FR-30, ADM-BR-10 · ghi `feature_commands` theo cả hai chiều (feature ↔ command) + khoá hàng + tăng `version`
// bên kia (spec M2 §3 "version": tập đổi từ phía nào cũng tăng version hai thực thể). Module features sở hữu bảng này.
// Khoá: chỉ FOR NO KEY UPDATE, sắp id tăng; thứ tự toàn cục workflows → commands → features (plan §5.1).
import {
  CORE_FEATURE_KEY,
  FEATURE_NAME_MAX,
  type FeatureRef,
  type FeatureStatus,
  LocalizedTextSchema,
} from "@ai/contracts";
import { commands, featureCommands, features, type Tx } from "@ai/db";
import { and, asc, eq, inArray, sql } from "drizzle-orm";

const NameSchema = LocalizedTextSchema(FEATURE_NAME_MAX);

/** Khoá command theo id tăng dần; trả hàng thấy được (id thiếu = không tồn tại). */
export async function lockCommands(
  tx: Tx,
  ids: readonly string[],
): Promise<{ id: string; name: string }[]> {
  if (ids.length === 0) return [];
  return tx
    .select({ id: commands.id, name: commands.name })
    .from(commands)
    .where(inArray(commands.id, [...ids]))
    .orderBy(asc(commands.id))
    .for("no key update");
}

export async function lockFeatures(tx: Tx, ids: readonly string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await tx
    .select({ id: features.id })
    .from(features)
    .where(inArray(features.id, [...ids]))
    .orderBy(asc(features.id))
    .for("no key update");
  return rows.map((r) => r.id);
}

/** `core` đầu rồi `key` (thứ tự FeatureRef của command). */
const byCoreThenKey = (a: FeatureRef, b: FeatureRef) =>
  Number(a.key !== CORE_FEATURE_KEY) - Number(b.key !== CORE_FEATURE_KEY) ||
  (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

/** Khoá features `FOR NO KEY UPDATE` (id tăng) và trả luôn FeatureRef — command mới khỏi đọc lại (perf POST). */
export async function lockFeatureRefs(tx: Tx, ids: readonly string[]): Promise<FeatureRef[]> {
  if (ids.length === 0) return [];
  const rows = await tx
    .select({ id: features.id, key: features.key, name: features.name, status: features.status })
    .from(features)
    .where(inArray(features.id, [...ids]))
    .orderBy(asc(features.id))
    .for("no key update");
  return rows
    .map((r) => ({
      id: r.id,
      key: r.key,
      name: NameSchema.parse(r.name),
      status: r.status as FeatureStatus,
    }))
    .sort(byCoreThenKey);
}

export async function existingFeatureIds(tx: Tx, ids: readonly string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await tx
    .select({ id: features.id })
    .from(features)
    .where(inArray(features.id, [...ids]));
  return rows.map((r) => r.id);
}

export async function commandIdsOfFeature(tx: Tx, featureId: string): Promise<string[]> {
  const rows = await tx
    .select({ id: featureCommands.commandId })
    .from(featureCommands)
    .where(eq(featureCommands.featureId, featureId))
    .orderBy(asc(featureCommands.commandId));
  return rows.map((r) => r.id);
}

export async function featureIdsOfCommand(tx: Tx, commandId: string): Promise<string[]> {
  const rows = await tx
    .select({ id: featureCommands.featureId })
    .from(featureCommands)
    .where(eq(featureCommands.commandId, commandId))
    .orderBy(asc(featureCommands.featureId));
  return rows.map((r) => r.id);
}

export async function addPairs(tx: Tx, pairs: { featureId: string; commandId: string }[]) {
  if (pairs.length > 0) await tx.insert(featureCommands).values(pairs).onConflictDoNothing();
}

export async function removePairs(tx: Tx, pairs: { featureId: string; commandId: string }[]) {
  for (const p of pairs) {
    await tx
      .delete(featureCommands)
      .where(
        and(eq(featureCommands.featureId, p.featureId), eq(featureCommands.commandId, p.commandId)),
      );
  }
}

export async function bumpCommands(tx: Tx, ids: readonly string[], actorId: string) {
  if (ids.length === 0) return;
  await tx
    .update(commands)
    .set({ version: sql`${commands.version} + 1`, updatedBy: actorId, updatedAt: sql`now()` })
    .where(inArray(commands.id, [...ids]));
}

export async function bumpFeatures(tx: Tx, ids: readonly string[], actorId: string) {
  if (ids.length === 0) return;
  await tx
    .update(features)
    .set({ version: sql`${features.version} + 1`, updatedBy: actorId, updatedAt: sql`now()` })
    .where(inArray(features.id, [...ids]));
}

/** FeatureRef của từng command, sắp `core` đầu rồi `key` (một câu cho cả trang). */
export async function featureRefsByCommands(
  tx: Tx,
  commandIds: readonly string[],
): Promise<Map<string, FeatureRef[]>> {
  const out = new Map<string, FeatureRef[]>();
  if (commandIds.length === 0) return out;
  const rows = await tx
    .select({
      commandId: featureCommands.commandId,
      id: features.id,
      key: features.key,
      name: features.name,
      status: features.status,
    })
    .from(featureCommands)
    .innerJoin(features, eq(features.id, featureCommands.featureId))
    .where(inArray(featureCommands.commandId, [...commandIds]))
    // COLLATE "C" = so theo byte như JS (`byCoreThenKey`): GET và POST trả `features` cùng thứ tự.
    .orderBy(sql`${features.key} <> ${CORE_FEATURE_KEY}`, sql`${features.key} collate "C"`);
  for (const r of rows) {
    const list = out.get(r.commandId) ?? [];
    list.push({
      id: r.id,
      key: r.key,
      name: NameSchema.parse(r.name),
      status: r.status as FeatureStatus,
    });
    out.set(r.commandId, list);
  }
  return out;
}

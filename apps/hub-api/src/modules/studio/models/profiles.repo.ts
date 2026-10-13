// HUB-FR-67 · spec H4b2 §3 B, §4 · plan §3.3 · câu SQL model profile Studio. Transaction + scope do service/
// `withConfigWrite` mở. Cột tường minh (không `select *`). Index: PK `model_profiles`, `agents` quét ≤ 200 hàng
// (`profile_id`), `providers ⋈ provider_state` ≤ 200 hàng (spec-decisions §Index).
import type { Ref } from "@ai/contracts/studio";
import type { Tx } from "@ai/db";
import { agents, modelProfiles, providerState, providers } from "@ai/db/schema/hub";
import { asc, eq, isNotNull, sql } from "drizzle-orm";
import { REF_LIMIT } from "./providers.repo";

/** Một bước jsonb `hub.model_profiles.steps` (kiểu từ schema Drizzle). */
export type ModelProfileStep = (typeof modelProfiles.$inferSelect)["steps"][number];

export type ProfileDbRow = {
  id: string;
  key: string;
  steps: ModelProfileStep[];
  version: number;
  updatedAt: Date;
};

/** Provider cho `stepsProblem` (vendor), `allSubscription` (kind) và `pickStep` (enabled + state). */
export type ProviderView = {
  key: string;
  vendor: string;
  kind: string;
  enabled: boolean;
  status: string | null;
  cooldownUntil: Date | null;
};

const BASE = {
  id: modelProfiles.id,
  key: modelProfiles.key,
  steps: modelProfiles.steps,
  version: modelProfiles.version,
  updatedAt: modelProfiles.updatedAt,
};

/** Theo PK; `forUpdate` khoá hàng (sau `config_meta` — thứ tự khoá plan §6). */
export async function readProfile(
  tx: Tx,
  id: string,
  forUpdate = false,
): Promise<ProfileDbRow | undefined> {
  const q = tx.select(BASE).from(modelProfiles).where(eq(modelProfiles.id, id));
  const [r] = forUpdate ? await q.for("update") : await q;
  return r;
}

/** List (theo key). */
export function readProfiles(tx: Tx): Promise<ProfileDbRow[]> {
  return tx.select(BASE).from(modelProfiles).orderBy(asc(modelProfiles.key));
}

export async function profileIdByKey(tx: Tx, key: string): Promise<string | undefined> {
  const [r] = await tx
    .select({ id: modelProfiles.id })
    .from(modelProfiles)
    .where(eq(modelProfiles.key, key));
  return r?.id;
}

/** Mọi provider kèm trạng thái sống (một câu; `providers` ≤ 200 hàng). */
export function readProviderViews(tx: Tx): Promise<ProviderView[]> {
  return tx
    .select({
      key: providers.key,
      vendor: providers.vendor,
      kind: providers.kind,
      enabled: providers.enabled,
      status: providerState.status,
      cooldownUntil: providerState.cooldownUntil,
    })
    .from(providers)
    .leftJoin(providerState, eq(providerState.providerKey, providers.key));
}

/** Số agent trỏ tới mỗi profile (profile không có agent ⇒ vắng trong map). */
export async function readAgentCounts(tx: Tx): Promise<Map<string, number>> {
  const rows = await tx
    .select({ id: agents.profileId, n: sql<number>`count(*)`.mapWith(Number) })
    .from(agents)
    .where(isNotNull(agents.profileId))
    .groupBy(agents.profileId);
  return new Map(rows.flatMap((r) => (r.id === null ? [] : [[r.id, r.n] as const])));
}

/** Agent dùng profile `id`, theo key, ≤ 50 (`used_by_agents`, `PROFILE_IN_USE.agents`). */
export function agentsUsing(tx: Tx, id: string): Promise<Ref[]> {
  return tx
    .select({ id: agents.id, key: agents.key })
    .from(agents)
    .where(eq(agents.profileId, id))
    .orderBy(asc(agents.key))
    .limit(REF_LIMIT);
}

export async function insertProfile(
  tx: Tx,
  v: { key: string; steps: ModelProfileStep[] },
): Promise<string> {
  const [r] = await tx.insert(modelProfiles).values(v).returning({ id: modelProfiles.id });
  if (!r) throw new Error("insert hub.model_profiles returned no row");
  return r.id;
}

/** Chỉ cột được GRANT UPDATE (0030 #3); `version + 1`, `updated_at = now()`. */
export async function updateProfile(tx: Tx, id: string, steps: ModelProfileStep[]): Promise<void> {
  await tx
    .update(modelProfiles)
    .set({ steps, version: sql`${modelProfiles.version} + 1`, updatedAt: sql`now()` })
    .where(eq(modelProfiles.id, id));
}

/** `agents.profile_id` RESTRICT ⇒ 23503 (service đổi thành PROFILE_IN_USE). */
export async function deleteProfile(tx: Tx, id: string): Promise<void> {
  await tx.delete(modelProfiles).where(eq(modelProfiles.id, id));
}

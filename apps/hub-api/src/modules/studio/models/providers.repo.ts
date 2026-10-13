// HUB-FR-66 · spec H4b2 §3 A, §4 · plan §3.1 · câu SQL provider Studio. Transaction + scope do service/`withConfigWrite`
// mở. Liệt kê cột tường minh (không `select *`): `hub.secrets` chỉ đọc `id/name/kind/tenant_id` (hub_rw không SELECT
// được bản mã). Index: PK `providers`, `jobs_provider_key_idx` (lịch sử + slots), `model_profiles` quét ≤ 200 hàng.
import type { Ref } from "@ai/contracts/studio";
import type { Tx } from "@ai/db";
import { jobs, modelProfiles, providerState, providers } from "@ai/db/schema/hub";
import { hubSecrets } from "@ai/db/schema/hub-secrets";
import { asc, eq, sql } from "drizzle-orm";

export const REF_LIMIT = 50;

const BASE = {
  id: providers.id,
  key: providers.key,
  kind: providers.kind,
  vendor: providers.vendor,
  baseUrl: providers.baseUrl,
  secretId: providers.secretId,
  maxConcurrency: providers.maxConcurrency,
  enabled: providers.enabled,
  devOnly: providers.devOnly,
  version: providers.version,
  updatedAt: providers.updatedAt,
};

export type ProviderDbRow = {
  id: string;
  key: string;
  kind: "subscription" | "api";
  vendor: string;
  baseUrl: string | null;
  secretId: string | null;
  maxConcurrency: number;
  enabled: boolean;
  devOnly: boolean;
  version: number;
  updatedAt: Date;
};

export type ProviderDetailRow = ProviderDbRow & {
  secretName: string | null;
  slotsInUse: number;
  state: {
    status: string;
    cooldownUntil: Date | null;
    lastProbeAt: Date | null;
    lastOkAt: Date | null;
    utilization: number | null;
    lastError: string | null;
  } | null;
};

/** Theo PK; `forUpdate` khoá hàng (sau `config_meta` — thứ tự khoá plan §6). */
export async function readProvider(
  tx: Tx,
  id: string,
  forUpdate = false,
): Promise<ProviderDbRow | undefined> {
  const q = tx.select(BASE).from(providers).where(eq(providers.id, id));
  const [r] = forUpdate ? await q.for("update") : await q;
  return r;
}

export async function providerIdByKey(tx: Tx, key: string): Promise<string | undefined> {
  const [r] = await tx.select({ id: providers.id }).from(providers).where(eq(providers.key, key));
  return r?.id;
}

/** Chi tiết: hàng + tên secret + state (cả `last_error`, chỉ ở chi tiết — Q6) + số job `running`. */
export async function readProviderDetail(
  tx: Tx,
  id: string,
): Promise<ProviderDetailRow | undefined> {
  const [r] = await tx
    .select({
      ...BASE,
      secretName: hubSecrets.name,
      slotsInUse: sql<number>`(select count(*) from hub.jobs j
        where j.provider_key = "providers"."key" and j.status = 'running')`.mapWith(Number),
      stStatus: providerState.status,
      cooldownUntil: providerState.cooldownUntil,
      lastProbeAt: providerState.lastProbeAt,
      lastOkAt: providerState.lastOkAt,
      utilization: providerState.utilization,
      lastError: providerState.lastError,
    })
    .from(providers)
    .leftJoin(hubSecrets, eq(hubSecrets.id, providers.secretId))
    .leftJoin(providerState, eq(providerState.providerKey, providers.key))
    .where(eq(providers.id, id));
  if (!r) return undefined;
  const { stStatus, cooldownUntil, lastProbeAt, lastOkAt, utilization, lastError, ...row } = r;
  const state =
    stStatus === null
      ? null
      : { status: stStatus, cooldownUntil, lastProbeAt, lastOkAt, utilization, lastError };
  return { ...row, state };
}

/** Secret tham chiếu (cho `secretRefProblem`): chỉ `kind`, `tenant_id`. */
export async function readSecretRef(
  tx: Tx,
  id: string,
): Promise<{ kind: string; tenantId: string | null } | undefined> {
  const [r] = await tx
    .select({ kind: hubSecrets.kind, tenantId: hubSecrets.tenantId })
    .from(hubSecrets)
    .where(eq(hubSecrets.id, id));
  return r;
}

/** Profile có bước dùng provider `key` (jsonb containment), theo key, ≤ 50. */
export function profilesUsing(tx: Tx, key: string): Promise<Ref[]> {
  return tx
    .select({ id: modelProfiles.id, key: modelProfiles.key })
    .from(modelProfiles)
    .where(
      sql`${modelProfiles.steps} @> jsonb_build_array(jsonb_build_object('provider_key', ${key}::text))`,
    )
    .orderBy(asc(modelProfiles.key))
    .limit(REF_LIMIT);
}

/** Đã có job (mọi trạng thái) — FK `jobs_provider_key_fkey` RESTRICT. Index `jobs_provider_key_idx`. */
export async function providerHasJobs(tx: Tx, key: string): Promise<boolean> {
  const [r] = await tx
    .select({ one: sql<number>`1` })
    .from(jobs)
    .where(eq(jobs.providerKey, key))
    .limit(1);
  return r !== undefined;
}

export type ProviderInsert = {
  key: string;
  kind: "subscription" | "api";
  vendor: "anthropic" | "openai" | "google" | "fake";
  baseUrl: string | null;
  secretId: string | null;
  maxConcurrency: number;
  enabled: boolean;
  devOnly: boolean;
};

export async function insertProvider(tx: Tx, v: ProviderInsert): Promise<string> {
  const [r] = await tx.insert(providers).values(v).returning({ id: providers.id });
  if (!r) throw new Error("insert hub.providers returned no row");
  return r.id;
}

export type ProviderPatch = {
  baseUrl: string | null;
  secretId: string | null;
  maxConcurrency: number;
  enabled: boolean;
};

/** Chỉ cột được GRANT UPDATE (0030 #2); `version + 1`, `updated_at = now()`. */
export async function updateProvider(tx: Tx, id: string, v: ProviderPatch): Promise<void> {
  await tx
    .update(providers)
    .set({ ...v, version: sql`${providers.version} + 1`, updatedAt: sql`now()` })
    .where(eq(providers.id, id));
}

/** Cascade `provider_state`, `provider_models`; `jobs` RESTRICT ⇒ 23503 (service đổi thành PROVIDER_HAS_HISTORY). */
export async function deleteProvider(tx: Tx, id: string): Promise<void> {
  await tx.delete(providers).where(eq(providers.id, id));
}

// ADM-FR-54 · M4-R14 · id theo key (file tham chiếu bằng key/tên, R14) + khoá hàng import (plan-cd §8.4, ngoại lệ E4).
// Khoá theo hạng plan M3 §6.1, trong mỗi hạng theo khoá chính tăng: tenants(1) → groups(3) → workflows(5) → commands(6)
// → command_names(7) → features(8) → feature_commands(9) → feature_entitlements(10) → tenant_quotas(A) →
// secrets(12, SHARE cho secret có sẵn được tham chiếu) → config_meta(14, bump cuối, do configWrite).
import type {
  CommandEl,
  FeatureEl,
  ImportItem,
  QuotaEntry,
  TenantEl,
  WorkflowEl,
} from "@ai/contracts";
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import { pgArray } from "../../lib/sql";
import { PLATFORM_TENANT_KEY } from "../tenants/tenants.rules";
import { canonicalJson } from "./transfer.norm";
import { capRows, SNAPSHOT_ROW_CAP } from "./transfer.repo";

export type Ids = {
  tenants: Map<string, string>;
  groups: Map<string, string>;
  workflows: Map<string, string>;
  commands: Map<string, string>;
  features: Map<string, string>;
  secrets: Map<string, string>;
};

export type It<T> = { op: "add" | "update"; key: string; before: T | null; after: T };

/** Mục của một loại (đã kiểm ở `planImport`). */
export function itemsOf<T>(items: readonly ImportItem[], type: ImportItem["type"]): It<T>[] {
  return items.filter((i) => i.type === type) as unknown as It<T>[];
}

const scopeOf = (q: QuotaEntry) => q.feature ?? "";

/** Dòng quota trong file khác DB (cùng tenant, feature) → thay; dòng ngoài file giữ. Trả tenant có quota đổi. */
export function changedQuotas(x: It<TenantEl>): QuotaEntry[] {
  const old = new Map((x.before?.quotas ?? []).map((q) => [scopeOf(q), canonicalJson(q)]));
  return x.after.quotas.filter((q) => old.get(scopeOf(q)) !== canonicalJson(q));
}

async function pairs(tx: Tx, q: ReturnType<typeof sql>): Promise<Map<string, string>> {
  const rows = (await tx.execute(q)) as unknown as { k: string; id: string }[];
  return new Map(capRows(rows).map((r) => [r.k, r.id]));
}

/** Không khoá (đọc trong tx ghi, trước `lockForImport`). */
export async function readIds(tx: Tx): Promise<Ids> {
  const cap = SNAPSHOT_ROW_CAP + 1; // + 1 để `capRows` phát hiện vượt trần
  return {
    tenants: await pairs(
      tx,
      sql`select key as k, id from admin.tenants where key <> ${PLATFORM_TENANT_KEY} order by key limit ${cap}`,
    ),
    groups: await pairs(
      tx,
      sql`select t.key || '/' || g.key as k, g.id from admin.groups g
        join admin.tenants t on t.id = g.tenant_id where t.key <> ${PLATFORM_TENANT_KEY}
        order by t.key, g.key limit ${cap}`,
    ),
    workflows: await pairs(
      tx,
      sql`select key as k, id from admin.workflows order by key limit ${cap}`,
    ),
    commands: await pairs(
      tx,
      sql`select name as k, id from admin.commands order by name limit ${cap}`,
    ),
    features: await pairs(
      tx,
      sql`select key as k, id from admin.features order by key limit ${cap}`,
    ),
    secrets: await pairs(
      tx,
      sql`select name as k, id from admin.secrets order by name limit ${cap}`,
    ),
  };
}

const idsOf = (m: Map<string, string>, keys: readonly string[]): string[] =>
  [...new Set(keys.map((k) => m.get(k)).filter((x): x is string => x !== undefined))].sort();

async function lockIds(tx: Tx, table: string, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  await tx.execute(sql`select id from ${sql.raw(`admin.${table}`)}
    where id = any(${pgArray(ids, "uuid")}) order by id for no key update`);
}

const updated = <T>(items: readonly ImportItem[], type: ImportItem["type"]) =>
  itemsOf<T>(items, type).filter((x) => x.op === "update");

async function lockChildren(tx: Tx, ids: Ids, items: readonly ImportItem[]): Promise<void> {
  const cmdIds = idsOf(
    ids.commands,
    updated<CommandEl>(items, "command").map((x) => x.key),
  );
  if (cmdIds.length > 0)
    await tx.execute(sql`select name from admin.command_names
      where command_id = any(${pgArray(cmdIds, "uuid")}) order by name for update`);
  await lockIds(
    tx,
    "features",
    idsOf(
      ids.features,
      updated<FeatureEl>(items, "feature").map((x) => x.key),
    ),
  );
  const featIds = idsOf(
    ids.features,
    updated<FeatureEl>(items, "feature").map((x) => x.key),
  );
  if (featIds.length > 0)
    await tx.execute(sql`select 1 from admin.feature_commands
      where feature_id = any(${pgArray(featIds, "uuid")}) order by feature_id, command_id for update`);
}

async function lockTenantRows(tx: Tx, ids: Ids, ts: ReturnType<typeof updated<TenantEl>>) {
  const entTenants = idsOf(
    ids.tenants,
    ts
      .filter((x) => x.after.entitlements.some((k) => !x.before?.entitlements.includes(k)))
      .map((x) => x.key),
  );
  if (entTenants.length > 0)
    await tx.execute(sql`select 1 from admin.feature_entitlements
      where tenant_id = any(${pgArray(entTenants, "uuid")}) order by feature_id, tenant_id for update`);
  const qTenants = idsOf(
    ids.tenants,
    ts.filter((x) => changedQuotas(x).length > 0).map((x) => x.key),
  );
  if (qTenants.length > 0)
    await tx.execute(sql`select id from admin.tenant_quotas
      where tenant_id = any(${pgArray(qTenants, "uuid")}) order by id for update`);
}

/** Khoá mọi hàng có sẵn sẽ sửa (§8.4). Secret có sẵn mà workflow đổi tham chiếu → SHARE (hạng 12, sau workflow). */
export async function lockForImport(tx: Tx, ids: Ids, items: readonly ImportItem[]): Promise<void> {
  const ts = updated<TenantEl>(items, "tenant");
  await lockIds(
    tx,
    "tenants",
    idsOf(
      ids.tenants,
      ts.map((x) => x.key),
    ),
  );
  await lockIds(
    tx,
    "groups",
    idsOf(
      ids.groups,
      updated(items, "group").map((x) => x.key),
    ),
  );
  const wfs = itemsOf<WorkflowEl>(items, "workflow");
  await lockIds(
    tx,
    "workflows",
    idsOf(
      ids.workflows,
      wfs.filter((x) => x.op === "update").map((x) => x.key),
    ),
  );
  await lockIds(
    tx,
    "commands",
    idsOf(
      ids.commands,
      updated(items, "command").map((x) => x.key),
    ),
  );
  await lockChildren(tx, ids, items);
  await lockTenantRows(tx, ids, ts);
  const secretIds = idsOf(
    ids.secrets,
    wfs.map((x) => x.after.secret),
  );
  if (secretIds.length > 0)
    await tx.execute(sql`select id from admin.secrets
      where id = any(${pgArray(secretIds, "uuid")}) order by id for share`);
}

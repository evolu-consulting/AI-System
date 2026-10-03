// ADM-FR-54 · M4-R14 · id theo key (file tham chiếu bằng key/tên, R14) + khoá hàng import (plan-cd §8.4, ngoại lệ E4).
// Khoá theo hạng plan M3 §6.1, trong mỗi hạng theo khoá chính tăng: tenants(1) → groups(3) → workflows(5) → commands(6)
// → command_names(7) → features(8) → feature_commands(9) → feature_entitlements(10) → tenant_quotas(A) →
// secrets(12, SHARE cho secret có sẵn được tham chiếu) → config_meta(14, bump cuối, do configWrite).
import type {
  CommandEl,
  FeatureEl,
  GrantEl,
  GroupEl,
  ImportItem,
  QuotaEntry,
  TenantEl,
  WorkflowEl,
} from "@ai/contracts";
import type { Tx } from "@ai/db";
import { type SQL, sql } from "drizzle-orm";
import { pgArray } from "../../lib/sql";
import { PLATFORM_TENANT_KEY } from "../tenants/tenants.rules";
import { canonicalJson } from "./transfer.norm";

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

type KeyType = keyof Ids;
type Keys = Record<KeyType, Set<string>>;

const refs = <T>(items: readonly ImportItem[], type: ImportItem["type"]): T[] =>
  itemsOf<T>(items, type).flatMap((x) => (x.before ? [x.before, x.after] : [x.after]));

/** Mọi khoá file chạm tới (mục + tham chiếu, cả `before`) — `readIds` chỉ tra các khoá này (không trần theo DB). */
export function keysOf(items: readonly ImportItem[]): Keys {
  const k: Keys = {
    tenants: new Set(),
    groups: new Set(),
    workflows: new Set(),
    commands: new Set(),
    features: new Set(),
    secrets: new Set(),
  };
  const add = (t: KeyType, keys: readonly (string | null)[]) => {
    for (const x of keys) if (x !== null) k[t].add(x);
  };
  for (const x of items) if (x.type !== "grant") add(`${x.type}s` as KeyType, [x.key]);
  add(
    "secrets",
    refs<WorkflowEl>(items, "workflow").map((w) => w.secret),
  );
  add(
    "workflows",
    refs<CommandEl>(items, "command").map((c) => c.workflow),
  );
  add(
    "commands",
    refs<FeatureEl>(items, "feature").flatMap((f) => f.commands),
  );
  const ts = refs<TenantEl>(items, "tenant");
  add(
    "features",
    ts.flatMap((t) => [...t.entitlements, ...t.quotas.map((q) => q.feature)]),
  );
  add(
    "tenants",
    refs<GroupEl>(items, "group").map((g) => g.tenant),
  );
  const gs = refs<GrantEl>(items, "grant");
  add(
    "tenants",
    gs.map((g) => g.tenant),
  );
  add(
    "groups",
    gs.map((g) => `${g.tenant}/${g.group}`),
  );
  add(
    "features",
    gs.map((g) => g.feature),
  );
  return k;
}

async function pairs(
  tx: Tx,
  keys: Set<string>,
  q: (arr: SQL) => SQL,
): Promise<Map<string, string>> {
  if (keys.size === 0) return new Map();
  const rows = (await tx.execute(q(pgArray([...keys], "text")))) as unknown as {
    k: string;
    id: string;
  }[];
  return new Map(rows.map((r) => [r.k, r.id]));
}

/**
 * Không khoá (đọc trong tx ghi, trước `lockForImport`). Chỉ tra khoá có trong file (≤ trần file) → không trần theo
 * số hàng DB (review M4 vòng 2: DB > 5000 group vẫn import được file nhỏ).
 */
export async function readIds(tx: Tx, items: readonly ImportItem[]): Promise<Ids> {
  const k = keysOf(items);
  const tenantKeys = pgArray([...new Set([...k.groups].map((g) => g.split("/")[0] ?? ""))], "text");
  return {
    tenants: await pairs(
      tx,
      k.tenants,
      (a) => sql`select key as k, id from admin.tenants where key = any(${a})
        and key <> ${PLATFORM_TENANT_KEY}`,
    ),
    groups: await pairs(
      tx,
      k.groups,
      (a) => sql`select t.key || '/' || g.key as k, g.id from admin.groups g
        join admin.tenants t on t.id = g.tenant_id
        where t.key = any(${tenantKeys}) and t.key <> ${PLATFORM_TENANT_KEY}
          and t.key || '/' || g.key = any(${a})`,
    ),
    workflows: await pairs(
      tx,
      k.workflows,
      (a) => sql`select key as k, id from admin.workflows where key = any(${a})`,
    ),
    commands: await pairs(
      tx,
      k.commands,
      (a) => sql`select name as k, id from admin.commands where name = any(${a})`,
    ),
    features: await pairs(
      tx,
      k.features,
      (a) => sql`select key as k, id from admin.features where key = any(${a})`,
    ),
    secrets: await pairs(
      tx,
      k.secrets,
      (a) => sql`select name as k, id from admin.secrets where name = any(${a})`,
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

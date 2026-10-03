// ADM-FR-54 · M4-R14 · AC-A06 · đọc snapshot cấu hình ở dạng phần tử file (plan-cd §3.2, §8.1). Chỉ đọc; người gọi mở
// tx `repeatable read, read only` (một snapshot). Secret: chỉ cột `name` (admin_rw không có quyền ciphertext/iv).
// Bỏ tenant `platform`; grant chỉ cho group. `FROM` dùng chung cho SELECT và COUNT → meta đếm đúng tập export.
import type { ConfigFileBody, TransferType } from "@ai/contracts";
import type { Tx } from "@ai/db";
import { type SQL, sql } from "drizzle-orm";
import { PLATFORM_TENANT_KEY } from "../tenants/tenants.rules";
import type { Snapshot } from "./transfer.rules";

/** Trần hàng mỗi loại khi đọc (plan-cd §8.1). */
export const SNAPSHOT_ROW_CAP = 5000;

const FROM: Record<TransferType, SQL> = {
  workflows: sql`from admin.workflows w join admin.secrets s on s.id = w.secret_id`,
  commands: sql`from admin.commands c join admin.workflows w on w.id = c.workflow_id`,
  features: sql`from admin.features f`,
  tenants: sql`from admin.tenants t where t.key <> ${PLATFORM_TENANT_KEY}`,
  groups: sql`from admin.groups g join admin.tenants t on t.id = g.tenant_id
    where t.key <> ${PLATFORM_TENANT_KEY}`,
  grants: sql`from admin.feature_grants fg join admin.groups g on g.id = fg.group_id
    join admin.tenants t on t.id = fg.tenant_id join admin.features f on f.id = fg.feature_id
    where fg.group_id is not null and t.key <> ${PLATFORM_TENANT_KEY}`,
};

const COLS: Record<TransferType, SQL> = {
  workflows: sql`w.key, w.name, w.description, w.app_type, w.base_url, s.name as secret, w.input_schema,
    w.output_field, w.enabled`,
  commands: sql`c.name, c.aliases, c.description, w.key as workflow, c.args, c.input_map, c.output, c.mode,
    c.timeout_s, c.enabled`,
  features: sql`f.key, f.name, f.description, coalesce(f.icon, 'package') as icon, f.status,
    coalesce((select json_agg(c.name) from admin.feature_commands fc join admin.commands c on c.id = fc.command_id
      where fc.feature_id = f.id), '[]'::json) as commands`,
  tenants: sql`t.key, t.name, t.max_concurrent_sub,
    coalesce((select json_agg(f.key) from admin.feature_entitlements e join admin.features f on f.id = e.feature_id
      where e.tenant_id = t.id and e.revoked_at is null), '[]'::json) as entitlements,
    coalesce((select json_agg(json_build_object('feature', f.key, 'max_runs', q.max_runs,
        'max_tokens', q.max_tokens, 'max_usd', q.max_usd::text))
      from admin.tenant_quotas q left join admin.features f on f.id = q.feature_id
      where q.tenant_id = t.id), '[]'::json) as quotas`,
  groups: sql`t.key as tenant, g.key, g.name, g.description`,
  grants: sql`t.key as tenant, g.key as "group", f.key as feature`,
};

async function readType<T extends TransferType>(
  tx: Tx,
  t: T,
): Promise<NonNullable<ConfigFileBody[T]>> {
  const rows = await tx.execute(sql`select ${COLS[t]} ${FROM[t]} limit ${SNAPSHOT_ROW_CAP}`);
  return rows as unknown as NonNullable<ConfigFileBody[T]>;
}

async function readSecretNames(tx: Tx): Promise<string[]> {
  const rows = (await tx.execute(
    sql`select name from admin.secrets order by name limit ${SNAPSHOT_ROW_CAP}`,
  )) as unknown as { name: string }[];
  return rows.map((r) => r.name);
}

/** Snapshot chỉ gồm `types` (thứ tự do `buildExportFile` sắp ở JS — không phụ thuộc collation DB). */
export async function readSnapshot(
  tx: Tx,
  configVersion: number,
  types: readonly TransferType[],
): Promise<Snapshot> {
  const snap: Snapshot = { configVersion, secrets: await readSecretNames(tx) };
  const body = snap as Record<string, unknown>;
  for (const t of types) body[t] = await readType(tx, t);
  return snap;
}

export type SnapshotCounts = Record<TransferType, number>;

/** Một câu, cùng `FROM` với `readType` → khớp số phần tử export (trần như khi đọc). */
export async function countSnapshot(tx: Tx): Promise<SnapshotCounts> {
  const one = (t: TransferType) =>
    sql`(select least(count(*), ${SNAPSHOT_ROW_CAP})::int ${FROM[t]})`;
  const rows = (await tx.execute(sql`select ${one("workflows")} as workflows,
    ${one("commands")} as commands, ${one("features")} as features, ${one("tenants")} as tenants,
    ${one("groups")} as groups, ${one("grants")} as grants`)) as unknown as SnapshotCounts[];
  const r = rows[0];
  if (!r) throw new Error("countSnapshot: không có hàng");
  return r;
}

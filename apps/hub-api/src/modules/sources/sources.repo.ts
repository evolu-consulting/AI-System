// HUB-FR-120 · ADM-FR-68 · PB-R01/R08/R20 · SQL `hub.sources` + tra cứu dùng-bởi/audit. Cách ly tenant: mọi câu lọc
// `tenant_id = T` (tx scope `system` ⇒ bỏ qua RLS; lọc ở repo). jsonb (config/last_pin) trả về object.
import type { SourceConfig, SourceKind, SourcePin } from "@ai/contracts/hub-admin";
import type { Tx } from "@ai/db";
import { type SQL, sql } from "drizzle-orm";

export type SourceRow = {
  id: string;
  tenant_id: string;
  key: string;
  kind: SourceKind;
  config: SourceConfig;
  description: string;
  version: number;
  last_pin: SourcePin | null;
  created_at: string;
  updated_at: string;
  updated_by: string | null;
};

const iso = (col: SQL) => sql`to_char(${col} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
const COLS = sql`s.id, s.tenant_id, s.key, s.kind, s.config, s.description, s.version, s.last_pin,
  ${iso(sql`s.created_at`)} as created_at, ${iso(sql`s.updated_at`)} as updated_at, s.updated_by::text as updated_by`;

export type SourceWrite = {
  tenantId: string;
  key: string;
  kind: SourceKind;
  config: SourceConfig;
  description: string;
  actorId: string;
};

export async function insertSource(tx: Tx, w: SourceWrite): Promise<SourceRow> {
  const [r] = await tx.execute<SourceRow>(sql`with ins as (insert into hub.sources as s
      (tenant_id, key, kind, config, description, created_by, updated_by)
    values (${w.tenantId}, ${w.key}, ${w.kind}, ${JSON.stringify(w.config)}::jsonb, ${w.description},
      ${w.actorId}, ${w.actorId}) returning *) select ${COLS} from ins s`);
  if (!r) throw new Error("insert hub.sources không trả hàng");
  return r;
}

export async function readSource(
  tx: Tx,
  tenantId: string,
  key: string,
  lock = false,
): Promise<SourceRow | null> {
  const [r] = await tx.execute<SourceRow>(sql`select ${COLS} from hub.sources s
    where s.tenant_id = ${tenantId} and s.key = ${key} and s.deleted_at is null
    ${lock ? sql`for update` : sql``}`);
  return r ?? null;
}

export async function keyExists(tx: Tx, tenantId: string, key: string): Promise<boolean> {
  const [r] = await tx.execute<{ n: number }>(sql`select count(*)::int as n from hub.sources
    where tenant_id = ${tenantId} and key = ${key} and deleted_at is null`);
  return (r?.n ?? 0) > 0;
}

export type ListOpts = {
  tenantId: string;
  kind?: SourceKind;
  afterKey?: string;
  limit: number;
};

/** Trang theo `key` tăng dần; `limit + 1` để biết còn trang. */
export async function listSources(tx: Tx, o: ListOpts): Promise<SourceRow[]> {
  const kindF = o.kind ? sql`and s.kind = ${o.kind}` : sql``;
  const afterF = o.afterKey ? sql`and s.key > ${o.afterKey}` : sql``;
  return tx.execute<SourceRow>(sql`select ${COLS} from hub.sources s
    where s.tenant_id = ${o.tenantId} and s.deleted_at is null ${kindF} ${afterF}
    order by s.key asc limit ${o.limit + 1}`);
}

export async function updateSource(
  tx: Tx,
  id: string,
  u: { config: SourceConfig; description: string; actorId: string },
): Promise<SourceRow> {
  const [r] = await tx.execute<SourceRow>(sql`with up as (update hub.sources as s
    set config = ${JSON.stringify(u.config)}::jsonb, description = ${u.description},
      kind = ${(u.config as { kind: SourceKind }).kind}, version = version + 1,
      updated_by = ${u.actorId}, updated_at = now()
    where s.id = ${id} returning *) select ${COLS} from up s`);
  if (!r) throw new Error("update hub.sources không trả hàng");
  return r;
}

export async function softDeleteSource(tx: Tx, id: string, actorId: string): Promise<void> {
  await tx.execute(sql`update hub.sources set deleted_at = now(), version = version + 1,
    updated_by = ${actorId}, updated_at = now() where id = ${id}`);
}

export async function setLastPin(
  tx: Tx,
  sourceId: string,
  tenantId: string,
  pin: SourcePin,
): Promise<void> {
  await tx.execute(sql`update hub.sources set last_pin = ${JSON.stringify(pin)}::jsonb,
    last_pin_at = now() where id = ${sourceId} and tenant_id = ${tenantId} and deleted_at is null`);
}

/** Quy trình (còn sống) của tenant tham chiếu nguồn `key` — cho `SourceView.used_by`. */
export async function usedByKeys(tx: Tx, tenantId: string, key: string): Promise<string[]> {
  const rows = await tx.execute<{ key: string }>(sql`select key from hub.process_defs
    where tenant_id = ${tenantId} and deleted_at is null and sources ? ${key} order by key asc`);
  return rows.map((r) => r.key);
}

type DefStagesRow = {
  process_key: string;
  stages: { key: string; sources?: { source_key: string }[] }[];
};

/** {process_key, stage_key} mọi stage tham chiếu nguồn `key` — chi tiết 409 SOURCE_IN_USE. */
export async function inUseRefs(
  tx: Tx,
  tenantId: string,
  key: string,
): Promise<{ process_key: string; stage_key: string }[]> {
  const rows =
    await tx.execute<DefStagesRow>(sql`select key as process_key, stages from hub.process_defs
    where tenant_id = ${tenantId} and deleted_at is null and sources ? ${key} order by key asc`);
  const refs: { process_key: string; stage_key: string }[] = [];
  for (const d of rows)
    for (const st of d.stages ?? [])
      if ((st.sources ?? []).some((s) => s.source_key === key))
        refs.push({ process_key: d.process_key, stage_key: st.key });
  return refs;
}

/** PB-R04/C10 · tài liệu library còn sống của tenant (kho H2c). */
export async function libraryDocExists(
  tx: Tx,
  tenantId: string,
  documentId: string,
): Promise<boolean> {
  const [r] = await tx.execute<{ n: number }>(sql`select count(*)::int as n from hub.attachments
    where id = ${documentId} and tenant_id = ${tenantId} and origin = 'library' and purged_at is null`);
  return (r?.n ?? 0) > 0;
}

/** Chip nguồn cho user thường (`GET /process-runs/sources`) — scope `user`, RLS lọc tenant. */
export async function chipRows(
  tx: Tx,
): Promise<{ key: string; kind: SourceKind; description: string; config: SourceConfig }[]> {
  return tx.execute<{ key: string; kind: SourceKind; description: string; config: SourceConfig }>(
    sql`select key, kind, description, config from hub.sources where deleted_at is null order by key asc`,
  );
}

/** Token job → job `source.resolve` đang chạy (scope system; kiểm id/type ở người gọi). */
export async function resolveJobByTokenHash(
  tx: Tx,
  hash: Buffer,
): Promise<{ id: string; tenantId: string; type: string; payload: unknown } | undefined> {
  const [r] = await tx.execute<{ id: string; tenant_id: string; type: string; payload: unknown }>(
    sql`select id, tenant_id, type, payload from hub.jobs where token_hash = ${hash} and status = 'running'`,
  );
  return r && { id: r.id, tenantId: r.tenant_id, type: r.type, payload: r.payload };
}

/** Enqueue job `source.resolve` (không run/agent/provider — cột nullable sau 0021). */
export async function enqueueResolveJob(
  tx: Tx,
  o: { jobId: string; tenantId: string; userId: string; payload: unknown },
): Promise<void> {
  await tx.execute(sql`insert into hub.jobs (id, tenant_id, user_id, type, payload, status)
    values (${o.jobId}, ${o.tenantId}, ${o.userId}, 'source.resolve', ${JSON.stringify(o.payload)}::jsonb, 'queued')`);
}

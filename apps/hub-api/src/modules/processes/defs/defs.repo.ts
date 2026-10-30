// HUB-FR-104 · ADM-FR-65 · HUB-BR-25 · SQL `hub.process_defs` (plan §2.1, D17). Cách ly tenant ở repo: mọi câu lọc
// `tenant_id = T` hoặc `tenant_id IS NULL` (mẫu) — gọi trong tx scope `system` (`withConfigWrite`/đọc system).
import type { ProcessDefInput, ProcessInputDef } from "@ai/contracts/hub-admin";
import type { Tx } from "@ai/db";
import { type SQL, sql } from "drizzle-orm";
import type { DefScope, PageKey } from "./def.rules";

export type { DefScope } from "./def.rules";

export type DefRow = {
  id: string;
  tenant_id: string | null;
  key: string;
  name: string;
  description: string;
  input_hint: string;
  run_group_ids: string[];
  stages: ProcessDefInput["stages"];
  token_budget: number | null;
  enabled: boolean;
  sources: string[];
  inputs: ProcessInputDef[];
  ttl_days: number | null;
  source_template_id: string | null;
  version: number;
  created_at: string;
  updated_at: string;
};
export type DefListRow = Pick<
  DefRow,
  "id" | "tenant_id" | "key" | "name" | "enabled" | "version" | "updated_at"
> & {
  stage_count: number;
  active_runs: number;
};

const iso = (col: SQL) => sql`to_char(${col} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
const COLS = sql`d.id, d.tenant_id, d.key, d.name, d.description, d.input_hint, d.run_group_ids, d.stages,
  d.token_budget, d.enabled, coalesce(d.sources, '[]'::jsonb) as sources,
  coalesce(d.inputs, '[]'::jsonb) as inputs, d.ttl_days, d.source_template_id, d.version,
  ${iso(sql`d.created_at`)} as created_at, ${iso(sql`d.updated_at`)} as updated_at`;

const visible = (s: DefScope) =>
  s.tenantId === null
    ? sql`d.tenant_id is null`
    : sql`(d.tenant_id = ${s.tenantId} or d.tenant_id is null)`;

export type ListOpts = DefScope & { includeTemplates: boolean; limit: number; after?: PageKey };

/** Idx `process_defs_tenant_updated_idx`; `limit + 1` để biết còn trang. */
export async function listDefs(tx: Tx, o: ListOpts): Promise<DefListRow[]> {
  const scope =
    o.includeTemplates || o.tenantId === null ? visible(o) : sql`d.tenant_id = ${o.tenantId}`;
  const after = o.after
    ? sql`and (d.updated_at, d.id) < (${o.after[0]}::timestamptz, ${o.after[1]}::uuid)`
    : sql``;
  return tx.execute<DefListRow>(sql`select d.id, d.tenant_id, d.key, d.name, d.enabled, d.version,
      ${iso(sql`d.updated_at`)} as updated_at, jsonb_array_length(d.stages)::int as stage_count,
      (select count(*)::int from hub.process_runs r where r.process_def_id = d.id
        and r.status in ('running', 'waiting_review', 'waiting_answer', 'needs_decision')) as active_runs
    from hub.process_defs d
    where d.deleted_at is null and ${scope} ${after}
    order by d.updated_at desc, d.id desc limit ${o.limit + 1}`);
}

/** Một định nghĩa còn sống trong phạm vi; `lock` ⇒ FOR UPDATE (ghi). */
export async function readDef(
  tx: Tx,
  s: DefScope,
  id: string,
  lock = false,
): Promise<DefRow | null> {
  const [r] = await tx.execute<DefRow>(sql`select ${COLS} from hub.process_defs d
    where d.id = ${id} and d.deleted_at is null and ${visible(s)} ${lock ? sql`for update` : sql``}`);
  return r ?? null;
}

/** Key đã dùng trong cùng phạm vi (tenant hoặc mẫu) — gọi sau khoá `config_meta` nên không race. */
export async function keyTaken(
  tx: Tx,
  tenantId: string | null,
  key: string,
  exceptId?: string,
): Promise<boolean> {
  const t = tenantId === null ? sql`tenant_id is null` : sql`tenant_id = ${tenantId}`;
  const ex = exceptId ? sql`and id <> ${exceptId}` : sql``;
  const [r] = await tx.execute<{ n: number }>(sql`select count(*)::int as n from hub.process_defs
    where ${t} and key = ${key} and deleted_at is null ${ex}`);
  return (r?.n ?? 0) > 0;
}

/** PB-R06 · key nguồn còn sống trong tenant (để báo SOURCE_NOT_FOUND khi def tham chiếu key lạ). */
export async function liveSourceKeys(
  tx: Tx,
  tenantId: string | null,
  keys: readonly string[],
): Promise<Set<string>> {
  if (tenantId === null || keys.length === 0) return new Set();
  const rows = await tx.execute<{ key: string }>(sql`select key from hub.sources
    where tenant_id = ${tenantId} and deleted_at is null and key = any(${`{${keys.join(",")}}`}::text[])`);
  return new Set(rows.map((r) => r.key));
}

/** PC-R01 · loại của các nguồn còn sống (key → kind) — kiểm nguồn của stage tự-sửa. */
export async function liveSourceKinds(
  tx: Tx,
  tenantId: string | null,
  keys: readonly string[],
): Promise<Map<string, string>> {
  if (tenantId === null || keys.length === 0) return new Map();
  const rows = await tx.execute<{ key: string; kind: string }>(sql`select key, kind from hub.sources
    where tenant_id = ${tenantId} and deleted_at is null and key = any(${`{${keys.join(",")}}`}::text[])`);
  return new Map(rows.map((r) => [r.key, r.kind]));
}

export type DefWrite = {
  tenantId: string | null;
  input: ProcessDefInput;
  sourceTemplateId: string | null;
  ttlDays: number | null;
  actorId: string;
};

export async function insertDef(tx: Tx, w: DefWrite): Promise<DefRow> {
  const d = w.input;
  const [r] =
    await tx.execute<DefRow>(sql`with ins as (insert into hub.process_defs as d (tenant_id, key, name,
      description, input_hint, run_group_ids, stages, token_budget, enabled, sources, inputs, ttl_days, source_template_id,
      created_by, updated_by)
    values (${w.tenantId}, ${d.key}, ${d.name}, ${d.description}, ${d.input_hint}, ${pgUuids(d.run_group_ids)},
      ${JSON.stringify(d.stages)}::jsonb, ${d.token_budget}, ${d.enabled}, ${JSON.stringify(d.sources)}::jsonb,
      ${JSON.stringify(d.inputs)}::jsonb, ${w.ttlDays}, ${w.sourceTemplateId}, ${w.actorId}, ${w.actorId})
    returning *) select ${COLS} from ins d`);
  if (!r) throw new Error("insert process_defs không trả hàng");
  return r;
}

export async function updateDef(
  tx: Tx,
  w: { id: string; input: ProcessDefInput; ttlDays: number | null; actorId: string },
): Promise<DefRow> {
  const { id, ttlDays, actorId } = w;
  const d = w.input;
  const [r] =
    await tx.execute<DefRow>(sql`with up as (update hub.process_defs set key = ${d.key}, name = ${d.name},
      description = ${d.description}, input_hint = ${d.input_hint}, run_group_ids = ${pgUuids(d.run_group_ids)},
      stages = ${JSON.stringify(d.stages)}::jsonb, token_budget = ${d.token_budget}, enabled = ${d.enabled},
      sources = ${JSON.stringify(d.sources)}::jsonb, inputs = ${JSON.stringify(d.inputs)}::jsonb,
      ttl_days = ${ttlDays}, version = version + 1, updated_by = ${actorId}, updated_at = now(),
      source_ref = null
    where id = ${id} returning *) select ${COLS} from up d`);
  if (!r) throw new Error("update process_defs không trả hàng");
  return r;
}

export async function softDeleteDef(tx: Tx, id: string, actorId: string): Promise<void> {
  await tx.execute(sql`update hub.process_defs set deleted_at = now(), version = version + 1,
    updated_by = ${actorId}, updated_at = now() where id = ${id}`);
}

/** `uuid[]` qua literal mảng (postgres.js không tự ép mảng JS trong `sql` drizzle). */
const pgUuids = (ids: readonly string[]) => sql`${`{${ids.join(",")}}`}::uuid[]`;

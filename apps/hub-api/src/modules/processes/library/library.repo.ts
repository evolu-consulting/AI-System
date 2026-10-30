// CR-105 · L2a · SQL def thư viện (`tenant_id NULL` + `slot`) + bản phát hành bất biến. Gọi trong tx scope system (`withConfigWrite`
// ghi / đọc system) sau cổng platform_admin ở route. Mỗi việc số câu cố định (Luật 4c).
import type { Tx } from "@ai/db";
import { type SQL, sql } from "drizzle-orm";

export type LibRow = {
  id: string;
  key: string;
  name: string;
  slot: string;
  slot_body: unknown;
  stages: unknown[];
  enabled: boolean;
  published_version: number | null;
  version: number;
};
const iso = (col: SQL) => sql`to_char(${col} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
const LIB_COLS = sql`d.id, d.key, d.name, d.slot, d.slot_body, d.stages, d.enabled, d.published_version, d.version`;
const IS_LIB = sql`d.tenant_id is null and d.slot is not null and d.deleted_at is null`;

/** Def thư viện còn sống; `lock` ⇒ FOR UPDATE (publish/rollback/clone đọc nguồn). */
export async function readLibDef(tx: Tx, id: string, lock = false): Promise<LibRow | null> {
  const [r] = await tx.execute<LibRow>(sql`select ${LIB_COLS} from hub.process_defs d
    where d.id = ${id} and ${IS_LIB} ${lock ? sql`for update` : sql``}`);
  return r ?? null;
}

/** Def thư viện (còn sống) theo `key` + khe; một câu SQL cố định theo index key. */
export async function readLibDefByKey(tx: Tx, key: string, slot: string): Promise<LibRow | null> {
  const [r] = await tx.execute<LibRow>(sql`select ${LIB_COLS} from hub.process_defs d
    where d.key = ${key} and d.slot = ${slot} and ${IS_LIB}`);
  return r ?? null;
}
export type ReleaseRow = {
  rel_version: number;
  name: string;
  published_at: string;
  published_by: string | null;
  note: string | null;
  stages: unknown[];
  slot_body: unknown;
};

/** Chụp `snap` thành bản `max+1` + đặt nháp = `snap`, `published_version` = bản mới, version nháp +1 (đua ⇒ người sau 409). */
export async function release(
  tx: Tx,
  w: {
    id: string;
    snap: { name: string; stages: unknown[]; slotBody: unknown };
    actorId: string;
    note: string;
  },
): Promise<{ rel_version: number; version: number }> {
  const s = w.snap;
  const [r] = await tx.execute<{ rel_version: number; version: number }>(sql`with rel as (
      insert into hub.process_def_releases (def_id, rel_version, name, stages, slot_body, published_by, note)
      select ${w.id}, coalesce(max(rel_version), 0) + 1, ${s.name}, ${JSON.stringify(s.stages)}::jsonb,
        ${JSON.stringify(s.slotBody ?? null)}::jsonb, ${w.actorId}, ${w.note}
      from hub.process_def_releases where def_id = ${w.id}
      returning rel_version)
    update hub.process_defs d set published_version = rel.rel_version, name = ${s.name},
      stages = ${JSON.stringify(s.stages)}::jsonb, slot_body = ${JSON.stringify(s.slotBody ?? null)}::jsonb,
      version = d.version + 1, updated_by = ${w.actorId}, updated_at = now()
    from rel where d.id = ${w.id} returning rel.rel_version, d.version`);
  if (!r) throw new Error("release: không ghi được");
  return { rel_version: Number(r.rel_version), version: Number(r.version) };
}

const REL_COLS = sql`r.rel_version, r.name, ${iso(sql`r.published_at`)} as published_at,
  r.published_by::text as published_by, nullif(r.note, '') as note`;

export const listReleases = (tx: Tx, defId: string): Promise<ReleaseRow[]> =>
  tx.execute<ReleaseRow>(sql`select ${REL_COLS} from hub.process_def_releases r
    where r.def_id = ${defId} order by r.rel_version desc limit 200`);

export async function readRelease(tx: Tx, defId: string, rel: number): Promise<ReleaseRow | null> {
  const [r] = await tx.execute<ReleaseRow>(sql`select ${REL_COLS}, r.stages, r.slot_body
    from hub.process_def_releases r where r.def_id = ${defId} and r.rel_version = ${rel}`);
  return r ?? null;
}

/** Def đang gán (số tenant) / là mặc định của khe nào đó — chặn xoá/tắt/đổi key-khe (409 PROCESS_IN_USE). */
export async function usage(
  tx: Tx,
  defId: string,
): Promise<{ tenant_count: number; is_default: boolean }> {
  const [r] = await tx.execute<{ tenant_count: number; is_default: boolean }>(sql`select
    (select count(*)::int from hub.process_slot_assignments a where a.def_id = ${defId}) as tenant_count,
    exists (select 1 from hub.process_slots s where s.default_def_id = ${defId}) as is_default`);
  return { tenant_count: Number(r?.tenant_count ?? 0), is_default: r?.is_default === true };
}

/** Key def thư viện đã dùng có tiền tố `base` (nhân bản chọn hậu tố trống — một câu). */
export async function libKeysLike(tx: Tx, base: string): Promise<Set<string>> {
  const rows = await tx.execute<{ key: string }>(sql`select key from hub.process_defs
    where tenant_id is null and deleted_at is null and starts_with(key, ${base})`);
  return new Set(rows.map((r) => r.key));
}

export async function insertClone(
  tx: Tx,
  w: { src: string; key: string; name: string; actorId: string },
): Promise<string> {
  const [r] = await tx.execute<{
    id: string;
  }>(sql`insert into hub.process_defs (tenant_id, key, name,
      description, input_hint, run_group_ids, stages, token_budget, enabled, sources, inputs, ttl_days, slot, slot_body,
      created_by, updated_by)
    select null, ${w.key}, ${w.name}, description, input_hint, run_group_ids, stages, token_budget, enabled, sources,
      inputs, ttl_days, slot, slot_body, ${w.actorId}, ${w.actorId}
    from hub.process_defs where id = ${w.src} returning id::text as id`);
  if (!r) throw new Error("clone: không ghi được");
  return r.id;
}

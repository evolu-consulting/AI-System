// DLC-R14 · SQL `hub.dlc_workflows` (danh mục platform, không RLS — như hub.agents). Gọi trong `withHubScope(system)`.
import type { DlcWorkflow, DlcWorkflowCreate, DlcWorkflowPatch } from "@ai/contracts/hub-admin";
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";

const COLS = sql`id, key, name, description, process, human_mode, lane, is_default, enabled, version,
  to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as updated_at`;

export async function listWorkflows(tx: Tx): Promise<DlcWorkflow[]> {
  return tx.execute<DlcWorkflow>(
    sql`select ${COLS} from hub.dlc_workflows order by process, is_default desc, key limit 200`,
  );
}

export async function findWorkflow(tx: Tx, id: string): Promise<DlcWorkflow | null> {
  const [r] = await tx.execute<DlcWorkflow>(
    sql`select ${COLS} from hub.dlc_workflows where id = ${id}`,
  );
  return r ?? null;
}

export async function keyExists(tx: Tx, key: string): Promise<boolean> {
  const [r] = await tx.execute<{ n: number }>(
    sql`select count(*)::int as n from hub.dlc_workflows where key = ${key}`,
  );
  return (r?.n ?? 0) > 0;
}

/** Bỏ cờ mặc định của process (trước khi đặt workflow khác làm mặc định). */
export async function clearDefault(tx: Tx, process: string, exceptId?: string): Promise<void> {
  await tx.execute(sql`update hub.dlc_workflows set is_default = false, version = version + 1, updated_at = now()
    where process = ${process} and is_default ${exceptId ? sql`and id <> ${exceptId}` : sql``}`);
}

export async function insertWorkflow(tx: Tx, w: DlcWorkflowCreate): Promise<DlcWorkflow> {
  const [r] = await tx.execute<DlcWorkflow>(sql`insert into hub.dlc_workflows
      (key, name, description, process, human_mode, lane, is_default, enabled)
    values (${w.key}, ${w.name}, ${w.description}, ${w.process}, ${w.human_mode}, ${w.lane}, ${w.is_default},
      ${w.enabled})
    returning ${COLS}`);
  if (!r) throw new Error("insert dlc_workflows returned no row");
  return r;
}

/** Ghi theo `version` (khoá lạc quan): 0 dòng ⇒ null (bản đã đổi hoặc đã xoá). */
export async function updateWorkflow(
  tx: Tx,
  id: string,
  p: DlcWorkflowPatch,
): Promise<DlcWorkflow | null> {
  const [r] = await tx.execute<DlcWorkflow>(sql`update hub.dlc_workflows set
      name = coalesce(${p.name ?? null}, name),
      description = coalesce(${p.description ?? null}, description),
      process = coalesce(${p.process ?? null}, process),
      human_mode = ${p.human_mode === undefined ? sql`human_mode` : sql`${p.human_mode}`},
      lane = ${p.lane === undefined ? sql`lane` : sql`${p.lane}`},
      is_default = coalesce(${p.is_default ?? null}, is_default),
      enabled = coalesce(${p.enabled ?? null}, enabled),
      version = version + 1, updated_at = now()
    where id = ${id} and version = ${p.version}
    returning ${COLS}`);
  return r ?? null;
}

export async function deleteWorkflow(tx: Tx, id: string): Promise<boolean> {
  const rows = await tx.execute(sql`delete from hub.dlc_workflows where id = ${id} returning 1`);
  return rows.length > 0;
}

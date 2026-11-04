// dlc-step-library · SQL thư viện bước DLC (`hub.dlc_step_templates`, RLS chỉ system). Gọi trong tx scope system (`withConfigWrite`
// ghi / đọc system) sau cổng platform_admin ở route. Mỗi việc số câu cố định.
import type { DlcStepTemplate, DlcStepTemplateInput } from "@ai/contracts/hub-admin";
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";

const COLS = sql`id, key, name, action, agent_key, instruction, gate_group, reject_to, max_rounds, timeout_min, version,
  to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as updated_at`;

export async function listSteps(tx: Tx): Promise<DlcStepTemplate[]> {
  return [
    ...(await tx.execute<DlcStepTemplate>(
      sql`select ${COLS} from hub.dlc_step_templates order by name, key`,
    )),
  ];
}

/** Một mẫu theo id; `lock` ⇒ FOR UPDATE (sửa / xoá). */
export async function readStep(tx: Tx, id: string, lock = false): Promise<DlcStepTemplate | null> {
  const [r] = await tx.execute<DlcStepTemplate>(sql`select ${COLS} from hub.dlc_step_templates
    where id = ${id} ${lock ? sql`for update` : sql``}`);
  return r ?? null;
}

/** Khoá đã có ở mẫu khác (`except` = mẫu đang sửa). Ghi tuần tự sau khoá `config_meta` ⇒ kiểm trước không đua. */
export async function keyTaken(tx: Tx, key: string, except: string | null): Promise<boolean> {
  const q = sql`select count(*)::int as n from hub.dlc_step_templates
    where key = ${key} and (${except}::uuid is null or id <> ${except}::uuid)`;
  const [r] = await tx.execute<{ n: number }>(q);
  return (r?.n ?? 0) > 0;
}

export async function insertStep(tx: Tx, v: DlcStepTemplateInput): Promise<DlcStepTemplate> {
  const [r] = await tx.execute<DlcStepTemplate>(sql`insert into hub.dlc_step_templates
      (key, name, action, agent_key, instruction, gate_group, reject_to, max_rounds, timeout_min)
    values (${v.key}, ${v.name}, ${v.action}, ${v.agent_key}, ${v.instruction}, ${v.gate_group}, ${v.reject_to},
      ${v.max_rounds}, ${v.timeout_min})
    returning ${COLS}`);
  if (!r) throw new Error("dlc-step-insert");
  return r;
}

/** Ghi đè mọi trường + version +1 (đã kiểm version dưới khoá hàng). */
export async function updateStep(
  tx: Tx,
  id: string,
  v: DlcStepTemplateInput,
): Promise<DlcStepTemplate> {
  const [r] =
    await tx.execute<DlcStepTemplate>(sql`update hub.dlc_step_templates set key = ${v.key},
      name = ${v.name}, action = ${v.action}, agent_key = ${v.agent_key}, instruction = ${v.instruction},
      gate_group = ${v.gate_group}, reject_to = ${v.reject_to}, max_rounds = ${v.max_rounds},
      timeout_min = ${v.timeout_min}, version = version + 1, updated_at = now()
    where id = ${id} returning ${COLS}`);
  if (!r) throw new Error("dlc-step-update");
  return r;
}

export async function deleteStep(tx: Tx, id: string): Promise<void> {
  await tx.execute(sql`delete from hub.dlc_step_templates where id = ${id}`);
}

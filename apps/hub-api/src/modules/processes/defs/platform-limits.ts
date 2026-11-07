// CR-122 · p22 · số bước tối đa của một quy trình = cài đặt NỀN TẢNG (`hub.platform_settings`, khoá `process.stages_max`, migration hub 0115).
// Vắng/sai ⇒ mặc định 22; luôn kẹp ≤ trần 50 (`resolveStagesMax`). Đọc một câu; ghi do platform_admin qua `PUT /process-editor/limits`.
import {
  PROCESS_STAGES_CEILING,
  PROCESS_STAGES_DEFAULT,
  type ProcessLimits,
  resolveStagesMax,
} from "@ai/contracts/hub-admin";
import type { Tx } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";
import type { Db } from "../../../lib/db";
import { defError } from "./defs.map";

export const STAGES_MAX_KEY = "process.stages_max";

export const limitsOf = (stagesMax: number): ProcessLimits => ({
  stages_max: stagesMax,
  ceiling: PROCESS_STAGES_CEILING,
  default: PROCESS_STAGES_DEFAULT,
});

export async function readStagesMax(tx: Tx): Promise<number> {
  const [r] = await tx.execute<{ value: unknown }>(
    sql`select value from hub.platform_settings where key = ${STAGES_MAX_KEY}`,
  );
  return resolveStagesMax(r?.value);
}

export async function writeStagesMax(tx: Tx, n: number, actor: string): Promise<void> {
  await tx.execute(sql`
    insert into hub.platform_settings as s (key, value, updated_by, updated_at)
    values (${STAGES_MAX_KEY}, to_jsonb(${n}::int), ${actor}, now())
    on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at`);
}

/** Số stage vượt cài đặt nền tảng ⇒ 422 `PROCESS_DEF_INVALID` (`paths = ["stages"]`, `stages_max`). */
export async function assertStagesWithinLimit(tx: Tx, count: number): Promise<void> {
  const max = await readStagesMax(tx);
  if (count > max) throw defError("PROCESS_DEF_INVALID", { paths: ["stages"], stages_max: max });
}

/** `GET /process-editor/limits`. */
export const getLimits = (db: Db): Promise<ProcessLimits> =>
  withHubScope(db, { kind: "system" }, async (tx) => limitsOf(await readStagesMax(tx)), {
    accessMode: "read only",
  });

/** `PUT /process-editor/limits` (route chỉ cho platform_admin). */
export async function saveLimits(db: Db, actor: string, n: number): Promise<ProcessLimits> {
  await withHubScope(db, { kind: "system" }, (tx) => writeStagesMax(tx, n, actor));
  return limitsOf(n);
}

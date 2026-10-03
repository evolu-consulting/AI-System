// ADM-FR-52 · M4-R13 · khôi phục command từ snapshot audit (plan M4 §4.4): cập nhật như PATCH (version = bản được
// khôi phục) hoặc chèn lại cùng id như POST; workflow mất → RESTORE_REF_MISSING; feature_ids mất bị bỏ (rỗng →
// COMMAND_NEEDS_FEATURE của module); trùng tên/alias → NAME_TAKEN. Khoá: đúng chuỗi PATCH/POST (M3 §6.2).
import { CommandCreateRequestSchema, CommandUpdateRequestSchema } from "@ai/contracts";
import type { ConfigSink, Tx } from "@ai/db";
import {
  existingIds,
  expectVersion,
  failRefMissing,
  keepExisting,
  mapNameTaken,
  parseSnapshot,
  pick,
  type Restored,
  type RestoreEntry,
  reinsertVersion,
  restoreMode,
} from "../audit/audit.restore-kit";
import * as repo from "./commands.repo";
import { type Call, createCommandIn, updateCommandIn } from "./commands.service";

const KEYS = [
  "name",
  "aliases",
  "description",
  "workflow_id",
  "args",
  "input_map",
  "output",
  "mode",
  "timeout_s",
  "enabled",
] as const;

export async function restoreCommand(
  tx: Tx,
  ch: ConfigSink,
  c: Call,
  e: RestoreEntry,
): Promise<Restored> {
  const cur = await repo.findCommand(tx, e.entityId);
  const mode = restoreMode(e, { exists: cur !== null, version: cur?.version ?? null });
  const wf = e.before.workflow_id;
  if (typeof wf === "string" && !(await existingIds(tx, "workflow", [wf])).has(wf))
    failRefMissing([{ entity: "workflow", id: wf }]);
  const fields = {
    ...pick(e.before, KEYS),
    feature_ids: await keepExisting(tx, "feature", e.before.feature_ids),
  };
  if (mode === "insert") {
    const input = parseSnapshot(CommandCreateRequestSchema, fields);
    const at = { id: e.entityId, version: reinsertVersion(e) };
    return mapNameTaken("command", null, () => createCommandIn({ tx, ch }, c, input, at));
  }
  const input = parseSnapshot(CommandUpdateRequestSchema, { ...fields, version: expectVersion(e) });
  return mapNameTaken("command", null, () => updateCommandIn({ tx, ch }, c, e.entityId, input));
}

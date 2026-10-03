// ADM-FR-52 · M4-R13 · khôi phục workflow từ snapshot audit (plan M4 §4.4): cập nhật như PATCH (version = bản được
// khôi phục) hoặc chèn lại cùng id như POST; secret mất → RESTORE_REF_MISSING; key trùng → NAME_TAKEN. Luật module
// (WORKFLOW_IN_USE, SCHEMA_BREAKS_COMMANDS…) chạy lại trong lõi. Khoá: đúng chuỗi PATCH/POST (M3 §6.2).
import { WorkflowCreateRequestSchema, WorkflowUpdateRequestSchema } from "@ai/contracts";
import type { ConfigSink, Tx } from "@ai/db";
import {
  existingIds,
  expectVersion,
  failRefMissing,
  mapNameTaken,
  parseSnapshot,
  pick,
  type Restored,
  type RestoreEntry,
  reinsertVersion,
  restoreMode,
} from "../audit/audit.restore-kit";
import * as repo from "./workflows.repo";
import { type Call, createWorkflowIn, updateWorkflowIn } from "./workflows.service";

const KEYS = [
  "name",
  "description",
  "app_type",
  "base_url",
  "secret_id",
  "input_schema",
  "output_field",
  "enabled",
] as const;

export async function restoreWorkflow(
  tx: Tx,
  ch: ConfigSink,
  c: Call,
  e: RestoreEntry,
): Promise<Restored> {
  const cur = await repo.findWorkflow(tx, e.entityId, false);
  const mode = restoreMode(e, { exists: cur !== null, version: cur?.version ?? null });
  const sec = e.before.secret_id;
  if (typeof sec === "string" && !(await existingIds(tx, "secret", [sec])).has(sec))
    failRefMissing([{ entity: "secret", id: sec }]);
  const key = typeof e.before.key === "string" ? e.before.key : null;
  const fields = pick(e.before, KEYS);
  if (mode === "insert") {
    const input = parseSnapshot(WorkflowCreateRequestSchema, { ...fields, key: e.before.key });
    const at = { id: e.entityId, version: reinsertVersion(e) };
    return mapNameTaken("workflow", key, () => createWorkflowIn({ tx, ch }, c, input, at));
  }
  const input = parseSnapshot(WorkflowUpdateRequestSchema, {
    ...fields,
    version: expectVersion(e),
  });
  return mapNameTaken("workflow", key, () => updateWorkflowIn({ tx, ch }, c, e.entityId, input));
}

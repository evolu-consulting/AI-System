// ADM-FR-52 · M4-R13 · khôi phục group từ snapshot audit (plan M4 §4.4): cập nhật như PATCH (version = bản được
// khôi phục) hoặc chèn lại cùng id vào tenant của dòng audit như POST — không kèm member/grant; key trùng → NAME_TAKEN.
import { GroupCreateRequestSchema, GroupUpdateRequestSchema } from "@ai/contracts";
import type { ConfigSink, Tx } from "@ai/db";
import { appError } from "../../lib/errors";
import {
  expectVersion,
  mapNameTaken,
  parseSnapshot,
  pick,
  type Restored,
  type RestoreEntry,
  reinsertVersion,
  restoreMode,
} from "../audit/audit.restore-kit";
import * as repo from "./groups.repo";
import { type Call, createGroupIn, updateGroupIn } from "./groups.service";

const KEYS = ["name", "description"] as const;

export async function restoreGroup(
  tx: Tx,
  ch: ConfigSink,
  c: Call,
  e: RestoreEntry,
): Promise<Restored> {
  const cur = await repo.findGroup(tx, null, e.entityId);
  const mode = restoreMode(e, { exists: cur !== null, version: cur?.version ?? null });
  const key = typeof e.before.key === "string" ? e.before.key : null;
  const fields = pick(e.before, KEYS);
  if (mode === "insert") {
    const tenantId = e.tenantId;
    if (!tenantId) throw appError("NOT_RESTORABLE");
    const input = parseSnapshot(GroupCreateRequestSchema, { ...fields, key });
    const at = { id: e.entityId, version: reinsertVersion(e) };
    return mapNameTaken("group", key, () => createGroupIn({ tx, ch }, c, { tenantId, input }, at));
  }
  const input = parseSnapshot(GroupUpdateRequestSchema, { ...fields, version: expectVersion(e) });
  return mapNameTaken("group", key, () => updateGroupIn({ tx, ch }, c, e.entityId, input));
}

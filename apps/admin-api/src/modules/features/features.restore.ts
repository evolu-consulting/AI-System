// ADM-FR-52 · M4-R13 · khôi phục feature từ snapshot audit (plan M4 §4.4): cập nhật như PATCH (version = bản được
// khôi phục) hoặc chèn lại cùng id như POST — không kèm entitlement/grant/quota; command_ids đã mất bị bỏ; key trùng
// → NAME_TAKEN. Luật module (CORE_FEATURE_PROTECTED…) chạy lại trong lõi.
import { FeatureCreateRequestSchema, FeatureUpdateRequestSchema } from "@ai/contracts";
import type { ConfigSink, Tx } from "@ai/db";
import {
  expectVersion,
  keepExisting,
  mapNameTaken,
  parseSnapshot,
  pick,
  type Restored,
  type RestoreEntry,
  reinsertVersion,
  restoreMode,
} from "../audit/audit.restore-kit";
import * as repo from "./features.repo";
import { type Call, createFeatureIn, updateFeatureIn } from "./features.service";

const KEYS = ["name", "description", "icon", "status"] as const;

export async function restoreFeature(
  tx: Tx,
  ch: ConfigSink,
  c: Call,
  e: RestoreEntry,
): Promise<Restored> {
  const cur = await repo.findFeature(tx, e.entityId);
  const mode = restoreMode(e, { exists: cur !== null, version: cur?.version ?? null });
  const fields = {
    ...pick(e.before, KEYS),
    command_ids: await keepExisting(tx, "command", e.before.command_ids),
  };
  const key = typeof e.before.key === "string" ? e.before.key : null;
  if (mode === "insert") {
    const input = parseSnapshot(FeatureCreateRequestSchema, { ...fields, key: e.before.key });
    const at = { id: e.entityId, version: reinsertVersion(e) };
    return mapNameTaken("feature", key, () => createFeatureIn({ tx, ch }, c, input, at));
  }
  const input = parseSnapshot(FeatureUpdateRequestSchema, { ...fields, version: expectVersion(e) });
  return mapNameTaken("feature", key, () => updateFeatureIn({ tx, ch }, c, e.entityId, input));
}

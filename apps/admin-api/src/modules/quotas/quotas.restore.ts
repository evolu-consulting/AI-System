// ADM-FR-52 · M4-R13 · Q9 · khôi phục bộ quota của tenant từ snapshot audit (plan M4 §4.4): thay cả bộ như PUT với
// `version` = version tenant sau thay đổi được khôi phục; dòng của feature đã xoá bị bỏ. Khoá: đúng chuỗi Quota PUT
// (§6). Evaluator chạy sau commit do nơi gọi (`evaluateLater`).
import { QuotaSetRequestSchema } from "@ai/contracts";
import type { ConfigSink, Tx } from "@ai/db";
import {
  existingIds,
  expectVersion,
  parseSnapshot,
  pick,
  type Restored,
  type RestoreEntry,
  restoreMode,
} from "../audit/audit.restore-kit";
import * as repo from "./quotas.repo";
import { checkItems, putQuotasIn, type QuotasCall } from "./quotas.service";

const ITEM_KEYS = ["feature_id", "max_runs", "max_tokens", "max_usd"] as const;

/** `before.items` (có `feature_key` để đọc) → dòng request; bỏ dòng của feature không còn. */
async function itemsOf(tx: Tx, raw: unknown): Promise<Record<string, unknown>[]> {
  const rows = Array.isArray(raw) ? raw : [];
  const items = rows.map((r) => pick((r ?? {}) as Record<string, unknown>, ITEM_KEYS));
  const fids = items.flatMap((i) => (typeof i.feature_id === "string" ? [i.feature_id] : []));
  const have = await existingIds(tx, "feature", fids);
  return items.filter((i) => typeof i.feature_id !== "string" || have.has(i.feature_id));
}

export async function restoreQuota(
  tx: Tx,
  ch: ConfigSink,
  c: QuotasCall,
  e: RestoreEntry,
): Promise<Restored> {
  const cur = await repo.findTenant(tx, e.entityId, false);
  restoreMode(e, { exists: cur !== null, version: cur?.version ?? null });
  const input = parseSnapshot(QuotaSetRequestSchema, {
    version: expectVersion(e),
    items: await itemsOf(tx, e.before.items),
  });
  checkItems(input.items);
  const r = await putQuotasIn({ tx, ch }, c, e.entityId, input);
  return { version: r.out.version };
}

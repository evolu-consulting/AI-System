// CR-127 K3 · spec §3 #7b (#74, #76) · lượt gắn bản ghi app kết thúc KHÔNG thành công ⇒ báo app qua `OutcomeHandler.cancelled?/failed?`
// (từng lượt — Dừng / settle lỗi) hoặc `failedBatch?` (MỘT lần mỗi lô `expireBatch`, tx system nhiều tenant). Hook CAS, không ném; mỗi
// lời gọi trong SAVEPOINT riêng (tx con drizzle) ⇒ hook lỗi chỉ log, KHÔNG làm hỏng lệnh dừng / settle / lô hết hạn.

import type { Tx } from "@ai/db";
import { logger } from "../../../lib/logger";
import type { FlowRunEnd } from "../../packs/kit/public";
import { outcomeHandlerFor } from "../adapters/runs/flow-ports";

/** Gói + bản ghi + sự kiện của lượt (FlowDef có `trigger`); lượt không gắn gói ⇒ null. */
export type RunPackHead = {
  packKey?: string | null;
  packRecordId?: string | null;
  snapshot?: unknown;
};
const eventOf = (snap: unknown): string | null => {
  const t = (snap as { trigger?: { event?: unknown } } | null)?.trigger;
  return typeof t?.event === "string" ? t.event : null;
};

const safe = async (tx: Tx, what: string, event: string, fn: (sp: Tx) => Promise<unknown>) => {
  try {
    await tx.transaction(async (sp) => {
      await fn(sp as unknown as Tx);
    });
  } catch (e) {
    logger.warn("flow-run-end-hook-failed", {
      hook: what,
      event,
      error: e instanceof Error ? e.message.slice(0, 200) : "unknown",
    });
  }
};

/** Một lượt (Dừng ⇒ `cancelled`; settle tổng hợp `failed` ⇒ `failed`). Không gắn gói / gói không cài hook ⇒ 0 câu. */
export async function runEndHook(
  tx: Tx,
  kind: "cancelled" | "failed",
  run: RunPackHead & { id: string; tenantId: string },
  reason: string,
): Promise<void> {
  const event = eventOf(run.snapshot);
  if (!run.packKey || !run.packRecordId || !event) return;
  const h = outcomeHandlerFor(run.packKey, event);
  const hook = h?.[kind]?.bind(h);
  if (!hook) return;
  const input: FlowRunEnd = {
    tenantId: run.tenantId,
    event,
    ref: run.packRecordId,
    runId: run.id,
    reason,
  };
  await safe(tx, kind, event, (sp) => hook(sp, input));
}

/** Lô hết hạn: gom theo handler, gọi `failedBatch` MỘT lần mỗi handler (thường 0–1 handler/lô). */
export async function runsFailedBatch(
  tx: Tx,
  runs: readonly (RunPackHead & { id: string; tenantId: string; event?: string | null })[],
  reason: string,
): Promise<void> {
  const by = new Map<
    NonNullable<ReturnType<typeof outcomeHandlerFor>>,
    { event: string; items: FlowRunEnd[] }
  >();
  for (const r of runs) {
    const event = r.event ?? eventOf(r.snapshot);
    if (!r.packKey || !r.packRecordId || !event) continue;
    const h = outcomeHandlerFor(r.packKey, event);
    if (!h?.failedBatch) continue;
    const g = by.get(h) ?? { event, items: [] };
    g.items.push({ tenantId: r.tenantId, event, ref: r.packRecordId, runId: r.id, reason });
    by.set(h, g);
  }
  for (const [h, g] of by)
    await safe(
      tx,
      "failedBatch",
      g.event,
      (sp) => h.failedBatch?.(sp, g.items) ?? Promise.resolve(),
    );
}

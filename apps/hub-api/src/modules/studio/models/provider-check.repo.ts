// HUB-FR-66 · spec H4b2 §3 A (check) · plan §3.2, D9 · câu SQL "Kiểm tra lại" subscription. Chỉ đụng cột được GRANT ở
// 0030 #4 (`last_probe_at`, `last_ok_at`) — `status`/`updated_at` do Runtime sở hữu. Index: PK `provider_state.provider_key`.
import type { Tx } from "@ai/db";
import { providerState } from "@ai/db/schema/hub";
import { eq, sql } from "drizzle-orm";

/** Giờ DB (đầu transaction) — mốc so với `last_probe_at` do Runtime ghi bằng `now()` của DB (tránh lệch đồng hồ). */
export async function dbNow(tx: Tx): Promise<Date> {
  // epoch ms dạng số: tránh parse chuỗi timestamptz (µs, "+00") khác nhau giữa engine. Làm tròn xuống ⇒ t0 ≤ now() DB.
  const [r] = await tx.execute<{ ms: number | string }>(
    sql`select (extract(epoch from now()) * 1000)::float8 as ms`,
  );
  if (!r) throw new Error("select now() returned no row");
  return new Date(Math.floor(Number(r.ms)));
}

/** D9 · xoá mốc probe ⇒ Runtime probe ở nhịp kế. Không có hàng ⇒ no-op (Runtime coi trạng thái vắng là đến hạn). */
export async function clearProbe(tx: Tx, providerKey: string): Promise<void> {
  await tx
    .update(providerState)
    .set({ lastProbeAt: null, lastOkAt: null })
    .where(eq(providerState.providerKey, providerKey));
}

export type ProbeStateRow = { status: string; lastProbeAt: Date | null; lastError: string | null };

export async function readProbeState(
  tx: Tx,
  providerKey: string,
): Promise<ProbeStateRow | undefined> {
  const [r] = await tx
    .select({
      status: providerState.status,
      lastProbeAt: providerState.lastProbeAt,
      lastError: providerState.lastError,
    })
    .from(providerState)
    .where(eq(providerState.providerKey, providerKey));
  return r;
}

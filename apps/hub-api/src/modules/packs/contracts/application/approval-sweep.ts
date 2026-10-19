// HD-FR-35 · #218 · D3-06 · D3-09 · HD3 spec §4 (Luật 4c): vòng quét theo tập của flow duyệt — (1) HĐ còn trong flow mà run đã
// kết thúc không Đạt (Từ chối ở chat-web, huỷ, hết hạn) ⇒ "Bị từ chối"; (2) HĐ `extracting` không run quá `staleMinutes` (khởi
// động lại giữa chừng, đường cũ) ⇒ `extract_failed STALE`. Mỗi lượt: mỗi tenant 1 câu đọc + MỘT câu engine gộp mọi tenant
// (`= any`) + mỗi tenant có thay đổi 1 câu ghi (lô JSON). Ghi có điều kiện ⇒ nhiều instance chạy cùng lúc vẫn đúng. Lớp 2.
import type { PackRunOutcomeSys, PackRunsBridge } from "../../kit/application/pack-runs.ports";
import type { PackSystemUow } from "../../kit/application/ports";
import type { FlowRow, SweepRepo } from "./approval.ports";

export type SweepDeps = {
  uow: PackSystemUow<{ sweep: SweepRepo }>;
  bridge: PackRunsBridge;
  /** Tenant đang bật gói (cache cấu hình, 0 SQL). */
  tenants: () => Promise<string[]>;
  staleMinutes?: number;
  /** Trần HĐ đọc mỗi tenant mỗi lượt. */
  limit?: number;
};
export type SweepResult = { tenants: number; read: number; closed: number };

const DEAD = new Set(["cancelled", "failed", "expired"]);
type Action = "rejected" | "cancelled" | "stale";
type Close = { id: string; runId: string | null; action: Action; feedback: string | null };

/** Hàng cần đóng của một tenant: quá hạn ⇒ `stale`; run (cùng tenant) đã kết thúc không Đạt ⇒ `rejected`/`cancelled`. */
function closesOf(
  t: string,
  list: readonly FlowRow[],
  byRun: ReadonlyMap<string, PackRunOutcomeSys>,
): Close[] {
  const close: Close[] = [];
  for (const r of list) {
    if (r.stale) close.push({ id: r.id, runId: null, action: "stale", feedback: null });
    const o = r.runId ? byRun.get(r.runId) : undefined;
    if (!o || o.tenant_id !== t || !DEAD.has(o.status)) continue;
    const action = o.rejected ? "rejected" : "cancelled";
    close.push({ id: r.id, runId: r.runId, action, feedback: o.feedback });
  }
  return close;
}

export async function sweepApprovalsOnce(d: SweepDeps): Promise<SweepResult> {
  const tenants = await d.tenants();
  const stale = d.staleMinutes ?? 15;
  const limit = d.limit ?? 500;
  const rows = await Promise.all(
    tenants.map(async (t) => ({
      t,
      rows: await d.uow.system(t, (r) => r.sweep.inFlow(stale, limit)),
    })),
  );
  const runIds = rows.flatMap((x) => x.rows.flatMap((r) => (r.runId ? [r.runId] : [])));
  const port = d.bridge.port;
  const outs = port && runIds.length > 0 ? await port.outcomesOf(tenants, runIds) : [];
  const byRun = new Map(outs.map((o) => [o.run_id, o]));
  let closed = 0;
  await Promise.all(
    rows.map(async ({ t, rows: list }) => {
      const close = closesOf(t, list, byRun);
      if (close.length > 0) closed += await d.uow.system(t, (r) => r.sweep.close(close));
    }),
  );
  return { tenants: tenants.length, read: runIds.length, closed };
}

/** Vòng nền: một lượt mỗi `everyMs`, dừng theo `signal`; ngủ CHỈ giữa các lượt (Luật 4c). */
export function startApprovalSweeper(
  d: SweepDeps & { everyMs: number; signal?: AbortSignal; warn: (m: string) => void },
): void {
  const tick = async () => {
    if (d.signal?.aborted) return;
    await sweepApprovalsOnce(d).catch(() => d.warn("contract-approval-sweep-failed"));
    if (d.signal?.aborted) return;
    const t = setTimeout(tick, d.everyMs);
    (t as { unref?: () => void }).unref?.();
  };
  const t = setTimeout(tick, d.everyMs);
  (t as { unref?: () => void }).unref?.();
}

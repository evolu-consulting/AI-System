// HD-FR-35 · #218 · D3-06 · D3-09 · HD3 spec §4 (Luật 4c): vòng quét theo tập của flow duyệt — (1) HĐ còn trong flow mà run đã
// kết thúc không Đạt (Từ chối ở chat-web, huỷ, hết hạn) ⇒ "Bị từ chối"; (2) HĐ `extracting` không run quá `staleMinutes` (khởi
// động lại giữa chừng, đường cũ) ⇒ `extract_failed STALE`. Mỗi lượt: mỗi tenant 1 câu đọc + MỘT câu engine gộp mọi tenant
// (`= any`) + mỗi tenant có thay đổi 1 câu ghi (lô JSON). Ghi có điều kiện ⇒ nhiều instance chạy cùng lúc vẫn đúng. Lớp 2.
import type { PackRunOutcomeSys, PackRunsBridge } from "../../kit/application/pack-runs.ports";
import type { PackSystemUow } from "../../kit/application/ports";
import type { FlowCursor, FlowRow, SweepRepo } from "./approval.ports";

export type SweepDeps = {
  uow: PackSystemUow<{ sweep: SweepRepo }>;
  bridge: PackRunsBridge;
  /** Tenant đang bật gói (cache cấu hình, 0 SQL). */
  tenants: () => Promise<string[]>;
  staleMinutes?: number;
  /** Trần HĐ đọc mỗi tenant mỗi lượt. */
  limit?: number;
  /** Re-verify Low · mở lại run duyệt cho HĐ mồ côi sau D3-13 (danh tính người đã sửa). Vắng ⇒ bỏ qua. */
  restart?: (who: { tenantId: string; userId: string }, id: string) => Promise<unknown>;
};
export type SweepResult = { tenants: number; read: number; closed: number };

/** Review m3 · số tenant xử lý song song mỗi lượt (giữ pool kết nối). */
const PARALLEL = 4;
const DEAD = new Set(["cancelled", "failed", "expired"]);
type Action = "rejected" | "cancelled" | "stale" | "failed";
type Close = { id: string; runId: string | null; action: Action; feedback: string | null };
/** Review m2 · con trỏ xoay vòng mỗi tenant `(updated_at, id)` (RAM): lượt sau đọc tiếp sau hàng cuối, hết ⇒ quay đầu. */
export type SweepCursors = Map<string, FlowCursor | null>;

/** Hàng cần đóng của một tenant: quá hạn ⇒ `stale`; run (cùng tenant) huỷ ⇒ `rejected`/`cancelled`; run lỗi/hết hạn ⇒
 *  `failed` (review m4: HĐ về `extract_failed FLOW_FAILED`, không phải "Bị từ chối"). */
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
    const action: Action =
      o.status !== "cancelled" ? "failed" : o.rejected ? "rejected" : "cancelled";
    close.push({ id: r.id, runId: r.runId, action, feedback: o.feedback });
  }
  return close;
}

/** Chạy `fn` cho từng phần tử, tối đa `n` việc cùng lúc. */
async function pooled<T, R>(xs: readonly T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < xs.length; i += n)
    out.push(...(await Promise.all(xs.slice(i, i + n).map(fn))));
  return out;
}

/** HĐ mở lại duyệt mà run mới không mở được (lỗi giữa chừng) ⇒ mở lại thay người sửa; lỗi từng HĐ không chặn lượt. Hiếm ⇒
 *  một lời gọi mỗi HĐ, trần 50/tenant/lượt. */
async function restartOrphans(d: SweepDeps, tenants: readonly string[], stale: number) {
  const restart = d.restart;
  if (!restart) return;
  const lists = await pooled(tenants, PARALLEL, async (t) => ({
    t,
    rows: await d.uow.system(t, (r) => r.sweep.orphanReopens(stale, 50)),
  }));
  const jobs = lists.flatMap(({ t, rows }) => rows.map((x) => ({ t, ...x })));
  await pooled(jobs, PARALLEL, (j) =>
    restart({ tenantId: j.t, userId: j.actor }, j.id).catch(() => undefined),
  );
}

export async function sweepApprovalsOnce(
  d: SweepDeps,
  cursors: SweepCursors = new Map(),
): Promise<SweepResult> {
  const tenants = await d.tenants();
  const stale = d.staleMinutes ?? 15;
  const limit = d.limit ?? 500;
  const rows = await pooled(tenants, PARALLEL, async (t) => {
    const list = await d.uow.system(t, (r) => r.sweep.inFlow(stale, limit, cursors.get(t) ?? null));
    const last = list.at(-1);
    cursors.set(t, list.length >= limit && last ? { at: last.updatedAt, id: last.id } : null);
    return { t, rows: list };
  });
  const runIds = rows.flatMap((x) => x.rows.flatMap((r) => (r.runId ? [r.runId] : [])));
  const port = d.bridge.port;
  const outs = port && runIds.length > 0 ? await port.outcomesOf(tenants, runIds) : [];
  const byRun = new Map(outs.map((o) => [o.run_id, o]));
  const counts = await pooled(rows, PARALLEL, async ({ t, rows: list }) => {
    const close = closesOf(t, list, byRun);
    return close.length > 0 ? d.uow.system(t, (r) => r.sweep.close(close)) : 0;
  });
  await restartOrphans(d, tenants, stale);
  return {
    tenants: tenants.length,
    read: runIds.length,
    closed: counts.reduce((a, b) => a + b, 0),
  };
}
/** Vòng nền: một lượt mỗi `everyMs`, dừng theo `signal`; ngủ CHỈ giữa các lượt (Luật 4c). */
export function startApprovalSweeper(
  d: SweepDeps & { everyMs: number; signal?: AbortSignal; warn: (m: string) => void },
): void {
  const cursors: SweepCursors = new Map();
  const tick = async () => {
    if (d.signal?.aborted) return;
    await sweepApprovalsOnce(d, cursors).catch(() => d.warn("contract-approval-sweep-failed"));
    if (d.signal?.aborted) return;
    const t = setTimeout(tick, d.everyMs);
    (t as { unref?: () => void }).unref?.();
  };
  const t = setTimeout(tick, d.everyMs);
  (t as { unref?: () => void }).unref?.();
}

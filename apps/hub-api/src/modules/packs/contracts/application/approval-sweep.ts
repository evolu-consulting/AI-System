// HD-FR-35 · #218 · D3-09 · M3-decouple: vòng quét theo tập của flow duyệt — mỗi tenant bật gói MỘT câu (đếm HĐ trong flow +
// đóng HĐ `extracting` quá hạn ⇒ `extract_failed STALE`, lượt duyệt `failed`), tối đa 4 tenant song song (giữ pool). Ghi có điều
// kiện ⇒ nhiều instance chạy cùng lúc vẫn đúng. Ngủ CHỈ giữa các lượt (Luật 4c). Lớp 2.
// M3c (review B #7): job còn xếp hàng không bị STALE 15'; hạn của job đang chạy ≥ `claimIdleMs` + 5' (`staleMinutesFor`).
import type { PackSystemUow } from "../../kit/application/ports";
import type { SweepRepo } from "./approval.ports";

export type SweepDeps = {
  uow: PackSystemUow<{ sweep: SweepRepo }>;
  /** Tenant đang bật gói (cache cấu hình, 0 SQL). */
  tenants: () => Promise<string[]>;
  /** Hạn job đã chạy (mặc định 15'). */
  staleMinutes?: number;
  /** Hạn job còn xếp hàng (mặc định 6 giờ — entry Redis mất). */
  queuedMinutes?: number;
  /** Trần HĐ đọc/đóng mỗi tenant mỗi lượt. */
  limit?: number;
};
export type SweepResult = { tenants: number; read: number; closed: number; healed: number };

const PARALLEL = 4;
export const STALE_MINUTES = 15;
export const QUEUED_STALE_MINUTES = 360;

/** Hạn STALE của job đang chạy: không dưới 15' và luôn quá `claimIdleMs` + 5' (job dài chưa bị instance khác nhận lại thì
 *  chưa bị coi là mất — review B #7, `CONTRACTS_EXTRACT_TIMEOUT_S` tới 3600 s). */
export function staleMinutesFor(claimIdleMs: number): number {
  return Math.max(STALE_MINUTES, Math.ceil(claimIdleMs / 60_000) + 5);
}

/** Chạy `fn` cho từng phần tử, tối đa `n` việc cùng lúc. */
async function pooled<T, R>(xs: readonly T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < xs.length; i += n)
    out.push(...(await Promise.all(xs.slice(i, i + n).map(fn))));
  return out;
}

export async function sweepApprovalsOnce(d: SweepDeps): Promise<SweepResult> {
  const tenants = await d.tenants();
  const o = {
    staleMinutes: d.staleMinutes ?? STALE_MINUTES,
    queuedMinutes: d.queuedMinutes ?? QUEUED_STALE_MINUTES,
    limit: d.limit ?? 500,
  };
  const rows = await pooled(tenants, PARALLEL, (t) => d.uow.system(t, (r) => r.sweep.sweep(o)));
  const sum = (k: "read" | "closed" | "healed") => rows.reduce((a, b) => a + b[k], 0);
  return {
    tenants: tenants.length,
    read: sum("read"),
    closed: sum("closed"),
    healed: sum("healed"),
  };
}

/** Vòng nền: một lượt mỗi `everyMs`, dừng theo `signal`. */
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

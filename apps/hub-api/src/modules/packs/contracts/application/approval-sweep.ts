// HD-FR-35 · #218 · D3-09 · M3-decouple: vòng quét theo tập của flow duyệt — mỗi tenant bật gói MỘT câu (đếm HĐ trong flow +
// đóng HĐ `extracting` quá hạn ⇒ `extract_failed STALE`, lượt duyệt `failed`), tối đa 4 tenant song song (giữ pool). Ghi có điều
// kiện ⇒ nhiều instance chạy cùng lúc vẫn đúng. Ngủ CHỈ giữa các lượt (Luật 4c). Lớp 2.
import type { PackSystemUow } from "../../kit/application/ports";
import type { SweepRepo } from "./approval.ports";

export type SweepDeps = {
  uow: PackSystemUow<{ sweep: SweepRepo }>;
  /** Tenant đang bật gói (cache cấu hình, 0 SQL). */
  tenants: () => Promise<string[]>;
  staleMinutes?: number;
  /** Trần HĐ đọc/đóng mỗi tenant mỗi lượt. */
  limit?: number;
};
export type SweepResult = { tenants: number; read: number; closed: number };

const PARALLEL = 4;

/** Chạy `fn` cho từng phần tử, tối đa `n` việc cùng lúc. */
async function pooled<T, R>(xs: readonly T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < xs.length; i += n)
    out.push(...(await Promise.all(xs.slice(i, i + n).map(fn))));
  return out;
}

export async function sweepApprovalsOnce(d: SweepDeps): Promise<SweepResult> {
  const tenants = await d.tenants();
  const stale = d.staleMinutes ?? 15;
  const limit = d.limit ?? 500;
  const rows = await pooled(tenants, PARALLEL, (t) =>
    d.uow.system(t, (r) => r.sweep.sweep(stale, limit)),
  );
  return {
    tenants: tenants.length,
    read: rows.reduce((a, b) => a + b.read, 0),
    closed: rows.reduce((a, b) => a + b.closed, 0),
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

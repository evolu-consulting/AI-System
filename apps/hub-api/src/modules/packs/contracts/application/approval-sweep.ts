// HD-FR-35 · #218 · D3-09 · M3-decouple: vòng quét theo tập của flow duyệt — mỗi tenant bật gói MỘT câu (đếm HĐ trong flow +
// đóng HĐ `extracting` quá hạn ⇒ `extract_failed STALE`, lượt duyệt `failed`), tối đa 4 tenant song song (giữ pool). Ghi có điều
// kiện ⇒ nhiều instance chạy cùng lúc vẫn đúng. Ngủ CHỈ giữa các lượt (Luật 4c). Lớp 2.
// M3c (review B #7): job còn xếp hàng không bị STALE 15'; hạn của job đang chạy ≥ `claimIdleMs` + 5' (`staleMinutesFor`).
import type { PackSystemUow, PackWho } from "../../kit/application/ports";
import { reconcileOf } from "../domain/approval-engine.rules";
import type { ReconcileItem, SweepCounts, SweepRepo } from "./approval.ports";
import type { ApprovalEnginePort } from "./approval-engine.ports";

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
  /** contract-flow S3b · duyệt trên engine (cờ bật): đồng bộ HĐ theo run đã kết thúc + heal mở run. Vắng ⇒ bỏ qua. */
  engine?: {
    port: () => Pick<ApprovalEnginePort, "outcomesOf"> | undefined;
    /** `startEngineApproval` — mở run cho lượt vừa heal `extracting → level1` (không ném). */
    start: (who: PackWho, contractId: string) => Promise<unknown>;
  };
};
export type SweepResult = {
  tenants: number;
  read: number;
  closed: number;
  healed: number;
  /** S3b · lượt engine đã đồng bộ (Từ chối ⇒ HĐ rejected) / run kết thúc bất thường (giữ engine, chờ owner mở lại). */
  rejected: number;
  stalled: number;
};

/** Lô đồng bộ run engine mỗi tenant mỗi lượt (1 select + 1 outcomesOf + 1 UPDATE). */
export const RECONCILE_BATCH = 100;
export const HEAL_OPEN_MAX = 20;

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

/** S3b · lượt `engine` còn `level1` mà run đã kết thúc ⇒ đồng bộ HĐ (3 câu cố định mỗi lô, không phụ thuộc số lượt). */
async function reconcileTenant(d: SweepDeps, t: string, limit: number) {
  const port = d.engine?.port();
  if (!port) return { rejected: 0, stalled: 0 };
  const refs = await d.uow.system(t, (r) => r.sweep.engineRuns(limit));
  if (refs.length === 0) return { rejected: 0, stalled: 0 };
  const outs = new Map(
    (
      await port.outcomesOf(
        t,
        refs.map((x) => x.runId),
      )
    ).map((o) => [o.run_id, o]),
  );
  const items: ReconcileItem[] = [];
  for (const x of refs) {
    const c = reconcileOf(outs.get(x.runId));
    if (c.kind === "reject")
      items.push({
        approvalId: x.approvalId,
        runId: x.runId,
        kind: "reject",
        feedback: c.feedback,
      });
    else if (c.kind === "stalled")
      items.push({ approvalId: x.approvalId, runId: x.runId, kind: "stalled", reason: c.reason });
  }
  return d.uow.system(t, (r) => r.sweep.reconcile(items));
}

/** S3b · heal `extracting → level1` chưa có run ⇒ mở run (`startEngineApproval` tự kiểm điều kiện, không ném). */
async function openHealed(d: SweepDeps, t: string, healed: SweepCounts["healedLevel1"]) {
  // Giới hạn số HĐ mở run mỗi tenant mỗi lượt (phần dư: lượt quét sau không còn `extracting` ⇒ do owner mở lại / đường nhập tay).
  for (const h of (healed ?? []).slice(0, HEAL_OPEN_MAX))
    await d.engine?.start({ tenantId: t, userId: h.userId }, h.contractId);
}

async function sweepTenant(d: SweepDeps, t: string, o: Parameters<SweepRepo["sweep"]>[0]) {
  const base = await d.uow.system(t, (r) => r.sweep.sweep(o));
  // Lỗi engine không làm hỏng lượt quét STALE của tenant (lượt sau thử lại; ghi có điều kiện).
  const rc = await reconcileTenant(d, t, RECONCILE_BATCH).catch(() => ({
    rejected: 0,
    stalled: 0,
  }));
  await openHealed(d, t, base.healedLevel1).catch(() => undefined);
  return { ...base, ...rc };
}

export async function sweepApprovalsOnce(d: SweepDeps): Promise<SweepResult> {
  const tenants = await d.tenants();
  const o = {
    staleMinutes: d.staleMinutes ?? STALE_MINUTES,
    queuedMinutes: d.queuedMinutes ?? QUEUED_STALE_MINUTES,
    limit: d.limit ?? 500,
  };
  const rows = await pooled(tenants, PARALLEL, (t) => sweepTenant(d, t, o));
  const sum = (k: "read" | "closed" | "healed" | "rejected" | "stalled") =>
    rows.reduce((a, b) => a + b[k], 0);
  return {
    tenants: tenants.length,
    read: sum("read"),
    closed: sum("closed"),
    healed: sum("healed"),
    rejected: sum("rejected"),
    stalled: sum("stalled"),
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

// esign-sweep · vòng nền bước Ký số (scope hệ thống, mọi tenant bật gói; lớp 2 — chỉ cổng). Mỗi tenant MỘT tx: MỘT câu quét có điều
// kiện (`FOR UPDATE SKIP LOCKED`, lô ≤ `limit`) đánh dấu (a) kẹt `sending` quá `ESIGN_SENDING_STALE_MIN` ⇒ `needs_decision`
// SEND_FAILED — KHÔNG tự gửi lại (tiến trình cũ có thể đã gửi phong bì); (b) phong bì `sent` đến hạn nhắc ⇒ mốc `esign_reminded_at`;
// (c) quá `due_h` ⇒ mốc `esign_escalated_at` (một lần mỗi lần gửi). Rồi (khi có chuyển cấp kèm Group) MỘT câu danh bạ + MỘT câu chuông
// cho cả lô — chuông ghi trong tx của tenant ⇒ đúng tenant HĐ. Không gọi mạng nhà cung cấp (Luật 4c: chỉ trạng thái DB). Ngủ CHỈ
// giữa các lượt. Chạy lại / nhiều instance: ghi có điều kiện ⇒ không nhắc/chuyển cấp trùng.
import type { NotifyInput, NotifyTxRepos } from "../../kit/application/notify";
import type { PackSystemUow } from "../../kit/application/ports";
import { ESIGN_SENDING_STALE_MIN } from "./esign-flow.usecase";

export type EsignSweptRow = {
  approvalId: string;
  contractId: string;
  owner: string | null;
  signer: string | null;
  label: string;
  /** Group chuyển cấp của bước (mẫu chụp), chỉ khi `overdue`. */
  escalateGroupId: string | null;
  stale: boolean;
  remind: boolean;
  overdue: boolean;
};
export type EsignSweepRepo = {
  /** MỘT câu: đánh dấu các hàng đến hạn lúc `now` (lô ≤ `limit`), trả hàng đã đổi. */
  sweep(o: { now: Date; staleMin: number; limit: number }): Promise<EsignSweptRow[]>;
};
type R = { esignSweep: EsignSweepRepo } & NotifyTxRepos;

export type EsignSweepDeps = {
  uow: PackSystemUow<R>;
  tenants: () => Promise<readonly string[]>;
  /** Người nhận chuyển cấp theo Group (trưởng phòng của Group; không có ⇒ thành viên còn dùng được). MỘT câu cho cả lô. */
  escalateTo: (tenantId: string, groupIds: readonly string[]) => Promise<Map<string, string[]>>;
  now?: () => Date;
  limit?: number;
  warn?: (m: string, meta: Record<string, unknown>) => void;
};
export type EsignSweepResult = {
  tenants: number;
  stale: number;
  reminded: number;
  escalated: number;
  bells: number;
};

export const ESIGN_SWEEP_LIMIT = 200;
const PARALLEL = 4;

const bell = (user: string, id: string, title: string, body: string): NotifyInput => ({
  user_id: user,
  kind: "contract.esign",
  title: title.slice(0, 200),
  body,
  link: `/contracts/${id}`,
});

/** Chuông của lô (thuần): kẹt ⇒ người phụ trách; nhắc ⇒ người ký công ty; quá hạn ⇒ người phụ trách + người nhận chuyển cấp. */
export function esignSweepBells(
  rows: readonly EsignSweptRow[],
  to: Map<string, string[]>,
): NotifyInput[] {
  const out: NotifyInput[] = [];
  for (const r of rows) {
    const k = r.contractId;
    if (r.stale && r.owner)
      out.push(
        bell(
          r.owner,
          k,
          `Ký số HĐ ${r.label} cần quyết`,
          "Lý do: gửi ký không thành công. Gửi lại hoặc mở lại HĐ.",
        ),
      );
    if (r.remind && r.signer)
      out.push(bell(r.signer, k, `Nhắc ký số HĐ ${r.label}`, "Hợp đồng đang chờ bạn ký số."));
    if (!r.overdue) continue;
    const users = new Set([
      ...(r.owner ? [r.owner] : []),
      ...(to.get(r.escalateGroupId ?? "") ?? []),
    ]);
    for (const u of users)
      out.push(
        bell(u, k, `Ký số HĐ ${r.label} quá hạn`, "Phong bì ký số đã quá hạn mà chưa ký xong."),
      );
  }
  return out;
}

async function sweepTenant(d: EsignSweepDeps, t: string, now: Date) {
  return d.uow.system(t, async (r) => {
    const rows = await r.esignSweep.sweep({
      now,
      staleMin: ESIGN_SENDING_STALE_MIN,
      limit: d.limit ?? ESIGN_SWEEP_LIMIT,
    });
    const groups = [
      ...new Set(rows.flatMap((x) => (x.overdue && x.escalateGroupId ? [x.escalateGroupId] : []))),
    ];
    const to = groups.length > 0 ? await d.escalateTo(t, groups) : new Map<string, string[]>();
    const bells = esignSweepBells(rows, to);
    if (bells.length > 0) await r.notify.enqueue(bells);
    return {
      stale: rows.filter((x) => x.stale).length,
      reminded: rows.filter((x) => x.remind).length,
      escalated: rows.filter((x) => x.overdue).length,
      bells: bells.length,
    };
  });
}

export async function sweepEsignOnce(d: EsignSweepDeps, at?: Date): Promise<EsignSweepResult> {
  const now = at ?? d.now?.() ?? new Date();
  const ts = await d.tenants();
  const sum = { tenants: ts.length, stale: 0, reminded: 0, escalated: 0, bells: 0 };
  for (let i = 0; i < ts.length; i += PARALLEL) {
    const part = await Promise.all(
      ts.slice(i, i + PARALLEL).map((t) =>
        sweepTenant(d, t, now).catch((e: unknown) => {
          d.warn?.("contract-esign-sweep-tenant-failed", {
            tenant_id: t,
            error: e instanceof Error ? e.name : "unknown",
          });
          return { stale: 0, reminded: 0, escalated: 0, bells: 0 };
        }),
      ),
    );
    for (const p of part) {
      sum.stale += p.stale;
      sum.reminded += p.reminded;
      sum.escalated += p.escalated;
      sum.bells += p.bells;
    }
  }
  return sum;
}

/** Vòng nền: một lượt mỗi `everyMs`, dừng theo `signal`. */
export function startEsignSweeper(
  d: EsignSweepDeps & { everyMs: number; signal?: AbortSignal },
): void {
  const tick = async () => {
    if (d.signal?.aborted) return;
    await sweepEsignOnce(d).catch(() => d.warn?.("contract-esign-sweep-failed", {}));
    if (d.signal?.aborted) return;
    const t = setTimeout(tick, d.everyMs);
    (t as { unref?: () => void }).unref?.();
  };
  const t = setTimeout(tick, d.everyMs);
  (t as { unref?: () => void }).unref?.();
}

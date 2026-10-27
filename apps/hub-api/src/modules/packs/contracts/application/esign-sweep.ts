// esign-sweep · vòng nền bước Ký số (scope hệ thống, mọi tenant bật gói; lớp 2 — chỉ cổng). Mỗi tenant MỘT tx: MỘT câu quét có điều
// kiện (`FOR UPDATE SKIP LOCKED`, lô ≤ `limit`) đánh dấu (a) kẹt `sending` quá `ESIGN_SENDING_STALE_MIN` ⇒ `needs_decision`
// SEND_FAILED — KHÔNG tự gửi lại (tiến trình cũ có thể đã gửi phong bì); (b) phong bì `sent` đến hạn nhắc ⇒ mốc `esign_reminded_at`;
// (c) quá `due_h` ⇒ mốc `esign_escalated_at` (một lần mỗi lần gửi). Rồi (khi có chuyển cấp kèm Group) MỘT câu danh bạ + MỘT câu chuông
// cho cả lô — chuông ghi trong tx của tenant ⇒ đúng tenant HĐ. Không gọi mạng nhà cung cấp (Luật 4c: chỉ trạng thái DB). Ngủ CHỈ
// giữa các lượt. Chạy lại / nhiều instance: ghi có điều kiện ⇒ không nhắc/chuyển cấp trùng. esign-sweep2 · sau phần SQL, pha đồng bộ
// phong bì với nhà cung cấp (`esign-sync.ts`, ngoài tx, có giới hạn) khi `d.sync` có.
import type { NotifyInput, NotifyTxRepos } from "../../kit/application/notify";
import type { PackSystemUow } from "../../kit/application/ports";
import { ESIGN_SENDING_STALE_MIN } from "./esign-flow.usecase";
import { type EsignSyncDeps, syncEsignOnce } from "./esign-sync";

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
  /** esign-remind-fix · phong bì mở mà không tới lượt người ký công ty (đã ký / đối tác ký trước) ⇒ nhắc người phụ trách
   *  "đang chờ đối tác ký" thay vì người ký (`remindTargetOf` = "owner"). */
  waitPartner: boolean;
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
  /** esign-sweep2 · pha đồng bộ phong bì với nhà cung cấp (ngoài tx, sau phần SQL); vắng ⇒ không đồng bộ. */
  sync?: EsignSyncDeps;
};
export type EsignSweepResult = {
  tenants: number;
  stale: number;
  reminded: number;
  escalated: number;
  bells: number;
  /** esign-sweep2 · số phong bì đã hỏi nhà cung cấp / lỗi. */
  synced: number;
  syncFailed: number;
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

/** Chuông nhắc (khi `remind`): tới lượt công ty ⇒ người ký; chờ đối tác ⇒ người phụ trách; thiếu người nhận ⇒ không chuông. */
function remindBell(r: EsignSweptRow): NotifyInput[] {
  if (!r.remind) return [];
  if (!r.waitPartner)
    return r.signer
      ? [bell(r.signer, r.contractId, `Nhắc ký số HĐ ${r.label}`, "Hợp đồng đang chờ bạn ký số.")]
      : [];
  return r.owner
    ? [
        bell(
          r.owner,
          r.contractId,
          `Ký số HĐ ${r.label} đang chờ đối tác ký`,
          "Phía công ty đã ký hoặc chưa tới lượt; phong bì đang chờ đối tác ký.",
        ),
      ]
    : [];
}

/** Chuông của lô (thuần): kẹt ⇒ người phụ trách; nhắc ⇒ người ký công ty khi tới lượt, không thì người phụ trách
 *  ("đang chờ đối tác ký"); quá hạn ⇒ người phụ trách + người nhận chuyển cấp. */
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
    out.push(...remindBell(r));
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
  const sum = {
    tenants: ts.length,
    stale: 0,
    reminded: 0,
    escalated: 0,
    bells: 0,
    synced: 0,
    syncFailed: 0,
  };
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
  if (d.sync) {
    const s = await syncEsignOnce(d.sync, ts, now, d.warn).catch((e: unknown) => {
      d.warn?.("contract-esign-sync-claim-failed", {
        error: e instanceof Error ? e.name : "unknown",
      });
      return { checked: 0, failed: 0 };
    });
    sum.synced = s.checked;
    sum.syncFailed = s.failed;
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

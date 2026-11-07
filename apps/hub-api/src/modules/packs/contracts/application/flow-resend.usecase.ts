// CR-122 · P11b · "Mở lại" của lượt duyệt CHỜ FLOW (công ty bật flow theo sự kiện, chưa có run: không mở được / quá lâu) ⇒ về
// FLOW_STARTING + phát lại `contract.submitted` với event_id MỚI (cùng tx, người gây sự kiện = người gửi duyệt) ⇒ bộ điều phối mở lại.
// p24 · lượt ĐÃ có run flow: run còn chạy ⇒ "not_stalled" (409, không đụng); run đã kết thúc bất thường ⇒ bỏ gắn run cũ rồi mở lượt flow
// mới (trước đây rơi sang đường cũ: tính lại mẫu duyệt cũ ⇒ ghi sai lý do FLOW_MISSING/FLOW_ROUTE_NONE lên thẻ).
// Lượt khác (máy cũ, cờ tắt) ⇒ đi tiếp đường "Mở lại" cũ (`next`). Lớp 2: chỉ cổng.
import type { PackWho } from "../../kit/public";
import { EV_RECEIVED, EV_SUBMITTED } from "../domain/contract-flow-events.rules";
import type { ApprovalUow } from "./approval.ports";
import { type ContractFlowGate, requireFlow } from "./contract-flow.ports";

type Op<T> = (who: PackWho, contractId: string) => Promise<T>;

/** Lượt engine `level1` đang mở (chưa run = chờ flow; có run = hasRun); khác ⇒ null. */
async function liveApproval(uow: ApprovalUow, who: PackWho, id: string) {
  const st = await uow.tenant(who, async (r) => r.approval.state(id, { lock: false }));
  const a = st?.approval;
  if (a?.status !== "level1" || a.mode !== "engine") return null;
  return { a, hasRun: !!a.engineRunId, received: st?.source === "partner_inbox" };
}

/**
 * CR-124 · sự kiện phát lại + người gây. HĐ nhận từ đối tác không có "người gửi duyệt" thật (started_by = hệ thống) ⇒ `contract.received`,
 * người gây = người bấm Mở lại; HĐ thường ⇒ `contract.submitted`, người gây = người gửi duyệt.
 */
function resendEmit(
  cur: Awaited<ReturnType<typeof liveApproval>>,
  who: PackWho,
): { event: typeof EV_RECEIVED | typeof EV_SUBMITTED; actor: string } {
  return cur?.received === true
    ? { event: EV_RECEIVED, actor: who.userId }
    : { event: EV_SUBMITTED, actor: cur?.a.startedBy ?? "" };
}

export function withFlowResend<T extends string>(
  next: Op<T> | undefined,
  d: {
    uow: ApprovalUow;
    flow: ContractFlowGate | undefined;
    /** Run đã gắn có kẹt thật không (vắng ⇒ đi đường cũ như trước). */
    stalled?: (who: PackWho, contractId: string) => Promise<boolean>;
  },
): Op<T | "ok" | "flow_starting" | "not_stalled" | "failed"> {
  return async (who, id) => {
    const cur = d.flow ? await liveApproval(d.uow, who, id) : null;
    const a = cur?.a;
    const hasRun = cur?.hasRun === true;
    const { event, actor } = resendEmit(cur, who);
    const prep = a && d.flow ? await d.flow.prepare(who.tenantId, actor) : null;
    if (!a || !prep?.on || (hasRun && !d.stalled)) return next ? next(who, id) : "failed";
    if (hasRun && !(await d.stalled?.(who, id))) return "not_stalled" as const;
    return d.uow.tenant(who, async (r) => {
      const repo = requireFlow(r);
      // P11c · CAS chỉ khi ĐÃ kẹt thật; đang mở quy trình (bấm đúp / sự kiện đầu chưa xong) ⇒ 409, không phát thêm sự kiện
      // p24 · CAS theo run đã thấy: 0 hàng ⇒ lượt đã có run mới / đã có người Mở lại trước ⇒ not_stalled, không phát sự kiện
      if (!(await repo.rearmFlow?.(id, a.id, a.engineRunId ?? null)))
        return (hasRun ? "not_stalled" : "flow_starting") as "not_stalled" | "flow_starting";
      const key = `${a.id}.${crypto.randomUUID().slice(0, 8)}`; // event_id mới ⇒ không bị coi là trùng
      await repo.emitContract(event, id, key, {
        actor,
        departments: prep.departments,
      });
      return "ok" as const;
    });
  };
}

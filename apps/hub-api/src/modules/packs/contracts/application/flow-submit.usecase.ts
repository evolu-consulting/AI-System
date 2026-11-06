// CR-122 · P11d · "Xác nhận và lưu" của HĐ khi công ty BẬT flow theo sự kiện. Hành trình người dùng giữ như cũ: AI đọc / nhập tay ⇒ nháp
// chờ rà soát (lượt `level1`, máy cũ, nút "Xác nhận và lưu") ⇒ người dùng bấm xác nhận ⇒ CÙNG tx khoá HĐ: lượt chờ flow (FLOW_STARTING,
// SP chọn lúc xác nhận giữ ở `pending_links`, gắn khi flow Đã duyệt) + ghi `contract.submitted` (event_id theo lượt). KHÔNG khoá HĐ ở đây
// (máy cũ không còn chốt). Lượt khác (đã chờ flow / engine) ⇒ null (đi đường cũ). Lớp 2: chỉ cổng.
import type { PackWho } from "../../kit/public";
import type { ApprovalActor } from "../domain/approval-machine.rules";
import { EV_SUBMITTED } from "../domain/contract-flow-events.rules";
import type { ApprovalUow } from "./approval.ports";
import type { ActOutcome, ApprovalAction, ContractApproval } from "./approval.usecase";
import { emitFlow, type FlowPrep, requireFlow } from "./contract-flow.ports";

/** Cờ bật + "Xác nhận và lưu" ở lượt máy cũ `level1` ⇒ gửi vào flow rồi trả thẻ mới; không áp dụng ⇒ null (đường cũ). */
export async function submitOrNull(
  uow: ApprovalUow,
  get: (who: PackWho, id: string) => Promise<ContractApproval | null>,
  c: { who: PackWho; id: string; b: ApprovalAction; actor: ApprovalActor; prep: FlowPrep },
): Promise<ActOutcome | null> {
  if (!c.prep.on) return null;
  const sub = await submitToFlow(uow, c.who, c.id, c.b, c.actor, c.prep);
  if (sub !== "ok") return sub;
  return (await get(c.who, c.id)) ?? "not_found";
}

export async function submitToFlow(
  uow: ApprovalUow,
  who: PackWho,
  id: string,
  b: ApprovalAction,
  actor: ApprovalActor,
  prep: FlowPrep,
): Promise<
  "ok" | Exclude<ActOutcome, object> | { error: "APPROVAL_NOT_OPEN" | "NOT_REVIEWER" } | null
> {
  if (b.action !== "approve" || !prep.on) return null;
  return uow.tenant(who, async (r) => {
    const st = await r.approval.state(id, { lock: true });
    if (!st) return "not_found" as const;
    const a = st.approval;
    if (a?.mode !== "machine" || a.status !== "level1") return null;
    if (b.expect && b.expect.taskId !== a.id) return { error: "APPROVAL_NOT_OPEN" as const };
    if (!actor.inLevel1) return { error: "NOT_REVIEWER" as const };
    const repo = requireFlow(r);
    if (!(await repo.holdForFlow?.(id, a.id, b.products ?? null)))
      return { error: "APPROVAL_NOT_OPEN" as const };
    await emitFlow(r, prep, EV_SUBMITTED, [id, a.id], who.userId);
    return "ok" as const;
  });
}

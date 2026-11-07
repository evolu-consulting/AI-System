// CR-122 · P11d · "Xác nhận và lưu" của HĐ khi công ty BẬT flow theo sự kiện. Hành trình người dùng giữ như cũ: AI đọc / nhập tay ⇒ nháp
// chờ rà soát (lượt `level1`, máy cũ, nút "Xác nhận và lưu") ⇒ người dùng bấm xác nhận ⇒ CÙNG tx khoá HĐ: lượt chờ flow (FLOW_STARTING,
// SP chọn lúc xác nhận giữ ở `pending_links`, gắn khi flow Đã duyệt) + ghi `contract.submitted` (event_id theo lượt). KHÔNG khoá HĐ ở đây
// (máy cũ không còn chốt). Lượt khác (đã chờ flow / engine) ⇒ null (đi đường cũ). Lớp 2: chỉ cổng.
import type { PackWho } from "../../kit/public";
import type { ApprovalActor } from "../domain/approval-machine.rules";
import { EV_SUBMITTED } from "../domain/contract-flow-events.rules";
import type { ApprovalState, ApprovalUow } from "./approval.ports";
import type { ActOutcome, ApprovalAction, ContractApproval } from "./approval-act.types";
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

/** p24 · cờ flow BẬT: "Xác nhận và lưu" ở nháp `level1` luôn gửi vào flow ⇒ màn hình LUÔN mở hộp "Gắn sản phẩm" (SP chọn lúc xác nhận
 *  giữ ở `pending_links`, gắn khi flow Đã duyệt) — không còn tuỳ ngưỡng giá trị của máy cũ (trước: HĐ lớn không có hộp ⇒ mất SP). */
export function withFlowConfirm<V extends { finalizes_on_approve: boolean }>(
  prep: FlowPrep,
  v: V,
): V {
  return prep.on && !v.finalizes_on_approve ? { ...v, finalizes_on_approve: true } : v;
}

/** Lượt máy cũ cấp 1 = nháp chờ "Xác nhận và lưu" (cờ bật). */
const isDraftLevel1 = (st: ApprovalState): boolean =>
  st.approval?.mode === "machine" && st.approval.status === "level1";

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
    // P11h · đọc TRƯỚC không khoá: lượt engine (người duyệt ngoài cây bấm Đạt) ⇒ null ngay, đi đường engine. Trước sửa khoá luôn
    // (`FOR UPDATE` không cờ duyệt ⇒ RLS ghi lọc mất HĐ với người duyệt) ⇒ null ⇒ "not_found" ⇒ 404, người duyệt không Đạt được.
    const peek = await r.approval.state(id, { lock: false });
    if (!peek) return "not_found" as const;
    if (!isDraftLevel1(peek)) return null;
    const st = await r.approval.state(id, { lock: true });
    if (!st) return "not_found" as const;
    if (!isDraftLevel1(st)) return null;
    return holdAndEmit(r, { id, st, b, actor, prep, by: who.userId });
  });
}

/** Trong tx đã khoá HĐ: kiểm task + quyền cấp 1 ⇒ lượt chờ flow + `contract.submitted`. */
async function holdAndEmit(
  r: Parameters<Parameters<ApprovalUow["tenant"]>[1]>[0],
  c: {
    id: string;
    st: ApprovalState;
    b: ApprovalAction;
    actor: ApprovalActor;
    prep: FlowPrep;
    by: string;
  },
) {
  const a = c.st.approval as NonNullable<ApprovalState["approval"]>;
  if (c.b.expect && c.b.expect.taskId !== a.id) return { error: "APPROVAL_NOT_OPEN" as const };
  if (!c.actor.inLevel1) return { error: "NOT_REVIEWER" as const };
  if (!(await requireFlow(r).holdForFlow?.(c.id, a.id, c.b.products ?? null)))
    return { error: "APPROVAL_NOT_OPEN" as const };
  await emitFlow(r, c.prep, EV_SUBMITTED, [c.id, a.id], c.by);
  return "ok" as const;
}

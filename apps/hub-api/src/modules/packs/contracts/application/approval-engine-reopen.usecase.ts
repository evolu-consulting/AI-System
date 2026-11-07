// fix-review · CR-107 · thao tác owner/admin gói (route `admin`) trên lượt engine kẹt. Lớp 2: chỉ cổng. Không vòng lặp tự động: mỗi lần
// là một thao tác của owner; KHÔNG bao giờ trả lượt về máy cũ.
// - `reopenEngineApproval` ("Mở lại quy trình"): run đã kết thúc bất thường (kiểm bằng `outcomesOf`, không tin cờ client) HOẶC lượt
//   kẹt chưa có run (CR-107 · mẫu thiếu Group lúc mở) ⇒ run mới dưới người bắt đầu lượt với mẫu HIỆN HÀNH. Mẫu vẫn hỏng ⇒ ghi lại lý do.
// - `retryEngineApproval` ("Thử lại"): run `needs_decision` ⇒ quyết decision mở bằng `add_attempt` của engine (không trạng thái mới).
// - `cancelReopenEngineApproval` ("Huỷ & mở lại"): huỷ run (scope system) + ghi lý do `CANCELLED_BY_OWNER` rồi đi đúng đường mở lại.
import type { PackWho } from "../../kit/public";
import { CANCELLED_BY_OWNER, FLOW_INVALID, reconcileOf } from "../domain/approval-engine.rules";
import { APPROVAL_PROCESS_KEY } from "../domain/approval-flow.rules";
import type { ApprovalEnginePort, EngineStartRow } from "./approval-engine.ports";
import {
  type ApprovalEngineDeps,
  callerOf,
  compiled,
  engineErrMeta,
  loadStart,
  markStalled,
  openRun,
} from "./approval-engine.usecase";
import { defVersionOf } from "./approval-engine-slot";

export type ReopenOutcome = "ok" | "not_found" | "not_stalled" | "flow_invalid" | "failed";
export type RetryOutcome = "ok" | "not_found" | "not_open" | "failed";

type Got = NonNullable<Awaited<ReturnType<typeof loadStart>>>;
type Stalled = { id: string; got: Got; run: string | null };

/** Lượt engine `level1` kẹt? Có run ⇒ run phải đã kết thúc bất thường (`outcomesOf`); chưa có run ⇒ kẹt (CR-107). */
async function findStalled(
  d: ApprovalEngineDeps,
  port: ApprovalEnginePort,
  who: PackWho,
  id: string,
): Promise<Stalled | "not_found" | "not_stalled"> {
  const got = await loadStart(
    d,
    who,
    id,
    (s) => s.mode === "engine" && s.approvalStatus === "level1",
  );
  if (!got) return "not_found";
  const run = got.st.engineRunId;
  if (!run) return { id, got, run: null };
  const [o] = await port.outcomesOf(who.tenantId, [run]);
  return reconcileOf(o).kind === "stalled" ? { id, got, run } : "not_stalled";
}

async function reopenStalled(
  d: ApprovalEngineDeps,
  port: ApprovalEnginePort,
  who: PackWho,
  s: Stalled,
): Promise<ReopenOutcome> {
  const flow = s.got.flow;
  const c = await compiled(d, who, flow);
  if ("invalid" in c || "invalid" in flow) {
    const reason = "invalid" in c ? c.invalid : FLOW_INVALID;
    await markStalled(d, who, { id: s.id, approvalId: s.got.st.approvalId, run: s.run, reason });
    return "flow_invalid";
  }
  const caller = callerOf({ tenantId: who.tenantId, userId: s.got.starter });
  await port.ensureDef(caller, APPROVAL_PROCESS_KEY, c.def, defVersionOf(flow, c.def, port));
  const args = { id: s.id, flow, starter: s.got.starter, def: c.def, replaces: s.run };
  return (await openRun(d, port, who, args)) === "started" ? "ok" : "not_stalled";
}

/** p24 · lượt engine `level1` ĐÃ kẹt (run kết thúc bất thường / chưa có run)? Cổng cho "Mở lại" của công ty bật flow (không ném). */
export function engineRunStalled(d: ApprovalEngineDeps) {
  return async (who: PackWho, id: string): Promise<boolean> => {
    const port = d.bridge.port;
    if (!port) return false;
    try {
      return typeof (await findStalled(d, port, who, id)) !== "string";
    } catch {
      return false;
    }
  };
}

export function reopenEngineApproval(d: ApprovalEngineDeps) {
  return async (who: PackWho, id: string): Promise<ReopenOutcome> => {
    const port = d.bridge.port;
    if (!port) return "failed";
    try {
      const s = await findStalled(d, port, who, id);
      if (typeof s === "string") return s;
      return await reopenStalled(d, port, who, s);
    } catch (e) {
      d.warn("contract-engine-reopen-failed", { contract_id: id, ...engineErrMeta(e) });
      return "failed";
    }
  };
}

/** Lượt engine `level1` đang giữ run (điều kiện Thử lại / Huỷ & mở lại); không thấy HĐ/lượt ⇒ "not_found". */
async function liveRun(
  d: ApprovalEngineDeps,
  who: PackWho,
  id: string,
): Promise<{ st: EngineStartRow; run: string } | "not_found" | "not_open"> {
  const st = await d.uow.tenant(who, (r) => r.approvalEngine.startState(id));
  if (!st?.approvalId) return "not_found";
  if (st.mode !== "engine" || st.approvalStatus !== "level1" || !st.engineRunId) return "not_open";
  return { st, run: st.engineRunId };
}

/** CR-107 · "Thử lại": decision mở của run ⇒ `add_attempt` (engine chạy lại stage). Run không chờ quyết ⇒ "not_open". */
export function retryEngineApproval(d: ApprovalEngineDeps) {
  return async (who: PackWho, id: string): Promise<RetryOutcome> => {
    const port = d.bridge.port;
    if (!port?.retryDecision) return "failed";
    try {
      const l = await liveRun(d, who, id);
      if (typeof l === "string") return l;
      return await port.retryDecision(callerOf(who), l.run);
    } catch (e) {
      d.warn("contract-engine-retry-failed", { contract_id: id, ...engineErrMeta(e) });
      return "failed";
    }
  };
}

/** CR-107 · "Huỷ & mở lại": huỷ run (đã kết thúc ⇒ vẫn tiếp), ghi lý do `CANCELLED_BY_OWNER` (lượt kẹt nếu mở lại không được),
 *  rồi mở lại như "Mở lại quy trình". */
export function cancelReopenEngineApproval(d: ApprovalEngineDeps) {
  const reopen = reopenEngineApproval(d);
  return async (who: PackWho, id: string): Promise<ReopenOutcome> => {
    const port = d.bridge.port;
    if (!port) return "failed";
    try {
      const l = await liveRun(d, who, id);
      if (l === "not_found") return l;
      if (l === "not_open") return "not_stalled";
      await port.cancelSys(who.tenantId, l.run);
      const c = { id, approvalId: l.st.approvalId, run: l.run, reason: CANCELLED_BY_OWNER };
      await markStalled(d, who, c);
    } catch (e) {
      d.warn("contract-engine-cancel-reopen-failed", { contract_id: id, ...engineErrMeta(e) });
      return "failed";
    }
    return reopen(who, id);
  };
}

// CR-127 · Z1 · CHỈ CHO TEST: dựng lượt duyệt kiểu cũ (lượt `extracting`/`level1`) làm fixture cho các int của thẻ/engine duyệt đã có.
// Production KHÔNG còn mở lượt như vậy (máy duyệt cũ đã gỡ; HĐ vào quy trình qua "Gửi" — `submit.usecase`). Q1/R1: đổi fixture sang submit rồi gỡ file này.
import type { PackWho } from "../../kit/public";
import type { ApprovalUow, OpenOutcome } from "../application/approval.ports";
import type { ExtractJobs } from "../application/approval.usecase";
import {
  type ContractFlowGate,
  emitFlow,
  FLOW_OFF,
  type FlowPrep,
} from "../application/contract-flow.ports";
import { EV_SUBMITTED } from "../domain/contract-flow-events.rules";

type Deps = { uow: ApprovalUow; jobs: ExtractJobs; flow?: ContractFlowGate };

export function startApproval(d: Deps) {
  return async (
    who: PackWho,
    id: string,
    initial: "extracting" | "level1",
  ): Promise<OpenOutcome> => {
    const aid = crypto.randomUUID();
    const prep: FlowPrep =
      initial === "level1" && d.flow ? await d.flow.prepare(who.tenantId, who.userId) : FLOW_OFF;
    const out = await d.uow.tenant(who, async (r) => {
      const o = await (r.approval.open as (...a: unknown[]) => Promise<OpenOutcome>)(
        id,
        aid,
        who.userId,
        initial,
      );
      if (o === "ok" && initial === "level1") {
        await emitFlow(r, prep, EV_SUBMITTED, [id, aid], who.userId);
        // Như "Gửi" thật: lượt chuyển engine + FLOW_STARTING để bộ điều phối gắn run (cờ bật).
        if (prep.on) await r.contractFlow?.holdForFlow?.(id, aid);
      }
      return o;
    });
    if (out === "ok" && initial === "extracting")
      await d.jobs.enqueue({ ...who, contractId: id, approvalId: aid });
    return out;
  };
}

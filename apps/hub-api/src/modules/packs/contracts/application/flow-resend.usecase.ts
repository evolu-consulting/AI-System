// CR-122 · P11b · "Mở lại" của lượt duyệt CHỜ FLOW (công ty bật flow theo sự kiện, chưa có run: không mở được / quá lâu) ⇒ về
// FLOW_STARTING + phát lại `contract.submitted` với event_id MỚI (cùng tx, người gây sự kiện = người gửi duyệt) ⇒ bộ điều phối mở lại.
// Lượt khác (máy cũ, engine có run, cờ tắt) ⇒ đi tiếp đường "Mở lại" cũ (`next`). Lớp 2: chỉ cổng.
import type { PackWho } from "../../kit/public";
import { EV_SUBMITTED } from "../domain/contract-flow-events.rules";
import type { ApprovalUow } from "./approval.ports";
import { type ContractFlowGate, requireFlow } from "./contract-flow.ports";

type Op<T> = (who: PackWho, contractId: string) => Promise<T>;

export function withFlowResend<T extends string>(
  next: Op<T> | undefined,
  d: { uow: ApprovalUow; flow: ContractFlowGate | undefined },
): Op<T | "ok" | "not_stalled" | "failed"> {
  return async (who, id) => {
    const a = d.flow
      ? await d.uow.tenant(
          who,
          async (r) => (await r.approval.state(id, { lock: false }))?.approval,
        )
      : null;
    const waiting = a && a.status === "level1" && a.mode === "engine" && !a.engineRunId;
    const prep = waiting && d.flow ? await d.flow.prepare(who.tenantId, a.startedBy) : null;
    if (!a || !prep?.on) return next ? next(who, id) : "failed";
    return d.uow.tenant(who, async (r) => {
      const repo = requireFlow(r);
      if (!(await repo.rearmFlow?.(id, a.id))) return "not_stalled" as const;
      const key = `${a.id}.${crypto.randomUUID().slice(0, 8)}`; // event_id mới ⇒ không bị coi là trùng
      await repo.emitContract(EV_SUBMITTED, id, key, {
        actor: a.startedBy,
        departments: prep.departments,
      });
      return "ok" as const;
    });
  };
}

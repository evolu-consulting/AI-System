// CR-118 · CR-120 · ADR-0035/0036 · nối flow runtime của gói contracts: khe `contracts.approval` = adapter bọc thẻ duyệt hiện có
// (CÙNG use case `act` với `POST …/approval` cũ — giữ một bản phát hành cho rollback). Mặc định BẬT; `HUB_FLOW_RUNTIME=off` ⇒ không
// gắn route (`/pack/contracts/flow/*` = 404). Tách khỏi `extraction.mount.ts` (trần 400 dòng).
import type { Db } from "@ai/db";
import type { Hono } from "hono";
import { flowRoutes } from "../kit/adapters/flow.routes";
import type { PackAccessView, PackGuardVars } from "../kit/adapters/pack-guard.middleware";
import { createPackUow } from "../kit/adapters/pack-uow";
import { flowAdapterSlots } from "../kit/adapters/slot-contract.check";
import { flowRuntime, flowRuntimeOn } from "../kit/application/flow.ports";
import { approvalFlowSummaryRepo } from "./adapters/approval-flow-summary.repo";
import type { actApproval, getApproval } from "./application/approval.usecase";
import { approvalFlowSlot } from "./application/approval-flow-slot.usecase";

export function contractsFlowRoutes(
  db: Db,
  view: PackAccessView,
  d: {
    get: ReturnType<typeof getApproval>;
    act: ReturnType<typeof actApproval>;
    on?: boolean | undefined;
  },
): Hono<PackGuardVars> | null {
  if (!flowRuntimeOn(d.on)) return null;
  const uow = createPackUow(db, "contracts", (tx, tid) => ({
    flow: approvalFlowSummaryRepo(tx, tid),
  }));
  const slot = approvalFlowSlot({
    get: d.get,
    act: d.act,
    rows: (who, ids) =>
      ids.length ? uow.tenant(who, (r) => r.flow.rows(ids)) : Promise.resolve([]),
  });
  flowAdapterSlots.add(slot.slot); // CR-120 · kiểm khe manifest ↔ adapter lúc mount
  return flowRoutes(view, "contracts", flowRuntime("contracts", [slot]));
}

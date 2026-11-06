// CR-120 · G4 · node `wait_event`: Hub chờ sự kiện theo khoá (gói bắn qua `signalEvent`), hết `timeout_h` giờ ⇒ chạy tiếp
// (output ghi "Hết hạn chờ"). Không agent, không output field. Luật def (WAIT_INVALID) dùng chung ở `wait-for/wait-timed.rules`
// và chạy MỘT lần theo `NODE_LIST` (qua `waitForNode.defIssues`) cho cả hai loại ⇒ ở đây không khai `defIssues` (tránh báo trùng).
import { NODE_FAMILY_OF } from "@ai/contracts/hub-admin";
import type { DefStage, NodeSpec } from "../types";
import { ensureWaitStage } from "../wait-until/wait-stage.rules";

/** CR-122 E3b · output khai field `event` (khoá sự kiện đã nhận / `timeout`) ⇒ node Nếu / rẽ bước đọc được. */
export function ensureWaitEventStage<S extends DefStage>(s: S): S {
  const w = ensureWaitStage(s);
  if (w.executor.kind !== "wait_event") return w;
  return {
    ...w,
    output: { ...w.output, fields: [{ key: "event", type: "string", required: false }] },
  };
}

export const waitEventNode: NodeSpec<"wait_event"> = {
  kind: "wait_event",
  family: NODE_FAMILY_OF.wait_event,
  produces: "declared",
  realAction: false,
  handoff: false,
  normalize: ensureWaitEventStage,
};

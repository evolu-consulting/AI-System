// CR-120 · G4 · node `wait_event`: Hub chờ sự kiện theo khoá (gói bắn qua `signalEvent`), hết `timeout_h` giờ ⇒ chạy tiếp
// (output ghi "Hết hạn chờ"). Không agent, không output field. Luật def (WAIT_INVALID) dùng chung ở `wait-for/wait-timed.rules`
// và chạy MỘT lần theo `NODE_LIST` (qua `waitForNode.defIssues`) cho cả hai loại ⇒ ở đây không khai `defIssues` (tránh báo trùng).
import { NODE_FAMILY_OF } from "@ai/contracts/hub-admin";
import type { NodeSpec } from "../types";
import { ensureWaitStage } from "../wait-until/wait-stage.rules";

export const waitEventNode: NodeSpec<"wait_event"> = {
  kind: "wait_event",
  family: NODE_FAMILY_OF.wait_event,
  produces: "none",
  realAction: false,
  handoff: false,
  normalize: ensureWaitStage,
};

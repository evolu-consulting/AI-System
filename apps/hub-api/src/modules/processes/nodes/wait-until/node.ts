// CR-103 · R1 · node `wait_until` (P-d1, PD-R13): Hub tự chờ tới ngày, không agent, không output field.
// Luật def (WAIT_INVALID) nằm ở contract `processDefStageIssues`; ở đây chỉ ép trường khi lưu (PD-R17).
import { NODE_FAMILY_OF } from "@ai/contracts/hub-admin";
import type { NodeSpec } from "../types";
import { ensureWaitStage } from "./wait-stage.rules";

export const waitUntilNode: NodeSpec<"wait_until"> = {
  kind: "wait_until",
  family: NODE_FAMILY_OF.wait_until,
  produces: "none",
  realAction: false,
  handoff: false,
  normalize: ensureWaitStage,
};

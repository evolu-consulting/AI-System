// CR-120 · G3 · node `wait_for`: Hub tự chờ N giờ kể từ lúc tới lượt (hẹn giờ `wait_until`), không agent, không output field.
import { NODE_FAMILY_OF } from "@ai/contracts/hub-admin";
import type { NodeSpec } from "../types";
import { ensureWaitStage } from "../wait-until/wait-stage.rules";
import { timedWaitDefIssues } from "./wait-timed.rules";

export const waitForNode: NodeSpec<"wait_for"> = {
  kind: "wait_for",
  family: NODE_FAMILY_OF.wait_for,
  produces: "none",
  realAction: false,
  handoff: false,
  defIssues: timedWaitDefIssues,
  normalize: ensureWaitStage,
};

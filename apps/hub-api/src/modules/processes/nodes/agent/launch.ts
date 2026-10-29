// CR-103 · R1 · node `agent` — chạy: run `direct` qua `hub.runs` với executor agent (HUB-FR-105, D3/D4).
import { launchStage, type NodeLauncher } from "../../runs/launch-common";

export const agentLauncher: NodeLauncher = {
  launch(d, tx, c) {
    if (c.def.executor.kind !== "agent")
      throw new Error("agentLauncher: executor không phải agent");
    return launchStage(d, tx, c, { kind: "agent", agentId: c.def.executor.agent_id });
  },
};

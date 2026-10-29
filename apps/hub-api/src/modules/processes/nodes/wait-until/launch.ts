// CR-103 · R1 · node `wait_until` — chạy (P-d1 · PD-R13): Hub tự chờ (hẹn giờ), KHÔNG tạo `hub.runs`/agent.
import type { NodeLauncher } from "../../runs/launch-common";
import { launchWaitStage } from "../../runs/wait-launch";

export const waitUntilLauncher: NodeLauncher = {
  launch(d, tx, c) {
    if (c.def.executor.kind !== "wait_until") return Promise.resolve({ kind: "skip" });
    const stageKeys = c.head.snapshot.stages.map((s) => s.key);
    const w = {
      runId: c.runId,
      tenantId: c.u.tenantId,
      idx: c.idx,
      stage: c.stage,
      exec: c.def.executor,
      stageKeys,
    };
    return launchWaitStage(d, tx, w);
  },
};

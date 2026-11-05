// CR-120 · G3 · node `wait_for` — chạy: hẹn giờ N giờ, KHÔNG tạo `hub.runs`/agent (khuôn `wait_until`).
import type { NodeLauncher } from "../../runs/launch-common";
import { launchTimedWaitStage } from "../../runs/wait-timed-launch";

export const waitForLauncher: NodeLauncher = {
  launch(d, tx, c) {
    if (c.def.executor.kind !== "wait_for") return Promise.resolve({ kind: "skip" });
    return launchTimedWaitStage(d, tx, {
      runId: c.runId,
      tenantId: c.u.tenantId,
      stage: c.stage,
      hours: c.def.executor.hours,
    });
  },
};

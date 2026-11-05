// CR-120 · G4 · node `wait_event` — chạy: hẹn hạn `timeout_h` (hoặc tới hạn ngay nếu sự kiện đã tới), KHÔNG tạo `hub.runs`/agent.
import type { NodeLauncher } from "../../runs/launch-common";
import { launchTimedWaitStage } from "../../runs/wait-timed-launch";

export const waitEventLauncher: NodeLauncher = {
  launch(d, tx, c) {
    const ex = c.def.executor;
    if (ex.kind !== "wait_event") return Promise.resolve({ kind: "skip" });
    return launchTimedWaitStage(d, tx, {
      runId: c.runId,
      tenantId: c.u.tenantId,
      stage: c.stage,
      hours: ex.timeout_h,
      event: ex.event,
    });
  },
};

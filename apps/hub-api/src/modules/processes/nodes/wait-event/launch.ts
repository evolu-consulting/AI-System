// CR-120 · G4 · node `wait_event` — chạy: hẹn hạn `timeout_h` (hoặc tới hạn ngay nếu sự kiện đã tới), KHÔNG tạo `hub.runs`/agent.
// CR-127 · E10 · chờ `milestone.confirmed` (node «Xác nhận mốc») ⇒ mở thêm việc nhóm `kind='milestone'` cho bản ghi của run.
import { MILESTONE_TASK_EVENT, openMilestoneTask } from "../../adapters/milestone-task.repo";
import type { NodeLauncher } from "../../runs/launch-common";
import { launchTimedWaitStage } from "../../runs/wait-timed-launch";

export const waitEventLauncher: NodeLauncher = {
  async launch(d, tx, c) {
    const ex = c.def.executor;
    if (ex.kind !== "wait_event") return { kind: "skip" };
    const r = await launchTimedWaitStage(d, tx, {
      runId: c.runId,
      tenantId: c.u.tenantId,
      stage: c.stage,
      hours: ex.timeout_h,
      event: ex.event,
    });
    if (ex.event === MILESTONE_TASK_EVENT) {
      const taskId = await openMilestoneTask(tx, {
        tenantId: c.u.tenantId,
        runId: c.runId,
        stageRunId: c.stage.id,
        now: d.now(),
      });
      if (taskId) r.events.push(...(await d.notifier.taskOpened(tx, taskId)));
    }
    return r;
  },
};

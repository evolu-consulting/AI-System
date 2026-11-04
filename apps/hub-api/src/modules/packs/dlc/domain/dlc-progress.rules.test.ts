// dlc-progress · tiến độ lượt DLC cho thẻ Chat: bước đang mở, việc của lượt (lọc mã), việc đang làm, số việc xong.
import { expect, test } from "bun:test";
import type { PackStepsView } from "../../kit/application/pack-runs.ports";
import { dlcProgress, tasksOfRun } from "./dlc-progress.rules";

const step = (idx: number, name: string, status: string) =>
  ({ idx, key: `s${idx}`, name, status }) as never;
const view = {
  run_id: "r",
  status: "running",
  started_by: "u",
  steps: [
    step(3, "Chuẩn bị đội", "passed"),
    step(4, "Build theo queue", "running"),
    step(5, "Nghiệm thu", "pending"),
  ],
} as PackStepsView;
const queue = [
  { id: "bf-t1", title: "Font", domain: "frontend", status: "ready_to_deploy", attempts: 2 },
  { id: "bf-t2", title: "Tests", domain: "frontend", status: "in_progress", attempts: 1 },
  { id: "bf-t3", title: "Theme", domain: "backend", status: "queued", attempts: 0 },
  { id: "zz-t1", title: "Lượt khác", status: "queued" },
];

test("chỉ việc của lượt (tiền tố mã); không mã ⇒ rỗng", () => {
  expect(tasksOfRun(queue, "bf").map((q) => q.id)).toEqual(["bf-t1", "bf-t2", "bf-t3"]);
  expect(tasksOfRun(queue, undefined)).toEqual([]);
});

test("bước đang chạy + việc đang làm + số việc xong + agent", () => {
  const agent = { agent: "dlc-x-frontend", flow_id: "f", status: "running", started_at: "t" };
  const p = dlcProgress(view, tasksOfRun(queue, "bf"), agent);
  expect(p.step).toEqual({ idx: 4, total: 3, name: "Build theo queue", status: "running" });
  expect(p.current).toEqual({ id: "bf-t2", title: "Tests" });
  expect(p.done).toBe(1);
  expect(p.tasks).toHaveLength(3);
  expect(p.agent?.flow_id).toBe("f");
});

test("run đã xong ⇒ không bước mở, không việc đang làm", () => {
  const p = dlcProgress({ ...view, status: "done", steps: [step(0, "A", "passed")] }, [], null);
  expect(p.step).toBeNull();
  expect(p.current).toBeNull();
});

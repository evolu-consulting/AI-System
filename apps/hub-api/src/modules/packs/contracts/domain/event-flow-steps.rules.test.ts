// CR-125 · S2 · stage của flow theo sự kiện ⇒ bước hiển thị ở Cài đặt (cùng flow tab Quy trình).
import { expect, it } from "bun:test";
import { stepsOfStages } from "./event-flow-steps.rules";

const approve = (name: string, step: number, after: Record<string, unknown>) => ({
  name,
  step,
  executor: { kind: "approve" },
  after: { kind: "review", ...after },
});

it("Duyệt 2 cấp: hai bước duyệt + ký số + thông báo, bỏ Chờ ký xong / Kết thúc, theo thứ tự step", () => {
  const stages = [
    { name: "Kết thúc · Đã duyệt", step: 5, executor: { kind: "set" }, outcome: "approved" },
    approve("Giám đốc duyệt", 1, { group_key: "giam-doc", group_id: null }),
    approve("Trưởng phòng duyệt", 0, { group_id: "g-1", group_key: null }),
    { name: "Ký số", step: 2, executor: { kind: "tool", tool_key: "contracts-esign-send" } },
    { name: "Chờ ký xong", step: 3, executor: { kind: "wait_event" } },
    { name: "Báo người tạo", step: 4, executor: { kind: "notify" } },
  ];
  const r = stepsOfStages(stages);
  expect(r.branches).toBe(false);
  expect(r.steps.map((s) => [s.name, s.kind, s.groupId, s.groupKey])).toEqual([
    ["Trưởng phòng duyệt", "review", "g-1", null],
    ["Giám đốc duyệt", "review", null, "giam-doc"],
    ["Ký số", "esign", null, null],
    ["Báo người tạo", "notify", null, null],
  ]);
});

it("có node Nếu ⇒ branches = true; stage rác không làm hỏng", () => {
  const r = stepsOfStages([
    { name: "Nhánh", step: 0, executor: { kind: "if" } },
    approve("Pháp chế duyệt", 1, { group_key: "phap-che" }),
    null,
    "x",
  ]);
  expect(r.branches).toBe(true);
  expect(r.steps.map((s) => s.name)).toEqual(["Pháp chế duyệt"]);
});

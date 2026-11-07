// CR-123 · u6 · FLOW3-FR-14 · gộp cụm node module (Ký số = gửi + chờ) thành MỘT bước với trạng thái nghiệp vụ.
import { describe, expect, test } from "bun:test";
import type { PackStepView } from "../../packs/kit/public";
import { collapseModuleSteps, type StageFact } from "./pack-runs-modules";

const step = (idx: number, key: string, name: string): PackStepView => ({
  idx,
  key,
  name,
  status: "pending",
  group_id: null,
  escalated_group_id: null,
  due_at: null,
  escalated: false,
  result: null,
  decided_by: null,
  decided_at: null,
  feedback: null,
  task: null,
});
const steps = [step(0, "a", "Duyệt"), step(1, "send", "Ký số"), step(2, "wait", "Chờ ký xong")];
const stages = [
  { executor: { kind: "tool" } },
  { node: "contracts.esign", executor: { kind: "tool" } },
  { node: "contracts.esign", executor: { kind: "wait_event" } },
];
const f = (send: string, wait: string, consumed: string | null = null): StageFact[] => [
  { stageStatus: "done", consumed: null },
  { stageStatus: send, consumed: null },
  { stageStatus: wait, consumed },
];
const run = (facts: StageFact[]) => collapseModuleSteps(steps, stages, facts);

describe("collapseModuleSteps · Ký số", () => {
  test("gửi + chờ = MỘT dòng 'Ký số' (không còn 'Chờ ký xong')", () => {
    const out = run(f("done", "waiting_timer"));
    expect(out.map((s) => s.name)).toEqual(["Duyệt", "Ký số"]);
  });
  test.each([
    ["pending", f("pending", "pending"), "pending", "pending"],
    ["waiting", f("done", "waiting_timer"), "waiting", "running"],
    ["done", f("done", "done", "esign.completed"), "done", "passed"],
    ["declined", f("done", "done", "esign.declined"), "declined", "rejected"],
    ["voided", f("done", "done", "esign.voided"), "declined", "rejected"],
    ["expired", f("done", "done", null), "expired", "failed"],
  ] as const)("trạng thái %s", (_n, facts, outcome, status) => {
    const s = run([...facts])[1] as PackStepView;
    expect(s.module).toEqual({ node: "contracts.esign", outcome });
    expect(s.status).toBe(status);
  });
  test("không có cụm ⇒ giữ nguyên", () => {
    expect(collapseModuleSteps(steps, [{ executor: { kind: "tool" } }], f("done", "done"))).toEqual(
      steps,
    );
  });
});

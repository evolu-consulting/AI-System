// CR-123 · u6 · FLOW3-FR-14 · gộp cụm node module (Ký số = gửi + chờ) thành MỘT bước với trạng thái nghiệp vụ.
import { describe, expect, test } from "bun:test";
import type { PackStepView } from "../../packs/kit/public";
import { collapseModuleSteps, type StageFact, signerRefs } from "./pack-runs-modules";

const ID = "0a1b2c3d-0000-4000-8000-0123456789ab";
describe("signerRefs", () => {
  test("đọc cả nguồn const {from,value} lẫn chuỗi trần", () => {
    const want = [`user:${ID}`, `group:${ID}`];
    const v = `user:${ID},group:${ID}`;
    expect(
      signerRefs({ executor: { args: { company_signers: { from: "const", value: v } } } }),
    ).toEqual(want);
    expect(signerRefs({ executor: { args: { company_signers: v } } })).toEqual(want);
    expect(signerRefs({ executor: { args: {} } })).toEqual([]);
  });
});

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
    ["failed", f("needs_decision", "pending"), "failed", "failed"],
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

describe("collapseModuleSteps · CR-126 bước người làm trong node Gửi đối tác", () => {
  const pk = (idx: number, key: string) => step(idx, key, key);
  const ps = [pk(0, "duyet"), pk(1, "chon"), pk(2, "gui"), pk(3, "cho")];
  const pstages = [
    { executor: { kind: "approve" } },
    { node: "contracts.partner-send", executor: { kind: "form" } },
    { node: "contracts.partner-send", executor: { kind: "tool" } },
    { node: "contracts.partner-send", executor: { kind: "wait_event" } },
  ];
  const facts: StageFact[] = [
    { stageStatus: "done", consumed: null },
    { stageStatus: "waiting_review", consumed: null },
    { stageStatus: "pending", consumed: null },
    { stageStatus: "pending", consumed: null },
  ];
  test("form đang mở ⇒ dòng là bước form (task + form), KHÔNG mang `module` (thẻ không vẽ thành bước tự động)", () => {
    const open: PackStepView = {
      ...(ps[1] as PackStepView),
      status: "open",
      task: { id: "t1", can_act: true },
      form: { fields: [{ key: "partner_email" }] as never, values: null },
    };
    const out = collapseModuleSteps(
      [ps[0] as PackStepView, open, ps[2] as PackStepView, ps[3] as PackStepView],
      pstages,
      facts,
    );
    expect(out.map((s) => s.key)).toEqual(["duyet", "chon"]);
    expect(out[1]?.module).toBeUndefined();
    expect(out[1]?.task?.id).toBe("t1");
    expect(out[1]?.form?.fields).toHaveLength(1);
  });
});

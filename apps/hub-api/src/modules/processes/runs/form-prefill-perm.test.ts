// CR-126 · review: điền sẵn (danh sách đối tác + email) CHỈ cho người quyết được bước form (can_act); người xem lượt không nhận.
// + quy trình BẬT có node Gửi đối tác mà chưa chọn nhóm phụ trách ⇒ lưu bị chặn NODE_ASSIGNEE_MISSING (bước sẽ không ai nhận).
import { afterAll, describe, expect, it } from "bun:test";
import type { ProcessDefInput } from "@ai/contracts/hub-admin";
import { formPrefillRegistry, type PackStepView } from "../../packs/kit/public";
import { withNodeAssignee } from "../defs/def-group-bind";
import { withFormPrefill } from "./pack-runs-extra";

const NODE = "test.prefill-perm";
let calls = 0;
formPrefillRegistry.register(NODE, async () => {
  calls++;
  return { field_defaults: { partner_email: "a@b.vn" }, field_options: {} };
});
afterAll(() => formPrefillRegistry.clear(NODE));

const step = (can: boolean): PackStepView =>
  ({
    idx: 0,
    key: "chon",
    name: "Chọn",
    status: "open",
    task: { id: "t1", can_act: can },
    form: { fields: [], values: null },
  }) as unknown as PackStepView;
const q = { tenantId: "t", userId: "u", recordId: null };

describe("CR-126 · quyền điền sẵn", () => {
  it("người xem không quyết được ⇒ không prefill, không gọi resolver", async () => {
    const out = await withFormPrefill([step(false)], () => NODE, q);
    expect(out[0]?.form?.prefill).toBeUndefined();
    expect(calls).toBe(0);
  });
  it("người được giao ⇒ có prefill (một lời gọi)", async () => {
    const out = await withFormPrefill([step(true)], () => NODE, q);
    expect(out[0]?.form?.prefill?.field_defaults).toEqual({ partner_email: "a@b.vn" });
    expect(calls).toBe(1);
  });
});

const partnerStages = (args: Record<string, unknown>) => [
  {
    key: "chon",
    name: "Gửi đối tác xác nhận",
    node: "contracts.partner-send",
    executor: { kind: "form", fields: [] },
    after: { kind: "auto" },
  },
  {
    key: "gui",
    node: "contracts.partner-send",
    executor: { kind: "tool", tool_key: "contracts-partner-send", args },
    after: { kind: "auto" },
  },
  {
    key: "cho",
    node: "contracts.partner-send",
    executor: { kind: "wait_event" },
    after: { kind: "auto" },
  },
];
const def = (enabled: boolean, args: Record<string, unknown>) =>
  ({ enabled, stages: partnerStages(args) }) as unknown as ProcessDefInput;

describe("CR-126 · nhóm phụ trách trống", () => {
  it("quy trình BẬT, chưa chọn nhóm ⇒ 422 NODE_ASSIGNEE_MISSING «Chọn nhóm phụ trách gửi đối tác»", () => {
    expect(() => withNodeAssignee(def(true, {}))).toThrow("Chọn nhóm phụ trách gửi đối tác");
    try {
      withNodeAssignee(def(true, {}));
    } catch (e) {
      expect((e as { code?: string }).code).toBe("NODE_ASSIGNEE_MISSING");
    }
  });
  it("nháp (chưa bật) lưu được; có nhóm ⇒ stage form giao cho nhóm", () => {
    expect(() => withNodeAssignee(def(false, {}))).not.toThrow();
    const G = "2f6f6f6f-1111-4222-8333-444455556666";
    const out = withNodeAssignee(def(true, { assignee_group: { from: "const", value: G } }));
    expect((out.stages[0] as unknown as { after: unknown }).after).toMatchObject({
      kind: "review",
      group_id: G,
    });
  });
});

// ADM-FR-66 · P-a F5: test hàm thuần của form editor quy trình (validate client khớp contract, mã giai đoạn, đổi chỗ).
import { describe, expect, test } from "bun:test";
import {
  canRealAction,
  type DefDraft,
  emptyDraft,
  emptyStage,
  patchStage,
  slugKey,
  snapshot,
  stageIndexesOf,
  toDraft,
  toInput,
  validateDraft,
} from "./def-form";

const A = "11111111-1111-4111-8111-111111111111";
const G = "22222222-2222-4222-8222-222222222222";

function validDraft(): DefDraft {
  const s = emptyStage();
  Object.assign(s, {
    key: "doc",
    name: "Đọc hoá đơn",
    executor: `agent:${A}`,
    filename: "doc.md",
    template: "# Doc",
    sections: ["Tóm tắt"],
  });
  return { ...emptyDraft(), key: "hoa-don", name: "Hoá đơn", stages: [s] };
}

describe("validateDraft", () => {
  test("bản nháp hợp lệ ⇒ không lỗi", () => {
    expect(validateDraft(validDraft())).toEqual({});
  });
  test("bản nháp rỗng ⇒ lỗi tên, ký hiệu, giai đoạn", () => {
    const e = validateDraft(emptyDraft());
    expect(e.name).toBe("process.admin.validate.nameRequired");
    expect(e.key).toBe("process.admin.validate.keyFormat");
    expect(e["stages.0.output.filename"]).toBe("process.admin.validate.fileName");
    expect(e["stages.0.output.required_sections"]).toBe("process.admin.validate.sectionRequired");
  });
  test("ký hiệu: 2–32, a-z 0-9 -", () => {
    const d = validDraft();
    for (const bad of ["a", "Ab", "a_b", "x".repeat(33)])
      expect(validateDraft({ ...d, key: bad }).key).toBeDefined();
    expect(validateDraft({ ...d, key: "ab" }).key).toBeUndefined();
  });
  test("mã giai đoạn trùng, hạn ngoài 60..3600, ngân sách ngoài 1000..5e6", () => {
    const d = validDraft();
    const s2 = { ...emptyStage(), ...d.stages[0], uid: "x2" };
    const e = validateDraft({
      ...d,
      stages: [d.stages[0] as never, { ...s2, timeout: "59", budget: "999" }],
    });
    expect(e["stages.1.key"]).toBe("process.admin.validate.stageKeyDup");
    expect(e["stages.1.timeout_s"]).toBe("process.admin.validate.timeout");
    expect(e["stages.1.token_budget"]).toBe("process.admin.validate.budget");
  });
  test("mã trường sai; hành động thật cần giai đoạn trước có người kiểm", () => {
    const d = validDraft();
    const s = { ...(d.stages[0] as never as (typeof d.stages)[0]) };
    s.fields = [{ key: "1bad", type: "string", required: false }];
    s.real = true;
    const e = validateDraft({ ...d, stages: [s] });
    expect(e["stages.0.output.fields.0.key"]).toBe("process.admin.validate.fieldKey");
    expect(e["stages.0.real_action"]).toBe("process.admin.canvas.err.realStep");
  });
  test("bật khi giai đoạn kiểm chưa có Group ⇒ PROCESS_DEF_INCOMPLETE", () => {
    const d = validDraft();
    const s = { ...(d.stages[0] as never as (typeof d.stages)[0]), after: "review" as const };
    expect(validateDraft({ ...d, stages: [s] }, false)["stages.0.after.group_id"]).toBeUndefined();
    expect(validateDraft({ ...d, stages: [s] }, true)["stages.0.after.group_id"]).toBe(
      "process.admin.apiError.PROCESS_DEF_INCOMPLETE",
    );
    expect(validateDraft({ ...d, stages: [{ ...s, groupId: G }] }, true)).toEqual({});
  });
});

describe("chuyển đổi nháp ↔ input", () => {
  test("toInput(toDraft(x)) giữ nguyên nội dung", () => {
    const input = toInput({
      ...validDraft(),
      stages: [
        {
          ...(validDraft().stages[0] as never as DefDraft["stages"][0]),
          after: "review",
          groupId: G,
        },
      ],
    });
    expect(toInput(toDraft(input))).toEqual(input);
    expect(input.stages[0]?.executor).toEqual({ kind: "agent", agent_id: A });
    expect(input.stages[0]?.after).toEqual({
      kind: "review",
      group_id: G,
      back_to_steps: [],
    });
    expect(input.token_budget).toBeNull();
  });
  test("snapshot bỏ uid cục bộ", () => {
    expect(snapshot(validDraft())).toBe(snapshot(validDraft()));
  });
});

describe("tiện ích giai đoạn", () => {
  test("slugKey bỏ dấu và tránh trùng", () => {
    expect(slugKey("Đọc hoá đơn", [])).toBe("doc-hoa-don");
    expect(slugKey("Đọc hoá đơn", ["doc-hoa-don"])).toBe("doc-hoa-don-2");
    expect(slugKey("!!!", [])).toBe("stage");
  });
  test("patchStage: còn keyAuto ⇒ sinh lại mã theo tên; sửa tay ⇒ giữ", () => {
    const a = { ...emptyStage(), key: "a" };
    const out = patchStage([a], 0, { name: "Kiểm tra" });
    expect(out[0]?.key).toBe("kiem-tra");
    const manual = patchStage(out, 0, { key: "mine", keyAuto: false });
    expect(patchStage(manual, 0, { name: "Khác" })[0]?.key).toBe("mine");
  });
  test("canRealAction + stageIndexesOf", () => {
    const s0 = { ...emptyStage(), after: "review" as const };
    const s1 = emptyStage(1);
    expect(canRealAction([s0, s1], 0)).toBe(false);
    expect(canRealAction([s0, s1], 1)).toBe(true);
    expect(stageIndexesOf(["name", "stages.2.key", "stages.0.output.template", "stages"])).toEqual([
      0, 2,
    ]);
  });
});

describe("P-b2 · bước", () => {
  const withStep = (step: number, extra: Partial<ReturnType<typeof emptyStage>> = {}) => ({
    ...validDraft().stages[0],
    ...emptyStage(step),
    key: `k${step}${extra.uid ?? ""}`,
    name: "N",
    executor: `agent:${A}`,
    filename: "a.md",
    template: "# T",
    sections: ["S"],
    ...extra,
  });
  test("toDraft/toInput: step luôn xuất, back_to_steps chỉ khi review; def cũ ⇒ bước = chỉ số", () => {
    const d = validDraft();
    const input = toInput({
      ...d,
      stages: [withStep(0), withStep(1, { after: "review", backTo: [0], groupId: G })],
    });
    expect(input.stages.map((s) => s.step)).toEqual([0, 1]);
    expect(input.stages[0]?.after).toEqual({ kind: "auto" });
    expect(input.stages[1]?.after).toEqual({ kind: "review", group_id: G, back_to_steps: [0] });
    const old = { ...input, stages: input.stages.map(({ step: _s, ...x }) => x) };
    expect(toDraft(old).stages.map((s) => s.step)).toEqual([0, 1]);
    expect(toDraft(input).stages[1]?.backTo).toEqual([0]);
  });
  test("canRealAction: mọi giai đoạn ở bước trước phải có người kiểm; bước 0 ⇒ không", () => {
    const r = (step: number) => withStep(step, { after: "review" });
    expect(canRealAction([r(0), r(0), emptyStage(1)], 2)).toBe(true);
    expect(canRealAction([r(0), emptyStage(0), emptyStage(1)], 2)).toBe(false);
    expect(canRealAction([r(0), emptyStage(0)], 0)).toBe(false);
  });
  test("validateDraft: bước đầy / sai thứ tự / đích quay lại / hành động thật", () => {
    const d = validDraft();
    const mk = (s: ReturnType<typeof withStep>[]) =>
      validateDraft({ ...d, stages: s.map((x, i) => ({ ...x, uid: `u${i}`, key: `k${i}` })) });
    expect(mk([withStep(0), withStep(0), withStep(0), withStep(0)])["stages.3.step"]).toBe(
      "process.admin.canvas.err.stepFull",
    );
    expect(mk([withStep(0), withStep(2)])["stages.1.step"]).toBe("process.admin.canvas.err.step");
    expect(mk([withStep(0), withStep(1, { after: "review", backTo: [1] })])).toMatchObject({
      "stages.1.after.back_to_steps": "process.admin.canvas.err.backTarget",
    });
    expect(mk([withStep(0), withStep(1, { real: true })])["stages.1.real_action"]).toBe(
      "process.admin.canvas.err.realStep",
    );
    expect(mk([withStep(0, { after: "review" }), withStep(1, { real: true })])).toEqual({});
  });
  test("patchStage: đổi sang auto ⇒ xoá backTo", () => {
    const s = withStep(1, { after: "review", backTo: [0] });
    expect(patchStage([s], 0, { after: "auto" })[0]?.backTo).toEqual([]);
  });
});

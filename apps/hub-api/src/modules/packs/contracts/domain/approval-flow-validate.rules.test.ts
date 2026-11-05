// CR-121 D-2 · unit: kiểm loại bước + điều kiện theo danh mục khe, mã phòng ban trong điều kiện, xem trước "chưa có dữ liệu".
import { describe, expect, it } from "bun:test";
import type { FlowStep } from "./approval-flow.types";
import {
  conditionDepartmentKeys,
  previewPath,
  stepKindAndCondIssues,
  validateApprovalBody,
} from "./approval-flow-stages.rules";
import { defaultSlotBody } from "./approval-slot-default.rules";

const rev = (when: unknown) => ({ ...(defaultSlotBody().steps[0] as object), key: "x", when });
const bodyWith = (when: unknown) => ({ steps: [defaultSlotBody().steps[0], rev(when)] });

describe("stepKindAndCondIssues", () => {
  it("điều kiện hợp lệ (4 trường đã khai báo, nhóm lồng một cấp) ⇒ không lỗi", () => {
    const when = {
      op: "or",
      conds: [
        { field: "total_value", op: "ge", value: 5 },
        { field: "deal", in: ["buy"] },
        { op: "and", conds: [{ field: "new_partner", is: true }] },
      ],
    };
    expect(stepKindAndCondIssues(bodyWith(when))).toEqual([]);
  });

  it("trường chưa khai báo / toán tử sai / giá trị ngoài danh sách / lồng 2 cấp", () => {
    const w = (c: unknown) => stepKindAndCondIssues(bodyWith({ op: "and", conds: [c] }))[0]?.rule;
    expect(w({ field: "due_date", in: ["x"] })).toBe("COND_FIELD_UNDECLARED:due_date");
    expect(w({ field: "total_value", op: "in", value: 1 })).toBe("COND_OP_UNSUPPORTED:total_value");
    expect(w({ field: "deal", in: ["lease"] })).toBe("COND_VALUE_INVALID:deal");
    expect(w({ field: "new_partner", is: "yes" })).toBe("COND_VALUE_INVALID:new_partner");
    const deep = { op: "and", conds: [{ op: "and", conds: [{ op: "or", conds: [] }] }] };
    expect(stepKindAndCondIssues(bodyWith(deep))[0]?.rule).toBe("COND_NESTING");
  });

  it("loại bước app không hỗ trợ ⇒ NODE_UNSUPPORTED kèm đúng bước", () => {
    const b = { steps: [defaultSlotBody().steps[0], { kind: "notify", key: "n" }] };
    expect(stepKindAndCondIssues(b)).toEqual([{ path: "steps.1.kind", rule: "NODE_UNSUPPORTED" }]);
  });
});

describe("validateApprovalBody", () => {
  it("loại bước/điều kiện lỗi đi trước; sạch ⇒ rơi về luật chéo bước (vd quá 20 bước)", () => {
    expect(validateApprovalBody(bodyWith({ op: "and", conds: [{ field: "zzz" }] }))[0]?.rule).toBe(
      "COND_FIELD_UNDECLARED:zzz",
    );
    const s0 = defaultSlotBody().steps[0] as object;
    const many = { steps: Array.from({ length: 21 }, (_, i) => ({ ...s0, key: `k${i}` })) };
    expect(validateApprovalBody(many).map((i) => i.rule)).toContain("STEPS_MAX");
  });
});

describe("conditionDepartmentKeys", () => {
  it("gom mã phòng ban ở điều kiện (kể cả nhóm lồng), không trùng", () => {
    const steps = [
      { kind: "review", when: null },
      {
        kind: "review",
        when: {
          op: "or",
          conds: [
            { field: "creator_department", in: ["a", "b"] },
            { op: "and", conds: [{ field: "creator_department", in: ["b", "c"] }] },
          ],
        },
      },
    ] as unknown as FlowStep[];
    expect(conditionDepartmentKeys(steps).sort()).toEqual(["a", "b", "c"]);
  });
});

describe("previewPath · chưa có dữ liệu", () => {
  const steps = [
    { kind: "review", key: "a", name: "a", when: null },
    {
      kind: "review",
      key: "b",
      name: "b",
      when: { op: "and", conds: [{ field: "creator_department", in: ["sales"] }] },
    },
    { kind: "dify", key: "d", name: "d", workflow_key: "w", after: "auto" },
  ] as unknown as FlowStep[];
  const st = (i: Parameters<typeof previewPath>[1]) =>
    previewPath({ steps }, i).map((p) => p.state);

  it("thiếu phòng ban ⇒ no_data (vẫn chạy); có dữ liệu ⇒ run/skip", () => {
    expect(st({ contractType: null, value: null })).toEqual(["run", "no_data", "run"]);
    expect(st({ contractType: "buy", value: 1, creatorDepartments: ["sales"] })).toEqual([
      "run",
      "run",
      "run",
    ]);
    expect(st({ contractType: "buy", value: 1, creatorDepartments: ["hr"] })).toEqual([
      "run",
      "skip",
      "run",
    ]);
  });
});

// CR-121 D-2 · CR-125 G1 · unit: Hub trả mã + biến + vị trí bước/trường (không câu chữ); web dịch bằng khoá i18n của mã.
import { describe, expect, it } from "bun:test";
import { PUBLISH_ISSUE_CODES } from "@ai/contracts/pack-contracts";
import { explainIssue, missingGroupIssues } from "./library-publish.messages";

describe("explainIssue", () => {
  it("steps.N.field ⇒ bước đánh số từ 1 + trường + mã, không có câu chữ", () => {
    const e = explainIssue({ path: "steps.2.department_group_id", rule: "GROUP_REQUIRED" });
    expect(e).toEqual({
      path: "steps.2.department_group_id",
      rule: "GROUP_REQUIRED",
      step: 3,
      field: "department_group_id",
      code: "GROUP_REQUIRED",
      params: {},
    });
    expect(e).not.toHaveProperty("message");
    expect(e).not.toHaveProperty("message_en");
  });

  it("stages.N.slot.when: stage 0 = bước 1, stage ≥ 2 = bước N (bỏ qua stage rẽ hệ thống)", () => {
    expect(explainIssue({ path: "stages.0.slot.when", rule: "UNREACHABLE_STEP" }).step).toBe(1);
    expect(explainIssue({ path: "stages.3.slot.when", rule: "UNREACHABLE_STEP" }).step).toBe(3);
  });

  it("mã có tham số: trường điều kiện chưa khai báo / thiếu nút hệ thống", () => {
    const f = explainIssue({ path: "steps.1.when", rule: "COND_FIELD_UNDECLARED:due_date" });
    expect(f).toMatchObject({
      step: 2,
      code: "COND_FIELD_UNDECLARED",
      params: { param: "due_date" },
    });
    const s = explainIssue({ path: "stages", rule: "SYSTEM_TOOL_MISSING:contracts-route" });
    expect(s).toMatchObject({ step: null, params: { param: "contracts-route" } });
  });

  it("mã có giới hạn: biến lấy từ hằng chung", () => {
    expect(explainIssue({ path: "steps", rule: "STEPS_MAX" }).params).toEqual({ max: 20 });
    const r = explainIssue({ path: "steps.1.remind_every_h", rule: "REMIND_RANGE" });
    expect(r.params).toMatchObject({ min: 4, max: 168 });
    expect(explainIssue({ path: "steps.1", rule: "NOTIFY_TO_REQUIRED" }).code).toBe(
      "NOTIFY_TO_REQUIRED",
    );
  });

  it("mã lạ ⇒ vẫn trả mã gốc để web hiện câu chung kèm mã", () => {
    expect(explainIssue({ path: "steps.0", rule: "WHATEVER" })).toMatchObject({
      code: "WHATEVER",
      step: 1,
    });
    expect(PUBLISH_ISSUE_CODES).not.toContain("WHATEVER");
  });
});

describe("missingGroupIssues", () => {
  const body = {
    steps: [
      { key: "a", department_group_key: "ke-toan", when: null },
      {
        key: "sales",
        department_group_key: "ke-toan",
        when: { op: "and", conds: [{ field: "creator_department", in: ["sales"] }] },
      },
    ],
  };
  it("một mã cho mỗi bước dùng mã; biến nêu mã phòng ban và công ty", () => {
    const r = missingGroupIssues(body, "congty-x", ["sales"]);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({
      step: 2,
      rule: "GROUP_MISSING_IN_TENANT",
      code: "GROUP_MISSING_IN_TENANT",
      params: { key: "sales", tenant: "congty-x" },
    });
  });
  it("không tìm ra bước ⇒ lỗi chung", () => {
    expect(missingGroupIssues({ steps: [] }, "t", ["z"])[0]?.step).toBeNull();
  });
});

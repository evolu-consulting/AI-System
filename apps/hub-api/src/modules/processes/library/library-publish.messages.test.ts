// CR-121 D-2 · unit: mỗi mã luật có câu tiếng Việt nói cách sửa + bản Anh; vị trí bước/trường đúng.
import { describe, expect, it } from "bun:test";
import { explainIssue, missingGroupIssues } from "./library-publish.messages";

describe("explainIssue", () => {
  it("steps.N.field ⇒ bước đánh số từ 1 + trường", () => {
    const e = explainIssue({ path: "steps.2.department_group_id", rule: "GROUP_REQUIRED" });
    expect(e).toMatchObject({ step: 3, field: "department_group_id" });
    expect(e.message).toBe(
      "Bước 3: bước duyệt chưa chọn phòng ban — chọn phòng ban hoặc người duyệt cho bước này.",
    );
    expect(e.message_en.startsWith("Step 3:")).toBe(true);
  });

  it("stages.N.slot.when: stage 0 = bước 1, stage ≥ 2 = bước N (bỏ qua stage rẽ hệ thống)", () => {
    expect(explainIssue({ path: "stages.0.slot.when", rule: "UNREACHABLE_STEP" }).step).toBe(1);
    expect(explainIssue({ path: "stages.3.slot.when", rule: "UNREACHABLE_STEP" }).step).toBe(3);
  });

  it("mã có tham số: trường điều kiện chưa khai báo / thiếu nút hệ thống", () => {
    const f = explainIssue({ path: "steps.1.when", rule: "COND_FIELD_UNDECLARED:due_date" });
    expect(f.message).toContain("'due_date'");
    expect(f.message).toContain("Bước 2");
    const s = explainIssue({ path: "stages", rule: "SYSTEM_TOOL_MISSING:contracts-route" });
    expect(s).toMatchObject({ step: null });
    expect(s.message).toContain("contracts-route");
  });

  it("lỗi chung (không có bước) và ký số không ở cuối", () => {
    expect(explainIssue({ path: "steps", rule: "STEPS_MAX" }).message).toContain("20 bước");
    expect(explainIssue({ path: "steps.4", rule: "ESIGN_NOT_LAST" }).message).toContain(
      "Bước Ký số phải là bước cuối.",
    );
  });

  it("mã lạ ⇒ câu chung vẫn có hướng xử lý", () => {
    expect(explainIssue({ path: "steps.0", rule: "WHATEVER" }).message).toContain("WHATEVER");
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
  it("một câu cho mỗi bước dùng mã; nêu tên công ty và cách sửa", () => {
    const r = missingGroupIssues(body, "congty-x", ["sales"]);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ step: 2, rule: "GROUP_MISSING_IN_TENANT" });
    expect(r[0]?.message).toBe(
      "Bước 2: phòng ban 'sales' không có ở công ty congty-x — tạo phòng ban này ở công ty hoặc đổi điều kiện/phòng ban của bước.",
    );
  });
  it("không tìm ra bước ⇒ câu chung", () => {
    expect(missingGroupIssues({ steps: [] }, "t", ["z"])[0]?.step).toBeNull();
  });
});

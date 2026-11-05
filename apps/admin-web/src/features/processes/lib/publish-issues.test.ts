// CR-121 D-3: đọc lỗi xuất bản 422 của Hub (bước, trường, câu sửa) → dòng hiển thị + chỉ số bước để nhảy tới.
import { describe, expect, test } from "bun:test";
import { newReview } from "./flow-form";
import { parsePublishIssues } from "./publish-issues";

const steps = [newReview([], "pb-a"), { ...newReview([], "pb-b"), key: "duyet-gd" }];

describe("parsePublishIssues", () => {
  test("dạng chuẩn {step,field,fix}: theo mã bước hoặc số thứ tự", () => {
    const out = parsePublishIssues(
      {
        issues: [
          {
            path: "x",
            rule: "R",
            step: "duyet-gd",
            field: "department_group_key",
            fix: "Chọn phòng ban",
          },
          { path: "x", rule: "R2", step: 0 },
        ],
      },
      steps,
    );
    expect(out).toEqual([
      { index: 1, field: "department_group_key", text: "Chọn phòng ban", rule: "R" },
      { index: 0, field: null, text: "R2", rule: "R2" },
    ]);
  });
  test("thiếu step ⇒ suy từ path; mục hỏng bị bỏ; không có issues ⇒ rỗng", () => {
    const out = parsePublishIssues(
      { issues: [{ path: "slot_body.steps.2.when", rule: "COND_DEPT_MISSING" }, 5, null] },
      steps,
    );
    expect(out).toEqual([
      { index: 2, field: "when", text: "COND_DEPT_MISSING", rule: "COND_DEPT_MISSING" },
    ]);
    expect(parsePublishIssues({}, steps)).toEqual([]);
    expect(parsePublishIssues(null, steps)).toEqual([]);
  });
});

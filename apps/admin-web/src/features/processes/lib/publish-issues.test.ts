// CR-121 D-3 · CR-125 G1: đọc lỗi xuất bản 422 của Hub (mã + biến + bước, trường) → dòng hiển thị (web dịch) + chỉ số bước để nhảy tới.
import { describe, expect, test } from "bun:test";
import { newReview } from "./flow-form";
import { parsePublishIssues, type Translate } from "./publish-issues";

const steps = [newReview([], "pb-a"), { ...newReview([], "pb-b"), key: "duyet-gd" }];
/** Bộ dịch giả: trả `khoá|biến` để kiểm khoá + biến mà không cần i18n. */
const t: Translate = (k, p) =>
  `${k.replace("process.admin.library.form.", "")}|${JSON.stringify(p ?? {})}`;

describe("parsePublishIssues", () => {
  test("dạng chuẩn {step,field,code,params}: khoá của mã + biến, kèm số bước", () => {
    const out = parsePublishIssues(
      {
        issues: [
          {
            path: "x",
            rule: "GROUP_REQUIRED",
            code: "GROUP_REQUIRED",
            step: "duyet-gd",
            field: "department_group_key",
            params: {},
          },
          { path: "x", rule: "DUE_RANGE", step: 0, params: { min: 4, max: 2160 } },
        ],
      },
      steps,
      t,
    );
    expect(out).toEqual([
      {
        index: 1,
        field: "department_group_key",
        text: 'stepIssue|{"n":2,"msg":"err.GROUP_REQUIRED|{}"}',
        rule: "GROUP_REQUIRED",
      },
      {
        index: 0,
        field: null,
        text: 'stepIssue|{"n":1,"msg":"err.DUE_RANGE|{\\"min\\":4,\\"max\\":2160}"}',
        rule: "DUE_RANGE",
      },
    ]);
  });
  test("thiếu step ⇒ suy từ path; thiếu code ⇒ lấy từ rule; mã lạ ⇒ câu chung; mục hỏng bị bỏ", () => {
    const out = parsePublishIssues(
      { issues: [{ path: "slot_body.steps.2.when", rule: "COND_DEPT_MISSING" }, 5, null] },
      steps,
      t,
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ index: 2, field: "when", rule: "COND_DEPT_MISSING" });
    expect(out[0]?.text).toContain("err.unknown|");
    expect(out[0]?.text).toContain("COND_DEPT_MISSING");
    expect(parsePublishIssues({}, steps, t)).toEqual([]);
    expect(parsePublishIssues(null, steps, t)).toEqual([]);
  });
  test("lỗi chung (không có bước) ⇒ không tiền tố bước; luật có tham số lấy mã trước dấu ':'", () => {
    const [i] = parsePublishIssues(
      {
        issues: [
          {
            path: "stages",
            rule: "SYSTEM_TOOL_MISSING:contracts-route",
            params: { param: "contracts-route" },
          },
        ],
      },
      steps,
      t,
    );
    expect(i).toMatchObject({
      index: null,
      text: 'err.SYSTEM_TOOL_MISSING|{"param":"contracts-route"}',
    });
  });
});

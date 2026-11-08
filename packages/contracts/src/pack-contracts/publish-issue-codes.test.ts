// CR-125 · G1 · biến nội suy theo mã lấy từ hằng chung; danh sách mã không trùng.
import { describe, expect, test } from "bun:test";
import { APPROVAL_FLOW_DUE_H, APPROVAL_FLOW_STEPS_MAX } from "./approval-flow";
import { PUBLISH_ISSUE_CODES, publishIssueParams } from "./publish-issue-codes";

describe("publishIssueParams", () => {
  test("mã có giới hạn ⇒ min/max từ hằng chung; mã có tham số ⇒ param; còn lại rỗng", () => {
    expect(publishIssueParams("DUE_RANGE")).toEqual({
      min: APPROVAL_FLOW_DUE_H.min,
      max: APPROVAL_FLOW_DUE_H.max,
    });
    expect(publishIssueParams("STEPS_MAX")).toEqual({ max: APPROVAL_FLOW_STEPS_MAX });
    expect(publishIssueParams("REMIND_RANGE")).toHaveProperty("min");
    expect(publishIssueParams("WAIT_OFFSET_RANGE")).toEqual({ min: -365, max: 365 });
    expect(publishIssueParams("COND_FIELD_UNDECLARED", "due_date")).toEqual({ param: "due_date" });
    expect(publishIssueParams("KEY_DUP")).toEqual({});
  });
  test("danh sách mã không trùng", () => {
    expect(new Set(PUBLISH_ISSUE_CODES).size).toBe(PUBLISH_ISSUE_CODES.length);
  });
});

// CR-126 · widget `group` (Nhóm phụ trách gửi đối tác) dùng CÙNG ô chọn nhóm với `department` của panel chung.
import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { fieldsOf } from "./fields";

describe("fieldsOf · widget group", () => {
  test("assignee_group ⇒ ô chọn nhóm (kind department), nhãn từ describe, không bắt buộc", () => {
    const schema = z.object({
      assignee_group: z.string().optional().describe("Nhóm phụ trách gửi đối tác"),
    });
    const [f] = fieldsOf({ schema, widgets: { assignee_group: "group" } });
    expect(f).toMatchObject({
      key: "assignee_group",
      kind: "department",
      label: "Nhóm phụ trách gửi đối tác",
      required: false,
    });
  });
});

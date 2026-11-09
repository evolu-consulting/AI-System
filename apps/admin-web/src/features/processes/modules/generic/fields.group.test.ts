// CR-126 · widget `group` (Nhóm phụ trách gửi đối tác) dùng CÙNG ô chọn nhóm với `department` của panel chung.
import { describe, expect, test } from "bun:test";
import { featureNodeByKey, MODULES } from "@ai/contracts/modules";
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

  test("node gửi đối tác: ô đối tác và email cũ bị ẩn khỏi panel cấu hình, nhóm phụ trách còn", () => {
    const port = featureNodeByKey(MODULES, "contracts.partner-send")?.configPort;
    if (!port) throw new Error("thiếu configPort");
    const keys = fieldsOf(port).map((f) => f.key);
    expect(keys).not.toContain("partner_tax_code");
    expect(keys).not.toContain("partner_email");
    expect(keys).toContain("assignee_group");
    expect(keys).toContain("reply_days");
  });
});

// CR-122 · P11b · lượt flow theo sự kiện không mở được ⇒ câu nghiệp vụ riêng (kèm cách sửa), nút Mở lại cho chủ HĐ.
import { describe, expect, test } from "bun:test";
import { attentionText } from "./attention";

const B = "contracts.approval.engine.attention.reason";

describe("P11b · lý do flow không mở được", () => {
  test("mỗi mã có câu riêng (không rơi về câu chung)", () => {
    for (const r of ["FLOW_NOT_ASSIGNED", "FLOW_REFUSED", "FLOW_START_FAILED", "FLOW_STARTING"])
      expect(attentionText({ kind: "stalled", reason: r }).key).toBe(`${B}.${r}`);
  });
  test("thiếu nhóm ⇒ nêu mã nhóm, chủ HĐ có nút Mở lại", () => {
    expect(attentionText({ kind: "stalled", reason: "FLOW_GROUP_MISSING:pb-phap-che" })).toEqual({
      key: `${B}.FLOW_GROUP_MISSING`,
      vars: { keys: "pb-phap-che" },
    });
  });
});

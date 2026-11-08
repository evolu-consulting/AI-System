// CR-125 · cr125-purchase-templates · mẫu Thư viện chọn nhóm duyệt theo MÃ: nạp `after.group_key` vào nháp và lưu lại đúng (không rớt mã,
// không đẩy id), để quản trị nền tảng dựng mẫu bằng trình sửa canvas.
import { describe, expect, test } from "bun:test";
import { emptyStage, stageToDraft, stageToInput } from "./stage-convert";

describe("stage-convert · nhóm duyệt theo mã (mẫu Thư viện)", () => {
  test("đặt groupKey ⇒ after.group_key và group_id null, nạp lại giữ mã", () => {
    const s = Object.assign(emptyStage(), {
      key: "duyet",
      name: "Duyệt",
      executor: "approve",
      after: "review" as const,
      groupKey: "truong-bo-phan",
    });
    const def = stageToInput(s);
    expect(def.after).toMatchObject({
      kind: "review",
      group_id: null,
      group_key: "truong-bo-phan",
    });
    expect(stageToDraft(def, 0).groupKey).toBe("truong-bo-phan");
  });

  test("không có mã (flow công ty) ⇒ vẫn lưu group_id như cũ, không có group_key", () => {
    const g = "22222222-2222-4222-8222-222222222222";
    const s = Object.assign(emptyStage(), {
      key: "k",
      name: "K",
      after: "review" as const,
      groupId: g,
    });
    const def = stageToInput(s);
    expect(def.after).toMatchObject({ kind: "review", group_id: g });
    expect("group_key" in def.after).toBe(false);
  });
});

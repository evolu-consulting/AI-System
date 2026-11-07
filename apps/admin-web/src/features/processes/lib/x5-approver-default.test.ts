// CR-125 · x5 · bước Duyệt mới KHÔNG có người duyệt mặc định (nhất là không phải nhóm kỹ thuật như "Beta testers"): Lưu bị chặn tới khi chọn,
// danh sách chọn chỉ có nhóm nghiệp vụ (cùng nguồn `isApproverGroup`).
import { describe, expect, test } from "bun:test";
import { isApproverGroup } from "@ai/contracts/groups";
import { emptyStage, validateDraft } from "./def-form";
import { nodesForApp } from "./flow-def";

const draftOf = (stages: ReturnType<typeof emptyStage>[]) => ({
  key: "duyet-moi",
  name: "Quy trình",
  description: "",
  hint: "",
  groupIds: [],
  budget: "",
  enabled: false,
  stages,
  sources: [],
  inputs: [],
  ttl: "7",
  noExpiry: false,
});

describe("CR-125 x5 · bước Duyệt mới chưa chọn người duyệt", () => {
  const approve = nodesForApp("").find((n) => n.id === "approve");
  const fresh = { ...emptyStage(0), ...approve?.patch };

  test("mẫu Duyệt trong bảng node không đặt nhóm nào", () => {
    expect(approve?.patch).toBeTruthy();
    expect(fresh.executor).toBe("approve");
    expect(fresh.groupId).toBe("");
  });
  test("Lưu để áp dụng bị chặn tới khi chọn người duyệt, chọn rồi thì hết lỗi", () => {
    const blocked = validateDraft(draftOf([fresh]), true);
    expect(blocked["stages.0.after.group_id"]).toBeDefined();
    const ok = validateDraft(draftOf([{ ...fresh, groupId: "g1" }]), true);
    expect(ok["stages.0.after.group_id"]).toBeUndefined();
  });
  test("nhóm kỹ thuật (Beta, nhóm vai của gói) không phải lựa chọn mặc định hay lựa chọn được", () => {
    const groups = [
      { key: "beta-testers", is_beta: true },
      { key: "contracts-owner" },
      { key: "ke-toan" },
    ];
    expect(groups.filter(isApproverGroup).map((g) => g.key)).toEqual(["ke-toan"]);
  });
});

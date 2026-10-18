// HUB-FR-144 · P-d1 · A4 G7: `toOpenTask` — `escalated_group` chỉ có khi task đã chuyển cấp (UAT B4).
import { describe, expect, it } from "bun:test";
import { toOpenTask } from "./runs.repo";

const base = {
  id: "11111111-1111-4111-8111-111111111111",
  kind: "review" as const,
  stage_idx: 0,
  group_id: "22222222-2222-4222-8222-222222222222",
  group_name: "Kế toán",
  assignees: [],
  esc_group_id: null,
  esc_group_name: null,
};

describe("toOpenTask", () => {
  it("chưa chuyển cấp ⇒ không có escalated_group", () => {
    const t = toOpenTask(base);
    expect("escalated_group" in t).toBe(false);
    expect(t.group).toEqual({ id: base.group_id, name: "Kế toán" });
  });
  it("đã chuyển cấp ⇒ escalated_group {id, name}", () => {
    const g = "33333333-3333-4333-8333-333333333333";
    const t = toOpenTask({ ...base, esc_group_id: g, esc_group_name: "Giám đốc" });
    expect(t.escalated_group).toEqual({ id: g, name: "Giám đốc" });
  });
  it("nhóm chuyển cấp không có tên ⇒ dùng id", () => {
    const g = "33333333-3333-4333-8333-333333333333";
    expect(toOpenTask({ ...base, esc_group_id: g }).escalated_group?.name).toBe(g);
  });
});

// CR-127 · U4 · «Việc của tôi»: nhận việc, x/n, «Thay A», việc Xác nhận mốc, HĐ nhận không quy trình.
import { describe, expect, test } from "bun:test";
import { claimFields, filterInbox, inboxRows } from "./inbox";

const U = "11111111-1111-4111-8111-111111111111";
const base = {
  approvals: [],
  signing: [],
  requests: [],
  signTag: "Cần ký",
  now: Date.parse("2026-11-10"),
};
const item = (task: Record<string, unknown>) =>
  ({
    task: {
      id: U,
      stage_name: "Duyệt",
      created_at: "2026-11-09T00:00:00Z",
      kind: "review",
      ...task,
    },
    process_run: {
      id: U,
      process: { name: "Mua" },
      started_by: { id: U, display_name: "An" },
    },
  }) as never;

describe("claimFields", () => {
  test("việc đích danh không có dải nhận", () => {
    expect(claimFields({})).toEqual({});
  });
  test("chưa ai nhận / người khác giữ", () => {
    expect(claimFields({ claim: { state: "unclaimed" } }).claim).toEqual({
      state: "unclaimed",
      holder: null,
    });
    expect(
      claimFields({ claim: { state: "other", by: { id: U, display_name: "Lan" } } }).claim,
    ).toEqual({ state: "other", holder: "Lan" });
  });
  test("Cần tất cả ⇒ chỉ x/n; có thay người ⇒ behalf", () => {
    const f = claimFields({
      need: "all",
      claim: { state: "unclaimed" },
      votes: { done: 1, total: 3 },
      delegated_from: { id: U, display_name: "Hà" },
    });
    expect(f).toEqual({ votes: "1/3", behalf: "Hà" });
  });
});

describe("inboxRows", () => {
  test("việc Xác nhận mốc ⇒ kind milestone, kèm trạng thái nhận", () => {
    const rows = inboxRows({
      ...base,
      requests: [item({ kind: "milestone", claim: { state: "unclaimed" } })],
    });
    expect(rows[0]).toMatchObject({ kind: "milestone", claim: { state: "unclaimed" } });
  });
  test("HĐ nhận không quy trình ⇒ dòng inbox có 3 nút (đủ dữ liệu), tính vào chip Cần duyệt", () => {
    const rows = inboxRows({
      ...base,
      inbox: [
        {
          contract_id: U,
          contract_number: "HD-1",
          contract_title: "Mua giấy",
          sender_name: "Công ty B",
          round: 1,
          since: "2026-11-08T00:00:00Z",
        },
      ],
    });
    expect(rows[0]?.inbox).toEqual({ contractId: U, sender: "Công ty B" });
    expect(filterInbox(rows, "approve")).toHaveLength(1);
    expect(filterInbox(rows, "sign")).toHaveLength(0);
  });
  test("duyệt HĐ: `delegated_from` của /my-work ⇒ «Thay A» dù /me/review-tasks chưa có việc", () => {
    const rows = inboxRows({
      ...base,
      approvals: [
        {
          task_id: U,
          contract_id: U,
          contract_number: null,
          contract_title: "HĐ",
          stage_name: "Kế toán duyệt",
          due_at: null,
          escalated: false,
          delegated_from: { id: U, display_name: "Hà" },
        },
      ],
    });
    expect(rows[0]?.behalf).toBe("Hà");
  });
});

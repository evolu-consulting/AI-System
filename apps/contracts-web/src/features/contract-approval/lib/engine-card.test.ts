// contract-flow S4 · unit: luật nút/ghi chú thẻ engine, dòng thời gian, nhãn lý do `ENGINE_RUN_*`.
import { describe, expect, test } from "bun:test";
import type { ApprovalCardStep, ContractApproval } from "@ai/contracts";
import { approvalView } from "./approval";
import { hoursLeft, releaseNoteKey, timelineRows } from "./engine-card";

const G1 = "11111111-1111-4111-8111-111111111111";
const G2 = "22222222-2222-4222-8222-222222222222";
const step = (o: Partial<ApprovalCardStep>): ApprovalCardStep => ({
  idx: 0,
  key: "s0",
  name: "Soạn",
  kind: "review",
  status: "pending",
  group_id: G1,
  head_only: false,
  escalated_group_id: null,
  due_at: null,
  escalated: false,
  decided_by: null,
  decided_at: null,
  feedback: null,
  ...o,
});
const card = (steps: ApprovalCardStep[], o: Partial<ContractApproval> = {}): ContractApproval => ({
  mode: "engine",
  run_id: G1,
  run_status: "running",
  step: "level1",
  task_id: G2,
  can_act: true,
  feedback: null,
  steps,
  ...o,
});
const W = { write: true, hasSource: true };

describe("approvalView (engine)", () => {
  test("bước soạn mở + can_act ⇒ Xác nhận (không Trả lại)", () => {
    const v = approvalView(card([step({ status: "open" })]), W);
    expect(v).toMatchObject({ confirm: true, reject: true });
    expect(v.back).toBeUndefined();
    expect(v.pass).toBeUndefined();
  });
  test("bước ≥ 1 mở + can_act ⇒ Đạt + Trả lại + Từ chối", () => {
    const v = approvalView(
      card([step({ status: "passed" }), step({ idx: 1, key: "s1", status: "open" })]),
      W,
    );
    expect(v).toMatchObject({ pass: true, back: true, reject: true, confirm: false });
  });
  test("can_act=false ⇒ không nút, ghi chú theo lý do; head_only ⇒ câu trưởng phòng", () => {
    const open = step({ idx: 1, key: "s1", status: "open", head_only: true });
    const mk = (r: ContractApproval["block_reason"]) =>
      approvalView(card([open], { can_act: false, block_reason: r }), W);
    expect(mk("starter").note).toBe("contracts.approval.engine.blocked.starter");
    expect(mk("not_reviewer").note).toBe("contracts.approval.engine.blocked.headOnly");
    expect(mk("not_reviewer")).toMatchObject({ confirm: false, approve: false, reject: false });
    expect(mk("not_reviewer").pass).toBeUndefined();
    expect(mk("not_reviewer").back).toBeUndefined();
    const plain = card([{ ...open, head_only: false }], {
      can_act: false,
      block_reason: "not_reviewer",
    });
    expect(approvalView(plain, W).note).toBe("contracts.approval.engine.blocked.notReviewer");
    expect(approvalView(card([open]), { ...W, write: false }).note).toBe(
      "contracts.approval.blocked.viewOnly",
    );
  });
  test("máy cũ (không mode) giữ nguyên", () => {
    const v = approvalView({ ...card([]), mode: "machine" }, W);
    expect(v).toEqual({ confirm: true, approve: false, reject: true, redo: true, note: null });
  });
});

describe("timelineRows", () => {
  const now = Date.parse("2026-10-27T12:00:00Z");
  const groups = [{ id: G1, name: "Kế toán" }];
  test("tên phòng từ /groups; quá hạn chỉ ở bước mở; đã chuyển cấp", () => {
    const rows = timelineRows(
      [
        step({
          status: "passed",
          due_at: "2026-10-26T00:00:00Z",
          decided_by: { id: G2, name: "An" },
        }),
        step({ idx: 1, key: "s1", status: "open", due_at: "2026-10-27T10:00:00Z", group_id: G2 }),
        step({
          idx: 2,
          key: "s2",
          status: "open",
          due_at: "2026-10-28T12:00:00Z",
          escalated: true,
          escalated_group_id: G1,
        }),
      ],
      groups,
      now,
    );
    expect(rows[0]).toMatchObject({ group: "Kế toán", decidedBy: "An", due: { flag: null } });
    expect(rows[1]).toMatchObject({ group: "", due: { flag: "overdue" } });
    expect(rows[2]).toMatchObject({ due: { flag: "escalated" }, escalatedTo: "Kế toán" });
  });
  test("bước Dify không có phòng ⇒ null", () => {
    expect(
      timelineRows([step({ kind: "dify", group_id: null })], groups, now)[0]?.group,
    ).toBeNull();
  });
  test("hoursLeft làm tròn về 0", () => {
    expect(hoursLeft("2026-10-27T14:30:00Z", now)).toBe(2);
    expect(hoursLeft("2026-10-27T09:30:00Z", now)).toBe(-2);
  });
});

describe("releaseNoteKey", () => {
  test("mã đã biết / lạ / không phải mã engine", () => {
    expect(releaseNoteKey("ENGINE_RUN_FAILED")).toBe("contracts.approval.engine.release.FAILED");
    expect(releaseNoteKey("ENGINE_RUN_MISSING")).toBe("contracts.approval.engine.release.MISSING");
    expect(releaseNoteKey("ENGINE_RUN_WEIRD")).toBe("contracts.approval.engine.release.OTHER");
    expect(releaseNoteKey("Thiếu điều khoản")).toBeNull();
    expect(releaseNoteKey(null)).toBeNull();
  });
});

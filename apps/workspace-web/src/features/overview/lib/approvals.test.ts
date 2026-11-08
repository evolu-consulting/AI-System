// contract-flow S4 · unit: danh sách "Chờ tôi duyệt" (tên HĐ, sắp theo hạn, quá hạn).
import { describe, expect, test } from "bun:test";
import type { MyWorkApproval } from "@ai/contracts/pack-contracts";
import { approvalRows, approvalTarget, approvalTitle } from "./approvals";

const A = (o: Partial<MyWorkApproval>): MyWorkApproval => ({
  task_id: "t",
  contract_id: "c",
  contract_number: null,
  contract_title: null,
  stage_name: "Kế toán",
  due_at: null,
  escalated: false,
  ...o,
});
const now = Date.parse("2026-10-27T12:00:00Z");

describe("approvals", () => {
  test("tên: số · tên, thiếu một vế vẫn đọc được, thiếu cả hai ⇒ null", () => {
    expect(approvalTitle(A({ contract_number: "HD-1", contract_title: "Mua" }))).toBe("HD-1 · Mua");
    expect(approvalTitle(A({ contract_title: "Mua" }))).toBe("Mua");
    expect(approvalTitle(A({}))).toBeNull();
  });
  test("sắp theo hạn gần nhất, không hạn xuống cuối; cờ quá hạn", () => {
    const rows = approvalRows(
      [
        A({ task_id: "none" }),
        A({ task_id: "later", due_at: "2026-10-30T00:00:00Z" }),
        A({ task_id: "late", due_at: "2026-10-26T00:00:00Z", escalated: true }),
      ],
      now,
    );
    expect(rows.map((r) => r.taskId)).toEqual(["late", "later", "none"]);
    expect(rows[0]).toMatchObject({ due: { late: true }, escalated: true });
    expect(rows[1]?.due?.late).toBe(false);
    expect(approvalRows(undefined, now)).toEqual([]);
  });
});

describe("approvalTarget", () => {
  test("CR-126 · task thuộc run mở trang yêu cầu của run, không có run mở thẻ HĐ", () => {
    const row = { taskId: "t1", contractId: "c1" };
    expect(approvalTarget(row, new Map([["t1", "run9"]]))).toEqual({
      to: "/contracts/requests/$runId",
      params: { runId: "run9" },
    });
    expect(approvalTarget(row, new Map([["x", "run9"]]))).toEqual({
      to: "/contracts/c/$id",
      params: { id: "c1" },
    });
    expect(approvalTarget(row)).toEqual({ to: "/contracts/c/$id", params: { id: "c1" } });
  });
});

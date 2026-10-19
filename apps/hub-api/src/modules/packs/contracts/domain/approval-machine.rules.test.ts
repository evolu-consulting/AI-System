// M3-decouple · HD-FR-33/34/36 · D3-02/D3-08: máy trạng thái duyệt trong gói — mọi luật người dùng chốt (spec HD3 §5).
import { describe, expect, test } from "bun:test";
import {
  afterExtraction,
  approvalView,
  canAct,
  type DecideInput,
  decide,
  phaseOf,
} from "./approval-machine.rules";

const A = "a0000000-0000-4000-8000-00000000000a"; // người bắt đầu
const B = "b0000000-0000-4000-8000-00000000000b";
const editor = (userId: string) => ({ userId, inLevel1: true, inLevel2: false });
const owner = (userId: string) => ({ userId, inLevel1: false, inLevel2: true });
const both = (userId: string) => ({ userId, inLevel1: true, inLevel2: true });
const base: DecideInput = {
  status: "level1",
  startedBy: A,
  actor: editor(B),
  action: "approve",
  feedback: undefined,
  value: 245_000_000,
  threshold: 500_000_000,
  hasSource: true,
};

describe("cấp 1 · editor Xác nhận, rẽ theo ngưỡng HIỆN TẠI", () => {
  test("< ngưỡng ⇒ finalize (chưa qua cấp 2); ≥ ngưỡng / trống ⇒ cấp 2", () => {
    expect(decide(base)).toEqual({ kind: "finalize", level2Passed: false });
    expect(decide({ ...base, value: 500_000_000 })).toEqual({ kind: "to_level2" });
    expect(decide({ ...base, value: null })).toEqual({ kind: "to_level2" });
    expect(decide({ ...base, threshold: 100_000_000 })).toEqual({ kind: "to_level2" });
  });
  test("người bắt đầu ĐƯỢC xác nhận cấp 1 (intake câu 5); không thuộc Group cấp 1 ⇒ NOT_REVIEWER", () => {
    expect(decide({ ...base, actor: both(A) })).toEqual({ kind: "finalize", level2Passed: false });
    expect(decide({ ...base, actor: owner(B) })).toEqual({ kind: "error", code: "NOT_REVIEWER" });
  });
});

describe("cấp 2 · owner Duyệt, người bắt đầu bị chặn MỌI thao tác (D3-08)", () => {
  const l2 = { ...base, status: "level2", value: 600_000_000 };
  test("owner khác ⇒ finalize đã qua cấp 2; editor ⇒ NOT_REVIEWER", () => {
    expect(decide({ ...l2, actor: owner(B) })).toEqual({ kind: "finalize", level2Passed: true });
    expect(decide({ ...l2, actor: editor(B) })).toEqual({ kind: "error", code: "NOT_REVIEWER" });
  });
  test("người bắt đầu (kể cả thuộc owner) approve/reject/redo ⇒ STARTER_CANNOT_REVIEW", () => {
    for (const action of ["approve", "reject", "redo"] as const)
      expect(decide({ ...l2, actor: both(A), action, feedback: "x" })).toEqual({
        kind: "error",
        code: "STARTER_CANNOT_REVIEW",
      });
  });
});

describe("Từ chối / Trích lại cần lý do; bước không mở ⇒ 409", () => {
  test("reject/redo thiếu lý do ⇒ FEEDBACK_REQUIRED; có ⇒ reject / redo (có nguồn mới đọc lại)", () => {
    expect(decide({ ...base, action: "reject" })).toEqual({
      kind: "error",
      code: "FEEDBACK_REQUIRED",
    });
    expect(decide({ ...base, action: "redo", feedback: "  " })).toEqual({
      kind: "error",
      code: "FEEDBACK_REQUIRED",
    });
    expect(decide({ ...base, action: "reject", feedback: "Sai" })).toEqual({ kind: "reject" });
    expect(decide({ ...base, action: "redo", feedback: "Đọc lại" })).toEqual({
      kind: "redo",
      reextract: true,
    });
    expect(decide({ ...base, action: "redo", feedback: "x", hasSource: false })).toEqual({
      kind: "redo",
      reextract: false,
    });
  });
  test("extracting / done / rejected ⇒ APPROVAL_NOT_OPEN", () => {
    for (const status of ["extracting", "done", "rejected", "failed", "cancelled"])
      expect(decide({ ...base, status })).toEqual({ kind: "error", code: "APPROVAL_NOT_OPEN" });
  });
});

describe("thẻ duyệt + giai đoạn sửa", () => {
  test("can_act: cấp 1 theo Group 1; cấp 2 theo Group 2 trừ người bắt đầu", () => {
    expect(canAct("level1", A, editor(B))).toBe(true);
    expect(canAct("level1", A, owner(B))).toBe(false);
    expect(canAct("level2", A, owner(B))).toBe(true);
    expect(canAct("level2", A, both(A))).toBe(false);
    expect(canAct("done", A, both(B))).toBe(false);
  });
  test("view giữ hình dạng HD3 (run_id = id lượt duyệt, task_id khi bước mở)", () => {
    const a = { id: B, status: "level2", startedBy: A, feedback: null };
    expect(approvalView(a, owner(B))).toEqual({
      run_id: B,
      run_status: "waiting_review",
      step: "level2",
      task_id: B,
      can_act: true,
      feedback: null,
    });
    expect(approvalView({ ...a, status: "rejected", feedback: "Sai" }, owner(B))).toMatchObject({
      step: "rejected",
      task_id: null,
      can_act: false,
      feedback: "Sai",
    });
    expect(approvalView(null, owner(B))).toMatchObject({ run_id: null, step: null });
  });
  test("phase: extracting/level1 ⇒ level1 (sửa được), level2 ⇒ later (409), khác ⇒ none", () => {
    expect([
      phaseOf("extracting"),
      phaseOf("level1"),
      phaseOf("level2"),
      phaseOf("done"),
      phaseOf(null),
    ]).toEqual(["level1", "level1", "later", "none", "none"]);
  });
  test("AI đọc xong ⇒ level1; lỗi ⇒ failed; HĐ đã đổi trạng thái ⇒ null", () => {
    expect([
      afterExtraction("needs_review"),
      afterExtraction("extract_failed"),
      afterExtraction("active"),
    ]).toEqual(["level1", "failed", null]);
  });
});

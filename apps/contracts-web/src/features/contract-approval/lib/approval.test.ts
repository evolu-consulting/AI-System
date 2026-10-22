// HD-FR-36 · S05: luật hiển thị thẻ duyệt + câu lỗi (không lộ thông điệp máy chủ).
import { describe, expect, test } from "bun:test";
import type { ContractApproval } from "@ai/contracts";
import { ApiError } from "@ai/web-kit/http";
import { approvalView, feedbackOk } from "./approval";
import { approvalErrorText } from "./approval-error";

const A = (o: Partial<ContractApproval>): ContractApproval => ({
  run_id: "11111111-1111-4111-8111-111111111111",
  run_status: "waiting_review",
  step: "level1",
  task_id: "22222222-2222-4222-8222-222222222222",
  can_act: true,
  feedback: null,
  ...o,
});
const W = { write: true, hasSource: true };

describe("approvalView", () => {
  test("cấp 1 + can_act ⇒ Xác nhận, Từ chối, Đọc lại (có nguồn); không nguồn ⇒ không Đọc lại", () => {
    expect(approvalView(A({}), W)).toEqual({
      confirm: true,
      approve: false,
      reject: true,
      redo: true,
      note: null,
    });
    expect(approvalView(A({}), { ...W, hasSource: false }).redo).toBe(false);
  });
  test("cấp 2 + can_act ⇒ Duyệt + Từ chối; không quyết được (người bắt đầu) ⇒ ghi chú chờ", () => {
    expect(approvalView(A({ step: "level2" }), W)).toMatchObject({ approve: true, reject: true });
    expect(approvalView(A({ step: "level2", can_act: false }), W)).toMatchObject({
      approve: false,
      note: "contracts.approval.waitLevel2",
    });
  });
  test("viewer (không write) không thấy nút dù engine báo can_act; chưa có run / đã xong ⇒ trống", () => {
    expect(approvalView(A({}), { ...W, write: false }).confirm).toBe(false);
    expect(approvalView(undefined, W).note).toBeNull();
    expect(approvalView(A({ step: "done" }), W)).toMatchObject({ confirm: false, note: null });
    expect(approvalView(A({ step: "extract" }), W).note).toBe("contracts.approval.working");
  });
  test("không quyết được ⇒ ghi chú nói rõ vì sao, không có nút", () => {
    const note = (o: Partial<ContractApproval>, write = true) =>
      approvalView(A({ can_act: false, ...o }), { ...W, write });
    expect(note({ block_reason: "not_reviewer" })).toEqual({
      confirm: false,
      approve: false,
      reject: false,
      redo: false,
      note: "contracts.approval.blocked.notReviewer.level1",
    });
    expect(note({ step: "level2", block_reason: "not_reviewer" }).note).toBe(
      "contracts.approval.blocked.notReviewer.level2",
    );
    expect(note({ step: "level2", block_reason: "starter" }).note).toBe(
      "contracts.approval.blocked.starter",
    );
    // chỉ xem: báo thiếu quyền sửa, kể cả khi hub báo can_act
    expect(note({ can_act: true }, false).note).toBe("contracts.approval.blocked.viewOnly");
    expect(note({ step: "level2" }, false).note).toBe("contracts.approval.blocked.viewOnly");
    // hub cũ chưa gửi block_reason ⇒ giữ câu chờ cũ
    expect(note({}).note).toBe("contracts.approval.waitLevel1");
  });
  test("lý do bắt buộc, ≤ 4.000 ký tự", () => {
    expect(feedbackOk("  ")).toBe(false);
    expect(feedbackOk("Sai giá")).toBe(true);
    expect(feedbackOk("x".repeat(4001))).toBe(false);
  });
});

describe("approvalErrorText", () => {
  const t = (k: string, o?: Record<string, unknown>) => (o ? `${k}:${JSON.stringify(o)}` : k);
  test("mã engine ⇒ câu riêng; trần ⇒ kèm số; lạ ⇒ câu chung", () => {
    const e = (code: string, details?: unknown) =>
      new ApiError(403, code as never, "raw", { details });
    expect(approvalErrorText(e("STARTER_CANNOT_REVIEW"), t)).toBe(
      "contracts.approval.errors.starter",
    );
    expect(approvalErrorText(e("ACTION_QUOTA", { limit: 100 }), t)).toBe(
      'contracts.approval.errors.quota:{"limit":100}',
    );
    expect(approvalErrorText(e("TOO_MANY_PROCESS_RUNS", { max: 7 }), t)).toBe(
      'contracts.approval.errors.runLimit:{"max":7}',
    );
    expect(approvalErrorText(e("WHATEVER"), t)).toBe("contracts.errors.unknown");
  });
});

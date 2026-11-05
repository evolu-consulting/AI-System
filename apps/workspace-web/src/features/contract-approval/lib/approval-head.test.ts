import { describe, expect, test } from "bun:test";
import { type ApprovalView, afterConfirm, overflowOf, showDraftSave } from "./approval";

const v = (o: Partial<ApprovalView>): ApprovalView => ({
  confirm: false,
  approve: false,
  reject: false,
  redo: false,
  note: null,
  ...o,
});

describe("header ux-excel E4", () => {
  test("cấp 1: chỉ Từ chối vào menu ⋯ (Đọc lại ẩn theo người dùng 2026-10-23)", () => {
    expect(overflowOf(v({ confirm: true, reject: true, redo: true }))).toEqual(["reject"]);
    expect(overflowOf(v({ confirm: true, reject: true }))).toEqual(["reject"]);
  });
  test("không xác nhận được ⇒ không có menu", () => {
    expect(overflowOf(v({ approve: true, reject: true }))).toEqual([]);
    expect(overflowOf(v({ note: "x" }))).toEqual([]);
  });
  test("confirm-flow: hộp Gắn SP đóng khi thành công mọi bước; cấp 2 ⇒ toast chờ BGĐ", () => {
    expect(afterConfirm({ ok: true, step: "done" })).toEqual({
      close: true,
      refetch: true,
      toast: null,
    });
    expect(afterConfirm({ ok: true, step: "level2" })).toEqual({
      close: true,
      refetch: true,
      toast: "contracts.approval.done.toLevel2",
    });
    expect(afterConfirm({ ok: true, step: null }).close).toBe(true);
  });
  test("confirm-flow: bước không còn mở ⇒ đóng + tải lại; lỗi khác ⇒ giữ hộp", () => {
    expect(afterConfirm({ ok: false, code: "APPROVAL_NOT_OPEN" })).toEqual({
      close: true,
      refetch: true,
      toast: null,
    });
    expect(afterConfirm({ ok: false, code: "REVIEW_TASK_CLOSED" }).close).toBe(true);
    expect(afterConfirm({ ok: false, code: "NETWORK_ERROR" })).toEqual({
      close: false,
      refetch: false,
      toast: null,
    });
    expect(afterConfirm({ ok: false, code: null }).close).toBe(false);
  });
  test("Lưu nháp chỉ khi không xác nhận được và có quyền lưu", () => {
    expect(showDraftSave(v({ confirm: true }), true)).toBe(false);
    expect(showDraftSave(v({ note: "contracts.approval.blocked.viewOnly" }), true)).toBe(true);
    expect(showDraftSave(v({}), false)).toBe(false);
  });
});

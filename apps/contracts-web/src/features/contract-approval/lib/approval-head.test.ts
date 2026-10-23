import { describe, expect, test } from "bun:test";
import { type ApprovalView, overflowOf, showDraftSave } from "./approval";

const v = (o: Partial<ApprovalView>): ApprovalView => ({
  confirm: false,
  approve: false,
  reject: false,
  redo: false,
  note: null,
  ...o,
});

describe("header ux-excel E4", () => {
  test("cấp 1: Đọc lại + Từ chối vào menu ⋯", () => {
    expect(overflowOf(v({ confirm: true, reject: true, redo: true }))).toEqual(["redo", "reject"]);
    expect(overflowOf(v({ confirm: true, reject: true }))).toEqual(["reject"]);
  });
  test("không xác nhận được ⇒ không có menu", () => {
    expect(overflowOf(v({ approve: true, reject: true }))).toEqual([]);
    expect(overflowOf(v({ note: "x" }))).toEqual([]);
  });
  test("Lưu nháp chỉ khi không xác nhận được và có quyền lưu", () => {
    expect(showDraftSave(v({ confirm: true }), true)).toBe(false);
    expect(showDraftSave(v({ note: "contracts.approval.blocked.viewOnly" }), true)).toBe(true);
    expect(showDraftSave(v({}), false)).toBe(false);
  });
});

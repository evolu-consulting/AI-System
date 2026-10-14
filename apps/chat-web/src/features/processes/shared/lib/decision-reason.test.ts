// CHAT-AC-60 · AC-PB2-07 · ánh xạ lý do "Cần người quyết" (P-b2 thêm back_limit).
import { describe, expect, test } from "bun:test";
import { DECISION_REASONS, PROCESS_BACK_ROUNDS_MAX } from "@ai/contracts/chat";
import {
  isApplyReason,
  isAutofixReason,
  reasonHintKey,
  reasonKey,
  reasonParams,
} from "./decision-reason";

describe("decision-reason", () => {
  test("back_limit ⇒ khoá common + max = hằng contract", () => {
    expect(DECISION_REASONS).toContain("back_limit");
    expect(reasonKey("back_limit")).toBe("process.common.back_limit");
    expect(reasonParams("back_limit")).toEqual({ max: PROCESS_BACK_ROUNDS_MAX });
  });
  test("P-c1: 2 mã tự sửa có nhãn + hướng dẫn", () => {
    for (const r of ["autofix_check_failed", "sandbox_unavailable"] as const) {
      expect(DECISION_REASONS).toContain(r);
      expect(reasonKey(r)).toBe(`process.common.${r}`);
      expect(reasonHintKey(r)).toBe(`process.common.${r}_hint`);
      expect(reasonParams(r)).toEqual({});
    }
    expect(reasonHintKey("redo_limit")).toBeNull();
  });
  test("P-c2: 2 mã Áp ⇒ nhãn; chỉ apply_conflict có hướng dẫn", () => {
    for (const r of ["apply_conflict", "apply_failed"] as const) {
      expect(DECISION_REASONS).toContain(r);
      expect(reasonKey(r)).toBe(`process.common.${r}`);
      expect(isApplyReason(r)).toBe(true);
    }
    expect(reasonHintKey("apply_conflict")).toBe("process.common.apply_conflict_hint");
    expect(reasonHintKey("apply_failed")).toBeNull();
    expect(isApplyReason("redo_limit")).toBe(false);
  });
  test("mã khác giữ nguyên", () => {
    expect(reasonParams("source_unresolvable")).toEqual({});
  });
});

describe("isAutofixReason (P-c1)", () => {
  test("chỉ 2 mã tự sửa mã", () => {
    expect(isAutofixReason("autofix_check_failed")).toBe(true);
    expect(isAutofixReason("sandbox_unavailable")).toBe(true);
    expect(isAutofixReason("redo_limit")).toBe(false);
    expect(isAutofixReason(undefined)).toBe(false);
  });
});

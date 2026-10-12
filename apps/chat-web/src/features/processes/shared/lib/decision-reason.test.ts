// CHAT-AC-60 · AC-PB2-07 · ánh xạ lý do "Cần người quyết" (P-b2 thêm back_limit).
import { describe, expect, test } from "bun:test";
import { DECISION_REASONS, PROCESS_BACK_ROUNDS_MAX } from "@ai/contracts/chat";
import { reasonKey, reasonParams } from "./decision-reason";

describe("decision-reason", () => {
  test("back_limit ⇒ khoá common + max = hằng contract", () => {
    expect(DECISION_REASONS).toContain("back_limit");
    expect(reasonKey("back_limit")).toBe("process.common.back_limit");
    expect(reasonParams("back_limit")).toEqual({ max: PROCESS_BACK_ROUNDS_MAX });
  });
  test("mã khác giữ nguyên", () => {
    expect(reasonParams("source_unresolvable")).toEqual({});
  });
});

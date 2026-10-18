// HUB-FR-146 · P-d2 · T20-FE: lý do `tool_failed` có câu giải thích (hint) như `retry_exhausted`/`timer_invalid`.
import { describe, expect, test } from "bun:test";
import { reasonHintKey, reasonKey } from "./decision-reason";

describe("tool_failed", () => {
  test("khoá lý do + hint", () => {
    expect(reasonKey("tool_failed")).toBe("process.common.tool_failed");
    expect(reasonHintKey("tool_failed")).toBe("process.common.tool_failed_hint");
  });
});

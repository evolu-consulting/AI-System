import { describe, expect, test } from "bun:test";
import { PROCESS_RUN_STATUSES } from "@ai/contracts/chat";
import { formatSeconds, formatTokens } from "./format";
import { isActiveRun, runStatusKey, statusTone } from "./status";

describe("status", () => {
  test("mọi trạng thái có tone + khoá i18n", () => {
    for (const s of PROCESS_RUN_STATUSES) {
      expect(statusTone(s)).toBeDefined();
      expect(runStatusKey(s)).toBe(`process.common.status.${s}`);
    }
  });
  test("active = năm trạng thái chưa kết thúc (P-d1 thêm waiting_timer)", () => {
    expect(PROCESS_RUN_STATUSES.filter(isActiveRun)).toEqual([
      "running",
      "waiting_review",
      "waiting_answer",
      "needs_decision",
      "waiting_timer",
    ]);
  });
});

describe("format", () => {
  test("giây 1 chữ số thập phân theo ngôn ngữ; null ⇒ —", () => {
    expect(formatSeconds(12000, "en")).toBe("12.0s");
    expect(formatSeconds(12000, "vi")).toBe("12,0s");
    expect(formatSeconds(null, "vi")).toBe("—");
  });
  test("token có phân cách nghìn", () => {
    expect(formatTokens(1234567, "en")).toBe("1,234,567");
  });
});

// CHAT-AC-24..27 · bảng nút theo mã lỗi.
import { describe, expect, test } from "bun:test";
import { errorActions, errorTitleKey, reportText } from "./error-map";

describe("error-map", () => {
  test("nút theo mã", () => {
    expect(errorActions("TIMEOUT")).toEqual({ retry: true, report: false });
    expect(errorActions("UPSTREAM_ERROR")).toEqual({ retry: true, report: false });
    expect(errorActions("ALL_PROVIDERS_EXHAUSTED")).toEqual({ retry: true, report: true });
    expect(errorActions("NOT_CONFIGURED")).toEqual({ retry: false, report: true });
    expect(errorActions("BUDGET_EXCEEDED")).toEqual({ retry: false, report: false });
    expect(errorActions("INTERNAL_ERROR")).toEqual({ retry: true, report: true });
    expect(errorActions("WHAT")).toEqual({ retry: true, report: true });
  });
  test("tiêu đề mã lạ và chuỗi báo admin", () => {
    expect(errorTitleKey("WHAT")).toBe("errors.unknown.title");
    expect(errorTitleKey("TIMEOUT")).toBe("errors.TIMEOUT.title");
    expect(reportText("TIMEOUT", "r1")).toBe("TIMEOUT · run r1");
    expect(reportText("TIMEOUT", null)).toBe("TIMEOUT · run —");
  });
});

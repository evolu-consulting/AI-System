// fix-stale-resubmit · câu lỗi dùng chung: không bao giờ lộ thông điệp thô của máy chủ.
import { describe, expect, it } from "bun:test";
import { ApiError } from "@ai/web-kit/http";
import { isStale, STALE_KEY, unknownErrorText } from "./error-text";

const t = (k: string, o?: Record<string, unknown>) => (o ? `${k}:${JSON.stringify(o)}` : k);

describe("error-text", () => {
  it("isStale chỉ đúng với CONTRACT_STALE", () => {
    expect(isStale(new ApiError(409, "CONTRACT_STALE" as never, "Contract was modified"))).toBe(
      true,
    );
    expect(isStale(new ApiError(409, "REVIEW_NOT_ALLOWED" as never, "x"))).toBe(false);
    expect(isStale(new Error("CONTRACT_STALE"))).toBe(false);
    expect(STALE_KEY).toBe("contracts.errors.stale");
  });
  it("mã lạ ⇒ câu chung + mã; mạng / thân lạ / không phải ApiError ⇒ câu chung thuần", () => {
    expect(unknownErrorText(new ApiError(500, "BOOM" as never, "raw english"), t)).toBe(
      'contracts.errors.unknownCode:{"code":"BOOM"}',
    );
    expect(unknownErrorText(new ApiError(502, "HTTP_ERROR", "Bad Gateway"), t)).toBe(
      "contracts.errors.unknown",
    );
    expect(unknownErrorText(new ApiError(0, "NETWORK_ERROR", "Network error"), t)).toBe(
      "contracts.errors.unknown",
    );
    expect(unknownErrorText(new Error("SELECT *"), t)).toBe("contracts.errors.unknown");
  });
});

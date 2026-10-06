import { describe, expect, test } from "bun:test";
import { describeApiError } from "./api-error";
import { ApiError } from "./http";

describe("describeApiError", () => {
  test("mã đã biết → errors.<CODE>", () => {
    expect(describeApiError(new ApiError(409, "AGENT_HAS_HISTORY", "x")).key).toBe(
      "errors.AGENT_HAS_HISTORY",
    );
  });
  test("INVALID_REFERENCE mang field", () => {
    const e = new ApiError(400, "INVALID_REFERENCE", "x", { field: "profile_id" });
    expect(describeApiError(e).params?.field).toBe("profile_id");
  });
  test("mã lạ / không phải ApiError → login.err.server", () => {
    expect(describeApiError(new ApiError(500, "BOOM", "x"))).toEqual({
      key: "login.err.server",
      params: { code: "BOOM" },
    });
    expect(describeApiError(new Error("x")).params?.code).toBe("UNKNOWN");
  });
  test("mạng → login.err.network", () => {
    expect(describeApiError(new ApiError(0, "NETWORK_ERROR", "x")).key).toBe("login.err.network");
  });
});

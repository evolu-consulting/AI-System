// HD1 D-16 · `TenantState.timezone`: kiểm một lần khi nạp; vắng/sai ⇒ Asia/Ho_Chi_Minh.
import { describe, expect, it } from "bun:test";
import { DEFAULT_TENANT_TZ, tenantTimeZone } from "./config.rules";

describe("tenantTimeZone (D-16)", () => {
  it("IANA hợp lệ giữ; vắng/sai ⇒ Asia/Ho_Chi_Minh", () => {
    expect(tenantTimeZone("Pacific/Kiritimati")).toBe("Pacific/Kiritimati");
    expect(DEFAULT_TENANT_TZ).toBe("Asia/Ho_Chi_Minh");
    for (const v of [null, undefined, "", "Mars/Olympus", 7, "x".repeat(65)])
      expect(tenantTimeZone(v)).toBe(DEFAULT_TENANT_TZ);
  });
});

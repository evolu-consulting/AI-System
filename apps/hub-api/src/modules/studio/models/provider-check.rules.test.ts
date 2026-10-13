// HUB-FR-66 · AC-H4b2-02 · plan H4b2 §2.2 — biên luật "Kiểm tra key" ngoài ca qc (R30–R47).
import { describe, expect, test } from "bun:test";
import { ProviderCheckResultSchema } from "@ai/contracts/studio";
import {
  errorMessageOf,
  hitOfFetchError,
  redactKey,
  subscriptionOutcome,
  vendorCheckRequest,
} from "./provider-check.rules";

const T0 = new Date("2026-10-13T08:00:00.000Z");
const T1 = new Date("2026-10-13T08:00:03.000Z");

describe("HUB-FR-66 · bảng hãng + che key", () => {
  test("base_url có / cuối và path ⇒ nối đúng; vendor `toString` (prototype) ⇒ null", () => {
    expect(vendorCheckRequest("anthropic", "https://p.test/base/", "k")?.url).toBe(
      "https://p.test/base/v1/models",
    );
    expect(vendorCheckRequest("toString", null, "k")).toBeNull();
  });
  test("key rỗng ⇒ chỉ che mẫu; khoảng trắng ⇒ message null", () => {
    expect(redactKey("plain sk-abcdefgh", "")).toBe("plain ***");
    expect(errorMessageOf("   ", "k")).toBeNull();
  });
  test("lỗi fetch: AbortError ⇒ timeout; TypeError / giá trị lạ ⇒ network", () => {
    expect(hitOfFetchError(new DOMException("x", "AbortError"))).toBe("timeout");
    expect(hitOfFetchError(new TypeError("fetch failed"))).toBe("network");
    expect(hitOfFetchError("boom")).toBe("network");
  });
});

describe("HUB-FR-66 · subscriptionOutcome", () => {
  test("chưa có probe mới (null / trước t0 / không hàng) ⇒ null", () => {
    expect(subscriptionOutcome(undefined, T0, T1)).toBeNull();
    const s = { status: "ok", lastProbeAt: null, lastError: null };
    expect(subscriptionOutcome(s, T0, T1)).toBeNull();
    expect(
      subscriptionOutcome({ ...s, lastProbeAt: new Date(T0.getTime() - 1) }, T0, T1),
    ).toBeNull();
  });
  test("probe mới ok|busy ⇒ ok; logged_out ⇒ error kèm last_error đã che; hợp contract", () => {
    const at = { lastProbeAt: T0, lastError: null };
    const ok = subscriptionOutcome({ status: "busy", ...at }, T0, T1);
    expect(ok).toMatchObject({
      status: "ok",
      error_code: null,
      http_status: null,
      latency_ms: 3000,
    });
    const err = subscriptionOutcome(
      { status: "logged_out", lastProbeAt: T1, lastError: "token sk-abcdef123456 expired" },
      T0,
      T1,
    );
    expect(err).toMatchObject({ status: "error", message: "token *** expired" });
    expect(ProviderCheckResultSchema.safeParse(err).success).toBe(true);
    expect(ProviderCheckResultSchema.safeParse(ok).success).toBe(true);
  });
});

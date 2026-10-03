import { describe, expect, test } from "bun:test";
import { isOtpComplete, sanitizeOtp } from "./otp";

describe("ADM-FR-08 · sanitizeOtp", () => {
  test("bỏ ký tự không phải số, cắt 6", () => {
    expect(sanitizeOtp("12a3 45-6789")).toBe("123456");
    expect(sanitizeOtp("")).toBe("");
  });
  test("đủ 6 số", () => {
    expect(isOtpComplete("12345")).toBe(false);
    expect(isOtpComplete("123456")).toBe(true);
  });
});

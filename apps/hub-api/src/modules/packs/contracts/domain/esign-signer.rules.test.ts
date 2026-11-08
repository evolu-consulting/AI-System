// CR-125 · c1 · MỘT định nghĩa "người ký đã ký" (nhắc ký, đổi cách ký, đầu ra node cùng dùng).
import { describe, expect, test } from "bun:test";
import { isSigned } from "./esign-signer.rules";
import { signerDone } from "./esign-sweep.rules";

describe("isSigned", () => {
  test("có mốc ký ⇒ đã ký", () => {
    expect(isSigned({ signed_at: "2026-11-07T00:00:00Z" })).toBe(true);
  });
  test("trạng thái completed/signed (mọi kiểu hoa thường) dù chưa có mốc ⇒ đã ký", () => {
    for (const s of ["completed", "COMPLETED", "Signed", "signed"])
      expect(isSigned({ signed_at: null, status: s })).toBe(true);
  });
  test("chưa ký: không mốc, trạng thái khác / vắng", () => {
    expect(isSigned({ signed_at: null, status: "sent" })).toBe(false);
    expect(isSigned({ signed_at: null })).toBe(false);
    expect(isSigned({})).toBe(false);
  });
  test("luật nhắc ký dùng đúng hàm này", () => {
    const s = { role: "company" as const, order: 1, status: "completed", signed_at: null };
    expect(signerDone(s)).toBe(isSigned(s));
  });
});

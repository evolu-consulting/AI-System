// ADM-FR-08 · M4-R16 · unit lib/totp (vector RFC 6238 phụ lục B; ca biên riêng của lib).
import { describe, expect, it } from "bun:test";
import { base32Decode, base32Encode, hotp, matchTotp, otpauthUrl, timeStep } from "./totp";

const SECRET = new TextEncoder().encode("12345678901234567890");

describe("ADM-FR-08 · lib/totp", () => {
  it("ADM-FR-08 · t = 59 → 287082; bước 1", () => {
    expect(timeStep(new Date(59_000))).toBe(1n);
    expect(hotp(SECRET, 1n)).toBe("287082");
  });

  it("ADM-FR-08 · base32 khứ hồi mọi độ dài 0..25 byte", () => {
    for (let n = 0; n <= 25; n++) {
      const b = Uint8Array.from({ length: n }, (_, i) => (i * 37 + n) & 0xff);
      expect(Array.from(base32Decode(base32Encode(b)))).toEqual(Array.from(b));
    }
  });

  it("ADM-FR-08 · base32Decode ném khi có '=' (không padding) — message không chứa input", () => {
    expect(() => base32Decode("MY======")).toThrow("base32: ký tự không hợp lệ");
  });

  it("ADM-FR-08 · matchTotp: lastUsedStep = T+1 chặn cả cửa sổ; mã có khoảng trắng → null", () => {
    const now = new Date(1_111_111_111_000);
    const t = timeStep(now);
    expect(matchTotp(SECRET, hotp(SECRET, t + 1n), now, t + 1n)).toBeNull();
    expect(matchTotp(SECRET, ` ${hotp(SECRET, t)}`, now, null)).toBeNull();
  });

  it("ADM-FR-08 · otpauthUrl mã hoá nhãn, không '+' cho khoảng trắng", () => {
    const u = otpauthUrl({ secretB32: "MZXW6", issuer: "AI System", account: "a b" });
    expect(u).toBe(
      "otpauth://totp/AI%20System:a%20b?secret=MZXW6&issuer=AI%20System&algorithm=SHA1&digits=6&period=30",
    );
  });
});

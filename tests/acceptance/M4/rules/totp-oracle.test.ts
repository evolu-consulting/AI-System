// ADM-FR-08 · M4-R16 · tự kiểm oracle `_totp.ts` bằng vector RFC 4226 phụ lục D, RFC 6238 phụ lục B, RFC 4648 §10.
// File này phải XANH ngay từ Q2 (oracle sai thì mọi test 2FA đều vô nghĩa).
import { describe, expect, it } from "bun:test";
import {
  b32,
  hotpOracle,
  RFC_SECRET_ASCII,
  RFC_SECRET_B32,
  stepOf,
  totpAt,
  unb32,
  wrongCodeAt,
} from "../_totp";

const enc = (s: string) => new TextEncoder().encode(s);

describe("ADM-FR-08 · oracle TOTP (test tự kiểm)", () => {
  it("ADM-FR-08 · oracle · base32 RFC 4648 §10 (không padding) + giải ngược", () => {
    const cases: Array<[string, string]> = [
      ["", ""],
      ["f", "MY"],
      ["fo", "MZXQ"],
      ["foo", "MZXW6"],
      ["foob", "MZXW6YQ"],
      ["fooba", "MZXW6YTB"],
      ["foobar", "MZXW6YTBOI"],
    ];
    for (const [plain, coded] of cases) {
      expect(b32(enc(plain))).toBe(coded);
      expect(new TextDecoder().decode(unb32(coded))).toBe(plain);
    }
    expect(b32(enc(RFC_SECRET_ASCII))).toBe(RFC_SECRET_B32);
    expect(() => unb32("MZ!W")).toThrow();
  });

  it("ADM-FR-08 · oracle · HOTP RFC 4226 phụ lục D (counter 0..9)", () => {
    const want = "755224 287082 359152 969429 338314 254676 287922 162583 399871 520489".split(" ");
    const got = want.map((_, i) => hotpOracle(enc(RFC_SECRET_ASCII), i));
    expect(got).toEqual(want);
  });

  it("ADM-FR-08 · oracle · TOTP RFC 6238 phụ lục B (SHA1, 6 số cuối, giữ số 0 đầu)", () => {
    const vec: Array<[number, string]> = [
      [59, "287082"],
      [1111111109, "081804"],
      [1111111111, "050471"],
      [1234567890, "005924"],
      [2000000000, "279037"],
      [20000000000, "353130"],
    ];
    for (const [t, code] of vec) expect(totpAt(RFC_SECRET_B32, t)).toBe(code);
    expect([0, 29, 30, 59, 60].map(stepOf)).toEqual([0, 0, 1, 1, 2]);
  });

  it("ADM-FR-08 · oracle · wrongCodeAt khác mã của 5 bước quanh T", () => {
    const t = 1111111111;
    const w = wrongCodeAt(RFC_SECRET_B32, t);
    expect(w).toMatch(/^\d{6}$/);
    for (const d of [-2, -1, 0, 1, 2]) expect(totpAt(RFC_SECRET_B32, t + d * 30)).not.toBe(w);
  });
});

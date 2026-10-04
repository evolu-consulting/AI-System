import { describe, expect, test } from "bun:test";
import { hashJobToken, isJobToken } from "./job-token";

// Vector cố định dùng chung với Runtime Python (P01/P28): sha256 tính độc lập bằng `sha256sum`. Token thử, không thật.
const VECTORS: { token: string; sha256: string }[] = [
  {
    token: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    sha256: "0f007385b6f9d4b7eeb2748605afe1a984a0a3bfa3f014d09e2a784ce9e5cd1a",
  },
  {
    token: "test_job-token-vector_0123456789_abcdefghij",
    sha256: "612aac117a8936eada56e1dfb1a962d6c062699c16440affb607229af893ff22",
  },
];

describe("HUB-FR-50 · H2a-R18 · job-token (P4)", () => {
  test.each(VECTORS)("hashJobToken = sha256 ASCII, 32 byte ($token)", (v) => {
    const h = hashJobToken(v.token);
    expect(h.length).toBe(32);
    expect(h.toString("hex")).toBe(v.sha256);
  });

  test("isJobToken: đúng 43 ký tự base64url", () => {
    for (const v of VECTORS) expect(isJobToken(v.token)).toBe(true);
    for (const bad of [
      "",
      "A".repeat(42),
      "A".repeat(44),
      `${"A".repeat(42)}=`,
      `${"A".repeat(42)}+`,
    ])
      expect(isJobToken(bad)).toBe(false);
  });
});

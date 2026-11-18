import { describe, expect, it } from "bun:test";
import { pickMatch, SHA256_RE, type VerifyCandidate } from "./verify-file.rules";

const base: VerifyCandidate = {
  contractId: "c1",
  contractTitle: "HĐ A",
  which: "signed",
  sha256: `abcdef12${"0".repeat(56)}`,
  signedBy: "An",
  signedAt: "2026-11-01T00:00:00Z",
  fileId: "f1",
  seq: 1,
  versionId: "v1",
};

describe("CR-182 R7 · pickMatch", () => {
  it("không có bản nào ⇒ không khớp", () => {
    expect(pickMatch([])).toEqual({ match: false });
  });
  it("bản đã ký ⇒ mã kiểm tra = 8 ký tự đầu viết hoa", () => {
    expect(pickMatch([base])).toMatchObject({
      match: true,
      which: "signed",
      check_code: "ABCDEF12",
      signed_by: "An",
    });
  });
  it("ưu tiên bản đã ký hơn tệp gốc, rồi bản mới nhất", () => {
    const orig: VerifyCandidate = {
      ...base,
      which: "original",
      signedBy: null,
      signedAt: null,
      fileId: null,
      seq: null,
      versionId: null,
    };
    const later: VerifyCandidate = {
      ...base,
      seq: 2,
      signedAt: "2026-11-05T00:00:00Z",
      signedBy: "Bình",
    };
    expect(pickMatch([orig, base, later])).toMatchObject({
      which: "signed",
      seq: 2,
      signed_by: "Bình",
    });
    expect(pickMatch([orig])).toMatchObject({ which: "original", signed_by: null });
  });
  it("sha256 hợp lệ là 64 ký tự thường", () => {
    expect(SHA256_RE.test(base.sha256)).toBe(true);
    expect(SHA256_RE.test("ABC")).toBe(false);
  });
});

import { describe, expect, it } from "bun:test";
import { docKindOf, pickMatch, SHA256_RE, type VerifyCandidate } from "./verify-file.rules";

const base: VerifyCandidate = {
  visible: true,
  contractId: "c1",
  contractTitle: "HĐ A",
  docKind: "contract",
  partner: "Công ty X",
  sha256: `abcdef12${"0".repeat(56)}`,
  signedBy: "An",
  signedAt: "2026-11-01T00:00:00Z",
  fileId: "f1",
  seq: 1,
  versionId: "v1",
};
const hiddenRow: VerifyCandidate = {
  ...base,
  visible: false,
  contractId: null,
  contractTitle: null,
  docKind: null,
  partner: null,
  signedBy: null,
  fileId: null,
  seq: null,
  versionId: null,
};

describe("CR-188 BR-188-6 · pickMatch", () => {
  it("(c) không có bản nào ⇒ không khớp, cùng hình dạng", () => {
    const miss = pickMatch([]);
    expect(miss).toMatchObject({ match: false, visible: false, contract: null });
    expect(Object.keys(miss).sort()).toEqual(Object.keys(pickMatch([base])).sort());
  });
  it("(a) khớp + có quyền ⇒ HĐ, loại, đối tác, giờ ký, mã kiểm tra", () => {
    expect(pickMatch([base])).toMatchObject({
      match: true,
      visible: true,
      other: false,
      contract: { id: "c1", title: "HĐ A", kind: "contract", partner: "Công ty X" },
      check_code: "ABCDEF12",
      signed_by: "An",
      signed_at: "2026-11-01T00:00:00Z",
    });
  });
  it("(a') khớp mà không quyền ⇒ chỉ match, mọi chi tiết null, không rò id", () => {
    const r = pickMatch([hiddenRow]);
    expect(r).toMatchObject({
      match: true,
      visible: false,
      contract: null,
      check_code: null,
      signed_at: null,
    });
    expect(Object.keys(r).sort()).toEqual(Object.keys(pickMatch([base])).sort());
  });
  it("(b) gọi kèm HĐ đang mở mà khớp HĐ khác ⇒ other=true; khớp chính nó ⇒ other=false, ưu tiên bản của nó", () => {
    const o = { ...base, contractId: "c2", signedAt: "2026-11-09T00:00:00Z" };
    expect(pickMatch([o], "c1")).toMatchObject({
      match: true,
      other: true,
      contract: { id: "c2" },
    });
    expect(pickMatch([o, base], "c1")).toMatchObject({ other: false, contract: { id: "c1" } });
    expect(pickMatch([hiddenRow], "c1")).toMatchObject({ visible: false, other: true });
  });
  it("bản mới nhất không xem được không che bản cũ xem được", () => {
    const newerHidden = { ...hiddenRow, signedAt: "2026-11-09T00:00:00Z" };
    expect(pickMatch([newerHidden, base])).toMatchObject({
      match: true,
      visible: true,
      contract: { id: "c1" },
    });
  });
  it("nhiều bản ⇒ bản ký mới nhất", () => {
    const later = { ...base, seq: 2, signedAt: "2026-11-05T00:00:00Z", signedBy: "Bình" };
    expect(pickMatch([base, later])).toMatchObject({ seq: 2, signed_by: "Bình" });
  });
  it("loại giấy tờ: phụ lục / hợp đồng / khác", () => {
    expect(docKindOf("appendix", "contract")).toBe("appendix");
    expect(docKindOf("contract", "contract")).toBe("contract");
    expect(docKindOf("contract", "deal")).toBe("other");
  });
  it("sha256 hợp lệ là 64 ký tự thường", () => {
    expect(SHA256_RE.test(base.sha256)).toBe(true);
    expect(SHA256_RE.test("ABC")).toBe(false);
  });
});

import { describe, expect, it } from "bun:test";
import { asDate, foldVi, searchKey, signerKeys } from "./fold.rules";
import { isContractStatus } from "./status.rules";

describe("asDate (D-15)", () => {
  it("ngày hợp lệ ⇒ chính chuỗi; năm nhuận", () => {
    expect(asDate("2027-03-31")).toBe("2027-03-31");
    expect(asDate("2028-02-29")).toBe("2028-02-29");
  });
  it("không hợp lệ ⇒ null, không ném", () => {
    for (const s of [
      "2027-02-30",
      "2027-02-29",
      "1900-02-29",
      "2027-13-01",
      "2027-00-10",
      "2027-3-1",
      "31/12/2026",
      "0000-01-01",
      "",
      null,
    ])
      expect(asDate(s)).toBeNull();
  });
});
describe("khoá lọc (D-14)", () => {
  it("signerKeys bỏ null", () => {
    expect(signerKeys("Nguyễn Văn A – GĐ", null)).toEqual(["nguyen van a"]);
    expect(signerKeys(" ", null)).toEqual([]);
  });
  it("searchKey gộp, fold, thiếu ⇒ ''", () => {
    expect(searchKey(["Hợp Đồng", null, "ABC", undefined])).toBe("hop dong abc");
    expect(foldVi(searchKey([null]))).toBe("");
  });
});
describe("status", () => {
  it("CR-127 · 4 trạng thái (draft/processing/reject/done) hợp lệ; 9 trạng thái cũ và lạ thì không", () => {
    for (const s of ["draft", "processing", "reject", "done"])
      expect(isContractStatus(s)).toBe(true);
    for (const s of ["rejected", "needs_review", "extracting", "active", "expiring"])
      expect(isContractStatus(s)).toBe(false);
    expect(isContractStatus("deleted")).toBe(false);
  });
});

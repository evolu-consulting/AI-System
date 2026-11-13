import { describe, expect, test } from "bun:test";
import { signedUploadMime, signedUploadVerdict, signStepPasses } from "./sign-upload.rules";

describe("CR-141 · luật bước Ký hợp đồng", () => {
  test("qua bước khi đã ký số hoặc đã tải bản ký, không có cái nào thì chưa qua", () => {
    expect(signStepPasses({ digitallySigned: true, uploadedFile: false })).toBe(true);
    expect(signStepPasses({ digitallySigned: false, uploadedFile: true })).toBe(true);
    expect(signStepPasses({ digitallySigned: false, uploadedFile: false })).toBe(false);
  });
  test("chỉ nhận PDF, JPG, PNG (không phân biệt hoa thường)", () => {
    expect(signedUploadMime("HD.PDF")).toBe("application/pdf");
    expect(signedUploadMime("scan.jpeg")).toBe("image/jpeg");
    expect(signedUploadMime("a.png")).toBe("image/png");
    expect(signedUploadMime("a.docx")).toBeNull();
    expect(signedUploadMime("noext")).toBeNull();
  });
  test("người được giao tải được, người khác bị chặn, Toàn quyền duyệt thay", () => {
    const base = { awaiting: true, assigned: ["u1"], userId: "u1", admin: false };
    expect(signedUploadVerdict(base)).toEqual({ ok: true, override: false });
    expect(signedUploadVerdict({ ...base, userId: "u2" })).toEqual({
      ok: false,
      reason: "forbidden",
    });
    expect(signedUploadVerdict({ ...base, userId: "u2", admin: true })).toEqual({
      ok: true,
      override: true,
    });
  });
  test("bước không còn chờ thì không tải, kể cả Toàn quyền", () => {
    expect(
      signedUploadVerdict({ awaiting: false, assigned: ["u1"], userId: "u1", admin: true }),
    ).toEqual({ ok: false, reason: "not_awaiting" });
  });
});

import { describe, expect, test } from "bun:test";
import {
  checkSignedUpload,
  signedUploadMime,
  signedUploadVerdict,
  signStepPasses,
} from "./sign-upload.rules";

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

describe("CR-141 · kiểm nội dung tệp", () => {
  const b = (...x: number[]) => new Uint8Array(x);
  test("đuôi và chữ ký đầu tệp khớp thì qua; đổi đuôi tệp khác thì không", () => {
    expect(checkSignedUpload("a.pdf", b(0x25, 0x50, 0x44, 0x46, 1))).toEqual({
      ok: true,
      mime: "application/pdf",
    });
    expect(checkSignedUpload("a.JPG", b(0xff, 0xd8, 0xff, 0xe0))).toEqual({
      ok: true,
      mime: "image/jpeg",
    });
    expect(checkSignedUpload("a.png", b(0x89, 0x50, 0x4e, 0x47))).toEqual({
      ok: true,
      mime: "image/png",
    });
    expect(checkSignedUpload("a.pdf", b(0x50, 0x4b, 3, 4))).toEqual({
      ok: false,
      reason: "content",
    });
    expect(checkSignedUpload("a.png", b(0xff, 0xd8, 0xff))).toEqual({
      ok: false,
      reason: "content",
    });
    expect(checkSignedUpload("a.docx", b(0x25, 0x50, 0x44, 0x46))).toEqual({
      ok: false,
      reason: "ext",
    });
  });
});

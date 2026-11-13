// CR-141 · luật thuần khối «Tải lên bản đã ký».
import { describe, expect, it } from "bun:test";
import {
  isSignedFileName,
  isUploadOverride,
  showSignedUpload,
  uploadErrKey,
} from "./signed-upload-view";

describe("showSignedUpload", () => {
  it("chỉ hiện khi bước đang chờ VÀ người xem được tải", () => {
    expect(showSignedUpload({ awaiting: true, can_upload: true, override: false })).toBe(true);
    expect(showSignedUpload({ awaiting: true, can_upload: false, override: false })).toBe(false);
    expect(showSignedUpload({ awaiting: false, can_upload: true, override: false })).toBe(false);
    expect(showSignedUpload(undefined)).toBe(false);
  });
  it("«duyệt thay» chỉ khi khối đang hiện và override", () => {
    expect(isUploadOverride({ awaiting: true, can_upload: true, override: true })).toBe(true);
    expect(isUploadOverride({ awaiting: false, can_upload: true, override: true })).toBe(false);
    expect(isUploadOverride({ awaiting: true, can_upload: true, override: false })).toBe(false);
  });
});

describe("isSignedFileName / uploadErrKey", () => {
  it("nhận PDF/JPG/JPEG/PNG (không phân biệt hoa thường), từ chối còn lại", () => {
    for (const n of ["a.pdf", "A.PDF", "b.jpg", "c.JPEG", "d.png"])
      expect(isSignedFileName(n)).toBe(true);
    for (const n of ["a.docx", "b.pdf.exe", "c"]) expect(isSignedFileName(n)).toBe(false);
  });
  it("mã máy chủ ⇒ khoá riêng; lạ ⇒ unknown", () => {
    expect(uploadErrKey("FILE_TYPE")).toBe("contracts.esign.upload.err.FILE_TYPE");
    expect(uploadErrKey("SIGN_UPLOAD_NOT_AWAITING")).toBe(
      "contracts.esign.upload.err.SIGN_UPLOAD_NOT_AWAITING",
    );
    expect(uploadErrKey("ZZZ")).toBe("contracts.esign.upload.err.unknown");
    expect(uploadErrKey(null)).toBe("contracts.esign.upload.err.unknown");
  });
});

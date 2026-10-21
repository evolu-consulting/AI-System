// Gap #9: kiểm tệp + tiến độ lô.
import { describe, expect, test } from "bun:test";
import { batchProgress, checkFile, sizeText, UPLOAD_MAX_BYTES } from "./upload-queue";

describe("hàng đợi tải lên · luật thuần", () => {
  test("nhận pdf/docx/ảnh/.md (không phân biệt hoa thường); từ chối đuôi lạ, rỗng, > 20 MB", () => {
    for (const n of ["a.pdf", "A.DOCX", "x.png", "x.jpg", "x.JPEG", "dieu-khoan.md", "n.markdown"])
      expect(checkFile({ name: n, size: 10 })).toBe("ok");
    expect(checkFile({ name: "a.exe", size: 10 })).toBe("type");
    expect(checkFile({ name: "a", size: 10 })).toBe("type");
    expect(checkFile({ name: "a.pdf", size: 0 })).toBe("empty");
    expect(checkFile({ name: "a.pdf", size: UPLOAD_MAX_BYTES })).toBe("ok");
    expect(checkFile({ name: "a.pdf", size: UPLOAD_MAX_BYTES + 1 })).toBe("size");
  });
  test("dung lượng + tiến độ lô", () => {
    expect(sizeText(1536 * 1024)).toBe("1,5 MB");
    expect(sizeText(200)).toBe("1 KB");
    const it = (state: "queued" | "uploading" | "done" | "error") => ({
      key: 1,
      name: "a",
      size: 1,
      state,
    });
    expect(batchProgress([it("done"), it("error"), it("uploading"), it("queued")])).toEqual({
      finished: 2,
      total: 4,
    });
  });
});

// CR-149 · chọn kiểu xem: ảnh raster / PDF / Word xem được; SVG, HTML, .doc cũ, Excel ⇒ chỉ «Tải về».
import { describe, expect, test } from "bun:test";
import { DOCX_MIME, viewerKind } from "./viewer-kind";

describe("viewerKind (CR-149)", () => {
  test("chỉ ảnh raster, PDF và docx xem được", () => {
    for (const m of ["image/png", "image/jpeg", "image/webp", "image/gif", "IMAGE/PNG; x=1"])
      expect(viewerKind(m)).toBe("image");
    expect(viewerKind("application/pdf")).toBe("pdf");
    expect(viewerKind(DOCX_MIME)).toBe("docx");
    for (const m of [
      "image/svg+xml",
      "text/html",
      "application/zip",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "",
    ])
      expect(viewerKind(m, "x.bin")).toBe("other");
  });

  test("mime chung chung ⇒ dựa đuôi .pdf/.docx; .doc/.xlsx vẫn là loại khác", () => {
    expect(viewerKind("application/octet-stream", "HD.PDF")).toBe("pdf");
    expect(viewerKind("", "hd.docx")).toBe("docx");
    expect(viewerKind("application/octet-stream", "hd.doc")).toBe("other");
    expect(viewerKind("application/octet-stream", "b.xlsx")).toBe("other");
    expect(viewerKind("text/html", "a.pdf")).toBe("other"); // mime cụ thể thắng đuôi
  });
});

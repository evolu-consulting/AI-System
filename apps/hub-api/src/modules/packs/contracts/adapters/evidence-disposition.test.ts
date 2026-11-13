import { describe, expect, it } from "bun:test";
import { canInline, evidenceHeaders } from "./evidence-disposition";

const f = (mime: string) => ({ name: "a b.png", mime, size: 3 });

describe("CR-144 evidenceHeaders", () => {
  it("ảnh raster + PDF với inline ⇒ inline; luôn nosniff", () => {
    for (const m of ["image/png", "image/jpeg", "image/webp", "image/gif", "application/pdf"]) {
      const h = evidenceHeaders(f(m), true);
      expect(h["content-disposition"]).toStartWith("inline;");
      expect(h["x-content-type-options"]).toBe("nosniff");
    }
  });
  it("SVG và HTML luôn attachment dù inline", () => {
    for (const m of ["image/svg+xml", "text/html", "application/octet-stream", ""]) {
      expect(canInline(m)).toBe(false);
      expect(evidenceHeaders(f(m), true)["content-disposition"]).toStartWith("attachment;");
    }
  });
  it("inline ⇒ có CSP sandbox; attachment ⇒ không", () => {
    expect(evidenceHeaders(f("application/pdf"), true)["content-security-policy"]).toBe(
      "sandbox; default-src 'none'",
    );
    expect(evidenceHeaders(f("text/html"), true)["content-security-policy"]).toBeUndefined();
  });
  it("không có inline ⇒ attachment như cũ", () => {
    expect(evidenceHeaders(f("image/png"), false)["content-disposition"]).toStartWith(
      "attachment;",
    );
  });
  it("mime kèm tham số vẫn nhận; tên có dấu cách được mã hoá", () => {
    expect(canInline("Image/PNG; charset=x")).toBe(true);
    expect(evidenceHeaders(f("image/png"), true)["content-disposition"]).toContain("a%20b.png");
  });
});

import { describe, expect, it } from "bun:test";
import { isPdfFile, splitForEsign } from "./pdf-gate";

const f = (name: string, type = "") => ({ name, type });

describe("splitForEsign (CR-125 UX H6)", () => {
  it("ký số bật ⇒ tệp không phải PDF bị giữ lại, PDF đi tiếp", () => {
    const r = splitForEsign([f("a.pdf", "application/pdf"), f("b.md"), f("c.DOCX")], true);
    expect(r.ok.map((x) => x.name)).toEqual(["a.pdf"]);
    expect(r.notPdf).toEqual(["b.md", "c.DOCX"]);
  });
  it("ký số tắt ⇒ nhận mọi tệp", () => {
    const r = splitForEsign([f("b.md"), f("c.docx")], false);
    expect(r.ok).toHaveLength(2);
    expect(r.notPdf).toEqual([]);
  });
  it("nhận PDF theo đuôi (không phân biệt hoa thường) hoặc theo kiểu", () => {
    expect(isPdfFile(f("X.PDF"))).toBe(true);
    expect(isPdfFile(f("x", "application/pdf"))).toBe(true);
    expect(isPdfFile(f("x.txt", "text/plain"))).toBe(false);
  });
});

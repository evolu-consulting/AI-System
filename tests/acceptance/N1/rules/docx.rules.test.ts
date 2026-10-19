// PK-FR-07 · PK-AC08 · plan §7: luật thuần `checkZipEntries` + hằng giới hạn (docx.rules.ts). PHỤ THUỘC ADR-0024 Accepted
// (spec Q3 · D-10) — chưa duyệt ⇒ đỏ NGAY "PHỤ THUỘC" (qc đếm riêng, không tính "đỏ đúng lý do tính năng").
import { describe, expect, it } from "bun:test";
import { loadDocxRules, needAdr0024Accepted } from "../_support/load";

const MiB = 1024 * 1024;
const part = (name: string, originalSize: number) => ({ name, originalSize });
const rules = async () => {
  needAdr0024Accepted();
  return loadDocxRules();
};

describe("PK-FR-07 · [ADR-0024] giới hạn zip DOCX", () => {
  it("PK-FR-07 · hằng: DOCX_MAX_PARTS=2000, DOCX_MAX_UNZIP=100 MiB, DOCX_MAX_MD=5.000.000", async () => {
    const r = await rules();
    expect({ p: r.DOCX_MAX_PARTS, u: r.DOCX_MAX_UNZIP, m: r.DOCX_MAX_MD }).toEqual({
      p: 2000,
      u: 100 * MiB,
      m: 5_000_000,
    });
  });
  it("PK-FR-07 · DOCX thường (document.xml, styles, numbering) ⇒ ok", async () => {
    const { checkZipEntries } = await rules();
    expect(
      checkZipEntries([
        part("[Content_Types].xml", 800),
        part("word/document.xml", 90_000),
        part("word/styles.xml", 20_000),
      ]),
    ).toBe("ok");
  });
  it("PK-FR-07 · đúng 2.000 phần ⇒ ok; 2.001 phần ⇒ TOO_MANY_PARTS", async () => {
    const { checkZipEntries } = await rules();
    const mk = (n: number) => Array.from({ length: n }, (_, i) => part(`word/media/p${i}.xml`, 10));
    expect(checkZipEntries(mk(2000))).toBe("ok");
    expect(checkZipEntries(mk(2001))).toBe("TOO_MANY_PARTS");
  });
  it("PK-FR-07 · tổng giải nén đúng 100 MiB ⇒ ok; vượt 1 byte ⇒ TOO_LARGE (zip bomb khai báo)", async () => {
    const { checkZipEntries } = await rules();
    expect(checkZipEntries([part("word/document.xml", 100 * MiB)])).toBe("ok");
    expect(checkZipEntries([part("word/document.xml", 100 * MiB + 1)])).toBe("TOO_LARGE");
    expect(checkZipEntries([part("a", 60 * MiB), part("b", 41 * MiB)])).toBe("TOO_LARGE");
  });
  it("PK-FR-07 · có word/vbaProject.bin (macro) ⇒ MACRO", async () => {
    const { checkZipEntries } = await rules();
    expect(checkZipEntries([part("word/document.xml", 10), part("word/vbaProject.bin", 10)])).toBe(
      "MACRO",
    );
  });
  it("PK-FR-07 · thuần: danh sách rỗng không ném", async () => {
    const { checkZipEntries } = await rules();
    expect(() => checkZipEntries([])).not.toThrow();
  });
});

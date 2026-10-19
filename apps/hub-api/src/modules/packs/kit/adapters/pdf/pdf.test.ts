// ADR-0028 · R1: PDF → chữ qua worker `unpdf`. PDF dựng trong test (font chuẩn Helvetica, không cần tệp mẫu): trang có chữ ⇒
// ok + đủ chữ theo thứ tự trang; trang không chữ ⇒ PDF_NEEDS_OCR; rác ⇒ PDF_UNREADABLE; quá cỡ ⇒ PDF_TOO_LARGE trước worker;
// hàng đợi đầy ⇒ PDF_BUSY. Luật thuần (`pdf.rules`) kiểm riêng.
import { afterAll, describe, expect, it } from "bun:test";
import { isPdf, isScanned, PDF_MAX_INPUT, pagesToText, pdfResultOf } from "../../domain/pdf.rules";
import { convertPdf } from "./convert";
import { createPdfConverter } from "./index";
import { makePdf } from "./pdf.fixture.test-util";

const LONG =
  "Dieu 3. Thanh toan: Ben A thanh toan trong vong 30 ngay ke tu ngay nhan hoa don hop le.";
const conv = createPdfConverter({ maxPending: 2 });
afterAll(() => conv.close());

describe("pdf.rules", () => {
  it("isPdf theo chữ ký %PDF-; isScanned theo trang trung vị < 50 ký tự", () => {
    expect(isPdf(new TextEncoder().encode("%PDF-1.7\n"))).toBe(true);
    expect(isPdf(new TextEncoder().encode("PK\u0003\u0004"))).toBe(false);
    expect(isScanned([])).toBe(true);
    expect(isScanned(["", "", LONG])).toBe(true);
    expect(isScanned([LONG, "", LONG])).toBe(false);
  });
  it("pagesToText nối trang bằng dòng trống, gom dòng trắng; quá 500 trang ⇒ PDF_TOO_LARGE", () => {
    expect(pagesToText(["a  \n\n\n\nb", "  ", "c"]).text).toBe("a\n\nb\n\nc");
    expect(pdfResultOf([LONG], 501)).toEqual({ ok: false, code: "PDF_TOO_LARGE" });
  });
});

describe("convertPdf / createPdfConverter (worker)", () => {
  it("PDF có lớp chữ ⇒ ok, đủ chữ theo thứ tự trang", async () => {
    const r = await conv.toText(
      makePdf([
        [LONG, "Trang mot"],
        [LONG, "Trang hai"],
      ]),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.pages).toBe(2);
    expect(r.markdown).toContain("30 ngay");
    expect(r.markdown.indexOf("Trang mot")).toBeLessThan(r.markdown.indexOf("Trang hai"));
  });
  it("PDF scan (không lớp chữ) ⇒ PDF_NEEDS_OCR", async () => {
    expect(await conv.toText(makePdf([[], [], ["x"]]))).toEqual({
      ok: false,
      code: "PDF_NEEDS_OCR",
    });
  });
  it("rác / zip ⇒ PDF_UNREADABLE (không ném)", async () => {
    expect(await convertPdf(new TextEncoder().encode("not a pdf"))).toEqual({
      ok: false,
      code: "PDF_UNREADABLE",
    });
    expect(await convertPdf(new TextEncoder().encode("%PDF-1.4\n garbage"))).toEqual({
      ok: false,
      code: "PDF_UNREADABLE",
    });
  });
  it("đầu vào > 20 MiB ⇒ PDF_TOO_LARGE trước khi vào worker; hàng đợi đầy ⇒ PDF_BUSY", async () => {
    expect(await conv.toText(new Uint8Array(PDF_MAX_INPUT + 1))).toEqual({
      ok: false,
      code: "PDF_TOO_LARGE",
    });
    const one = createPdfConverter({ maxPending: 1 });
    const pdf = makePdf([[LONG]]);
    const [a, b] = await Promise.all([one.toText(pdf), one.toText(pdf)]);
    expect(a.ok).toBe(true);
    expect(b).toEqual({ ok: false, code: "PDF_BUSY" });
    await one.close();
  });
});

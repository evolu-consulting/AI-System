// CR-181 · s8 · đọc nhanh một PDF để cho bật «Cần ký» (Q13): đếm trang, nhận ra tệp có mật khẩu / hỏng. pdf-lib đã có ở hub-api (s7).
import { EncryptedPDFError, PDFDocument } from "pdf-lib";
import type { PdfProbe } from "../domain/sign.rules";

export async function probePdf(bytes: Uint8Array): Promise<PdfProbe> {
  try {
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    return { ok: true, pages: doc.getPageCount() };
  } catch (e) {
    // pdf-lib biên dịch ES5 nên `instanceof` có thể sai ⇒ nhận diện thêm theo thông điệp (như sign-stamp.pdf.ts).
    const enc =
      e instanceof EncryptedPDFError || (e instanceof Error && /is encrypted/.test(e.message));
    return { ok: false, reason: enc ? "encrypted" : "invalid" };
  }
}
